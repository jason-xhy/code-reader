// 能力：打开仓库对话框的本地目录浏览。
import { sendJson } from '../http/json.js';
import { listDirectories } from '../fs-browser.js';

export const filesystemRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/fs\/list$/,
    async handler({ response, url }) {
      sendJson(response, 200, await listDirectories(url.searchParams.get('path') || ''));
    },
  },
];