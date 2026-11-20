// 能力：LSP 状态、跳转定义与查找引用。
import { readJson, sendJson } from '../http/json.js';
import { getRepository } from '../repositories.js';
import { lspGotoDefinition, lspReferences, lspStatus } from '../lsp.js';
import { characterParam, integerParam, pathParam } from '../policies/request.js';
import { serverConfig } from '../config.js';

function positionBody(body) {
  return {
    path: pathParam(body.path),
    line: integerParam(String(body.line ?? '')),
    character: characterParam(body.character),
    content: body.content,
  };
}

export const lspRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/repositories\/([^/]+)\/lsp\/status$/,
    async handler({ response, params }) {
      sendJson(response, 200, await lspStatus(getRepository(params[0])));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/([^/]+)\/lsp\/goto-definition$/,
    async handler({ request, response, params }) {
      const repository = getRepository(params[0]);
      const body = await readJson(request, serverConfig.largeBodyLimit);
      sendJson(response, 200, await lspGotoDefinition(repository, positionBody(body)));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/([^/]+)\/lsp\/references$/,
    async handler({ request, response, params }) {
      const repository = getRepository(params[0]);
      const body = await readJson(request, serverConfig.largeBodyLimit);
      sendJson(response, 200, await lspReferences(repository, positionBody(body)));
    },
  },
];