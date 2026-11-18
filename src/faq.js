// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: FAQ 代码段识别与存储与 code-reader 强绑定
// grill: 成品检索=skill 库无 code-reader FAQ 成品; 输入固定=源码文本+行号/解释结果; 步骤机械=括号或缩进分段+JSON 读写; 判读固定=块范围包含关系; 失效场景=构造不出（仅本应用）
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';
import { dataPath } from './paths.js';

const faqRoot = dataPath('faq');
const MAX_ENTRIES = 1000;
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'else', 'do']);

function storePath(repositoryId) {
  if (typeof repositoryId !== 'string' || !/^[a-z0-9-]+$/i.test(repositoryId)) {
    throw new AppError('仓库标识无效', 400, 'INVALID_REPOSITORY');
  }
  return path.join(faqRoot, `${repositoryId}.json`);
}

async function loadEntries(repositoryId) {
  try {
    const parsed = JSON.parse(await readFile(storePath(repositoryId), 'utf8'));
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

async function saveEntries(repositoryId, entries) {
  await mkdir(faqRoot, { recursive: true });
  const target = storePath(repositoryId);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify({ entries }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

function sanitizeLines(lines) {
  let inBlockComment = false;
  return lines.map((line) => {
    let output = '';
    let inString = null;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          index += 1;
        }
        output += ' ';
        continue;
      }
      if (inString) {
        if (char === '\\') {
          output += ' ';
          index += 1;
          continue;
        }
        if (char === inString) inString = null;
        output += ' ';
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        output += ' ';
        index += 1;
        continue;
      }
      if (char === '/' && next === '/') {
        output += ' '.repeat(line.length - index);
        break;
      }
      if (char === '"' || char === "'") {
        inString = char;
        output += ' ';
        continue;
      }
      output += char;
    }
    return output;
  });
}

function braceBlocks(lines) {
  const blocks = [];
  const stack = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let column = 0; column < line.length; column += 1) {
      if (line[column] === '{') {
        stack.push({ openLine: lineIndex + 1, openColumn: column });
      } else if (line[column] === '}') {
        const block = stack.pop();
        if (block) blocks.push({ lineStart: block.openLine, lineEnd: lineIndex + 1, openColumn: block.openColumn });
      }
    }
  }
  for (const block of stack) {
    blocks.push({ lineStart: block.openLine, lineEnd: lines.length, openColumn: block.openColumn });
  }
  return blocks;
}

function signatureText(rawLines, block) {
  const startLine = rawLines[block.lineStart - 1] || '';
  const previousLine = block.lineStart > 1 ? rawLines[block.lineStart - 2] : '';
  return `${previousLine} ${startLine.slice(0, block.openColumn)}`.trim();
}

function isFunctionSignature(signature) {
  if (!signature.includes(')')) return false;
  const head = signature.replace(/^[^A-Za-z_]+/, '');
  const firstWord = (head.match(/^[A-Za-z_]\w*/) || [''])[0];
  if (CONTROL_KEYWORDS.has(firstWord)) return false;
  const tail = signature.slice(signature.lastIndexOf(')') + 1).trim();
  return /^[A-Za-z_:\s*,<>.-]*$/.test(tail);
}

function symbolOf(signature) {
  const names = signature.match(/[A-Za-z_]\w*(?=\s*\()/g);
  return names && names.length ? names[names.length - 1] : '';
}

function functionStartLine(rawLines, block) {
  const openLineText = rawLines[block.lineStart - 1] || '';
  if (openLineText.slice(0, block.openColumn).trim() !== '' || block.lineStart <= 1) {
    return block.lineStart;
  }
  let start = block.lineStart;
  for (let cursor = block.lineStart - 1; cursor >= 1; cursor -= 1) {
    const text = rawLines[cursor - 1] || '';
    if (!text.trim()) break;
    if (/^\s*(\/\/|\/\*|\*|#)/.test(text)) break;
    start = cursor;
    if (/[;{}]\s*$/.test(text)) break;
    if (block.lineStart - cursor > 4) break;
  }
  return start;
}

function detectBraceSegment(rawLines, target) {
  const sanitized = sanitizeLines(rawLines);
  const blocks = braceBlocks(sanitized);
  const containing = blocks.filter((block) => block.lineStart <= target && block.lineEnd >= target);
  if (!containing.length) return null;
  const functions = containing
    .filter((block) => isFunctionSignature(signatureText(rawLines, block)))
    .sort((a, b) => (a.lineEnd - a.lineStart) - (b.lineEnd - b.lineStart));
  if (functions.length) {
    const block = functions[0];
    return {
      lineStart: functionStartLine(rawLines, block),
      lineEnd: block.lineEnd,
      symbol: symbolOf(signatureText(rawLines, block)),
      kind: 'function',
    };
  }
  const block = containing.sort((a, b) => (a.lineEnd - a.lineStart) - (b.lineEnd - b.lineStart))[0];
  return { lineStart: block.lineStart, lineEnd: block.lineEnd, symbol: '', kind: 'block' };
}

function indentOf(line) {
  const match = String(line || '').match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function matchDefinition(line) {
  const definition = String(line || '').match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/);
  if (definition) return { indent: definition[1].length, kind: 'def', symbol: definition[2] };
  const clazz = String(line || '').match(/^(\s*)(?:async\s+)?class\s+([A-Za-z_]\w*)/);
  if (clazz) return { indent: clazz[1].length, kind: 'class', symbol: clazz[2] };
  return null;
}

function detectIndentSegment(rawLines, target) {
  if (!rawLines.some((line) => matchDefinition(line))) return null;
  const targetLine = rawLines[target - 1] || '';
  const targetIndent = indentOf(targetLine);
  for (let index = target - 1; index >= 0; index -= 1) {
    const definition = matchDefinition(rawLines[index]);
    if (!definition) continue;
    if (index + 1 !== target && targetIndent <= definition.indent && targetLine.trim()) continue;
    let end = rawLines.length;
    for (let cursor = index + 1; cursor < rawLines.length; cursor += 1) {
      const line = rawLines[cursor];
      if (!line.trim()) continue;
      if (indentOf(line) <= definition.indent) {
        end = cursor;
        break;
      }
    }
    return {
      lineStart: index + 1,
      lineEnd: Math.max(index + 1, end),
      symbol: definition.symbol,
      kind: definition.kind,
    };
  }
  return null;
}

export function detectSegment(content, line) {
  const lines = String(content || '').split('\n');
  const target = Math.min(Math.max(1, line), Math.max(1, lines.length));
  const brace = detectBraceSegment(lines, target);
  if (brace) return brace;
  const indent = detectIndentSegment(lines, target);
  if (indent) return indent;
  return {
    lineStart: Math.max(1, target - 50),
    lineEnd: Math.min(lines.length, target + 50),
    symbol: '',
    kind: 'range',
  };
}

function looksLikeFunctionStart(text) {
  if (!text || /^\s/.test(text)) return false;
  if (/^(#|\}|\/\/|\/\*|\*)/.test(text)) return false;
  if (/;\s*$/.test(text)) return false;
  if (/^(typedef|struct|union|enum|extern|if|for|while|switch|return|case|do|else)\b/.test(text)) return false;
  return /^[A-Za-z_][A-Za-z0-9_\s*]*\b[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text);
}

// 光标所在函数的完整范围（含跨多行的参数列表；游标停在签名行时也正确）。
// detectSegment 是 FAQ 的“最小代码块”，嵌套 switch/if 会返回内层块，不能当函数范围。
export function detectFunctionSegment(content, line) {
  const lines = String(content || '').split('\n');
  const target = Math.min(Math.max(1, line), Math.max(1, lines.length));
  let start = -1;
  for (let index = target - 1; index >= 0; index -= 1) {
    if (looksLikeFunctionStart(lines[index])) {
      start = index;
      break;
    }
  }
  if (start === -1) return null;
  let braceLine = -1;
  let braceColumn = -1;
  for (let index = start; index < lines.length && index <= start + 40; index += 1) {
    const text = lines[index];
    const brace = text.indexOf('{');
    const semicolon = text.indexOf(';');
    if (brace !== -1 && (semicolon === -1 || brace < semicolon)) {
      braceLine = index;
      braceColumn = brace;
      break;
    }
    if (semicolon !== -1 && (brace === -1 || semicolon < brace)) return null;
  }
  if (braceLine === -1) return null;
  let depth = 0;
  let inBlockComment = false;
  let inLineComment = false;
  let inString = false;
  let quote = '';
  let endLine = -1;
  for (let index = braceLine; index < lines.length; index += 1) {
    const text = lines[index];
    const from = index === braceLine ? braceColumn : 0;
    for (let column = from; column < text.length; column += 1) {
      const char = text[column];
      const next = text[column + 1];
      if (inLineComment) break;
      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          column += 1;
        }
        continue;
      }
      if (inString) {
        if (char === '\\') {
          column += 1;
          continue;
        }
        if (char === quote) inString = false;
        continue;
      }
      if (char === '/' && next === '/') {
        inLineComment = true;
        break;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        column += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          endLine = index + 1;
          break;
        }
      }
    }
    inLineComment = false;
    if (endLine !== -1) break;
  }
  if (endLine === -1) return null;
  if (target < start + 1 || target > endLine) return null;
  const signature = lines.slice(start, Math.min(braceLine + 1, start + 20)).join(' ');
  const paren = signature.indexOf('(');
  const names = signature.slice(0, paren === -1 ? signature.length : paren).match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  const symbol = names[names.length - 1] || '';
  return { lineStart: start + 1, lineEnd: endLine, symbol, kind: 'function' };
}

export async function recordFaq(repositoryId, { file, line, question, explanation, model, head, segment }) {
  const entries = await loadEntries(repositoryId);
  const now = new Date().toISOString();
  const normalized = String(question || '').trim();
  const existing = entries.find((entry) => (
    entry.file === file
    && entry.lineStart === segment.lineStart
    && entry.lineEnd === segment.lineEnd
    && entry.question === normalized
  ));
  const payload = {
    file,
    line,
    lineStart: segment.lineStart,
    lineEnd: segment.lineEnd,
    symbol: segment.symbol || '',
    kind: segment.kind || 'range',
    question: normalized,
    overview: explanation.overview,
    details: explanation.details,
    summary: explanation.summary,
    specifications: explanation.specifications,
    model,
    head,
    updatedAt: now,
  };
  let entry;
  if (existing) {
    Object.assign(existing, payload);
    entry = existing;
  } else {
    entry = { id: `${Date.now()}-${randomBytes(4).toString('hex')}`, ...payload, createdAt: now };
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  }
  await saveEntries(repositoryId, entries);
  return entry;
}

export async function findFaq(repositoryId, file, line) {
  const entries = await loadEntries(repositoryId);
  return entries
    .filter((entry) => entry.file === file && entry.lineStart <= line && entry.lineEnd >= line)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function deleteFaq(repositoryId, id) {
  const entries = await loadEntries(repositoryId);
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return { removed: false };
  await saveEntries(repositoryId, next);
  return { removed: true };
}