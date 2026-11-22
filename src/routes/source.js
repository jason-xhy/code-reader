// 能力：源码读取、上下文、行/函数历史、提交详情与 LLM 解释。
import { AppError } from '../errors.js';
import { readJson, sendJson } from '../http/json.js';
import { getRepository, repositoryPayload } from '../repositories.js';
import {
  commitDetails,
  functionEvolution,
  functionHistory,
  lineHistory,
  readSource,
  runGit,
  sourceContext,
} from '../git.js';
import { lspPrewarm } from '../lsp.js';
import { explainSource } from '../llm.js';
import { detectSegment, recordFaq } from '../faq.js';
import { integerParam } from '../policies/request.js';
import { serverConfig } from '../config.js';

function repository(params) {
  return getRepository(params[0]);
}

const repositoryPattern = (action) => new RegExp(`^/api/repositories/([^/]+)/${action}$`);

export const sourceRoutes = [
  {
    method: 'GET',
    pattern: repositoryPattern('tree'),
    async handler({ response, params }) {
      const data = await repositoryPayload(repository(params));
      sendJson(response, 200, { files: data.files });
    },
  },
  {
    method: 'GET',
    pattern: repositoryPattern('meta'),
    async handler({ response, params }) {
      const data = await repositoryPayload(repository(params));
      sendJson(response, 200, { repository: data.repository });
    },
  },
  {
    method: 'GET',
    pattern: repositoryPattern('file'),
    async handler({ response, url, params }) {
      const current = repository(params);
      const filePath = url.searchParams.get('path') || '';
      const data = await readSource(current.root, filePath);
      lspPrewarm(current, { path: filePath, content: data.content });
      sendJson(response, 200, data);
    },
  },
  {
    method: 'GET',
    pattern: repositoryPattern('context'),
    async handler({ response, url, params }) {
      const current = repository(params);
      const filePath = url.searchParams.get('path') || '';
      const line = integerParam(url.searchParams.get('line'));
      const radius = Number.parseInt(url.searchParams.get('radius') || String(serverConfig.contextRadius), 10);
      sendJson(response, 200, await sourceContext(current.root, filePath, line, radius));
    },
  },
  {
    method: 'GET',
    pattern: repositoryPattern('line-history'),
    async handler({ response, url, params }) {
      const current = repository(params);
      const filePath = url.searchParams.get('path') || '';
      const line = integerParam(url.searchParams.get('line'));
      sendJson(response, 200, { path: filePath, line, commits: await lineHistory(current.root, filePath, line) });
    },
  },
  {
    method: 'GET',
    pattern: repositoryPattern('function-history'),
    async handler({ response, url, params }) {
      const current = repository(params);
      const filePath = url.searchParams.get('path') || '';
      const line = integerParam(url.searchParams.get('line'));
      if (url.searchParams.get('deep') === '1') {
        sendJson(response, 200, await functionEvolution(current.root, filePath, line));
        return;
      }
      sendJson(response, 200, await functionHistory(current.root, filePath, line));
    },
  },
  {
    method: 'GET',
    pattern: repositoryPattern('commit'),
    async handler({ response, url, params }) {
      const current = repository(params);
      sendJson(response, 200, await commitDetails(current.root, url.searchParams.get('hash') || ''));
    },
  },
  {
    method: 'POST',
    pattern: repositoryPattern('explain'),
    async handler({ request, response, params }) {
      const current = repository(params);
      const body = await readJson(request);
      const line = integerParam(String(body.line || ''));
      const source = await readSource(current.root, body.path || '');
      if (line > source.lines) throw new AppError('行号超出文件范围', 400, 'INVALID_LINE');
      const controller = new AbortController();
      const cancel = () => { if (!response.writableEnded) controller.abort(); };
      response.on('close', cancel);
      let explanation;
      try {
        explanation = await explainSource(source, body.path, line, body.question, {
        repositoryRoot: current.root,
        repositoryId: current.id,
        animate: body.animate === true,
        signal: controller.signal,
      });
      } finally { response.removeListener('close', cancel); }
      controller.signal.throwIfAborted();
      let faq = null;
      try {
        const segment = detectSegment(source.content, line);
        const head = (await runGit(['rev-parse', '--short', 'HEAD'], { cwd: current.root })).trim();
        const entry = await recordFaq(current.id, {
          file: body.path,
          line,
          question: body.question,
          explanation: explanation.explanation,
          model: explanation.model,
          head,
          segment,
          content: source.content,
        });
        faq = { id: entry.id, lineStart: entry.lineStart, lineEnd: entry.lineEnd, symbol: entry.symbol };
      } catch (error) {
        console.error('[faq] 记录失败：', error?.message || error);
      }
      sendJson(response, 200, { ...explanation, faq });
    },
  },
];

