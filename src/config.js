// 应用级配置：只放"值"，不放行为。环境变量与默认值都集中在这里，
// 其它模块通过 import 读取，避免常量散落在路由与服务实现中。
import { fileURLToPath } from 'node:url';

export const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));

export const serverConfig = {
  // 只监听回环地址：本工具能读取本地仓库与 LLM Key 配置，不做鉴权。
  host: '127.0.0.1',
  port: Number.parseInt(process.env.PORT || '8765', 10),
  // 普通 JSON 请求体上限；LSP 需要携带整份文件内容，单独放宽。
  bodyLimit: 64 * 1024,
  largeBodyLimit: 8 * 1024 * 1024,
  // 引用 / 搜索结果预览的默认上下行数。
  contextRadius: 10,
};

// 静态文件别名表：只给首页与入口脚本起短路径，其余按 publicRoot 相对路径解析。
export const staticFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'],
  ['/llm-settings.js', 'llm-settings.js'],
]);

export const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// 前端路由入口：静态文件服务只允许这些后缀，避免把 .data 等目录带出去。
export const staticExtensions = new Set(Object.keys(contentTypes));