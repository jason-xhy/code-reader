// HTTP 传输层：JSON 读写与统一响应头。与业务能力无关。
import { AppError } from '../errors.js';
import { serverConfig } from '../config.js';

export function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

export async function readJson(request, maxBytes = serverConfig.bodyLimit) {
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