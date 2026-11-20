// 能力：工作区搜索（函数定义 + 文件名）。
// 主路径：内存符号索引（src/search/index.js），毫秒级响应并支持 /正则/。
// 索引构建期间 / 构建失败时回退到实时 git grep，保证功能不中断。
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { listSourceFiles, runGit } from '../git.js';
import { searchConfig } from './config.js';
import { globRank, parseQuery, regexRank } from './query.js';
import { definitionInfo } from './definitions.js';
import { compareResults, fileMatchRank, matchLabel, matchRank } from './ranking.js';
import {
  dedupeHeaderPrototypes,
  ensureSearchIndex,
  finalizeResults,
  queryIndex,
  searchIndexStatus,
} from './index.js';

const cache = new Map();
// 文件列表按 HEAD 缓存：分支/提交变化会换 key，避免搜索用旧文件树。
const fileCache = new Map();
const FILE_CACHE_TTL_MS = 5 * 60_000;

async function filesAtHead(root, head) {
  const key = `${root}\0${head}`;
  const hit = fileCache.get(key);
  if (hit && Date.now() - hit.at < FILE_CACHE_TTL_MS) return hit.files;
  const files = await listSourceFiles(root);
  fileCache.set(key, { at: Date.now(), files });
  while (fileCache.size > 8) fileCache.delete(fileCache.keys().next().value);
  return files;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > searchConfig.cacheTtlMs) {
    cache.delete(key);
    return null;
  }
  // LRU：命中后移到末尾。
  cache.delete(key);
  cache.set(key, hit);
  return hit.data;
}

function cacheSet(key, data) {
  cache.set(key, { at: Date.now(), data });
  while (cache.size > searchConfig.cacheLimit) {
    cache.delete(cache.keys().next().value);
  }
}

function parseGrepLine(line) {
  const first = line.indexOf(':');
  if (first <= 0) return null;
  const second = line.indexOf(':', first + 1);
  if (second <= first) return null;
  const lineNumber = Number(line.slice(first + 1, second));
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) return null;
  return {
    path: line.slice(0, first),
    line: lineNumber,
    text: line.slice(second + 1),
  };
}

// 快速排除明显不是定义的命中行，减少 10 万级 grep 行的正则开销。
function looksLikeDefinitionLine(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('#')) return false;
  if (/;\s*$/.test(trimmed) && !/^\s*(?:def|function|func|fn)\b/.test(trimmed)) return false;
  return true;
}

const SOURCE_EXTENSIONS = new Set(
  searchConfig.sourceGlobs.map((glob) => glob.replace(/^\*\./, '').toLowerCase()),
);

function isSourceFile(filePath) {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 && SOURCE_EXTENSIONS.has(filePath.slice(dot + 1).toLowerCase());
}

// 实时回退：只在索引未就绪时使用（大仓 kernel 约 1-2s）。
async function searchFunctionsLive(root, parsed) {
  if (parsed.mode !== 'fuzzy') {
    return {
      results: [],
      truncated: false,
      warning: parsed.mode === 'glob'
        ? '索引构建中；通配符函数搜索将在索引就绪后可用（文件名结果已返回）'
        : '索引构建中；正则函数搜索将在索引就绪后可用（文件名结果已返回）',
    };
  }
  const lowerQuery = parsed.lower;
  const mainArgs = ['grep', '-n', '-I', '-i', '-F', '--no-color', '-e', parsed.text, '--', ...searchConfig.sourceGlobs];
  let stdout = '';
  try {
    stdout = await runGit(mainArgs, { cwd: root, timeout: searchConfig.gitTimeoutMs });
  } catch (error) {
    if (!(error?.code === 'GIT_ERROR' && /退出码 1/.test(error.message || ''))) {
      return {
        results: [],
        truncated: true,
        warning: error?.code === 'GIT_OUTPUT_TOO_LARGE'
          ? '关键字过于宽泛，函数搜索结果已截断；请增加关键字长度'
          : `函数搜索失败：${error?.message || error}`,
      };
    }
  }
  const results = new Map();
  let truncated = false;
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    const parsedLine = parseGrepLine(raw);
    if (!parsedLine || !looksLikeDefinitionLine(parsedLine.text)) continue;
    const info = definitionInfo(parsedLine.text);
    if (!info || !info.name.toLowerCase().includes(lowerQuery)) continue;
    const key = `${parsedLine.path}:${parsedLine.line}`;
    if (results.has(key)) continue;
    const rank = matchRank(info.name, parsed.text);
    results.set(key, {
      kind: 'function',
      name: info.name,
      path: path.normalize(parsedLine.path),
      line: parsedLine.line,
      character: Math.max(0, info.index),
      rank,
      match: matchLabel(rank),
    });
    if (results.size >= 20_000) {
      truncated = true;
      break;
    }
  }
  return { results: [...results.values()], truncated, warning: '' };
}

function searchFiles(files, parsed) {
  const results = [];
  for (const filePath of files) {
    const base = path.posix.basename(filePath);
    const rank = parsed.mode === 'glob'
      ? (globRank(base, parsed.regex, parsed.text) ?? globRank(filePath, parsed.regex, parsed.text))
      : parsed.regex
        ? (regexRank(base, parsed.regex) ?? regexRank(filePath, parsed.regex))
        : (filePath.toLowerCase().includes(parsed.lower) ? fileMatchRank(filePath, parsed.text) : null);
    if (rank === null) continue;
    results.push({
      kind: 'file',
      name: path.basename(filePath) || filePath,
      path: filePath,
      line: 1,
      character: 0,
      rank,
      match: matchLabel(rank),
    });
  }
  return results;
}

// 工作区改动（已修改 + 未跟踪 + 已删除）：索引代表构建时刻的工作树，
// 用户 nvim 写盘或新增未跟踪文件后，用这份清单在查询时补齐/剔除。
const changeCache = new Map();
const CHANGE_CACHE_TTL_MS = 30_000;

async function worktreeChanges(root, head) {
  const key = `${root}\0${head}`;
  const hit = changeCache.get(key);
  if (hit && Date.now() - hit.at < CHANGE_CACHE_TTL_MS) return hit.data;
  const [modified, untracked, deleted] = await Promise.all([
    runGit(['diff', '--name-only', '-z', '--diff-filter=ACMRT', 'HEAD'], { cwd: root, timeout: 15_000 }).catch(() => ''),
    runGit(['ls-files', '-o', '--exclude-standard', '-z'], { cwd: root, timeout: 15_000 }).catch(() => ''),
    runGit(['diff', '--name-only', '-z', '--diff-filter=D', 'HEAD'], { cwd: root, timeout: 15_000 }).catch(() => ''),
  ]);
  const split = (value) => value.split('\0').filter(Boolean);
  const untrackedFiles = split(untracked);
  const changedFiles = [...new Set([...split(modified), ...untrackedFiles])];
  const data = {
    changed: changedFiles,
    changedSet: new Set(changedFiles),
    untracked: new Set(untrackedFiles),
    deleted: new Set(split(deleted)),
  };
  changeCache.set(key, { at: Date.now(), data });
  while (changeCache.size > 8) changeCache.delete(changeCache.keys().next().value);
  return data;
}

function matchesName(name, parsed) {
  if (parsed.mode === 'glob') return globRank(name, parsed.regex, parsed.text);
  if (parsed.regex) return regexRank(name, parsed.regex);
  return name.toLowerCase().includes(parsed.lower) ? matchRank(name, parsed.text) : null;
}

// 扫描改动文件里的函数定义（最多 maxUntrackedFiles 个源码文件）。
async function searchChangedFiles(root, parsed, changes) {
  const candidates = changes.changed.filter(isSourceFile).slice(0, searchConfig.maxUntrackedFiles);
  const results = [];
  let skipped = changes.changed.filter(isSourceFile).length > candidates.length;
  for (const filePath of candidates) {
    const absolute = path.resolve(root, filePath);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
    let content;
    try {
      content = await readFile(absolute, 'utf8');
    } catch {
      continue;
    }
    if (content.length > 2 * 1024 * 1024) {
      skipped = true;
      continue;
    }
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index];
      if (!looksLikeDefinitionLine(text)) continue;
      const info = definitionInfo(text);
      if (!info) continue;
      const rank = matchesName(info.name, parsed);
      if (rank === null) continue;
      results.push({
        kind: 'function',
        name: info.name,
        path: path.normalize(filePath),
        line: index + 1,
        character: Math.max(0, info.index),
        rank,
        match: matchLabel(rank),
      });
    }
  }
  return { results, truncated: skipped };
}

function mergeFunctions(indexResults, changedResults, changes) {
  // 改动文件里的结果代表当前工作树，索引里同路径的旧条目全部让位。
  const changedPaths = new Set(changedResults.map((item) => item.path));
  const merged = indexResults.filter((item) => !changes.changedSet.has(item.path) && !changedPaths.has(item.path));
  const seen = new Set(merged.map((item) => `${item.path}:${item.line}:${item.name}`));
  for (const item of changedResults) {
    const key = `${item.path}:${item.line}:${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function mergeFiles(indexFiles, changes) {
  const merged = indexFiles.filter((filePath) => !changes.deleted.has(filePath));
  const known = new Set(merged);
  for (const filePath of changes.changed) {
    if (known.has(filePath)) continue;
    known.add(filePath);
    merged.push(filePath);
  }
  return merged;
}

export async function searchWorkspace(repository, rawQuery) {
  const parsed = parseQuery(rawQuery);
  // HEAD 是搜索结果的版本锚点：换分支/新提交后缓存自动失效。
  const head = (await runGit(['rev-parse', '--short', 'HEAD'], { cwd: repository.root })).trim();
  const key = `${repository.root}\0${head}\0${parsed.query}`;
  const cached = cacheGet(key);
  if (cached && cached.index?.status === 'ready') {
    return { ...cached, index: searchIndexStatus(repository) };
  }

  let index = ensureSearchIndex(repository, head);
  // 正则查询无法用实时 git grep 等价兜底：索引构建中时等它完成（最多 ~8s），
  // 避免用户第一次输入 /正则/ 得到空结果。
  if (!index && parsed.mode === 'regex') {
    for (let attempt = 0; attempt < 40 && !index; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      index = ensureSearchIndex(repository, head);
    }
  }
  const changes = await worktreeChanges(repository.root, head);
  let functionResults = [];
  let fileResults = [];
  let warning = '';
  let truncated = false;

  if (index) {
    const indexed = queryIndex(index, parsed, {
      maxSymbols: 20_000,
      maxFiles: 20_000,
    });
    const changed = await searchChangedFiles(repository.root, parsed, changes);
    const files = mergeFiles(index.files, changes);
    functionResults = mergeFunctions(indexed.functions, changed.results, changes);
    fileResults = searchFiles(files, parsed);
    truncated = indexed.truncated || changed.truncated;
  } else {
    // 索引构建中：实时 grep 兜底；文件搜索走缓存的文件列表。
    const live = await searchFunctionsLive(repository.root, parsed);
    const changed = await searchChangedFiles(repository.root, parsed, changes);
    functionResults = mergeFunctions(live.results, changed.results, changes);
    fileResults = searchFiles(mergeFiles(await filesAtHead(repository.root, head), changes), parsed);
    warning = live.warning;
    truncated = live.truncated || changed.truncated;
  }

  functionResults = dedupeHeaderPrototypes(functionResults);
  const finalized = finalizeResults(functionResults, fileResults);
  const data = {
    query: parsed.query,
    mode: parsed.mode,
    head,
    results: [...finalized.functions, ...finalized.files].sort(compareResults).slice(0, searchConfig.maxResults),
    counts: {
      functions: functionResults.length,
      files: fileResults.length,
    },
    truncated: truncated
      || functionResults.length > searchConfig.maxFunctionResults
      || fileResults.length > searchConfig.maxFileResults,
    warning,
    index: searchIndexStatus(repository),
  };
  // 索引未就绪时的实时兜底结果不缓存：索引一就绪，同一关键字应立即走索引。
  if (index) cacheSet(key, data);
  return data;
}

export function clearSearchCaches() {
  cache.clear();
  fileCache.clear();
  changeCache.clear();
}