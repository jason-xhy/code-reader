// 能力：阅读历史（最近打开的仓库与位置）。
import { readJson, sendJson } from '../http/json.js';
import { getRepository } from '../repositories.js';
import { clearHistory, listHistory, removeHistory, touchRepository } from '../history.js';
import { optionalInteger } from '../policies/request.js';

export const historyRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/history$/,
    async handler({ response }) {
      sendJson(response, 200, await listHistory());
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/history$/,
    async handler({ response }) {
      sendJson(response, 200, await clearHistory());
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/history\/touch$/,
    async handler({ request, response }) {
      const body = await readJson(request);
      const repository = getRepository(String(body.repositoryId || ''));
      await touchRepository(repository, {
        file: typeof body.file === 'string' && body.file ? body.file : undefined,
        line: optionalInteger(body.line),
        character: Number.isInteger(body.character) && body.character >= 0 ? body.character : undefined,
      });
      sendJson(response, 200, { ok: true });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/history\/remove$/,
    async handler({ request, response }) {
      const body = await readJson(request);
      sendJson(response, 200, await removeHistory(String(body.key || '')));
    },
  },
];