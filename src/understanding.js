import { detectFunctionSegment, detectSegment } from './faq.js';
import { readSource } from './git.js';
import { searchDefinitionsForIdentifier } from './symbol-search.js';

const MAX_PRIMARY_CHARS = 28_000;
const MAX_RELATED_DEFINITIONS = 4;
const MAX_RELATED_CHARS = 5_000;
const CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'sizeof', 'typeof', 'return', 'function',
  'constructor', 'super', 'defined', 'elif', 'assert', 'print', 'require', 'import',
]);

function numberedText(content, start, end, target, limit) {
  const lines = String(content || '').split('\n');
  const selected = lines.slice(start - 1, end);
  let text = selected
    .map((line, index) => `${String(start + index).padStart(6, ' ')} | ${line}`)
    .join('\n');
  if (text.length <= limit) return text;
  const radius = Math.max(12, Math.floor(limit / 160));
  const focusStart = Math.max(start, target - radius);
  const focusEnd = Math.min(end, target + radius);
  const headEnd = Math.max(start, Math.min(focusStart - 1, start + 8));
  const tailStart = Math.min(end, Math.max(focusEnd + 1, end - 8));
  const parts = [];
  if (start <= headEnd && headEnd >= start) {
    parts.push(lines.slice(start - 1, headEnd).map((line, index) => `${String(start + index).padStart(6, ' ')} | ${line}`).join('\n'));
  }
  parts.push(`... 中间代码已省略；保留当前行 ${target} 附近上下文 ...`);
  parts.push(lines.slice(focusStart - 1, focusEnd).map((line, index) => `${String(focusStart + index).padStart(6, ' ')} | ${line}`).join('\n'));
  if (tailStart <= end && tailStart > focusEnd) {
    parts.push(lines.slice(tailStart - 1, end).map((line, index) => `${String(tailStart + index).padStart(6, ' ')} | ${line}`).join('\n'));
  }
  text = parts.join('\n');
  return text.length > limit ? `${text.slice(0, limit)}\n... 上下文达到长度限制 ...` : text;
}

function callIdentifiers(content, segment, currentLine) {
  const lines = String(content || '').split('\n');
  const counts = new Map();
  for (let index = segment.lineStart - 1; index < segment.lineEnd; index += 1) {
    const line = lines[index] || '';
    for (const match of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const identifier = match[1];
      if (CALL_KEYWORDS.has(identifier) || identifier === segment.symbol) continue;
      const current = counts.get(identifier) || { count: 0, onCurrentLine: false };
      current.count += 1;
      current.onCurrentLine ||= index + 1 === currentLine;
      counts.set(identifier, current);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => Number(b[1].onCurrentLine) - Number(a[1].onCurrentLine) || b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([identifier]) => identifier);
}

async function relatedDefinition(root, currentFile, identifier) {
  try {
    const locations = await searchDefinitionsForIdentifier({ root, identifier, filePath: currentFile });
    const location = locations[0];
    if (!location) return null;
    const source = await readSource(root, location.path);
    const segment = detectFunctionSegment(source.content, location.line)
      || detectSegment(source.content, location.line);
    const lineStart = segment?.lineStart || Math.max(1, location.line - 8);
    const lineEnd = segment?.lineEnd || Math.min(source.lines, location.line + 12);
    return {
      identifier,
      file: location.path,
      line: location.line,
      lineStart,
      lineEnd,
      symbol: segment?.symbol || identifier,
      text: numberedText(source.content, lineStart, lineEnd, location.line, MAX_RELATED_CHARS),
    };
  } catch {
    return null;
  }
}

export async function buildUnderstandingContext({ repositoryRoot, filePath, source, line, question = '' }) {
  const segment = detectFunctionSegment(source.content, line) || detectSegment(source.content, line);
  const primary = {
    file: filePath,
    lineStart: segment.lineStart,
    lineEnd: segment.lineEnd,
    symbol: segment.symbol || '',
    kind: segment.kind || 'range',
    text: numberedText(source.content, segment.lineStart, segment.lineEnd, line, MAX_PRIMARY_CHARS),
  };
  const candidates = callIdentifiers(source.content, segment, line);
  // Explicitly asked-about callees outrank generic logging helpers in large event handlers.
  const requested = candidates.filter(name => String(question).includes(name));
  const identifiers = [...requested, ...candidates.filter(name => !requested.includes(name))].slice(0, MAX_RELATED_DEFINITIONS);
  const related = (await Promise.all(
    identifiers.map((identifier) => relatedDefinition(repositoryRoot, filePath, identifier)),
  )).filter(Boolean).filter((item) => !(item.file === filePath && item.lineStart === primary.lineStart && item.lineEnd === primary.lineEnd));

  const sections = [
    `当前阅读单元：${filePath}:${primary.lineStart}-${primary.lineEnd}${primary.symbol ? `（${primary.symbol}）` : ''}\n${primary.text}`,
  ];
  for (const item of related) {
    sections.push(`相关定义：${item.identifier}，${item.file}:${item.lineStart}-${item.lineEnd}\n${item.text}`);
  }
  return {
    start: primary.lineStart,
    end: primary.lineEnd,
    text: sections.join('\n\n'),
    scope: {
      file: primary.file,
      lineStart: primary.lineStart,
      lineEnd: primary.lineEnd,
      symbol: primary.symbol,
      kind: primary.kind,
    },
    relatedDefinitions: related.map(({ text, ...item }) => item),
    queryText: [primary.symbol, ...identifiers, ...related.map((item) => item.file)].filter(Boolean).join(' '),
  };
}
