// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 本地文档索引与 code-reader 解释链路强绑定
// grill: 成品检索=skill 库无 code-reader 文档检索成品; 输入固定=docs 目录列表+问题文本; 步骤机械=遍历/抽取/切块/BM25; 判读固定=token 命中与分数; 失效场景=构造不出（仅本应用）
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './errors.js';
import { dataPath } from './paths.js';
import { CONFIGURED_DOCUMENTATION_WEIGHT, documentationQueryWeight, documentationSourceTerms } from './policies/documentation.js';

const execFileAsync = promisify(execFile);
const configPath = dataPath('docs-config.json');
const MAX_DIRECTORIES = 10;
const MAX_FILES = 12000;
const MAX_PDF_FILES = 200;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS_PER_FILE = 200;
const CHUNK_SIZE = 1200;
const CACHE_TTL_MS = 60 * 60 * 1000;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', 'build', 'dist', '.venv', 'venv', '__pycache__', 'target']);
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.rst', '.txt', '.adoc', '.html', '.htm', '.tex', '.json', '.yaml', '.yml']);

let configCache = null;
const directoryCache = new Map();

function invalidate() {
  directoryCache.clear();
}

export async function getDocsConfig() {
  if (configCache) return configCache;
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    configCache = {
      directories: Array.isArray(parsed.directories) ? parsed.directories.filter((value) => typeof value === 'string') : [],
      webEnabled: parsed.webEnabled !== false,
    };
  } catch {
    configCache = { directories: [], webEnabled: true };
  }
  return configCache;
}

export async function saveDocsConfig(body) {
  const input = Array.isArray(body?.directories) ? body.directories : [];
  if (input.length > MAX_DIRECTORIES) {
    throw new AppError(`最多支持 ${MAX_DIRECTORIES} 个文档目录`, 400, 'INVALID_DOCS_CONFIG');
  }
  const directories = [];
  for (const value of input) {
    if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) {
      throw new AppError('文档目录必须是绝对路径', 400, 'INVALID_DOCS_CONFIG');
    }
    let resolved;
    try {
      resolved = await realpath(value.trim());
      const info = await stat(resolved);
      if (!info.isDirectory()) throw new Error('not a directory');
    } catch {
      throw new AppError(`目录不存在或不可访问：${value}`, 400, 'INVALID_DOCS_CONFIG');
    }
    if (!directories.includes(resolved)) directories.push(resolved);
  }
  const webEnabled = body?.webEnabled !== false;
  configCache = { directories, webEnabled };
  invalidate();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(configCache, null, 2)}\n`, { mode: 0o600 });
  return configCache;
}

export function invalidateDocsIndex() {
  invalidate();
}

async function directoryExists(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function repositoryDocsDirectories(repositoryRoot) {
  if (!repositoryRoot) return [];
  const candidates = ['Documentation', 'docs', 'doc'].map((name) => path.join(repositoryRoot, name));
  const found = [];
  for (const candidate of candidates) {
    if (await directoryExists(candidate)) found.push(await realpath(candidate));
  }
  return found;
}

async function collectFiles(directory, output, depth) {
  if (depth > 8 || output.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (output.length >= MAX_FILES) return;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collectFiles(full, output, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (extension === '.pdf' || TEXT_EXTENSIONS.has(extension)) {
      output.push({ path: full, extension });
    }
  }
}

function stripHtml(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readPdf(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'pdftotext',
      ['-layout', filePath, '-'],
      { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return '';
  }
}

async function readDocument(filePath, extension) {
  if (extension === '.pdf') return readPdf(filePath);
  try {
    const info = await stat(filePath);
    if (info.size > MAX_FILE_BYTES) return '';
    const buffer = await readFile(filePath);
    if (buffer.includes(0)) return '';
    const text = buffer.toString('utf8');
    return extension === '.html' || extension === '.htm' ? stripHtml(text) : text;
  } catch {
    return '';
  }
}

function sampleChunks(chunks, limit) {
  if (chunks.length <= limit) return chunks;
  if (limit < 2) return [chunks[0]];
  const sampled = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(chunks[Math.round((index * (chunks.length - 1)) / (limit - 1))]);
  }
  return sampled;
}

function paragraphHeading(value) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  const markdown = /^#{1,6}\s+(.+)$/.exec(lines[0]);
  if (markdown) return markdown[1].trim().slice(0, 300);
  if (lines.length >= 2 && /^(?:=+|-+|~+|\^+)$/.test(lines[1]) && lines[1].length >= Math.min(3, lines[0].length)) {
    return lines[0].slice(0, 300);
  }
  const numbered = /^((?:\d+\.)+\d*)\s+(.+)$/.exec(lines[0]);
  return numbered ? `${numbered[1]} ${numbered[2]}`.slice(0, 300) : '';
}

function chunkText(text, source, rel, root, { page = null } = {}) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '');
  const chunks = [];
  let buffer = '';
  let currentSection = '';
  const flush = () => {
    const value = buffer.trim();
    if (value.length > 40) chunks.push({ source, rel, root, section: currentSection, page, text: value.slice(0, CHUNK_SIZE * 2) });
    buffer = '';
  };
  for (const paragraph of normalized.split(/\n\s*\n/)) {
    const value = paragraph.trim();
    if (!value) continue;
    const heading = paragraphHeading(value);
    if (heading) {
      flush();
      currentSection = heading;
    }
    if (value.length > CHUNK_SIZE * 1.4) {
      flush();
      for (let index = 0; index < value.length; index += CHUNK_SIZE) {
        chunks.push({ source, rel, root, section: currentSection, page, text: value.slice(index, index + CHUNK_SIZE) });
      }
      continue;
    }
    if ((buffer ? buffer.length + 2 : 0) + value.length > CHUNK_SIZE * 1.2) flush();
    buffer += `${buffer ? '\n\n' : ''}${value}`;
  }
  flush();
  return sampleChunks(chunks, MAX_CHUNKS_PER_FILE);
}

function chunkDocument(text, source, rel, root, extension) {
  if (extension !== '.pdf') return chunkText(text, source, rel, root);
  const pages = String(text || '').split('\f');
  return sampleChunks(
    pages.flatMap((pageText, index) => chunkText(pageText, source, rel, root, { page: index + 1 })),
    MAX_CHUNKS_PER_FILE,
  );
}

function tokenize(text) {
  const lower = String(text || '').toLowerCase();
  const tokens = lower.match(/[a-z0-9_]{2,}/g) || [];
  for (const token of [...tokens]) if (token.includes('_')) tokens.push(...token.split('_').filter((part) => part.length >= 2));
  const cjkBlocks = lower.match(/[\u4e00-\u9fff]+/g) || [];
  for (const block of cjkBlocks) {
    if (block.length === 1) tokens.push(block);
    for (let index = 0; index < block.length - 1; index += 1) tokens.push(block.slice(index, index + 2));
  }
  return tokens;
}

async function buildDirectoryIndex(directory) {
  const cached = directoryCache.get(directory);
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached;
  const files = [];
  await collectFiles(directory, files, 0);
  let pdfCount = 0;
  const chunks = [];
  for (const file of files) {
    if (file.extension === '.pdf') {
      pdfCount += 1;
      if (pdfCount > MAX_PDF_FILES) continue;
    }
    const text = await readDocument(file.path, file.extension);
    if (!text) continue;
    const rel = path.relative(directory, file.path);
    chunks.push(...chunkDocument(text, file.path, rel, directory, file.extension));
  }
  for (const chunk of chunks) chunk.tokens = tokenize(chunk.text);
  const entry = { builtAt: Date.now(), files: files.length, chunks };
  directoryCache.set(directory, entry);
  return entry;
}

async function collectChunks(directories) {
  const chunks = [];
  const stats = { directories: directories.length, files: 0, chunks: 0, builtAt: null };
  for (const directory of directories) {
    const index = await buildDirectoryIndex(directory);
    stats.files += index.files;
    stats.chunks += index.chunks.length;
    if (!stats.builtAt || index.builtAt < stats.builtAt) stats.builtAt = index.builtAt;
    chunks.push(...index.chunks);
  }
  return { chunks, stats };
}

function isTableOfContents(text) {
  return (text.match(/\.{4,}/g) || []).length >= 3;
}

function scoreChunks(chunks, query, sourceQuery = '', preferredRoots = []) {
  const sourceTerms = documentationSourceTerms(sourceQuery);
  const queryTokens = [...new Set([...sourceTerms, ...tokenize(query)])].slice(0, 128);
  if (!queryTokens.length || !chunks.length) return [];
  const documentFrequency = new Map();
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.tokens.length;
    for (const token of new Set(chunk.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
  const averageLength = Math.max(1, totalLength / chunks.length);
  const total = chunks.length;
  const scored = [];
  for (const chunk of chunks) {
    const frequencies = new Map();
    for (const token of chunk.tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    let score = 0;
    for (const token of queryTokens) {
      const frequency = frequencies.get(token) || 0;
      if (!frequency) continue;
      const df = documentFrequency.get(token) || 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      score += documentationQueryWeight(token, sourceTerms) * idf * ((frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * (chunk.tokens.length / averageLength))));
    }
    if (preferredRoots.includes(chunk.root)) score *= CONFIGURED_DOCUMENTATION_WEIGHT;
    if (isTableOfContents(chunk.text)) score *= 0.35;
    if (score > 0.8) scored.push({ ...chunk, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const perSource = new Map();
  const hits = [];
  for (const hit of scored) {
    const count = perSource.get(hit.source) || 0;
    if (count >= 3) continue;
    perSource.set(hit.source, count + 1);
    hits.push(hit);
    if (hits.length >= 6) break;
  }
  return hits;
}

export async function searchDocumentation({ repositoryRoot, query, sourceQuery = '' }) {
  const config = await getDocsConfig();
  const repoDirectories = await repositoryDocsDirectories(repositoryRoot);
  const directories = [...new Set([...config.directories, ...repoDirectories])];
  if (!directories.length) {
    return { hits: [], config, stats: { directories: 0, files: 0, chunks: 0, builtAt: null } };
  }
  const { chunks, stats } = await collectChunks(directories);
  const unique = new Map();
  for (const chunk of chunks) {
    const key = `${chunk.source}\0${chunk.page}\0${chunk.text}`;
    if (!unique.has(key)) unique.set(key, chunk);
  }
  const hits = scoreChunks([...unique.values()], query, sourceQuery, config.directories).map((hit) => ({
    source: `${path.basename(hit.root)}/${hit.rel}`,
    file: hit.source,
    root: hit.root,
    section: hit.section || '',
    page: hit.page || null,
    text: hit.text,
    score: hit.score,
  }));
  return { hits, config, stats };
}

export async function docsStats() {
  const config = await getDocsConfig();
  const directories = [];
  for (const directory of config.directories) {
    const cached = directoryCache.get(directory);
    directories.push({
      path: directory,
      indexed: Boolean(cached),
      files: cached?.files || 0,
      chunks: cached?.chunks.length || 0,
      builtAt: cached ? new Date(cached.builtAt).toISOString() : null,
    });
  }
  return { config, directories };
}