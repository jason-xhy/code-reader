// 能力：代码 FAQ（按函数/代码段命中，含过期检测）。
import { readJson, sendJson } from '../http/json.js';
import { getRepository } from '../repositories.js';
import { readSource, runGit } from '../git.js';
import { deleteFaq, findFaq } from '../faq.js';
import { integerParam, pathParam, requiredString } from '../policies/request.js';

export const faqRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/repositories\/([^/]+)\/faq$/,
    async handler({ response, url, params }) {
      const repository = getRepository(params[0]);
      const filePath = pathParam(url.searchParams.get('path') || '');
      const line = integerParam(url.searchParams.get('line'));
      let content = '';
      let head = '';
      try {
        content = (await readSource(repository.root, filePath)).content;
        head = (await runGit(['rev-parse', '--short', 'HEAD'], { cwd: repository.root })).trim();
      } catch (error) {
        console.error('[faq] 过期检测失败：', error?.message || error);
      }
      sendJson(response, 200, {
        path: filePath,
        line,
        entries: await findFaq(repository.id, filePath, line, { content, head }),
      });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/([^/]+)\/faq\/delete$/,
    async handler({ request, response, params }) {
      const repository = getRepository(params[0]);
      const body = await readJson(request);
      const id = requiredString(body.id, { message: '缺少 FAQ 标识', code: 'INVALID_FAQ' });
      sendJson(response, 200, await deleteFaq(repository.id, id));
    },
  },
];