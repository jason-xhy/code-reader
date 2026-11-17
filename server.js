import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './src/errors.js';
import { lineHistory, readSource } from './src/git.js';
import { explainSource, llmStatus, saveLlmConfig } from './src/llm.js';
import { getRepository, openLocal, openRemote, repositoryPayload } from './src/repositories.js';
import { lspGotoDefinition, lspReferences, lspStatus } from './src/lsp.js';

const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number.parseInt(process.env.PORT || '8765', 10);
const staticFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'],
  ['/llm-settings.js', 'llm-settings.js'],
]);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readJson(request, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      tooLarge = true;
    } else {
      chunks.push(chunk);
    }
  }
  if (tooLarge) throw new AppError('请求体过大', 413, 'BODY_TOO_LARGE');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new AppError('请求体必须是有效 JSON', 400, 'INVALID_JSON');
  }
}

function integerParam(value) {
  if (!/^[1-9]\d*$/.test(value || '')) throw new AppError('行号必须是正整数', 400, 'INVALID_LINE');
  const line = Number(value);
  if (!Number.isSafeInteger(line)) throw new AppError('行号无效', 400, 'INVALID_LINE');
  return line;
}

function characterParam(value) {
  const text = String(value ?? 0);
  if (!/^\d+$/.test(text)) throw new AppError('列号必须是非负整数', 400, 'INVALID_CHARACTER');
  return Number(text);
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/config' && request.method === 'GET') {
    sendJson(response, 200, { llm: await llmStatus() });
    return;
  }
  if (url.pathname === '/api/llm/config' && request.method === 'POST') {
    const body = await readJson(request);
    sendJson(response, 200, { llm: await saveLlmConfig(body) });
    return;
  }
  if (url.pathname === '/api/repositories/open-local' && request.method === 'POST') {
    const body = await readJson(request);
    sendJson(response, 200, await openLocal(body.path));
    return;
  }
  if (url.pathname === '/api/repositories/open-remote' && request.method === 'POST') {
    const body = await readJson(request);
    sendJson(response, 200, await openRemote(body.url));
    return;
  }

  const lspMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/lsp\/(status|goto-definition|references)$/);
  if (lspMatch) {
    const repository = getRepository(decodeURIComponent(lspMatch[1]));
    const action = lspMatch[2];
    if (action === 'status' && request.method === 'GET') {
      sendJson(response, 200, lspStatus(repository));
      return;
    }
    if (request.method !== 'POST') throw new AppError('该 API 不支持此请求方法', 405, 'METHOD_NOT_ALLOWED');
    const body = await readJson(request, 8 * 1024 * 1024);
    const filePath = typeof body.path === 'string' && body.path ? body.path : '';
    if (!filePath || filePath.includes('\0')) throw new AppError('文件路径无效', 400, 'INVALID_PATH');
    const line = integerParam(String(body.line ?? ''));
    const character = characterParam(body.character);
    if (action === 'goto-definition') {
      sendJson(response, 200, await lspGotoDefinition(repository, { path: filePath, line, character, content: body.content }));
      return;
    }
    sendJson(response, 200, await lspReferences(repository, { path: filePath, line, character, content: body.content }));
    return;
  }

  const match = url.pathname.match(/^\/api\/repositories\/([^/]+)\/(tree|meta|file|line-history|explain)$/);
  if (!match) throw new AppError('API 不存在', 404, 'NOT_FOUND');
  const repository = getRepository(decodeURIComponent(match[1]));
  const action = match[2];

  if (action === 'tree' && request.method === 'GET') {
    const data = await repositoryPayload(repository);
    sendJson(response, 200, { files: data.files });
    return;
  }
  if (action === 'meta' && request.method === 'GET') {
    const data = await repositoryPayload(repository);
    sendJson(response, 200, { repository: data.repository });
    return;
  }
  if (action === 'file' && request.method === 'GET') {
    sendJson(response, 200, await readSource(repository.root, url.searchParams.get('path') || ''));
    return;
  }
  if (action === 'line-history' && request.method === 'GET') {
    const filePath = url.searchParams.get('path') || '';
    const line = integerParam(url.searchParams.get('line'));
    sendJson(response, 200, { path: filePath, line, commits: await lineHistory(repository.root, filePath, line) });
    return;
  }
  if (action === 'explain' && request.method === 'POST') {
    const body = await readJson(request);
    const line = integerParam(String(body.line || ''));
    const source = await readSource(repository.root, body.path || '');
    if (line > source.lines) throw new AppError('行号超出文件范围', 400, 'INVALID_LINE');
    sendJson(response, 200, await explainSource(source, body.path, line, body.question));
    return;
  }
  throw new AppError('该 API 不支持此请求方法', 405, 'METHOD_NOT_ALLOWED');
}

async function serveStatic(response, pathname) {
  let filePath;
  const alias = staticFiles.get(pathname);
  if (alias) {
    filePath = path.join(publicRoot, alias);
  } else {
    const candidate = path.normalize(path.join(publicRoot, pathname));
    if (candidate !== publicRoot && !candidate.startsWith(publicRoot)) {
      throw new AppError('页面不存在', 404, 'NOT_FOUND');
    }
    filePath = candidate;
  }
  let body;
  try {
    body = await readFile(filePath);
  } catch {
    throw new AppError('页面不存在', 404, 'NOT_FOUND');
  }
  response.writeHead(200, {
    'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
    } else if (request.method === 'GET') {
      await serveStatic(response, url.pathname);
    } else {
      throw new AppError('请求方法不支持', 405, 'METHOD_NOT_ALLOWED');
    }
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof AppError ? error.message : '服务器内部错误';
    if (!(error instanceof AppError)) console.error(error);
    if (!response.headersSent) sendJson(response, status, { error: { code, message } });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Code Reader: http://127.0.0.1:${port}`);
});
