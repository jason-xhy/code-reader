// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 文本检索兜底与 code-reader 的 LSP 回退路径强绑定
// grill: 成品检索=skill 库无 code-reader 文本符号检索成品; 输入固定=仓库根/文件/行列/内容; 步骤机械=取词+git grep+打分/去重; 判读固定=定义形态与命中行; 失效场景=构造不出（仅本应用）
// 文本检索兜底：LSP 无结果时，按定义形态打分在源码中定位符号。
import path from 'node:path';
import { readSource, runGit } from './git.js';

const MAX_RESULTS = 12;
const MIN_DEFINITION_SCORE = 60;
const SOURCE_PATHS = ['*.c', '*.h', '*.cc', '*.cpp', '*.hpp', '*.S', '*.s'];
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

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