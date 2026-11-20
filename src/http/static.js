// 静态资源服务：只读 publicRoot 内的文件，目录穿越一律 404。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors.js';
import { contentTypes, publicRoot, staticExtensions, staticFiles } from '../config.js';

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

export async function serveStatic(response, pathname) {
  const alias = staticFiles.get(pathname);
  const candidate = alias
    ? path.join(publicRoot, alias)
    : path.normalize(path.join(publicRoot, pathname));
  if (candidate !== publicRoot && !candidate.startsWith(publicRoot)) {
    throw new AppError('页面不存在', 404, 'NOT_FOUND');
  }
  // 新增前端模块后仍按后缀白名单放行；非白名单后缀统一 404。
  if (!staticExtensions.has(path.extname(candidate))) {
    throw new AppError('页面不存在', 404, 'NOT_FOUND');
  }
  let body;
  try {
    body = await readFile(candidate);
  } catch {
    throw new AppError('页面不存在', 404, 'NOT_FOUND');
  }
  response.writeHead(200, {
    'content-type': contentTypes[path.extname(candidate)] || 'application/octet-stream',
    'cache-control': 'no-cache',
    ...securityHeaders,
  });
  response.end(body);
}