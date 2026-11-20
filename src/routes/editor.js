// 能力：编辑器环境与本地 profile。
import { readJson, sendJson } from '../http/json.js';
import { editorProfile } from '../editor-profile.js';
import { editorStatus, saveEditorConfig } from '../editor-env.js';

export const editorRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/editor$/,
    async handler({ response }) {
      sendJson(response, 200, await editorStatus());
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/editor\/profile$/,
    async handler({ response, url }) {
      sendJson(response, 200, await editorProfile({ force: url.searchParams.get('refresh') === '1' }));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/editor$/,
    async handler({ request, response }) {
      sendJson(response, 200, await saveEditorConfig(await readJson(request)));
    },
  },
];