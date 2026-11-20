// 能力：仓库打开、分支、同步与自动暂存。
import { readJson, sendJson } from '../http/json.js';
import { getRepository, openLocal, openRemote, repositoryPayload } from '../repositories.js';
import {
  checkoutBranch,
  listBranches,
  listCodeReaderStashes,
  popCodeReaderStash,
  syncRepository,
} from '../git.js';
import { resetLspSession } from '../lsp.js';
import { requiredString } from '../policies/request.js';
import { clearSearchCaches } from '../search/service.js';

function repository(params) {
  return getRepository(params[0]);
}

export const repositoryRoutes = [
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/open-local$/,
    async handler({ request, response }) {
      const body = await readJson(request);
      sendJson(response, 200, await openLocal(body.path, {
        resume: Boolean(body.resume),
        activate: body.activate !== false,
      }));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/open-remote$/,
    async handler({ request, response }) {
      const body = await readJson(request);
      sendJson(response, 200, await openRemote(body.url, {
        resume: Boolean(body.resume),
        activate: body.activate !== false,
      }));
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/repositories\/([^/]+)\/branches$/,
    async handler({ response, params }) {
      sendJson(response, 200, await listBranches(repository(params).root));
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/repositories\/([^/]+)\/stashes$/,
    async handler({ response, params }) {
      sendJson(response, 200, { stashes: await listCodeReaderStashes(repository(params).root) });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/([^/]+)\/refresh$/,
    async handler({ response, params }) {
      const current = repository(params);
      // 刷新文件树时同步失效搜索缓存：新增/删除的未跟踪文件立即可搜。
      clearSearchCaches();
      sendJson(response, 200, await repositoryPayload(current, { fresh: true }));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/([^/]+)\/checkout$/,
    async handler({ request, response, params }) {
      const current = repository(params);
      const body = await readJson(request);
      const branch = requiredString(body.branch, { message: '缺少目标分支', code: 'INVALID_BRANCH' });
      const checkout = await checkoutBranch(current.root, branch);
      await resetLspSession(current.id);
      const data = await repositoryPayload(current, { fresh: true });
      sendJson(response, 200, { ...data, checkout });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/([^/]+)\/sync$/,
    async handler({ response, params }) {
      const current = repository(params);
      const sync = await syncRepository(current.root);
      if (sync.action === 'fast-forwarded') await resetLspSession(current.id);
      const data = await repositoryPayload(current, { fresh: true });
      sendJson(response, 200, { ...data, sync });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/([^/]+)\/stashes\/pop$/,
    async handler({ request, response, params }) {
      const current = repository(params);
      const body = await readJson(request);
      const sha = requiredString(body.sha, { message: '缺少暂存标识', code: 'INVALID_STASH' });
      sendJson(response, 200, { restored: await popCodeReaderStash(current.root, sha) });
    },
  },
];