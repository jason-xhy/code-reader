// 能力：工作区模糊搜索（函数定义 / 文件名）。
import { sendJson } from '../http/json.js';
import { getRepository } from '../repositories.js';
import { searchWorkspace } from '../search/service.js';

export const searchRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/repositories\/([^/]+)\/search$/,
    async handler({ response, url, params }) {
      const repository = getRepository(params[0]);
      sendJson(response, 200, await searchWorkspace(repository, url.searchParams.get('q') || ''));
    },
  },
];