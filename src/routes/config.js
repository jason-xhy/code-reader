// 能力：LLM 配置读写。
import { readJson, sendJson } from '../http/json.js';
import { availableOpenaiModels } from '../llm/models.js';
import { llmStatus, saveLlmConfig } from '../llm.js';

export const configRoutes = [
  { method: 'GET', pattern: /^\/api\/llm\/models$/, async handler({ response }) {
    sendJson(response, 200, await availableOpenaiModels());
  } },
  {
    method: 'GET',
    pattern: /^\/api\/config$/,
    async handler({ response }) {
      sendJson(response, 200, { llm: await llmStatus() });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/llm\/config$/,
    async handler({ request, response }) {
      sendJson(response, 200, { llm: await saveLlmConfig(await readJson(request)) });
    },
  },
];