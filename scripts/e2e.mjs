// one-shot: code-reader 端到端 API 回归脚本（项目自带工具，非 agent 探索脚本）; no-generalize: 与 code-reader 仓库/API 形态强绑定
// grill: 成品检索=skill 库无 code-reader e2e 成品; 输入固定=临时 bare 仓库+固定 API 路径; 步骤机械=建仓/调 API/断言; 判读固定=HTTP 200 与字段值; 失效场景=构造不出（仅本应用）
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { detectSegment } from '../src/faq.js';
import { detectFunctionSegment } from '../src/faq.js';
import { parseGoogleResults } from '../src/websearch.js';
import { searchSymbolDefinitions, wordAt } from '../src/symbol-search.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://127.0.0.1:8799';
const root = mkdtempSync(path.join(os.tmpdir(), 'cr-e2e-'));
const work = path.join(root, 'work');
const peer = path.join(root, 'peer');
const remote = path.join(root, 'remote.git');
let failures = 0;
let checks = 0;

function log(message) {
  console.log(message);
}

function pass(message) {
  checks += 1;
  log(`PASS ${message}`);
}

function fail(message) {
  failures += 1;
  log(`FAIL ${message}`);
}

function assert(condition, message, detail = '') {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` :: ${detail}` : ''}`);
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'E2E',
      GIT_AUTHOR_EMAIL: 'e2e@example.com',
      GIT_COMMITTER_NAME: 'E2E',
      GIT_COMMITTER_EMAIL: 'e2e@example.com',
    },
  }).trim();
}

async function api(method, url, body) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON response (${response.status}): ${text.slice(0, 200)}`);
  }
  return { status: response.status, data };
}

function probeNvim(url, messages, { origin } = {}) {
  return new Promise((resolve) => {
    const socket = origin ? new WebSocket(url, { origin }) : new WebSocket(url);
    let data = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // 已关闭
      }
      resolve(result);
    };
    socket.on('open', () => {
      for (const message of messages) socket.send(JSON.stringify(message));
    });
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      if (message.t === 'd') data += message.d;
      if (data.includes('ping')) finish({ ok: true, data });
    });
    socket.on('error', (error) => finish({ ok: false, error: error.message, data }));
    socket.on('close', (code) => finish({ ok: data.includes('ping'), code, data }));
    setTimeout(() => finish({ ok: false, error: 'timeout', data }), 5000);
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/config`);
      if (response.ok) return;
    } catch {
      // not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server did not start');
}

let stubCalls = 0;
let lastUserContent = '';
const stub = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  stubCalls += 1;
  let messages = [];
  try {
    messages = JSON.parse(body || '{}').messages || [];
  } catch {
    messages = [];
  }
  lastUserContent = messages.filter((message) => message.role === 'user').map((message) => String(message.content || '')).join('\n');
  const content = lastUserContent.includes('TRIGGER_BAD_JSON')
    ? '{"overview": "缺少后续字段"'
    : messages.length >= 4
      ? '先给出结论。\n```json\n{"overview":"概览","details":["细节一","细节二"],"summary":"总结","specifications":[]}\n```'
      : '抱歉，我无法按要求输出 JSON。';
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
});

await new Promise((resolve) => stub.listen(8899, '127.0.0.1', resolve));

const dataDir = path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });

// 固定 editor profile，避免 e2e 依赖本机 nvim 配置；同时覆盖 profile 归一化链路。
const profileFixture = path.join(root, 'editor-profile.json');
writeFileSync(profileFixture, JSON.stringify({
  colorscheme: 'fixture-theme',
  background: 'dark',
  termguicolors: true,
  leader: ' ',
  localleader: ' ',
  font: { family: 'DejaVu Sans Mono', points: 12, source: 'fixture' },
  options: {
    tabstop: 8,
    shiftwidth: 8,
    expandtab: false,
    number: true,
    relativenumber: false,
    cursorline: true,
    wrap: true,
    list: true,
    listchars: 'nbsp:␣,tab:» ,trail:·',
  },
  colors: {
    Normal: { fg: '#c8d3f5', bg: '#222436' },
    Comment: { fg: '#636da6' },
    String: { fg: '#c3e88d' },
    Function: { fg: '#82aaff' },
    Statement: { fg: '#c099ff' },
    Visual: { bg: '#2d3f76' },
    LineNr: { fg: '#3b4261' },
  },
  keymaps: [
    { mode: 'n', lhs: ' sf', rhs: '', desc: '[S]earch [F]iles', silent: false },
    { mode: 'n', lhs: '<C-h>', rhs: '<C-w><C-h>', desc: 'Move focus to the left window', silent: false },
  ],
}, null, 2));

const server = spawn(process.execPath, ['server.js'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: '8799',
    CODE_READER_DATA_DIR: dataDir,
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'stub-model',
    LLM_BASE_URL: 'http://127.0.0.1:8899/v1',
    LLM_PROTOCOL: 'openai',
    CODE_READER_NVIM: '/bin/cat',
    CODE_READER_PROFILE_JSON: profileFixture,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

try {
  await waitForServer();

  git(root, 'init', '--bare', remote);
  git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/master');
  git(root, 'clone', remote, work);
  git(work, 'config', 'user.name', 'E2E');
  git(work, 'config', 'user.email', 'e2e@example.com');
  execFileSync('bash', ['-c', "printf 'line1\\nline2\\nline3\\n' > base.txt && git add base.txt && git commit -m initial"], { cwd: work, env: process.env });
  git(work, 'push', '-u', 'origin', 'master');
  git(work, 'checkout', '-b', 'feature');
  execFileSync('bash', ['-c', "printf 'feature\\n' > feature.txt && git add feature.txt && git commit -m feature"], { cwd: work, env: process.env });
  git(work, 'push', '-u', 'origin', 'feature');
  git(work, 'checkout', 'master');
  git(work, 'branch', '-D', 'feature');

  git(root, 'clone', remote, peer);
  git(peer, 'config', 'user.name', 'Peer');
  git(peer, 'config', 'user.email', 'peer@example.com');

  const opened = await api('POST', '/api/repositories/open-local', { path: work });
  assert(opened.status === 200, 'open-local 返回 200', `status=${opened.status}`);
  const id = opened.data.repository.id;
  const repoBase = `/api/repositories/${encodeURIComponent(id)}`;

  const branches = await api('GET', `${repoBase}/branches`);
  const localNames = branches.data.branches.filter((b) => b.type === 'local').map((b) => b.name);
  const remoteFeature = branches.data.branches.find((b) => b.type === 'remote' && b.name === 'origin/feature');
  assert(branches.data.current === 'master', 'branches 当前分支为 master', branches.data.current);
  assert(localNames.includes('master') && !localNames.includes('feature'), 'branches 本地分支不含 feature', localNames.join(','));
  assert(Boolean(remoteFeature) && remoteFeature.hasLocal === false, 'branches 含远程独有 origin/feature', JSON.stringify(remoteFeature));

  const checkoutRemote = await api('POST', `${repoBase}/checkout`, { branch: 'origin/feature' });
  assert(checkoutRemote.status === 200 && checkoutRemote.data.repository.branch === 'feature', 'checkout 远程独有分支创建并切换 feature', JSON.stringify(checkoutRemote.data.repository.branch));
  assert(checkoutRemote.data.files.includes('feature.txt'), 'checkout 后文件树含 feature.txt');
  assert(git(work, 'branch', '--show-current') === 'feature', 'git 实际分支为 feature');

  const checkoutMaster = await api('POST', `${repoBase}/checkout`, { branch: 'master' });
  assert(checkoutMaster.data.repository.branch === 'master', 'checkout 本地分支 master');

  execFileSync('bash', ['-c', "printf 'modified\\n' >> base.txt"], { cwd: work });
  const dirtySwitch = await api('POST', `${repoBase}/checkout`, { branch: 'feature' });
  const stashes = dirtySwitch.data.checkout?.stashes || [];
  assert(stashes.length === 1 && stashes[0].files === 1, '脏工作区切换自动 stash', JSON.stringify(stashes));
  assert(git(work, 'stash', 'list', '--format=%gs').includes('code-reader:'), 'stash 列表含 code-reader 标记');
  const stashList = await api('GET', `${repoBase}/stashes`);
  assert(stashList.data.stashes.length === 1, 'GET stashes 返回 1 条自动暂存', JSON.stringify(stashList.data.stashes));
  assert(!readFileSync(path.join(work, 'base.txt'), 'utf8').includes('modified'), '切换后工作区为干净检出');
  const pop = await api('POST', `${repoBase}/stashes/pop`, { sha: stashList.data.stashes[0].sha });
  assert(pop.status === 200, 'stash pop 返回 200');
  assert(readFileSync(path.join(work, 'base.txt'), 'utf8').includes('modified'), 'stash pop 恢复工作区修改');

  git(work, 'checkout', 'master');
  git(work, 'checkout', '--', 'base.txt');
  assert(git(work, 'status', '--porcelain') === '', '清理测试工作区修改');

  execFileSync('bash', ['-c', "printf 'untracked-feature\\n' > feature.txt"], { cwd: work });
  const untrackedSwitch = await api('POST', `${repoBase}/checkout`, { branch: 'feature' });
  const untrackedStashes = untrackedSwitch.data.checkout?.stashes || [];
  assert(untrackedSwitch.status === 200 && untrackedSwitch.data.repository.branch === 'feature', '未跟踪文件挡切换时二次 stash 后成功', JSON.stringify(untrackedSwitch.data.repository?.branch));
  assert(untrackedStashes.length === 1 && untrackedStashes[0].files === 1, '未跟踪文件自动 stash', JSON.stringify(untrackedStashes));
  assert(readFileSync(path.join(work, 'feature.txt'), 'utf8').includes('feature'), '切换后 feature.txt 为分支版本');
  const backMaster = await api('POST', `${repoBase}/checkout`, { branch: 'master' });
  assert(backMaster.data.repository.branch === 'master', '切回 master 准备恢复未跟踪暂存');
  const popUntracked = await api('POST', `${repoBase}/stashes/pop`, { sha: untrackedStashes[0].sha });
  assert(popUntracked.status === 200, '未跟踪暂存可恢复');
  assert(readFileSync(path.join(work, 'feature.txt'), 'utf8').includes('untracked-feature'), '未跟踪文件内容已恢复');
  rmSync(path.join(work, 'feature.txt'), { force: true });
  assert(git(work, 'status', '--porcelain') === '', '未跟踪恢复测试后工作区干净');

  execFileSync('bash', ['-c', "printf 'peer-line\\n' >> base.txt && git add base.txt && git commit -m peer-update && git push origin master"], { cwd: peer, env: process.env });
  const dirtySync = await api('POST', `${repoBase}/sync`);
  assert(dirtySync.data.sync.action === 'fast-forwarded' && dirtySync.data.sync.behind === 1, 'sync 快进 1 个提交', JSON.stringify(dirtySync.data.sync));
  assert(readFileSync(path.join(work, 'base.txt'), 'utf8').includes('peer-line'), 'sync 后文件已更新');

  execFileSync('bash', ['-c', "printf 'local-line\\n' > local.txt && git add local.txt && git commit -m local-divergence"], { cwd: work, env: process.env });
  execFileSync('bash', ['-c', "printf 'peer2\\n' >> base.txt && git add base.txt && git commit -m peer-diverged && git push origin master"], { cwd: peer, env: process.env });
  const diverged = await api('POST', `${repoBase}/sync`);
  assert(diverged.data.sync.action === 'diverged' && diverged.data.sync.ahead === 1 && diverged.data.sync.behind === 1, 'sync 分叉只报告不合并', JSON.stringify(diverged.data.sync));

  git(work, 'reset', '--hard', 'origin/master');
  execFileSync('bash', ['-c', "printf 'peer3\\n' >> base.txt && git add base.txt && git commit -m peer-third && git push origin master"], { cwd: peer, env: process.env });
  execFileSync('bash', ['-c', "printf 'dirty\\n' >> base.txt"], { cwd: work });
  const dirtyReport = await api('POST', `${repoBase}/sync`);
  assert(dirtyReport.data.sync.action === 'dirty', 'sync 脏工作区阻止快进', JSON.stringify(dirtyReport.data.sync));
  git(work, 'checkout', '--', 'base.txt');
  const cleanSync = await api('POST', `${repoBase}/sync`);
  assert(cleanSync.data.sync.action === 'fast-forwarded' && cleanSync.data.sync.behind === 1, 'sync 清理后可快进', JSON.stringify(cleanSync.data.sync));

  git(work, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
  const unreachable = await api('POST', `${repoBase}/sync`);
  assert(unreachable.status >= 400, '远程不可达时 sync 返回错误', `status=${unreachable.status}`);
  git(work, 'remote', 'set-url', 'origin', remote);

  git(work, 'checkout', '-b', 'solo');
  const noUpstream = await api('POST', `${repoBase}/sync`);
  assert(noUpstream.data.sync.action === 'no-upstream', 'sync 无 upstream 返回 no-upstream', JSON.stringify(noUpstream.data.sync));

  const history = await api('GET', `${repoBase}/line-history?path=base.txt&line=1`);
  assert(history.status === 200 && history.data.commits.length === 1, 'line-history 返回 1 条 blame 结果', JSON.stringify(history.data.commits));
  assert(/^[0-9a-f]{10}$/.test(history.data.commits[0]?.hash || ''), 'line-history hash 为 10 位短哈希', JSON.stringify(history.data.commits[0]));

  const explain = await api('POST', `${repoBase}/explain`, { path: 'base.txt', line: 1, question: '这一行是什么？' });
  assert(explain.status === 200 && explain.data.explanation?.overview === '概览', 'explain 非 JSON 响应重试后成功', `status=${explain.status}`);
  assert(stubCalls >= 2, 'LLM 桩收到重试请求', `calls=${stubCalls}`);

  const commitHash = history.data.commits[0].hash;
  const commit = await api('GET', `${repoBase}/commit?hash=${encodeURIComponent(commitHash)}`);
  assert(commit.status === 200 && commit.data.author === 'E2E', 'commit 接口返回作者信息', JSON.stringify(commit.data.author));
  assert(commit.data.message.includes('initial') && commit.data.files.some((file) => file.path === 'base.txt'), 'commit 返回 message 与文件统计');
  assert(commit.data.diff.includes('+line1'), 'commit 返回 diff 内容');

  const faq = await api('GET', `${repoBase}/faq?path=base.txt&line=2`);
  assert(faq.status === 200 && faq.data.entries.length === 1, 'FAQ 自动记录并按代码段命中', JSON.stringify(faq.data.entries.map((entry) => [entry.lineStart, entry.lineEnd])));

  const cSample = [
    'static int demo(int a)',
    '{',
    '  if (a) {',
    '    return 1;',
    '  }',
    '  return 0;',
    '}',
    '',
    'int other(void) { return 2; }',
  ].join('\n');
  const cSegment = detectSegment(cSample, 4);
  assert(cSegment.lineStart === 1 && cSegment.lineEnd === 7 && cSegment.symbol === 'demo', 'FAQ 分段识别 C 函数范围', JSON.stringify(cSegment));
  const pySample = ['def alpha():', '    x = 1', '    return x', '', 'def beta():', '    pass'].join('\n');
  const pySegment = detectSegment(pySample, 3);
  assert(pySegment.lineStart === 1 && pySegment.lineEnd === 4 && pySegment.symbol === 'alpha', 'FAQ 分段识别 Python 函数范围', JSON.stringify(pySegment));
  const faqEntry = faq.data.entries[0];
  assert(faqEntry.lineStart <= 2 && faqEntry.lineEnd >= 2 && faqEntry.question === '这一行是什么？', 'FAQ 段范围包含目标行');
  const faqDelete = await api('POST', `${repoBase}/faq/delete`, { id: faqEntry.id });
  assert(faqDelete.data.removed === true, 'FAQ 可删除');
  const faqAfter = await api('GET', `${repoBase}/faq?path=base.txt&line=2`);
  assert(faqAfter.data.entries.length === 0, 'FAQ 删除后不再返回');

  writeFileSync(path.join(work, 'sample.h'), 'struct demo_event {\n\tint value;\n};\n');
  writeFileSync(path.join(work, 'sample.c'), [
    '#include "sample.h"',
    '',
    'static void demo_handle(struct demo_event *event)',
    '{',
    '\tevent->value = 1;',
    '}',
    '',
    'void demo_entry(void)',
    '{',
    '\tstruct demo_event event;',
    '\tdemo_handle(&event);',
    '}',
  ].join('\n') + '\n');
  git(work, 'add', 'sample.c', 'sample.h');
  git(work, 'commit', '-m', 'sample-symbols');
  const sampleContent = readFileSync(path.join(work, 'sample.c'), 'utf8');
  assert(wordAt(sampleContent, 3, 33) === 'demo_event', '文本检索兜底：光标位置取词');
  const typeDefinitions = await searchSymbolDefinitions({ root: work, filePath: 'sample.c', line: 3, character: 33, content: sampleContent });
  assert(typeDefinitions.length === 1 && typeDefinitions[0].path === 'sample.h' && typeDefinitions[0].line === 1, '文本检索兜底：结构体定义定位到头文件', JSON.stringify(typeDefinitions));
  const functionDefinitions = await searchSymbolDefinitions({ root: work, filePath: 'sample.c', line: 11, character: 3, content: sampleContent });
  assert(functionDefinitions.length === 1 && functionDefinitions[0].path === 'sample.c' && functionDefinitions[0].line === 3, '文本检索兜底：函数调用定位到定义行', JSON.stringify(functionDefinitions));

  const bodySegment = detectFunctionSegment(sampleContent, 5);
  assert(bodySegment?.lineStart === 3 && bodySegment?.lineEnd === 6 && bodySegment?.symbol === 'demo_handle', '函数范围识别（函数体内）', JSON.stringify(bodySegment));
  const signatureSegment = detectFunctionSegment(sampleContent, 3);
  assert(signatureSegment?.lineStart === 3 && signatureSegment?.lineEnd === 6 && signatureSegment?.symbol === 'demo_handle', '函数范围识别（光标在签名行）', JSON.stringify(signatureSegment));
  const functionHistory = await api('GET', `${repoBase}/function-history?path=sample.c&line=5`);
  assert(
    functionHistory.status === 200
    && functionHistory.data.lineStart === 3
    && functionHistory.data.lineEnd === 6
    && functionHistory.data.symbol === 'demo_handle'
    && functionHistory.data.commits.length === 1
    && functionHistory.data.commits[0].subject === 'sample-symbols',
    '函数级历史返回最近提交与函数范围',
    JSON.stringify(functionHistory.data),
  );
  const functionHistoryCached = await api('GET', `${repoBase}/function-history?path=sample.c&line=4`);
  assert(functionHistoryCached.data.cached === true && functionHistoryCached.data.commits.length === 1, '函数级历史按函数范围命中缓存');

  const referenceContext = await api('GET', `${repoBase}/context?path=sample.c&line=5&radius=2`);
  assert(
    referenceContext.status === 200
    && referenceContext.data.lineStart === 3
    && referenceContext.data.lineEnd === 7
    && referenceContext.data.lines.length === 5
    && referenceContext.data.caller === 'demo_handle'
    && referenceContext.data.callerStart === 3
    && referenceContext.data.callerEnd === 6,
    '引用上下文返回前后 N 行与 Caller 函数范围',
    JSON.stringify(referenceContext.data),
  );

  const docsDir = path.join(root, 'docs');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(path.join(docsDir, 'xhci-spec.md'), '# XHCI\n\nTRB_RING_MAGIC_123 规范要求：传输事件必须带 TRB 指针。\n');
  const googleParsed = parseGoogleResults(
    '<div class="MjjYud"><a href="/url?q=https://example.com/xhci.pdf&amp;sa=U"><div><h3>XHCI spec</h3></div></a><div class="VwiC3b">TRB ring details</div></div>',
  );
  assert(
    googleParsed.length === 1 && googleParsed[0].url === 'https://example.com/xhci.pdf' && googleParsed[0].title === 'XHCI spec',
    'Google 结果解析可用',
    JSON.stringify(googleParsed),
  );
  const docsConfig = await api('POST', '/api/docs/config', { directories: [docsDir], webEnabled: false });
  assert(docsConfig.status === 200 && docsConfig.data.config.directories.length === 1, '保存 docs 目录配置', JSON.stringify(docsConfig.data.config));
  const docsExplain = await api('POST', `${repoBase}/explain`, { path: 'base.txt', line: 1, question: 'TRB_RING_MAGIC_123 在规范里怎么要求？' });
  assert(docsExplain.status === 200 && docsExplain.data.sources?.local?.length > 0, '本地 docs 命中并返回来源', JSON.stringify(docsExplain.data.sources));
  assert(lastUserContent.includes('localDocumentation') && lastUserContent.includes('TRB_RING_MAGIC_123'), 'docs 片段进入 LLM 请求');
  writeFileSync(path.join(docsDir, 'demo-spec.md'), 'demo_handle SPEC_MAGIC transfers events between endpoints and rings.\n');
  writeFileSync(path.join(docsDir, 'path-spec.md'), 'base.txt SPEC_MAGIC documents the base file.\n');
  await api('POST', '/api/docs/config', { directories: [docsDir], webEnabled: false });
  const contextDocs = await api('POST', `${repoBase}/explain`, { path: 'sample.c', line: 3, question: '这个函数做什么？' });
  assert(
    contextDocs.data.sources?.local?.some((item) => item.source.includes('demo-spec.md')),
    '知识库检索自动带上当前行上下文',
    JSON.stringify(contextDocs.data.sources),
  );
  const pathDocs = await api('POST', `${repoBase}/explain`, { path: 'base.txt', line: 1, question: '这一行是什么？' });
  assert(
    pathDocs.data.sources?.local?.some((item) => item.source.includes('path-spec.md')),
    '知识库检索自动带上文件路径',
    JSON.stringify(pathDocs.data.sources),
  );
  const docsStats = await api('GET', '/api/docs/config');
  assert(docsStats.status === 200 && docsStats.data.config.directories.length === 1, 'docs 配置回读一致');
  await api('POST', '/api/docs/config', { directories: [], webEnabled: false });

  const badExplain = await api('POST', `${repoBase}/explain`, { path: 'base.txt', line: 1, question: 'TRIGGER_BAD_JSON 请输出' });
  assert(badExplain.status === 502, 'LLM 解析失败返回 502', `status=${badExplain.status}`);
  const errorDetails = badExplain.data.error?.details;
  assert(Boolean(errorDetails?.request?.body?.includes('TRIGGER_BAD_JSON')), '错误详情包含请求体');
  assert(Boolean(errorDetails?.response?.body?.includes('缺少后续字段')), '错误详情包含 LLM 返回原文');
  assert(Boolean(errorDetails?.output), '错误详情包含解析失败的模型输出');

  const fsList = await api('GET', `/api/fs/list?path=${encodeURIComponent(root)}`);
  assert(fsList.status === 200 && fsList.data.entries.some((entry) => entry.name === 'docs'), '目录浏览器列出子目录');

  const historyList = await api('GET', '/api/history');
  const repoRootPath = opened.data.repository.root;
  assert(historyList.data.repositories.some((entry) => entry.path === repoRootPath), '阅读历史记录已打开仓库');
  await api('POST', '/api/history/touch', { repositoryId: id, file: 'base.txt', line: 2, character: 1 });
  const resumed = await api('POST', '/api/repositories/open-local', { path: work, resume: true });
  assert(resumed.data.resume?.file === 'base.txt' && resumed.data.resume?.line === 2, '历史恢复返回上次文件位置', JSON.stringify(resumed.data.resume));
  const removed = await api('POST', '/api/history/remove', { key: `local:${repoRootPath}` });
  assert(removed.data.removed === true, '可删除单条阅读历史');

  execFileSync('bash', ['-c', "printf 'dirty-status\\n' >> base.txt"], { cwd: work });
  const refreshed = await api('POST', `${repoBase}/refresh`);
  assert(refreshed.data.status?.['base.txt']?.includes('M'), 'refresh 返回 Git 状态徽标', JSON.stringify(refreshed.data.status));
  git(work, 'checkout', '--', 'base.txt');

  const badCheckout = await api('POST', `${repoBase}/checkout`, { branch: '--force' });
  assert(badCheckout.status === 400, '非法分支名被拒绝', `status=${badCheckout.status}`);

  const page = await fetch(base + '/');
  const html = await page.text();
  assert(page.status === 200 && html.includes('branch-select') && html.includes('sync-button'), '首页包含分支下拉与更新按钮');
  assert(html.includes('theme-select') && html.includes('docs-dialog') && html.includes('history-menu') && html.includes('faq-section'), '首页包含主题/知识库/历史/FAQ 容器');
  const bundle = await fetch(base + '/vendor/cm6/editor.bundle.js');
  const bundleText = await bundle.text();
  assert(bundle.status === 200 && bundleText.includes('createEditor'), 'CM6 预构建包可访问');
  assert(bundleText.includes('gruvbox') && bundleText.includes('tokyonight'), 'CM6 包包含主题调色板');
  const editorSource = readFileSync(path.join(repoRoot, 'web-src/editor.js'), 'utf8');
  assert(editorSource.includes("binding.key !== 'Mod-i'"), 'Vim Ctrl-i 不被 CodeMirror selectParentSyntax 覆盖');
  assert(editorSource.includes("Vim.defineEx('vi'") && editorSource.includes('readerJumpBack'), '编辑器注册 :vi 与应用级 Ctrl-o 跳转');
  const appSource = readFileSync(path.join(repoRoot, 'public/app.js'), 'utf8');
  assert(appSource.includes('function-history?') && appSource.includes('renderFilteredTree') && appSource.includes('function focusTree'), '前端含函数历史/过滤/文件树聚焦');
  assert(html.includes('函数提交历史'), '首页函数提交历史标题');
  assert(!html.includes('/vendor/ace/ace.js'), '首页不再加载 Ace');

  assert(html.includes('tab-nvim') && html.includes('nvim-term') && html.includes('nvim-status'), '首页包含 nvim 面板容器');
  assert(html.includes('nvim-note') && html.includes('nvim-keys') && html.includes('nvim-keymap-dialog'), '首页包含本地快捷键状态栏与映射弹窗');
  assert(html.includes('commit-overlay') && html.includes('editor-env-dialog'), '首页包含提交弹窗与编辑器环境对话框');
  assert(appSource.includes('function showCommit') && appSource.includes('faq-toggle'), '前端提交弹窗与 FAQ 折叠实现存在');
  assert(appSource.includes('historyCoversLine') && appSource.includes('cachedFunctionHistory'), '前端函数内移动不重复刷新历史');
  assert(appSource.includes('loadReferencePreview') && editorSource.includes('quickpick-preview'), '前端引用列表带上下文预览');
  assert(appSource.includes('applyEditorFont') && appSource.includes('code-reader-theme-v2'), '前端同步本地字体并以本地主题为默认');
  assert(
    appSource.includes("event.code === 'KeyE'") && appSource.includes("event.code === 'KeyN'") && html.includes('Ctrl+Alt+E'),
    '编辑器/nvim 页签支持 Ctrl+Alt+E / Ctrl+Alt+N 切换',
  );
  assert(html.includes('footer-status') && html.includes('editor-env-options'), '首页底部状态行与编辑器环境选项容器');
  assert(editorSource.includes('whitespaceExtension') && editorSource.includes('setProfile') && editorSource.includes('profileTheme'), '编辑器支持本地 profile 主题与 listchars');
  const editorProfile = await api('GET', '/api/editor/profile');
  assert(
    editorProfile.status === 200
    && editorProfile.data.available === true
    && editorProfile.data.colorscheme === 'fixture-theme'
    && editorProfile.data.options?.tabstop === 8
    && editorProfile.data.keymaps?.length >= 2
    && editorProfile.data.font?.family === 'DejaVu Sans Mono'
    && editorProfile.data.font?.sizePx === 16,
    '编辑器 profile 返回本地配色/选项/映射/字体',
    JSON.stringify(editorProfile.data).slice(0, 300),
  );
  const { profileTheme } = await import('../web-src/themes.js');
  const { parseFontSpec } = await import('../src/editor-profile.js');
  assert(
    parseFontSpec('JetBrainsMono Nerd Font:h14')?.points === 14
    && parseFontSpec('DejaVu Sans Mono 12')?.family === 'DejaVu Sans Mono'
    && parseFontSpec('DejaVu Sans Mono 12')?.points === 12
    && parseFontSpec('') === null,
    '字体规格解析支持 guifont 与桌面格式',
    JSON.stringify([parseFontSpec('JetBrainsMono Nerd Font:h14'), parseFontSpec('DejaVu Sans Mono 12')]),
  );
  const localTheme = profileTheme({
    background: 'dark',
    colorscheme: 'fixture-theme',
    colors: {
      Normal: { fg: '#c8d3f5', bg: '#222436' },
      Identifier: { fg: '#c099ff' },
      '@keyword': { fg: '#fca7ea', italic: true },
      '@variable': { fg: '#c8d3f5' },
      '@property': { fg: '#4fd6be' },
      '@function': { fg: '#82aaff' },
      '@type': { fg: '#65bcff' },
      '@type.builtin': { fg: '#589ed7' },
    },
  });
  assert(
    localTheme.syntax.keyword === '#fca7ea'
    && localTheme.styles?.keyword === 'italic'
    && localTheme.syntax.variable === '#c8d3f5'
    && localTheme.syntax.property === '#4fd6be'
    && localTheme.syntax.typeBuiltin === '#589ed7'
    && localTheme.editor.background === '#222436',
    '本地主题优先取 treesitter 组（keyword/variable/property/builtin）',
    JSON.stringify({ syntax: localTheme.syntax, styles: localTheme.styles }).slice(0, 400),
  );
  const editorEnv = await api('GET', '/api/editor');
  assert(editorEnv.status === 200 && Boolean(editorEnv.data.nvim) && Boolean(editorEnv.data.active), '编辑器环境接口返回探测结果', JSON.stringify(editorEnv.data).slice(0, 200));
  const builtin = await api('POST', '/api/editor', { program: 'builtin' });
  assert(builtin.status === 200 && builtin.data.active?.program === 'builtin' && builtin.data.available === false, '可切换到内置编辑器');
  const nvimBlocked = await probeNvim(`ws://127.0.0.1:8799/nvim?repository=${encodeURIComponent(id)}`, []);
  assert(!nvimBlocked.ok, '内置模式下 nvim WS 被拒绝', JSON.stringify(nvimBlocked).slice(0, 200));
  const restored = await api('POST', '/api/editor', { program: 'auto' });
  assert(restored.status === 200 && restored.data.saved?.program === 'auto', '可恢复自动选择');
  const nvimEcho = await probeNvim(`ws://127.0.0.1:8799/nvim?repository=${encodeURIComponent(id)}`, [{ t: 'i', d: 'ping\n' }]);
  assert(nvimEcho.ok, 'nvim WS/PTY 双向转发（stub 回显）', JSON.stringify(nvimEcho).slice(0, 200));
  const nvimBadOrigin = await probeNvim(`ws://127.0.0.1:8799/nvim?repository=${encodeURIComponent(id)}`, [], { origin: 'http://evil.example' });
  assert(!nvimBadOrigin.ok, 'nvim WS 拒绝非本机来源', JSON.stringify(nvimBadOrigin).slice(0, 200));
  const terminalBundle = await fetch(base + '/vendor/xterm/terminal.bundle.js');
  assert(terminalBundle.status === 200, 'xterm 终端预构建包可访问');
  const xtermCss = await fetch(base + '/vendor/xterm/xterm.css');
  assert(xtermCss.status === 200, 'xterm 样式可访问');
} catch (error) {
  fail(`未捕获异常：${error.stack || error.message}`);
} finally {
  server.kill('SIGTERM');
  stub.close();
  log(`\nRESULT ${failures === 0 ? 'PASS' : 'FAIL'} checks=${checks} failures=${failures}`);
  log(`workspace=${root}`);
  log(`serverLog=${serverLog ? serverLog.slice(0, 2000) : '(empty)'}`);
  if (failures === 0) rmSync(root, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}