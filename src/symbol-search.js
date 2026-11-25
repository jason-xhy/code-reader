// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 文本检索兜底与 code-reader 的 LSP 回退路径强绑定
// grill: 成品检索=skill 库无 code-reader 文本符号检索成品; 输入固定=仓库根/文件/行列/内容; 步骤机械=取词+git grep+打分/去重; 判读固定=定义形态与命中行; 失效场景=构造不出（仅本应用）
// 文本检索兜底：LSP 无结果时，按定义形态打分在源码中定位符号。
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { readSource, runGit } from './git.js';

const MAX_RESULTS = 12;
const MIN_DEFINITION_SCORE = 60;
const SOURCE_PATHS = ['*.c', '*.h', '*.cc', '*.cpp', '*.hpp', '*.S', '*.s'];
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
// gr 文本检索：git grep 全词命中很多（内核树 connect 3300+ 行），列表保持
// 可浏览的上限；命中行按「当前文件所在子目录优先」排序后再截断，保证
// 同子系统的调用点（如 input.c 的 handler->connect）排在前面。
const MAX_REFERENCE_RESULTS = 300;
// Kconfig 文件的 git pathspec：`Kconfig*` 只匹配根级，`*Kconfig*` 才能命中
// 任意深度的 lib/Kconfig.debug、arch/arm64/Kconfig 等。
const KCONFIG_PATHS = ['*Kconfig*'];
// Kconfig 定义行分数：必须高于同文件 #define 的 100+30（同文件加成），
// CONFIG_FOO 的权威定义是 Kconfig 的 config FOO 行。
const KCONFIG_DEFINITION_SCORE = 140;
const CONFIG_SYMBOL_RE = /^CONFIG_([A-Z][A-Z0-9_]*)$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function wordAt(content, line, character) {
  const text = String(content || '').split('\n')[line - 1] || '';
  if (!text) return null;
  const target = Math.max(0, Math.min(character, text.length));
  for (const match of text.matchAll(IDENTIFIER_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (target >= start && target < end) return match[0];
  }
  return null;
}

function definitionScore(text, identifier, filePath, candidatePath) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return 0;
  const id = escapeRegExp(identifier);
  let score = 10;
  if (new RegExp(`^#\\s*define\\s+${id}\\b`).test(trimmed)) {
    score = 100;
  } else if (new RegExp(`^\\s*(?:struct|union|enum|class)\\s+${id}\\s*(?:\\{|;)`).test(text)) {
    score = 95;
  } else if (new RegExp(`^\\s*typedef\\b[^;]*\\b${id}\\b`).test(text)) {
    score = 90;
  } else if (new RegExp(`^[A-Za-z_][A-Za-z0-9_\\s*]*\\b${id}\\s*\\(`).test(text)
    && !/;\s*(?:\/\*.*)?$/.test(trimmed)
    && !trimmed.startsWith('#')) {
    score = 70;
  }
  if (candidatePath === filePath) score += 30;
  return score;
}

function identifierStart(text, identifier) {
  const match = new RegExp(`\\b${escapeRegExp(identifier)}\\b`).exec(text);
  return match ? match.index : 0;
}

function isDefinitionTarget(text, identifier) {
  const match = new RegExp(`\\b${escapeRegExp(identifier)}\\b`).exec(text);
  if (!match) return false;
  const before = text.slice(0, match.index).trimEnd();
  const previous = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(before)?.[1] || '';
  if (/^(struct|union|enum|class)$/.test(previous)) return true;
  const after = text.slice(match.index + identifier.length).trimStart();
  if (after.startsWith('(')) return true;
  if (/^#\s*define\b/.test(text.trim())) return true;
  return /^[A-Z][A-Z0-9_]*$/.test(identifier) && identifier.length >= 3;
}

async function gitGrepDefinitions(root, identifier) {
  // 标识符只允许 C 标识符字符，作为参数数组传给 git（shell: false），不存在命令拼接。
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) return [];
  try {
    const stdout = await runGit(
      ['grep', '-n', '-I', '-w', '-F', '--no-color', '-e', identifier, '--', ...SOURCE_PATHS],
      { cwd: root, timeout: 20_000 },
    );
    return stdout.split('\n');
  } catch {
    return [];
  }
}

// CONFIG_FOO 的 Kconfig 定义行是 `config FOO`（不带前缀）；
// CONFIG_FOO_MODULE 对应 `config FOO`（=m 时宏名带 _MODULE 后缀）。
function kconfigCandidateNames(identifier) {
  const match = CONFIG_SYMBOL_RE.exec(identifier);
  if (!match) return null;
  const name = match[1];
  return name.endsWith('_MODULE') ? [name, name.slice(0, -'_MODULE'.length)] : [name];
}

async function gitGrepKconfigDefinitions(root, name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return [];
  try {
    // git grep -E 是 POSIX ERE：不吃 \s 与 (?:)；字尾用 ([[:space:]]|$) 锚定，
    // 防止 config FOO 误配 config FOO_BAR。
    const stdout = await runGit(
      ['grep', '-n', '-I', '-E', '--no-color', '-e', `^[[:space:]]*(menu)?config[[:space:]]+${escapeRegExp(name)}([[:space:]]|$)`, '--', ...KCONFIG_PATHS],
      { cwd: root, timeout: 20_000 },
    );
    return stdout.split('\n');
  } catch {
    return [];
  }
}

// 把 Kconfig 定义合并进已有结果集：CONFIG_FOO 必查（分数高于 #define）；
// 裸全大写标识符（如在 Kconfig 文件里 gd `depends on FOO` 的 FOO）在 C 源
// 无命中时回退查 `config FOO`。沿用同一去重键与行解析格式。
async function mergeKconfigDefinitions({ root, identifier, results, seen }) {
  let names = kconfigCandidateNames(identifier);
  if (!names && /^[A-Z][A-Z0-9_]*$/.test(identifier) && identifier.length >= 3) {
    names = results.length ? [] : [identifier];
  }
  if (!names?.length) return;
  for (const name of names) {
    const lines = await gitGrepKconfigDefinitions(root, name);
    for (const entry of lines) {
      const match = /^(.*?):(\d+):(.*)$/.exec(entry);
      if (!match) continue;
      const [, candidatePath, candidateLine, lineSource] = match;
      const key = `${candidatePath}:${candidateLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        path: path.normalize(candidatePath),
        line: Number(candidateLine),
        character: identifierStart(lineSource, name),
        score: KCONFIG_DEFINITION_SCORE,
      });
    }
  }
}

export async function searchDefinitionsForIdentifier({ root, identifier, filePath }) {
  if (!identifier || identifier.length < 2) return [];
  const lines = await gitGrepDefinitions(root, identifier);
  const results = [];
  const seen = new Set();
  for (const entry of lines) {
    const match = /^(.*?):(\d+):(.*)$/.exec(entry);
    if (!match) continue;
    const [, candidatePath, candidateLine, lineSource] = match;
    const key = `${candidatePath}:${candidateLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = definitionScore(lineSource, identifier, filePath, candidatePath);
    if (score < MIN_DEFINITION_SCORE) continue;
    results.push({
      path: path.normalize(candidatePath),
      line: Number(candidateLine),
      character: identifierStart(lineSource, identifier),
      score,
    });
  }
  await mergeKconfigDefinitions({ root, identifier, results, seen });
  results.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.line - b.line);
  const best = results[0]?.score;
  return results
    .filter((result) => result.score === best)
    .slice(0, MAX_RESULTS)
    .map(({ path: candidatePath, line: candidateLine, character: column }) => ({
      path: candidatePath,
      line: candidateLine,
      character: column,
    }));
}

export async function searchSymbolDefinitions({ root, filePath, line, character, content }) {
  let text = content;
  if (typeof text !== 'string') {
    try {
      text = (await readSource(root, filePath)).content;
    } catch {
      return [];
    }
  }
  const identifier = wordAt(text, line, character);
  if (!identifier || identifier.length < 2) return [];
  if (!isDefinitionTarget(text.split('\n')[line - 1] || '', identifier)) return [];
  return searchDefinitionsForIdentifier({ root, identifier, filePath });
}

// ---- gr 文本检索兜底/补充 ----

// git grep 的 path:line:content → { path, line, character }；character 落在
// 本行第一个词匹配处（0 基列，与 LSP 位置同构）。
function parseGrepLine(entry, identifier) {
  const match = /^(.*?):(\d+):(.*)$/.exec(entry);
  if (!match) return null;
  const [, candidatePath, candidateLine, lineSource] = match;
  if (!candidatePath || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) return null;
  const word = new RegExp(`\\b${escapeRegExp(identifier)}\\b`).exec(lineSource);
  return {
    path: path.normalize(candidatePath),
    line: Number(candidateLine),
    character: word ? word.index : 0,
  };
}

// 引用排序：按「与当前文件目录的共享前缀深度」分桶——当前文件所在目录的
// 命中最前，逐级向外（父目录、顶层目录、其余）保持 git grep 的路径序。
// 冷索引场景下跨文件调用点是否进列表很依赖这个排序（全词 connect 在内核树
// 命中 3000+ 行，朴素截断会漏掉 drivers/input 的调用点；按子目录分桶后
// drivers/input 的 87 处命中排在前 90 以内）。
function referencePrioritySort(matches, filePath) {
  const own = (filePath || '').split('/');
  own.pop();
  const bucket = (candidate) => {
    const parts = candidate.path.split('/');
    parts.pop();
    let shared = 0;
    while (shared < own.length && parts[shared] === own[shared]) shared += 1;
    return own.length - shared;
  };
  return matches
    .map((match, index) => ({ match, index, rank: bucket(match) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.match);
}

// CONFIG_* 是 gitignored 的 include/generated/autoconf.h 里的宏，git grep
// 搜不到（不在索引里）：直接读该文件找 `#define CONFIG_…` 行补进结果。
async function autoconfReferences(root, identifier) {
  const autoconfPath = 'include/generated/autoconf.h';
  let content;
  try {
    content = await readFile(path.join(root, autoconfPath), 'utf8');
  } catch {
    return [];
  }
  const defineRe = new RegExp(`^#define\\s+(${escapeRegExp(identifier)})\\b`);
  const results = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = defineRe.exec(lines[index]);
    if (!match) continue;
    // 宏名列起点：#define + 空白之后的第一个字符（match[0] 恰好到宏名末尾）。
    results.push({ path: autoconfPath, line: index + 1, character: match[0].length - identifier.length });
    if (results.length > 32) break;
  }
  return results;
}

export async function searchSymbolReferences({ root, filePath, line, character, content }) {
  let text = content;
  if (typeof text !== 'string') {
    try {
      text = (await readSource(root, filePath)).content;
    } catch {
      return [];
    }
  }
  const identifier = wordAt(text, line, character);
  if (!identifier || identifier.length < 2) return [];
  const matches = [];
  const seen = new Set();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    let lines = [];
    try {
      // -w -F：全词、按字面匹配（标识符只允许 C 词法字符，参数数组直传 git）。
      const stdout = await runGit(
        ['grep', '-n', '-I', '-w', '-F', '--no-color', '-e', identifier, '--', ...SOURCE_PATHS],
        { cwd: root, timeout: 20_000 },
      );
      lines = stdout.split('\n');
    } catch {
      lines = [];
    }
    for (const entry of lines) {
      if (!entry) continue;
      const location = parseGrepLine(entry, identifier);
      if (!location) continue;
      const key = `${location.path}:${location.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(location);
    }
  }
  const sorted = referencePrioritySort(matches, filePath).slice(0, MAX_REFERENCE_RESULTS);
  if (/^CONFIG_[A-Z0-9_]+$/.test(identifier)) {
    for (const location of await autoconfReferences(root, identifier)) {
      const key = `${location.path}:${location.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sorted.push(location);
    }
  }
  return sorted;
}