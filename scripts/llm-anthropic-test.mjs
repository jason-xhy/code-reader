// one-shot: code-reader Anthropic 协议回归测试（项目自带工具，非 agent 探索脚本）; no-generalize: 与 code-reader 的 LLM 请求/解析结构强绑定
// grill: 成品检索=skill 库无 code-reader Anthropic 专项测试成品; 输入固定=本地 fetch 桩与固定源码; 步骤机械=调用 explainSource 并检查请求体/响应; 判读固定=thinking.disabled 与错误码; 失效场景=构造不出（仅本应用）
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'cr-llm-anthropic-'));
process.env.CODE_READER_DATA_DIR = dataDir;
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'stub-model';
process.env.LLM_BASE_URL = 'http://127.0.0.1:9';
process.env.LLM_PROTOCOL = 'anthropic';

let checks = 0;
let failures = 0;

function assert(condition, message, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    failures += 1;
    console.log(`FAIL ${message}${detail ? ` :: ${detail}` : ''}`);
  }
}

const calls = [];
const stubFetch = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url, body });
  const lastMessage = body.messages?.at(-1)?.content || '';
  if (String(lastMessage).includes('TRIGGER_THINKING_ONLY')) {
    return new Response(JSON.stringify({
      content: [{ type: 'thinking', thinking: '思考内容'.repeat(100) }],
      stop_reason: 'max_tokens',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    content: [
      { type: 'thinking', thinking: '不应被解析进正文' },
      {
        type: 'text',
        text: JSON.stringify({
          overview: '概览',
          details: ['细节一', '细节二'],
          summary: '总结',
          specifications: [],
        }),
      },
    ],
    stop_reason: 'end_turn',
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

// Exercise the production Undici transport against a local server, rather than
// replacing global fetch (the production proxy-aware adapter imports its own fetch).
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const result = await stubFetch(`http://127.0.0.1${request.url}`, {body: Buffer.concat(chunks).toString()});
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(await result.text());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.LLM_BASE_URL = `http://127.0.0.1:${server.address().port}`;
const { explainSource } = await import(path.join(repoRoot, 'src/llm.js'));
const source = { content: ['int main(void)', '{', '    return 0;', '}'].join('\n') };

try {
  const result = await explainSource(source, 'test.c', 3, '这一行做什么？');
  assert(result.explanation.overview === '概览', 'Anthropic text 内容块可解析');
  assert(result.explanation.details.length === 2, 'Anthropic JSON 的 details 保留');
  assert(calls.length === 1, '成功路径只发送一次请求', `calls=${calls.length}`);
  assert(calls[0].url.endsWith('/v1/messages'), 'Anthropic 请求路径正确', calls[0].url);
  assert(calls[0].body.thinking?.type === 'disabled', 'Anthropic 请求关闭 thinking', JSON.stringify(calls[0].body.thinking));
  assert(calls[0].body.max_tokens === 8192, 'Anthropic max_tokens 为 8192', String(calls[0].body.max_tokens));

  let error = null;
  try {
    await explainSource(source, 'test.c', 3, 'TRIGGER_THINKING_ONLY 这一行做什么？');
  } catch (caught) {
    error = caught;
  }
  assert(error?.status === 502 && error?.code === 'INVALID_LLM_RESPONSE', '仅 thinking 响应返回 502', `${error?.status}/${error?.code}`);
  assert(String(error?.message || '').includes('max_tokens'), '错误信息说明 max_tokens 截断', error?.message);
  assert(error?.details?.stopReason === 'max_tokens', '错误详情保留 stop_reason', JSON.stringify(error?.details));
  assert(error?.details?.response?.status === 200, '错误详情保留 HTTP 200 原文', String(error?.details?.response?.status));
} finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\nRESULT ${failures === 0 ? 'PASS' : 'FAIL'} checks=${checks} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);