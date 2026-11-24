// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: LSP 会话管理与 code-reader 仓库模型强绑定
// grill: 成品检索=skill 库无 code-reader LSP 成品; 输入固定=仓库对象/JSON-RPC 固定方法; 步骤机械=启动/同步文档/请求/重置; 判读固定=LSP 标准 result 结构; 失效场景=构造不出（仅本应用）
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './errors.js';
import { listSourceFiles, readSource } from './git.js';
import { clearCompilationDatabase, prepareCompilationDatabase } from './compile-db.js';
import { searchSymbolDefinitions } from './symbol-search.js';

const execFileAsync = promisify(execFile);
const REQUEST_TIMEOUT = 60_000;
const MAX_OPEN_DOCUMENTS = 200;
// clangd 17+ 支持内核树的 `asm __inline` 等新语法；更旧的 clangd 会让全部 LSP 查询落空。
const MODERN_CLANGD_MAJOR = 17;
const ENGINE_CACHE_TTL = 60_000;

const LANGUAGE_BY_EXTENSION = new Map(Object.entries({
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.S': 'cpp',
}));

function pathToFileUri(absolute) {
  return `file://${absolute.split('/').map(encodeURIComponent).join('/')}`;
}

function fileUriToPath(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return null;
  try {
    return decodeURIComponent(uri.slice('file://'.length));
  } catch {
    return null;
  }
}

function executable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// 优先使用环境变量指定的 clangd；否则按「PATH 中的 clangdN / clangd-N」+ neovim mason 安装目录
// 收集候选，实测版本后按主版本号从高到低选择（系统自带 clangd 10 无法解析现代内核树）。
function candidateCommands() {
  const explicit = (process.env.CODE_READER_CLANGD || '').trim();
  if (explicit) return [explicit];
  const preference = (process.env.CODE_READER_LSP || 'auto').trim().toLowerCase();
  const names = ['clangd', 'ccls'];
  for (let major = 21; major >= 14; major -= 1) {
    names.push(`clangd${major}`, `clangd-${major}`);
  }
  const masonBase = path.join(homedir(), '.local', 'share', 'nvim', 'mason', 'packages', 'clangd');
  let entries = [];
  try {
    entries = readdirSync(masonBase, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const mason = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(masonBase, entry.name, 'bin', 'clangd'))
    .filter(executable);
  let candidates = [...names, ...mason];
  if (preference === 'clangd') candidates = candidates.filter((candidate) => !/ccls/i.test(path.basename(candidate)));
  if (preference === 'ccls') candidates = candidates.filter((candidate) => /ccls/i.test(path.basename(candidate)));
  return candidates;
}

async function probeEngine(command) {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], { timeout: 5_000 });
    const base = path.basename(command).toLowerCase();
    if (base.startsWith('ccls')) return { command, kind: 'ccls', name: 'ccls', version: 'unknown', major: 0 };
    const match = /clangd version (\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(`${stdout}\n${stderr}`);
    if (!match) return null;
    const major = Number(match[1]);
    return {
      command,
      kind: 'clangd',
      name: 'clangd',
      version: `${match[1]}.${match[2] ?? '0'}.${match[3] ?? '0'}`,
      major,
    };
  } catch {
    return null;
  }
}

let engineCache = { at: 0, engines: [] };

async function detectEngines() {
  if (Date.now() - engineCache.at < ENGINE_CACHE_TTL) return engineCache.engines;
  const seen = new Set();
  const unique = [];
  for (const command of candidateCommands()) {
    let key = command;
    try {
      key = realpathSync(command);
    } catch {
      // 命令名形式（依赖 PATH）无法 realpath，按字面去重
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(command);
  }
  const probed = await Promise.all(unique.map(probeEngine));
  const engines = probed
    .filter(Boolean)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'clangd' ? -1 : 1;
      return b.major - a.major || b.version.localeCompare(a.version, undefined, { numeric: true });
    });
  engineCache = { at: Date.now(), engines };
  return engines;
}

function engineArgs(engine, database) {
  if (engine.kind === 'clangd') {
    const args = ['--background-index', '--header-insertion=never'];
    if (database.generated) args.push(`--compile-commands-dir=${database.directory}`);
    return { args, initializationOptions: undefined };
  }
  return {
    args: [],
    initializationOptions: database.generated ? { compilationDatabaseDirectory: database.directory } : undefined,
  };
}

class LspClient {
  constructor(command, args) {
    this.command = command;
    this.args = args;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.child = null;
    this.dead = false;
  }

  start() {
    this.child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk) => this.#onData(chunk));
    this.child.stderr.on('data', () => {});
    this.child.on('error', (error) => this.#failAll(new Error(error.message)));
    this.child.on('close', () => {
      this.dead = true;
      this.#failAll(new Error('语言服务器进程已退出'));
    });
    return this;
  }

  #onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('latin1');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const raw = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      this.#onMessage(message);
    }
  }

  #onMessage(message) {
    if (message.id === undefined || message.id === null) return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new AppError(message.error.message || '语言服务器返回错误', 502, 'LSP_ERROR'));
    } else {
      entry.resolve(message.result);
    }
  }

  #failAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new AppError(`语言服务器不可用：${error.message}`, 503, 'LSP_UNAVAILABLE'));
      this.pending.delete(id);
    }
  }

  request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError('语言服务器响应超时', 504, 'LSP_TIMEOUT'));
      }, REQUEST_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params = {}) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  #write(message) {
    if (!this.child || this.dead) return;
    const body = JSON.stringify(message);
    try {
      this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    } catch (error) {
      this.#failAll(error);
    }
  }

  stop() {
    this.dead = true;
    try {
      this.child?.kill();
    } catch {
      // 进程可能已退出
    }
  }
}

class LspSession {
  constructor(repository) {
    this.repository = repository;
    this.client = null;
    this.engine = null;
    this.database = null;
    this.failed = null;
    // 「未检测到引擎」型失败可自动恢复：clangd 可能是会话失败之后才装上的
    // （apt 装完不重启服务）。启动失败型保持粘性，避免状态轮询反复拉起坏引擎。
    this.enginesMissing = false;
    this.lastError = null;
    this.initPromise = null;
    this.openDocuments = new Map();
    this.openDocumentsVersions = new Map();
    this.syncedHashes = new Map();
  }

  // 引擎重新出现时清掉粘性失败，让 status() / gd 走正常初始化路径。
  // detectEngines 有 60s 缓存，装好 clangd 后最多一分钟内恢复。
  async #recoverIfEnginesAppeared() {
    if (!this.enginesMissing || this.engine) return;
    const engines = await detectEngines();
    if (!engines.length) return;
    this.enginesMissing = false;
    this.failed = null;
    this.initPromise = null;
  }

  async status() {
    await this.#recoverIfEnginesAppeared();
    const engines = await detectEngines();
    const available = Boolean(this.engine) || engines.length > 0;
    if (available && !this.engine && !this.failed && !this.initPromise) {
      this.initPromise = this.#initialize();
      this.initPromise.catch(() => {});
    }
    const info = this.engine || engines[0] || null;
    let detail;
    if (this.engine) {
      const databaseNote = this.database?.generated ? '（使用生成的编译数据库）' : '（使用仓库自带编译数据库）';
      detail = `语言服务器 ${this.engine.name} ${this.engine.version} 已就绪${databaseNote}`;
      if (this.engine.kind === 'clangd' && this.engine.major < MODERN_CLANGD_MAJOR) {
        detail += `。该版本较旧，asm inline 等语法可能解析失败，跳转将回退文本检索；建议安装 clangd ${MODERN_CLANGD_MAJOR} 以上`;
      }
    } else if (this.failed) {
      detail = this.failed.message;
    } else if (!available) {
      detail = '未检测到 clangd/ccls（装好 clangd 17+ 后自动恢复，无需重启服务）';
    } else {
      detail = `语言服务器尚未启动（将使用 ${info.name} ${info.version}），打开 C/C++ 文件后自动初始化`;
    }
    return {
      available,
      engine: info ? info.name : null,
      engineVersion: info ? info.version : null,
      initialized: Boolean(this.engine),
      // 引擎缺失（还没装 clangd）终归可恢复：装好后 status 会直接初始化或经
      // 粘性失败恢复。前端据此保持轮询，徽标自动从「不可用」变「就绪」。
      recoverable: !available,
      detail,
    };
  }

  async gotoDefinition(filePath, line, character, content) {
    await this.#ensureReady(filePath, content);
    const result = await this.client.request('textDocument/definition', {
      textDocument: { uri: this.openDocuments.get(filePath) },
      position: { line: line - 1, character },
    });
    return normalizeLocations(result, this.repository.root);
  }

  async references(filePath, line, character, content) {
    await this.#ensureReady(filePath, content);
    const result = await this.client.request('textDocument/references', {
      textDocument: { uri: this.openDocuments.get(filePath) },
      position: { line: line - 1, character },
      context: { includeDeclaration: true },
    });
    return normalizeLocations(result, this.repository.root);
  }

  async #ensureReady(filePath, content) {
    await this.#recoverIfEnginesAppeared();
    if (this.failed) throw this.failed;
    if (!this.initPromise) this.initPromise = this.#initialize();
    await this.initPromise;
    await this.#syncDocument(filePath, content);
  }

  async #initialize() {
    const engines = await detectEngines();
    if (!engines.length) {
      this.enginesMissing = true;
      this.failed = new AppError(
        '未检测到语言服务器（clangd/ccls）；安装 clangd 17+ 后自动恢复，无需重启服务',
        503,
        'LSP_UNAVAILABLE',
      );
      throw this.failed;
    }
    this.enginesMissing = false;
    const files = await listSourceFiles(this.repository.root);
    for (const engine of engines) {
      try {
        const database = await prepareCompilationDatabase(this.repository.root, files, this.repository.id);
        const { args, initializationOptions } = engineArgs(engine, database);
        this.client = new LspClient(engine.command, args).start();
        const rootUri = pathToFileUri(this.repository.root);
        const params = {
          processId: process.pid,
          rootUri,
          capabilities: {
            textDocument: {
              definition: { linkSupport: true },
              references: {},
            },
            window: { workDoneProgress: false },
          },
          workspaceFolders: [{ uri: rootUri, name: this.repository.name }],
        };
        if (initializationOptions) params.initializationOptions = initializationOptions;
        await this.client.request('initialize', params);
        this.client.notify('initialized', {});
        this.engine = engine;
        this.database = database;
        return;
      } catch (error) {
        this.lastError = error instanceof AppError ? error.message : String(error?.message || error);
        this.client?.stop();
        this.client = null;
      }
    }
    this.failed = new AppError(`语言服务器启动失败：${this.lastError || '未知错误'}`, 503, 'LSP_UNAVAILABLE');
    throw this.failed;
  }

  async #syncDocument(filePath, content) {
    const existing = this.openDocuments.get(filePath);
    const languageId = LANGUAGE_BY_EXTENSION.get(path.extname(filePath)) || 'c';
    const uri = pathToFileUri(path.join(this.repository.root, filePath));
    if (existing) {
      if (content !== undefined && content !== null) {
        const hash = createHash('sha256').update(content).digest('hex');
        // 内容未变化时不发 didChange：clangd 会因此重新解析整个文件（内核文件约 1-2 秒）。
        if (this.syncedHashes.get(filePath) !== hash) {
          const version = (this.openDocumentsVersions.get(filePath) || 1) + 1;
          this.openDocumentsVersions.set(filePath, version);
          this.syncedHashes.set(filePath, hash);
          this.client.notify('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text: content }],
          });
        }
      }
      return;
    }
    if (this.openDocuments.size >= MAX_OPEN_DOCUMENTS) {
      const oldest = this.openDocuments.keys().next().value;
      if (oldest) {
        this.client.notify('textDocument/didClose', { textDocument: { uri: this.openDocuments.get(oldest) } });
        this.openDocuments.delete(oldest);
        this.syncedHashes.delete(oldest);
      }
    }
    let text = content;
    if (text === undefined || text === null) {
      text = (await readSource(this.repository.root, filePath)).content;
    }
    this.openDocuments.set(filePath, uri);
    this.openDocumentsVersions.set(filePath, 1);
    this.syncedHashes.set(filePath, createHash('sha256').update(text).digest('hex'));
    this.client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  // 打开文件时后台预热：让 clangd 提前解析，首次 gd/gr 不再等待整文件解析。
  prewarm(filePath, content) {
    if (typeof filePath !== 'string' || !LANGUAGE_BY_EXTENSION.has(path.extname(filePath))) return;
    this.#syncDocument(filePath, content).catch(() => {});
  }
stop() {
    this.client?.stop();
    this.client = null;
    this.engine = null;
    this.failed = null;
    this.enginesMissing = false;
    this.initPromise = null;
    this.openDocuments.clear();
    this.openDocumentsVersions.clear();
    this.syncedHashes.clear();
  }
}

function normalizeLocations(result, root) {
  const list = Array.isArray(result) ? result : result ? [result] : [];
  const locations = [];
  for (const item of list) {
    let uri = item.uri;
    let range = item.range;
    if (item.targetUri) {
      uri = item.targetUri;
      range = item.targetSelectionRange || item.targetRange;
    }
    const absolute = fileUriToPath(uri);
    if (!absolute || !range) continue;
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
    locations.push({
      path: relative,
      line: range.start.line + 1,
      character: range.start.character,
    });
  }
  return locations;
}

const sessions = new Map();

function sessionFor(repository) {
  if (!sessions.has(repository.id)) sessions.set(repository.id, new LspSession(repository));
  return sessions.get(repository.id);
}

export async function resetLspSession(repositoryId) {
  const session = sessions.get(repositoryId);
  if (session) {
    session.stop();
    sessions.delete(repositoryId);
  }
  await clearCompilationDatabase(repositoryId);
}

export async function lspStatus(repository) {
  return sessionFor(repository).status();
}

export function lspPrewarm(repository, body) {
  const session = sessions.get(repository.id);
  if (!session || !session.engine) return;
  session.prewarm(body.path, body.content);
}

export async function lspGotoDefinition(repository, body) {
  const session = sessionFor(repository);
  let lspError = null;
  let locations = [];
  try {
    locations = await session.gotoDefinition(body.path, body.line, body.character, body.content);
  } catch (error) {
    lspError = error;
  }
  if (locations.length) return { locations };
  let fallback = [];
  try {
    fallback = await searchSymbolDefinitions({
      root: repository.root,
      filePath: body.path,
      line: body.line,
      character: body.character,
      content: body.content,
    });
  } catch {
    fallback = [];
  }
  if (fallback.length) {
    if (lspError) console.error('[lsp] 定义请求失败，已回退到文本检索：', lspError?.message || lspError);
    return { locations: fallback };
  }
  if (lspError) throw lspError;
  return { locations };
}

export async function lspReferences(repository, body) {
  return { locations: await sessionFor(repository).references(body.path, body.line, body.character, body.content) };
}
