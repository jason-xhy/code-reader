// 能力：工作区符号索引（函数定义 + 文件路径）。
// 扫描策略：优先 ripgrep（12 线程扫描 kernel 约 1.3s），没有 rg 时回退 git grep。
// 索引按仓库 id 缓存在内存，按 HEAD 落盘（.data/search-index/<id>.json.gz）；
// HEAD 变化、显式刷新或超过 TTL 时后台重建，搜索请求永不等待索引构建。
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import path from 'node:path';
import { dataPath } from '../paths.js';
import { listSourceFiles, runGit } from '../git.js';
import { searchConfig } from './config.js';
import { canSearchFunctions, globRank, regexRank } from './query.js';
import { definitionInfo, kconfigSymbolInfo } from './definitions.js';
import { compareResults, fileMatchRank, matchLabel, matchRank } from './ranking.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// 版本 3：符号索引纳入 Kconfig 符号（config FOO / menuconfig FOO 行）。
const INDEX_VERSION = 3;
const INDEX_TTL_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 180_000;
const MAX_SYMBOL_HITS = 20_000;
const MAX_FILE_HITS = 20_000;

// Kconfig 文件（Kconfig、Kconfig.debug 等）basename 前缀。
const isKconfigPath = (filePath) => /^Kconfig/.test(path.posix.basename(filePath));

// POSIX ERE：ripgrep 与 git grep -E 都能执行。C 系负责顶格的类型+函数名，
// 其余语言按各自定义关键字，Kconfig 负责 config/menuconfig 符号行；
// 冒号行由 definitionInfo / kconfigSymbolInfo 二次判定，误报会被丢掉。
const CANDIDATE_PATTERN = [
  '^[A-Za-z_][A-Za-z0-9_ *]*[ *][A-Za-z_][A-Za-z0-9_]*[[:blank:]]*\\([^;]*$',
  '^[[:blank:]]*(async[[:blank:]]+)?def[[:blank:]]+[A-Za-z_]',
  '^[[:blank:]]*(export[[:blank:]]+)?(async[[:blank:]]+)?function[[:blank:]]*\\*?[[:blank:]]*[A-Za-z_$]',
  '^[[:blank:]]*(const|let|var)[[:blank:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:blank:]]*=[[:blank:]]*(async[[:blank:]]*)?(\\([^;]*=>|[A-Za-z_$][A-Za-z0-9_$]*[[:blank:]]+=>)',
  '^[[:blank:]]*func[[:blank:]]+(\\([^)]*\\)[[:blank:]]*)?[A-Za-z_]',
  '^[[:blank:]]*(pub([^)]*)?[[:blank:]]+)?(async[[:blank:]]+)?(unsafe[[:blank:]]+)?(const[[:blank:]]+)?fn[[:blank:]]+[A-Za-z_]',
  '^[[:blank:]]*[A-Za-z_][A-Za-z0-9_]*[[:blank:]]*\\([[:blank:]]*\\)[[:blank:]]*\\{?',
  '^[[:blank:]]*(menu)?config[[:blank:]]+[A-Za-z0-9_]+',
].join('|');

const states = new Map();

function indexFilePath(repository) {
  return dataPath('search-index', `${repository.id}.json.gz`);
}

function blankState() {
  return { status: 'idle', head: null, data: null, error: null, promise: null, builtAt: 0, failedAt: 0, source: null };
}

function stateFor(repository) {
  let state = states.get(repository.id);
  if (!state) {
    state = blankState();
    states.set(repository.id, state);
  }
  return state;
}

function parseGrepLine(line) {
  const first = line.indexOf(':');
  if (first <= 0) return null;
  const second = line.indexOf(':', first + 1);
  if (second <= first) return null;
  const lineNumber = Number(line.slice(first + 1, second));
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) return null;
  return {
    path: path.posix.normalize(line.slice(0, first).replace(/^\.\//, '')),
    line: lineNumber,
    text: line.slice(second + 1),
  };
}

function createIndexBuilder(root) {
  const symbolPaths = [];
  const fileIds = new Map();
  const names = [];
  const nameIds = new Map();
  const nameLowers = [];
  const symbolName = [];
  const symbolFile = [];
  const symbolLine = [];
  const symbolChar = [];
  let skipped = 0;

  const addSymbol = (filePath, lineNumber, text) => {
    // 文件名网关：Kconfig 命名的文件解析 config 符号行，其余走函数定义启发式
    // （config 形态的 C 行会被 definitionInfo 丢掉，反之亦然）。
    const info = isKconfigPath(filePath) ? kconfigSymbolInfo(text) : definitionInfo(text);
    if (!info?.name || info.name.length > 120) {
      skipped += 1;
      return;
    }
    let fileId = fileIds.get(filePath);
    if (fileId === undefined) {
      fileId = symbolPaths.length;
      fileIds.set(filePath, fileId);
      symbolPaths.push(filePath);
    }
    let nameId = nameIds.get(info.name);
    if (nameId === undefined) {
      nameId = names.length;
      nameIds.set(info.name, nameId);
      names.push(info.name);
      nameLowers.push(info.name.toLowerCase());
    }
    symbolName.push(nameId);
    symbolFile.push(fileId);
    symbolLine.push(lineNumber);
    symbolChar.push(Math.max(0, Math.min(info.index, 65535)));
  };

  return {
    addLine(raw) {
      if (!raw) return;
      const parsed = parseGrepLine(raw);
      if (!parsed) return;
      addSymbol(parsed.path, parsed.line, parsed.text);
    },
    finish() {
      return {
        version: INDEX_VERSION,
        symbolPaths,
        names,
        nameLowers,
        symbolName: Uint32Array.from(symbolName),
        symbolFile: Uint32Array.from(symbolFile),
        symbolLine: Uint32Array.from(symbolLine),
        symbolChar: Uint32Array.from(symbolChar),
        skipped,
      };
    },
  };
}

function sourceGlobs() {
  return searchConfig.sourceGlobs;
}

// rg 是可选加速器：参数全部来自固定配置，不拼接用户输入。
function scanWithRg(root, builder) {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-config',
      '--no-messages',
      '--no-heading',
      '--line-number',
      '--color', 'never',
      '--threads', '0',
      '-e', CANDIDATE_PATTERN,
    ];
    for (const glob of sourceGlobs()) args.push('-g', glob);
    args.push('--', '.');
    const child = spawn('rg', args, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('ripgrep 扫描超时'));
    }, BUILD_TIMEOUT_MS);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === 1) resolve(true);
      else reject(new Error(stderr.trim() || `ripgrep 退出码 ${code}`));
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => builder.addLine(line));
    lines.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function scanWithGit(root, builder) {
  const output = await runGit(
    ['grep', '-n', '-I', '-E', '--no-color', '-e', CANDIDATE_PATTERN, '--', ...sourceGlobs()],
    { cwd: root, timeout: BUILD_TIMEOUT_MS, maxOutput: 512 * 1024 * 1024 },
  ).catch((error) => {
    // 无命中时 git grep 退出码 1，runGit 会包成 GIT_ERROR；这不是扫描失败。
    if (error?.code === 'GIT_ERROR' && /退出码 1/.test(error.message || '')) return '';
    throw error;
  });
  for (const line of output.split('\n')) builder.addLine(line);
}

function hydrate(raw, repository, head) {
  if (raw?.version !== INDEX_VERSION || raw.head !== head || raw.root !== repository.root) return null;
  return {
    version: INDEX_VERSION,
    head,
    root: repository.root,
    builtAt: Number(raw.builtAt) || Date.now(),
    source: raw.source || 'disk',
    symbolPaths: Array.isArray(raw.symbolPaths) ? raw.symbolPaths : [],
    files: Array.isArray(raw.files) ? raw.files : [],
    names: Array.isArray(raw.names) ? raw.names : [],
    nameLowers: Array.isArray(raw.nameLowers) ? raw.nameLowers : [],
    symbolName: Uint32Array.from(raw.symbolName || []),
    symbolFile: Uint32Array.from(raw.symbolFile || []),
    symbolLine: Uint32Array.from(raw.symbolLine || []),
    symbolChar: Uint32Array.from(raw.symbolChar || []),
  };
}

function serialize(index) {
  return {
    version: INDEX_VERSION,
    head: index.head,
    root: index.root,
    builtAt: index.builtAt,
    source: index.source,
    symbolPaths: index.symbolPaths,
    files: index.files,
    names: index.names,
    nameLowers: index.nameLowers,
    symbolName: Array.from(index.symbolName),
    symbolFile: Array.from(index.symbolFile),
    symbolLine: Array.from(index.symbolLine),
    symbolChar: Array.from(index.symbolChar),
  };
}

async function readCached(repository, head) {
  try {
    const compressed = await readFile(indexFilePath(repository));
    const raw = JSON.parse((await gunzipAsync(compressed)).toString('utf8'));
    return hydrate(raw, repository, head);
  } catch {
    return null;
  }
}

async function writeCached(repository, index) {
  try {
    const file = indexFilePath(repository);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, await gzipAsync(Buffer.from(JSON.stringify(serialize(index))), { level: 6 }));
    await rename(temporary, file);
  } catch {
    // 缓存写失败不影响搜索；下次仍可从内存或重建。
  }
}

async function buildIndex(repository, head) {
  const cached = await readCached(repository, head);
  if (cached) return { ...cached, builtAt: Date.now() };
  const [files] = await Promise.all([listSourceFiles(repository.root)]);
  const builder = createIndexBuilder(repository.root);
  let source = 'rg';
  try {
    await scanWithRg(repository.root, builder);
  } catch {
    source = 'git';
    await scanWithGit(repository.root, builder);
  }
  const built = builder.finish();
  // 索引里的符号文件可能不在文件列表（不应发生），把路径补进去，保证文件搜索
  // 与跳转都完整。symbolPaths 与 symbolFile 下标绑定，不能被文件列表覆盖。
  const known = new Set(files);
  const extra = built.symbolPaths.filter((file) => !known.has(file));
  return {
    ...built,
    head,
    root: repository.root,
    builtAt: Date.now(),
    source,
    files: extra.length ? [...files, ...extra] : files,
  };
}

// 启动（或复用）索引构建。head 由调用方传入，避免每个请求重复 rev-parse。
export function ensureSearchIndex(repository, head) {
  const state = stateFor(repository);
  if (state.head === head) {
    if (state.status === 'ready' && state.data) {
      if (Date.now() - state.builtAt < INDEX_TTL_MS) return state.data;
      // TTL 过期：后台重建，本次仍用旧索引，搜索不等待。
      if (!state.promise) startBuild(repository, head, state);
      return state.data;
    }
    if (state.status === 'building') return null;
    // 构建失败后 60s 内不反复重试（正则查询的等待循环会反复调用这里）。
    if (state.status === 'error' && Date.now() - state.failedAt < 60_000) return null;
  }
  startBuild(repository, head, state);
  return null;
}

function startBuild(repository, head, state) {
  state.head = head;
  state.status = 'building';
  state.error = null;
  const task = buildIndex(repository, head)
    .then((data) => {
      // 期间切了 HEAD 或仓库被刷新：丢弃旧结果，不覆盖新状态。
      if (state.head !== head) return null;
      state.status = 'ready';
      state.data = data;
      state.builtAt = data.builtAt;
      state.source = data.source;
      writeCached(repository, data);
      return data;
    })
    .catch((error) => {
      if (state.head === head) {
        state.status = 'error';
        state.error = error?.message || String(error);
        state.failedAt = Date.now();
      }
      return null;
    })
    .finally(() => {
      if (state.head === head) state.promise = null;
    });
  state.promise = task;
  return task;
}

export function warmSearchIndex(repository, head = null) {
  if (!repository?.id || !repository?.root) return null;
  if (head) return ensureSearchIndex(repository, head);
  return runGit(['rev-parse', '--short', 'HEAD'], { cwd: repository.root })
    .then((value) => ensureSearchIndex(repository, value.trim()))
    .catch(() => null);
}

export function searchIndexStatus(repository) {
  const state = states.get(repository.id);
  if (!state) return { status: 'idle' };
  return {
    status: state.status,
    head: state.head,
    builtAt: state.builtAt || null,
    source: state.source,
    error: state.error,
    symbols: state.data?.symbolName?.length || 0,
  };
}

export async function invalidateSearchIndex(repository, { dropCache = false } = {}) {
  if (!repository?.id) return;
  states.delete(repository.id);
  if (dropCache) {
    await unlink(indexFilePath(repository)).catch(() => {});
  }
}

function fuzzyRank(name, lower, parsed) {
  return matchRank(name, parsed.text);
}

function fileMatches(filePath, parsed) {
  if (parsed.mode === 'glob') {
    const base = path.posix.basename(filePath);
    const baseRank = globRank(base, parsed.regex, parsed.text);
    const pathRank = globRank(filePath, parsed.regex, parsed.text);
    if (baseRank === null && pathRank === null) return null;
    return baseRank ?? pathRank;
  }
  if (parsed.regex) {
    const base = path.posix.basename(filePath);
    const baseRank = regexRank(base, parsed.regex);
    const pathRank = regexRank(filePath, parsed.regex);
    if (baseRank === null && pathRank === null) return null;
    return baseRank ?? pathRank;
  }
  const lower = filePath.toLowerCase();
  if (!lower.includes(parsed.lower)) return null;
  return fileMatchRank(filePath, parsed.text);
}

function symbolMatches(name, lower, parsed) {
  if (parsed.mode === 'glob') return globRank(name, parsed.regex, parsed.text);
  if (parsed.regex) return regexRank(name, parsed.regex);
  if (!lower.includes(parsed.lower)) return null;
  return fuzzyRank(name, lower, parsed);
}

// 在内存索引上执行查询。返回结构与 searchWorkspace 的历史契约一致。
export function queryIndex(index, parsed, limits = {}) {
  const maxSymbols = limits.maxSymbols ?? MAX_SYMBOL_HITS;
  const maxFiles = limits.maxFiles ?? MAX_FILE_HITS;
  const functions = [];
  const files = [];
  let functionCount = 0;
  let fileCount = 0;

  if (parsed.mode === 'regex'
    ? parsed.text.length >= searchConfig.minFunctionQueryLength
    : canSearchFunctions(parsed.text)) {
    const total = index.symbolFile.length;
    // Kconfig 符号与函数共用一套排序，仅 kind 不同；按路径一次性派生避免逐行正则。
    const pathKinds = index.symbolPaths.map((filePath) => (isKconfigPath(filePath) ? 'kconfig' : 'function'));
    for (let cursor = 0; cursor < total; cursor += 1) {
      const nameId = index.symbolName[cursor];
      const name = index.names[nameId];
      const lower = index.nameLowers[nameId] || name.toLowerCase();
      const rank = symbolMatches(name, lower, parsed);
      if (rank === null) continue;
      functionCount += 1;
      if (functions.length >= maxSymbols) continue;
      const fileCursor = index.symbolFile[cursor];
      const filePath = index.symbolPaths[fileCursor];
      functions.push({
        kind: pathKinds[fileCursor] || 'function',
        name,
        path: filePath,
        line: index.symbolLine[cursor],
        character: index.symbolChar[cursor],
        rank,
        match: matchLabel(rank),
      });
    }
  }

  for (const filePath of index.files) {
    const rank = fileMatches(filePath, parsed);
    if (rank === null) continue;
    fileCount += 1;
    if (files.length >= maxFiles) continue;
    files.push({
      kind: 'file',
      name: path.posix.basename(filePath) || filePath,
      path: filePath,
      line: 1,
      character: 0,
      rank,
      match: matchLabel(rank),
    });
  }

  return {
    functions,
    files,
    counts: { functions: functionCount, files: fileCount },
    truncated: functionCount > functions.length || fileCount > files.length,
  };
}

// 与旧实现一致：头文件原型不重复占位（源文件已有同名定义时丢掉头文件条目）。
export function dedupeHeaderPrototypes(functions) {
  const sourceNames = new Set(
    functions.filter((item) => !/\.(?:h|hh|hpp|hxx|inl)$/i.test(item.path)).map((item) => item.name),
  );
  return functions.filter(
    (item) => !/\.(?:h|hh|hpp|hxx|inl)$/i.test(item.path) || !sourceNames.has(item.name),
  );
}

export function finalizeResults(functions, files) {
  functions.sort(compareResults);
  files.sort(compareResults);
  return {
    functions: functions.slice(0, searchConfig.maxFunctionResults),
    files: files.slice(0, searchConfig.maxFileResults),
  };
}