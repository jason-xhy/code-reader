// 服务入口：只做"组装"——配置、路由表、静态资源、错误边界。
// 具体能力在 src/routes/*，传输层在 src/http/*，参数策略在 src/policies/*。
import http from 'node:http';
import { AppError } from './src/errors.js';
import { serverConfig } from './src/config.js';
import { sendJson } from './src/http/json.js';
import { createRouter } from './src/http/router.js';
import { serveStatic } from './src/http/static.js';
import { editorRoutes } from './src/routes/editor.js';
import { configRoutes } from './src/routes/config.js';
import { repositoryRoutes } from './src/routes/repositories.js';
import { workspaceRoutes } from './src/routes/workspace.js';
import { historyRoutes } from './src/routes/history.js';
import { filesystemRoutes } from './src/routes/filesystem.js';
import { docsRoutes } from './src/routes/docs.js';
import { faqRoutes } from './src/routes/faq.js';
import { lspRoutes } from './src/routes/lsp.js';
import { sourceRoutes } from './src/routes/source.js';
import { searchRoutes } from './src/routes/search.js';
import { initEditorEnv } from './src/editor-env.js';
import { attachNvim } from './src/nvim.js';

const handleApi = createRouter([
  editorRoutes,
  configRoutes,
  repositoryRoutes,
  workspaceRoutes,
  historyRoutes,
  filesystemRoutes,
  docsRoutes,
  faqRoutes,
  lspRoutes,
  sourceRoutes,
  searchRoutes,
]);

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
    const details = error instanceof AppError ? error.details : null;
    if (!(error instanceof AppError)) console.error(error);
    if (!response.headersSent) {
      sendJson(response, status, details ? { error: { code, message, details } } : { error: { code, message } });
    }
  }
});

await initEditorEnv();

server.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`Code Reader: http://${serverConfig.host}:${serverConfig.port}`);
});

attachNvim(server, { port: serverConfig.port });