// 能力：本地文档知识库配置与索引。
import { readJson, sendJson } from '../http/json.js';
import { docsStats, getDocsConfig, invalidateDocsIndex, saveDocsConfig } from '../docs.js';

export const docsRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/docs\/config$/,
    async handler({ response }) {
      sendJson(response, 200, await docsStats());
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/docs\/config$/,
    async handler({ request, response }) {
      sendJson(response, 200, { config: await saveDocsConfig(await readJson(request)) });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/docs\/reindex$/,
    async handler({ response }) {
      invalidateDocsIndex();
      sendJson(response, 200, { ok: true, config: await getDocsConfig() });
    },
  },
];