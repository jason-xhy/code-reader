// 能力：工作区（多仓库页签）持久化。
import { readJson, sendJson } from '../http/json.js';
import { activateWorkspaceKey, listWorkspace, removeWorkspaceEntry } from '../workspace.js';

export const workspaceRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/workspace$/,
    async handler({ response }) {
      sendJson(response, 200, await listWorkspace());
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/workspace\/activate$/,
    async handler({ request, response }) {
      const body = await readJson(request);
      sendJson(response, 200, await activateWorkspaceKey(String(body.key || '')));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/workspace\/close$/,
    async handler({ request, response }) {
      const body = await readJson(request);
      sendJson(response, 200, await removeWorkspaceEntry(String(body.key || '')));
    },
  },
];