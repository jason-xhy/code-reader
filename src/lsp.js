import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { AppError } from './errors.js';
import { listSourceFiles, readSource } from './git.js';
import { prepareCompilationDatabase } from './compile-db.js';

const REQUEST_TIMEOUT = 60_000;
const MAX_OPEN_DOCUMENTS = 200;

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

function enginePreference() {
  const configured = (process.env.CODE_READER_LSP || 'auto').trim().toLowerCase();
  if (configured === 'ccls' || configured === 'clangd') return [configured];
  return ['clangd', 'ccls'];
}

function detectEngines() {
  const available = [];
  for (const name of enginePreference()) {
    const probe = spawnSync(name, ['--version'], { timeout: 10_000 });
    if (probe.error || probe.status !== 0) continue;
    available.push(name);
  }
  return available;
}

function engineArgs(name, database) {
  if (name === 'clangd') {
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
    this.lastError = null;
    this.initPromise = null;
    this.openDocuments = new Map();
    this.openDocumentsVersions = new Map();
  }

  status() {
    const detected = detectEngines();
    const available = this.engine ? true : detected.length > 0;
    if (available && !this.engine && !this.failed && !this.initPromise) {
      this.initPromise = this.#initialize();
      this.initPromise.catch(() => {});
    }
    return {
      available,
      engine: this.engine || detected[0] || null,
      initialized: Boolean(this.engine),
      detail: this.engine
        ? `语言服务器 ${this.engine} 已就绪${this.database?.generated ? '（使用生成的编译数据库）' : ''}`
        : (this.failed?.message || (available ? '语言服务器尚未启动，打开 C/C++ 文件后自动初始化' : '未检测到 clangd/ccls')),
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
    if (this.failed) throw this.failed;
    if (!this.initPromise) this.initPromise = this.#initialize();
    await this.initPromise;
    await this.#syncDocument(filePath, content);
  }

  async #initialize() {
    const candidates = detectEngines();
    if (!candidates.length) {
      this.failed = new AppError('未检测到语言服务器（clangd/ccls）', 503, 'LSP_UNAVAILABLE');
      throw this.failed;
    }
    const files = await listSourceFiles(this.repository.root);
    for (const name of candidates) {
      try {
        const database = await prepareCompilationDatabase(this.repository.root, files, this.repository.id);
        const { args, initializationOptions } = engineArgs(name, database);
        this.client = new LspClient(name, args).start();
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
        this.engine = name;
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
        const version = (this.openDocumentsVersions.get(filePath) || 1) + 1;
        this.openDocumentsVersions.set(filePath, version);
        this.client.notify('textDocument/didChange', {
          textDocument: { uri, version },
          contentChanges: [{ text: content }],
        });
      }
      return;
    }
    if (this.openDocuments.size >= MAX_OPEN_DOCUMENTS) {
      const oldest = this.openDocuments.keys().next().value;
      if (oldest) {
        this.client.notify('textDocument/didClose', { textDocument: { uri: this.openDocuments.get(oldest) } });
        this.openDocuments.delete(oldest);
      }
    }
    let text = content;
    if (text === undefined || text === null) {
      text = (await readSource(this.repository.root, filePath)).content;
    }
    this.openDocuments.set(filePath, uri);
    this.openDocumentsVersions.set(filePath, 1);
    this.client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    });
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

export function lspStatus(repository) {
  return sessionFor(repository).status();
}

export async function lspGotoDefinition(repository, body) {
  return { locations: await sessionFor(repository).gotoDefinition(body.path, body.line, body.character, body.content) };
}

export async function lspReferences(repository, body) {
  return { locations: await sessionFor(repository).references(body.path, body.line, body.character, body.content) };
}
