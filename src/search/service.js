// 能力：工作区模糊搜索（函数定义 + 文件名）。
// 数据来源：文件名走仓库 payload 的文件列表；函数名走 git grep 的文本命中，
// 再由 definitions 策略过滤出真正的函数定义。排序由 ranking 策略决定。
import path from 'node:path';
import { listSourceFiles, runGit } from '../git.js';
import { searchConfig } from './config.js';
import { canSearchFunctions, normalizeQuery } from './query.js';
import { definitionInfo } from './definitions.js';
import { compareResults, fileMatchRank, matchLabel, matchRank } from './ranking.js';

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

// 主 git grep 不扫未跟踪文件（--untracked 会让大仓慢 3-4 倍）。这里单独取
// 未跟踪源码文件的短清单，只在清单不大时补搜，保持主路径的索引速度。
async function searchUntracked(root, query) {
  try {
    const listing = await runGit(['ls-files', '-o', '--exclude-standard', '-z'], { cwd: root, timeout: 10_000 });
    const files = listing.split('\0').filter(Boolean).filter(isSourceFile);
    if (!files.length || files.length > searchConfig.maxUntrackedFiles) return '';
    return await runGit(
      ['grep', '--no-index', '-n', '-I', '-i', '-F', '--no-color', '-e', query, '--', ...files],
      { cwd: root, timeout: searchConfig.gitTimeoutMs },
    );
  } catch {
    return '';
  }
}

async function searchFunctions(root, query) {
  const lowerQuery = query.toLowerCase();
  const mainArgs = ['grep', '-n', '-I', '-i', '-F', '--no-color', '-e', query, '--', ...searchConfig.sourceGlobs];
  const [main, untracked] = await Promise.allSettled([
    runGit(mainArgs, { cwd: root, timeout: searchConfig.gitTimeoutMs }),
    searchUntracked(root, query),
  ]);
  let stdout = '';
  if (main.status === 'fulfilled') {
    stdout = main.value;
  } else {
    // git grep 无命中时退出码为 1，这里与真正的错误区分开。
    if (!(main.reason?.code === 'GIT_ERROR' && /退出码 1/.test(main.reason.message || ''))) {
      return {
        results: [],
        truncated: true,
        warning: main.reason?.code === 'GIT_OUTPUT_TOO_LARGE'
          ? '关键字过于宽泛，函数搜索结果已截断；请增加关键字长度'
          : `函数搜索失败：${main.reason?.message || main.reason}`,
      };
    }
  }
  const untrackedText = untracked.status === 'fulfilled' ? untracked.value : '';
  if (untrackedText) stdout = `${stdout}\n${untrackedText}`;

  const results = new Map();
  let truncated = false;
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    const parsed = parseGrepLine(raw);
    if (!parsed || !looksLikeDefinitionLine(parsed.text)) continue;
    const info = definitionInfo(parsed.text);
    if (!info || !info.name.toLowerCase().includes(lowerQuery)) continue;
    const key = `${parsed.path}:${parsed.line}`;
    if (results.has(key)) continue;
    const rank = matchRank(info.name, query);
    results.set(key, {
      kind: 'function',
      name: info.name,
      path: path.normalize(parsed.path),
      line: parsed.line,
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

function searchFiles(files, query) {
  const lowerQuery = query.toLowerCase();
  const results = [];
  for (const filePath of files) {
    if (!filePath.toLowerCase().includes(lowerQuery)) continue;
    const rank = fileMatchRank(filePath, query);
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

export async function searchWorkspace(repository, rawQuery) {
  const query = normalizeQuery(rawQuery);
  // HEAD 是搜索结果的版本锚点：换分支/新提交后缓存自动失效。
  const head = (await runGit(['rev-parse', '--short', 'HEAD'], { cwd: repository.root })).trim();
  const key = `${repository.root}\0${head}\0${query}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const fileResults = searchFiles(await filesAtHead(repository.root, head), query);
  let functionResults = [];
  let warning = '';
  let functionTruncated = false;
  if (canSearchFunctions(query)) {
    const functionSearch = await searchFunctions(repository.root, query);
    functionResults = functionSearch.results;
    warning = functionSearch.warning;
    functionTruncated = functionSearch.truncated;
  }

  // 同名函数在头文件里的原型常常跨行书写、不以分号结尾，会被误当成定义；
  // 只要源文件里能找到同名定义，就丢掉头文件里的那条，避免一函数两条结果。
  const sourceNames = new Set(
    functionResults.filter((item) => !/\.(?:h|hh|hpp|hxx|inl)$/i.test(item.path)).map((item) => item.name),
  );
  functionResults = functionResults.filter(
    (item) => !/\.(?:h|hh|hpp|hxx|inl)$/i.test(item.path) || !sourceNames.has(item.name),
  );

  functionResults.sort(compareResults);
  fileResults.sort(compareResults);
  const results = [
    ...functionResults.slice(0, searchConfig.maxFunctionResults),
    ...fileResults.slice(0, searchConfig.maxFileResults),
  ]
    .sort(compareResults)
    .slice(0, searchConfig.maxResults);

  const data = {
    query,
    head,
    results,
    counts: {
      functions: functionResults.length,
      files: fileResults.length,
    },
    truncated: functionTruncated
      || functionResults.length > searchConfig.maxFunctionResults
      || fileResults.length > searchConfig.maxFileResults
      || results.length < functionResults.length + fileResults.length,
    warning,
  };
  cacheSet(key, data);
  return data;
}

export function clearSearchCaches() {
  cache.clear();
  fileCache.clear();
}