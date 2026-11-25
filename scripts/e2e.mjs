// one-shot: code-reader 端到端 API 回归脚本（项目自带工具，非 agent 探索脚本）; no-generalize: 与 code-reader 仓库/API 形态强绑定
// grill: 成品检索=skill 库无 code-reader e2e 成品; 输入固定=临时 bare 仓库+固定 API 路径; 步骤机械=建仓/调 API/断言; 判读固定=HTTP 200 与字段值; 失效场景=构造不出（仅本应用）
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { detectSegment } from '../src/faq.js';
import { detectFunctionSegment } from '../src/faq.js';
import { parseGoogleResults } from '../src/websearch.js';
import { searchSymbolDefinitions, wordAt } from '../src/symbol-search.js';
import { buildUnderstandingContext } from '../src/understanding.js';
import { parseAnimation, wantsAnimation } from '../src/animation.js';
import { createAnimationHtml } from '../public/animation-html.js';
import { definitionInfo, definitionName, kconfigSymbolInfo } from '../src/search/definitions.js';
import { matchRank } from '../src/search/ranking.js';
import { parseConfigContent } from '../src/kconfig.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const testPort = Number(process.env.CODE_READER_TEST_PORT || 8799);
const stubPort = Number(process.env.CODE_READER_TEST_LLM_PORT || process.env.E2E_LLM_PORT || 8899);
const base = `http://127.0.0.1:${testPort}`;
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cr-e2e-')));
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

// 前端已按 core/features 分层：静态断言读取整个 public/ 下的应用脚本，
// 避免检查绑定在单个 app.js 文件上。
function readFrontendSources(dir = path.join(repoRoot, 'public')) {
  const parts = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'vendor') continue;
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      parts.push(readFrontendSources(absolute));
    } else if (/\.m?js$/.test(entry)) {
      parts.push(readFileSync(absolute, 'utf8'));
    }
  }
  return parts.join('\n');
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
let slowStarted = false;
let slowCanceled = false;
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
  if (lastUserContent.includes('TRIGGER_SLOW_CANCEL')) {
    slowStarted = true;
    response.on('close', () => { slowCanceled = true; });
    return;
  }
const animationRequested = lastUserContent.includes('"animationRequested":true');
  const payload = {
    overview: '概览',
    details: ['细节一', '细节二'],
    summary: '总结',
    evidence: [
      { claim: '函数直接写入 event->value', kind: 'code', file: 'base.txt', lineStart: 1 },
      { claim: '设计意图属于推断', kind: 'inference' },
    ],
    nextSteps: [{ file: 'base.txt', line: 1, reason: '继续阅读调用方' }],
    specifications: [],
  };
  if (animationRequested) {
    payload.animation = {
      title: 'demo_handle 执行演示',
      summary: '演示事件处理流程',
      nodes: [
        { id: 'entry', label: 'demo_entry 调用', kind: 'code' },
        { id: 'handler', label: 'demo_handle', kind: 'code' },
        { id: 'spec', label: '规范约束', kind: 'spec' },
      ],
      steps: [
        { title: '进入函数', detail: 'demo_handle 接收事件指针', node: 'handler', from: 'entry', to: 'handler', file: 'sample.c', lineStart: 3, lineEnd: 6 },
        { title: '写入字段', detail: 'event->value 赋值为 1', node: 'handler', lineStart: 5 },
        { title: '符合规范', detail: '写事件前结构体已初始化', node: 'spec', from: 'handler', to: 'spec' },
      ],
    };
  }
  const validJson = `先给出结论。\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  const content = lastUserContent.includes('TRIGGER_BAD_JSON')
    ? '{"overview": "缺少后续字段"'
    : messages.length >= 4 || animationRequested
      ? validJson
      : '抱歉，我无法按要求输出 JSON。';
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
});

await new Promise((resolve) => stub.listen(stubPort, '127.0.0.1', resolve));

const dataDir = path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });
// e2e 进程自身也做动画存储单测；dataPath() 按调用时的环境变量解析，因此直接设置。
process.env.CODE_READER_DATA_DIR = dataDir;

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

const editorStub = path.join(root, 'editor-stub');
writeFileSync(editorStub, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "NVIM test stub"; exit 0; fi\nexec /bin/cat\n');
chmodSync(editorStub, 0o755);

const server = spawn(process.execPath, ['server.js'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(testPort),
    CODE_READER_DATA_DIR: dataDir,
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'stub-model',
    LLM_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
    LLM_PROTOCOL: 'openai',
    CODE_READER_NVIM: editorStub,
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

  const cancel = new AbortController();
  const pendingExplanation = fetch(`${base}${repoBase}/explain`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, signal: cancel.signal,
    body: JSON.stringify({ path: 'base.txt', line: 1, question: 'TRIGGER_SLOW_CANCEL' }),
  }).catch((error) => error);
  for (let i = 0; i < 100 && !slowStarted; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert(slowStarted, '取消测试已到达真实模型传输层');
  cancel.abort();
  await pendingExplanation;
  for (let i = 0; i < 100 && !slowCanceled; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert(slowCanceled, '浏览器断开请求会取消后端模型传输');

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

  // 旧版外部 viewer 动画 API 已由新版内嵌 Three.js 动画（parseAnimation/createAnimationHtml）取代。

  writeFileSync(path.join(work, 'sample.h'), 'struct demo_event {\n\tint value;\n};\n');
  writeFileSync(path.join(work, 'demo_handle_notes.md'), 'demo_handle notes\n');
  // Kconfig 符号：config / menuconfig / depends on 三种形态，行号被下方断言引用。
  writeFileSync(path.join(work, 'Kconfig'), [
    'config SAMPLE_CFG',
    '\tbool "Sample config"',
    '',
    'menuconfig SAMPLE_MENU',
    '\tbool "Sample menu"',
    '',
    'config SAMPLE_KCF',
    '\tbool',
    '\tdepends on SAMPLE_KCF',
  ].join('\n') + '\n');
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
    '',
    '#define CONFIG_SAMPLE_CFG 1',
    '#define CONFIG_SAMPLE_ONLY 1',
    '#ifdef CONFIG_SAMPLE_CFG',
    'static int sample_configured(void)',
    '{',
    '\treturn CONFIG_SAMPLE_CFG;',
    '}',
    '#endif',
    '#ifdef CONFIG_SAMPLE_ONLY',
    'static int sample_only(void)',
    '{',
    '\treturn CONFIG_SAMPLE_ONLY;',
    '}',
    '#endif',
  ].join('\n') + '\n');
  git(work, 'add', 'sample.c', 'sample.h', 'demo_handle_notes.md', 'Kconfig');
  git(work, 'commit', '-m', 'sample-symbols');
  const sampleContent = readFileSync(path.join(work, 'sample.c'), 'utf8');
  const kconfigContent = readFileSync(path.join(work, 'Kconfig'), 'utf8');

  // 工作区搜索：完全匹配的函数排第一；文件名部分匹配排在其后。
  const searchExact = await api('GET', `${repoBase}/search?q=demo_handle`);
  const firstResult = searchExact.data.results?.[0];
  const fileResultIndex = searchExact.data.results?.findIndex((item) => item.kind === 'file' && item.path === 'demo_handle_notes.md') ?? -1;
  assert(
    searchExact.status === 200
    && firstResult?.kind === 'function'
    && firstResult?.name === 'demo_handle'
    && firstResult?.match === 'exact'
    && firstResult?.character === 'static void '.length,
    '工作区搜索：完全匹配的函数排第一',
    JSON.stringify(searchExact.data.results?.slice(0, 3)),
  );
  assert(fileResultIndex > 0, '工作区搜索：文件名部分匹配排在完全匹配之后', `index=${fileResultIndex}`);
  const searchPartial = await api('GET', `${repoBase}/search?q=${encodeURIComponent('demo_')}`);
  assert(
    searchPartial.data.results?.filter((item) => item.kind === 'function').length === 2,
    '工作区搜索：部分匹配返回全部命中函数',
    JSON.stringify(searchPartial.data.results?.filter((item) => item.kind === 'function')),
  );
  const searchEmpty = await api('GET', `${repoBase}/search?q=`);
  assert(searchEmpty.status === 400, '工作区搜索：空关键字返回 400', `status=${searchEmpty.status}`);
  writeFileSync(path.join(work, 'untracked_search.c'), 'static void untracked_fn(void)\n{\n}\n');
  // 未跟踪文件不在已建索引里：刷新（与文件树刷新同一动作）后重新建索引。
  await api('POST', `${repoBase}/refresh`);
  const searchUntracked = await api('GET', `${repoBase}/search?q=untracked_fn`);
  assert(
    searchUntracked.data.results?.some((item) => item.kind === 'function'
      && item.name === 'untracked_fn'
      && item.path === 'untracked_search.c'),
    '工作区搜索：未跟踪源码文件也能命中',
    JSON.stringify(searchUntracked.data.results),
  );
  // 索引在后台构建：轮询到 ready 再验证 /正则/ 与索引元数据。
  let indexState = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = await api('GET', `${repoBase}/search?q=demo_handle`);
    indexState = probe.data.index || null;
    if (indexState?.status === 'ready') break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert(
    indexState?.status === 'ready' && indexState.symbols >= 2,
    '工作区搜索：符号索引构建完成并报告规模',
    JSON.stringify(indexState),
  );
  const searchRegex = await api('GET', `${repoBase}/search?q=${encodeURIComponent('/^demo_h.*$/')}`);
  assert(
    searchRegex.data.mode === 'regex'
    && searchRegex.data.results?.some((item) => item.kind === 'function' && item.name === 'demo_handle'),
    '工作区搜索：/正则/ 查询命中函数',
    JSON.stringify(searchRegex.data.results?.slice(0, 3)),
  );
  const badRegex = await api('GET', `${repoBase}/search?q=${encodeURIComponent('/[/')}`);
  assert(badRegex.status === 400, '工作区搜索：非法正则返回 400', `status=${badRegex.status}`);
  // 通配符：文件名与函数名都按 * / ? 匹配，且锚定（不命中尾部多出的后缀）。
  const searchGlobFile = await api('GET', `${repoBase}/search?q=${encodeURIComponent('sample*.c')}`);
  assert(
    searchGlobFile.data.mode === 'glob'
    && searchGlobFile.data.results?.some((item) => item.kind === 'file' && item.path === 'sample.c')
    && !searchGlobFile.data.results?.some((item) => item.kind === 'file' && item.path === 'sample.h'),
    '工作区搜索：sample*.c 通配符命中 sample.c 而不命中 sample.h',
    JSON.stringify(searchGlobFile.data.results),
  );
  const searchGlobFunction = await api('GET', `${repoBase}/search?q=${encodeURIComponent('demo_*')}`);
  const globFunctionNames = (searchGlobFunction.data.results || [])
    .filter((item) => item.kind === 'function')
    .map((item) => item.name)
    .sort();
  assert(
    searchGlobFunction.data.mode === 'glob'
    && globFunctionNames.join(',') === 'demo_entry,demo_handle',
    '工作区搜索：demo_* 通配符命中两个函数',
    JSON.stringify(globFunctionNames),
  );
  const globMiss = await api('GET', `${repoBase}/search?q=${encodeURIComponent('sample.c.bak')}`);
  assert(globMiss.data.results?.length === 0, '工作区搜索：无通配符时仍按字面量匹配', JSON.stringify(globMiss.data.results));
  // Kconfig 符号进入工作区搜索索引（config / menuconfig 行，kind=kconfig）。
  const searchKconfig = await api('GET', `${repoBase}/search?q=SAMPLE_CFG`);
  assert(
    searchKconfig.data.results?.some((item) => item.kind === 'kconfig'
      && item.name === 'SAMPLE_CFG'
      && item.path === 'Kconfig'
      && item.line === 1
      && item.character === 7),
    '工作区搜索：Kconfig 符号（config 行）可搜',
    JSON.stringify(searchKconfig.data.results),
  );
  const searchKconfigMenu = await api('GET', `${repoBase}/search?q=SAMPLE_ME`);
  assert(
    searchKconfigMenu.data.results?.some((item) => item.kind === 'kconfig'
      && item.name === 'SAMPLE_MENU'
      && item.path === 'Kconfig'
      && item.line === 4),
    '工作区搜索：Kconfig 符号（menuconfig 行）可搜',
    JSON.stringify(searchKconfigMenu.data.results),
  );
  const typedInfo = definitionInfo('struct foo_t *foo(void)');
  assert(
    definitionName('static int foo(struct x *p)') === 'foo'
    && typedInfo?.name === 'foo'
    && typedInfo?.index === 'struct foo_t *'.length
    && definitionName('int bar(void);') === null
    && definitionName('#define MAX(a,b) ((a)>(b)?(a):(b))') === null
    && definitionName('if (x) {') === null
    && definitionName('while (x) {') === null
    && definitionName('for (i = 0; i < 3; i++) {') === null
    && definitionName('__attribute__((noreturn))') === null
    && definitionName('EXPORT_SYMBOL(foo)') === null
    && definitionName('SYM_FUNC_START(entry_fn)') === 'entry_fn'
    && definitionName('SYM_CODE_START(entry_code)') === 'entry_code'
    && definitionName('ENTRY_CFI(entry_cfi)') === 'entry_cfi',
    '搜索定义识别：C 定义/原型/宏/控制语句/汇编',
    JSON.stringify({ typedInfo, ifLine: definitionName('if (x) {'), asm: definitionName('SYM_FUNC_START(entry_fn)') }),
  );
  assert(
    matchRank('foo', 'foo') === 0
    && matchRank('Foo', 'foo') === 1
    && matchRank('foobar', 'foo') === 2
    && matchRank('FOOBAR', 'foo') === 3
    && matchRank('xfoo', 'foo') === 4,
    '搜索排序：完全匹配 > 前缀 > 部分',
  );
  assert(wordAt(sampleContent, 3, 33) === 'demo_event', '文本检索兜底：光标位置取词');
  const typeDefinitions = await searchSymbolDefinitions({ root: work, filePath: 'sample.c', line: 3, character: 33, content: sampleContent });
  assert(typeDefinitions.length === 1 && typeDefinitions[0].path === 'sample.h' && typeDefinitions[0].line === 1, '文本检索兜底：结构体定义定位到头文件', JSON.stringify(typeDefinitions));
  const functionDefinitions = await searchSymbolDefinitions({ root: work, filePath: 'sample.c', line: 11, character: 3, content: sampleContent });
  assert(functionDefinitions.length === 1 && functionDefinitions[0].path === 'sample.c' && functionDefinitions[0].line === 3, '文本检索兜底：函数调用定位到定义行', JSON.stringify(functionDefinitions));
  // Kconfig 定义识别：CONFIG_SAMPLE_CFG 同时有 #define 与 config 定义，config 行优先。
  const configDefinitions = await searchSymbolDefinitions({ root: work, filePath: 'sample.c', line: 14, character: 8, content: sampleContent });
  assert(
    configDefinitions.length === 1
    && configDefinitions[0].path === 'Kconfig'
    && configDefinitions[0].line === 1
    && configDefinitions[0].character === 7,
    'Kconfig 定义识别：CONFIG_ 符号优先定位 config 行而非 #define',
    JSON.stringify(configDefinitions),
  );
  // 非 Kconfig 符号（只有 #define）：维持旧的宏定义定位行为。
  const macroOnlyDefinitions = await searchSymbolDefinitions({ root: work, filePath: 'sample.c', line: 22, character: 8, content: sampleContent });
  assert(
    macroOnlyDefinitions.length === 1
    && macroOnlyDefinitions[0].path === 'sample.c'
    && macroOnlyDefinitions[0].line === 15
    && macroOnlyDefinitions[0].character === 8,
    'Kconfig 定义识别：无 config 条目的 CONFIG_ 符号回退 #define',
    JSON.stringify(macroOnlyDefinitions),
  );
  // Kconfig 文件内的裸符号（depends on FOO → config FOO）。
  const bareKconfigDefinitions = await searchSymbolDefinitions({ root: work, filePath: 'Kconfig', line: 9, character: 15, content: kconfigContent });
  assert(
    bareKconfigDefinitions.length === 1
    && bareKconfigDefinitions[0].path === 'Kconfig'
    && bareKconfigDefinitions[0].line === 7,
    'Kconfig 定义识别：裸全大写符号回退 config 行',
    JSON.stringify(bareKconfigDefinitions),
  );
  const kconfigInfo = kconfigSymbolInfo('\tconfig SAMPLE_CFG # 注释');
  assert(
    kconfigSymbolInfo('config SAMPLE_CFG')?.name === 'SAMPLE_CFG'
    && kconfigSymbolInfo('menuconfig SAMPLE_MENU')?.index === 11
    && kconfigInfo?.name === 'SAMPLE_CFG'
    && kconfigSymbolInfo('configfoo') === null
    && kconfigSymbolInfo('\tdepends on FOO') === null,
    'Kconfig 行解析：config/menuconfig/注释与误报排除',
    JSON.stringify(kconfigInfo),
  );
  const parsedValues = parseConfigContent([
    '# CONFIG_A is not set',
    'CONFIG_B=y',
    'CONFIG_C=m',
    'CONFIG_D="text value"',
    'CONFIG_E=4096',
    '# 注释与空行忽略',
    '',
  ].join('\n'));
  // 键名不带 CONFIG_ 前缀（与 Kconfig 符号名一致，kconfigValue 按裸名查询）。
  assert(
    parsedValues.A === 'n'
    && parsedValues.B === 'y'
    && parsedValues.C === 'm'
    && parsedValues.D === '"text value"'
    && parsedValues.E === '4096'
    && Object.keys(parsedValues).length === 5,
    'Kconfig 取值解析：y/m/n/字符串/数字',
    JSON.stringify(parsedValues),
  );
  // 跳转定义 API：CONFIG_ 符号返回 Kconfig 定位，并附带未解析标记（fixture 未跑 make）。
  const gotoConfig = await api('POST', `${repoBase}/lsp/goto-definition`, { path: 'sample.c', line: 16, character: 8, content: sampleContent });
  assert(
    gotoConfig.status === 200
    && gotoConfig.data.locations?.length === 1
    && gotoConfig.data.locations[0].path === 'Kconfig'
    && gotoConfig.data.locations[0].line === 1
    && gotoConfig.data.config?.symbol === 'SAMPLE_CFG'
    && gotoConfig.data.config?.resolved === false,
    '跳转定义 API：CONFIG_ 符号定位 Kconfig 并附带取值信息',
    JSON.stringify(gotoConfig.data),
  );
  // Kconfig 路由：非内核仓的架构列表为空；解析请求给出可读错误。
  const kconfigOptions = await api('GET', `${repoBase}/kconfig`);
  assert(
    kconfigOptions.status === 200
    && Array.isArray(kconfigOptions.data.arches)
    && kconfigOptions.data.arches.length === 0
    && kconfigOptions.data.current === null,
    'Kconfig 路由：非内核仓库返回空架构与未解析状态',
    JSON.stringify(kconfigOptions.data),
  );
  const kconfigResolveMissing = await api('POST', `${repoBase}/kconfig/resolve`, {});
  assert(kconfigResolveMissing.status === 400, 'Kconfig 路由：缺少参数返回 400', `status=${kconfigResolveMissing.status}`);
  const kconfigResolveBad = await api('POST', `${repoBase}/kconfig/resolve`, { arch: 'x86', defconfig: 'defconfig' });
  assert(
    kconfigResolveBad.status === 400
    && kconfigResolveBad.data?.error?.code === 'INVALID_KCONFIG_ARCH',
    'Kconfig 路由：未知架构返回 INVALID_KCONFIG_ARCH',
    JSON.stringify(kconfigResolveBad.data),
  );

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

  const deepHistory = await api('GET', `${repoBase}/function-history?path=sample.c&line=5&deep=1`);
  assert(
    deepHistory.status === 200
    && deepHistory.data.mode === 'evolution'
    && deepHistory.data.symbol === 'demo_handle'
    && deepHistory.data.commits.some((entry) => entry.subject === 'sample-symbols'),
    '深层函数演变（git log -L）返回提交历史',
    JSON.stringify(deepHistory.data).slice(0, 300),
  );

  const understanding = await buildUnderstandingContext({ repositoryRoot: work, filePath: 'sample.c', source: { content: sampleContent }, line: 11 });
  assert(
    understanding.scope.symbol === 'demo_entry' && understanding.start === 8 && understanding.end === 12,
    '理解上下文定位当前函数范围',
    JSON.stringify(understanding.scope),
  );
  assert(
    understanding.relatedDefinitions.some((item) => item.identifier === 'demo_handle' && item.file === 'sample.c' && item.line === 3),
    '理解上下文带上下调用的相关函数定义',
    JSON.stringify(understanding.relatedDefinitions),
  );
  assert(understanding.text.includes('demo_handle(&event);') && understanding.queryText.includes('demo_handle'), '理解上下文包含调用行与检索词');

  assert(wantsAnimation('请用 Three.js 3D 动画解释当前函数') === true, '动画触发词：3D 动画');
  assert(wantsAnimation('用动画演示数据流') === true, '动画触发词：动画');
  assert(wantsAnimation('不需要动画，只要文字说明') === false, '动画触发词：否定形式不触发');
  assert(wantsAnimation('这个函数做什么？') === false, '普通问题不触发动画');

  const validAnimation = parseAnimation({
    title: 'T', summary: 'S',
    nodes: [
      { id: 'n1', label: '入口', kind: 'code' },
      { id: 'n2', label: '数据', kind: 'evil' },
    ],
    steps: [
      { title: 's1', detail: 'd1', node: 'n1' },
      { title: 's2', detail: 'd2', node: 'n2', from: 'n1', to: 'n2', lineStart: 3 },
      { title: 'bad', detail: 'd3', node: 'missing' },
    ],
  });
  assert(
    validAnimation?.steps.length === 2
    && validAnimation.nodes[1].kind === 'code'
    && validAnimation.steps[1].lineStart === 3
    && validAnimation.steps[1].lineEnd === 3,
    'parseAnimation 过滤非法引用并回落节点类型',
    JSON.stringify(validAnimation),
  );
  assert(parseAnimation({ nodes: [{ id: 'a', label: 'A' }], steps: [] }) === null, 'parseAnimation 拒绝空步骤');
  assert(parseAnimation(null) === null, 'parseAnimation 拒绝非对象输入');

  const offlineHtml = createAnimationHtml(validAnimation, 'window.__RUNTIME__=true;');
  assert(!offlineHtml.includes('<script src=') && offlineHtml.includes('window.__RUNTIME__=true;'), '离线动画 HTML 内联运行时且无外链');
  assert(offlineHtml.includes('type="application/json"') && offlineHtml.includes('.anim-fallback[hidden]'), '动画 HTML 使用 JSON 数据块且含 fallback 隐藏规则');
  const previewHtml = createAnimationHtml(validAnimation, '', { runtimeUrl: 'http://127.0.0.1:8799/vendor/three/animation.bundle.js' });
  assert(
    previewHtml.includes('<script src="http://127.0.0.1:8799/vendor/three/animation.bundle.js"></script>') && !previewHtml.includes('__RUNTIME__'),
    '预览动画 HTML 使用同源外部运行时',
  );
  const escapedHtml = createAnimationHtml({ ...validAnimation, title: '</script><script>alert(1)</script>' }, 'x</script>');
  assert(escapedHtml.includes('<\\/script') && !escapedHtml.includes('</script><script>alert(1)</script>'), '动画 HTML 转义 </script> 防注入');

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
  assert(docsExplain.data.sources.local.some((hit) => hit.section === 'XHCI'), '本地文档命中携带章节标题', JSON.stringify(docsExplain.data.sources.local));
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

  const animExplain = await api('POST', `${repoBase}/explain`, { path: 'sample.c', line: 5, question: '请用 Three.js 3D 动画解释当前函数的执行步骤，以及代码如何按照规范执行。' });
  assert(
    animExplain.status === 200 && animExplain.data.explanation?.animation?.steps?.length === 3,
    '明确要求动画时返回受限动画 JSON（3 步）',
    JSON.stringify(animExplain.data.explanation?.animation),
  );
  assert(animExplain.data.explanation.evidence?.length > 0 && animExplain.data.explanation.nextSteps?.length > 0, '解释包含证据与建议下一步');
  assert(animExplain.data.scope?.symbol === 'demo_handle' && animExplain.data.relatedDefinitions !== undefined, '解释返回函数范围与相关定义', JSON.stringify(animExplain.data.scope));
  const plainExplain = await api('POST', `${repoBase}/explain`, { path: 'sample.c', line: 5, question: '这个函数做什么？' });
  assert(plainExplain.status === 200 && plainExplain.data.explanation?.animation === null, '普通问题不生成动画');

  execFileSync('bash', ['-c', "printf '\\nlocal-change\\n' >> base.txt"], { cwd: work });
  const staleFaq = await api('GET', `${repoBase}/faq?path=base.txt&line=1`);
  assert(
    staleFaq.data.entries.some((entry) => entry.stale === true && entry.staleReason === '代码内容已变化'),
    'FAQ 检测未提交的代码内容变化',
    JSON.stringify(staleFaq.data.entries.map((entry) => [entry.stale, entry.staleReason])),
  );
  git(work, 'checkout', '--', 'base.txt');
  const freshFaq = await api('GET', `${repoBase}/faq?path=base.txt&line=1`);
  assert(freshFaq.data.entries.some((entry) => entry.stale === false), '代码恢复后 FAQ 回到新鲜状态');

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

  const workspace = await api('GET', '/api/workspace');
  assert(
    workspace.status === 200 && workspace.data.entries.some((entry) => entry.key === `local:${repoRootPath}`),
    '工作区记录已打开的仓库',
    JSON.stringify(workspace.data.entries),
  );
  assert(workspace.data.activeKey === `local:${repoRootPath}`, '工作区当前仓库为最近打开的仓库', workspace.data.activeKey);

  const peerOpened = await api('POST', '/api/repositories/open-local', { path: peer });
  const peerRootPath = peerOpened.data.repository.root;
  assert(
    peerOpened.data.workspace?.entries.length === 2 && peerOpened.data.workspace.activeKey === `local:${peerRootPath}`,
    '工作区可同时打开两个仓库，新仓库成为当前仓库',
    JSON.stringify(peerOpened.data.workspace),
  );

  const activated = await api('POST', '/api/workspace/activate', { key: `local:${repoRootPath}` });
  assert(activated.data.activeKey === `local:${repoRootPath}`, '工作区可在仓库间切换当前仓库', activated.data.activeKey);

  await api('POST', '/api/repositories/open-local', { path: peer, activate: false });
  const afterBackground = await api('GET', '/api/workspace');
  assert(afterBackground.data.activeKey === `local:${repoRootPath}`, '后台预载仓库不改变工作区当前仓库', afterBackground.data.activeKey);

  const closed = await api('POST', '/api/workspace/close', { key: `local:${peerRootPath}` });
  assert(
    closed.data.closed === true && closed.data.entries.length === 1 && !closed.data.entries.some((entry) => entry.key === `local:${peerRootPath}`),
    '工作区可关闭仓库',
    JSON.stringify(closed.data),
  );
  assert(closed.data.activeKey === `local:${repoRootPath}`, '关闭非当前仓库不改变当前仓库', closed.data.activeKey);

  execFileSync('bash', ['-c', "printf 'dirty-status\\n' >> base.txt"], { cwd: work });
  const refreshed = await api('POST', `${repoBase}/refresh`);
  assert(refreshed.data.status?.['base.txt']?.includes('M'), 'refresh 返回 Git 状态徽标', JSON.stringify(refreshed.data.status));
  git(work, 'checkout', '--', 'base.txt');

  const badCheckout = await api('POST', `${repoBase}/checkout`, { branch: '--force' });
  assert(badCheckout.status === 400, '非法分支名被拒绝', `status=${badCheckout.status}`);

  const page = await fetch(base + '/');
  const html = await page.text();
  assert(page.status === 200 && html.includes('branch-select') && html.includes('sync-button'), '首页包含分支下拉与更新按钮');
assert((page.headers.get('content-security-policy') || '').includes('frame-src blob:'), 'CSP 允许 blob: 动画预览且不放开 script-src', page.headers.get('content-security-policy'));
  assert(html.includes('question-presets') && html.includes('reading-trail') && html.includes('animation-overlay') && html.includes('sandbox="allow-scripts"'), '首页包含预设问题/阅读路径/动画沙箱容器');
  assert(html.includes('workspace-bar') && html.includes('workspace-tabs') && html.includes('workspace-add'), '首页包含工作区页签容器');
  assert(html.includes('theme-select') && html.includes('docs-dialog') && html.includes('history-menu') && html.includes('faq-section'), '首页包含主题/知识库/历史/FAQ 容器');
  const bundle = await fetch(base + '/vendor/cm6/editor.bundle.js');
  const bundleText = await bundle.text();
  assert(bundle.status === 200 && bundleText.includes('createEditor'), 'CM6 预构建包可访问');
  assert(bundleText.includes('gruvbox') && bundleText.includes('tokyonight'), 'CM6 包包含主题调色板');
  const editorSource = readFileSync(path.join(repoRoot, 'web-src/editor.js'), 'utf8');
  assert(editorSource.includes("binding.key !== 'Mod-i'"), 'Vim Ctrl-i 不被 CodeMirror selectParentSyntax 覆盖');
  assert(editorSource.includes("Vim.defineEx('vi'") && editorSource.includes('readerJumpBack'), '编辑器注册 :vi 与应用级 Ctrl-o 跳转');
  const appSource = readFrontendSources();
  const navSource = readFileSync(path.join(repoRoot, 'public/keyboard-nav.js'), 'utf8');
  const vimNavSource = readFileSync(path.join(repoRoot, 'public/vim-nav.js'), 'utf8');
  assert(appSource.includes('function-history?') && appSource.includes('renderFilteredTree') && appSource.includes('function focusTree'), '前端含函数历史/过滤/文件树聚焦');
  assert(
appSource.includes('createAnimationHtml') && appSource.includes('fetchFunctionHistoryDeep') && appSource.includes('pushReadingTrail') && appSource.includes('按当前代码重问'),
    '前端含动画预览/深层历史/阅读路径/FAQ 重问',
  );
  assert(
    appSource.includes('restoreWorkspace') && appSource.includes("'/api/workspace/activate'") && appSource.includes('activateWorkspaceEntry'),
    '前端加载即恢复工作区并支持仓库切换',
  );
  const stylesSource = readFileSync(path.join(repoRoot, 'public/styles.css'), 'utf8');
  assert(
    appSource.includes('activateWorkspaceByOffset') && appSource.includes('activateWorkspaceByIndex')
    && appSource.includes("'BracketRight'") && appSource.includes('pendingWorkspaceSwitch'),
    '工作区支持 Ctrl+Alt+[ / ] 与 Ctrl+Alt+Shift+1..9 快捷键（切换队列）',
  );
  assert(
    appSource.includes('preparePayload') && appSource.includes('preparedForSession') && appSource.includes('requestIdleCallback'),
    '工作区会话缓存代码树并在空闲时预建，切仓不重建',
  );
  assert(
    appSource.includes('typeAheadDir') && appSource.includes("addEventListener('dblclick'") && appSource.includes('selectDirIndex'),
    '打开对话框目录浏览支持单击选中/双击进入/字母导航',
  );
  assert(
    appSource.includes('flushTreeFilter') && appSource.includes('openFilteredFile') && appSource.includes('filterMatches'),
    '代码树过滤支持上下键选择与回车打开',
  );
  assert(html.includes('dir-list') && stylesSource.includes('.dir-row.selected'), '目录浏览含选中态样式');
  assert(html.includes('单击选中') && html.includes('双击'), '目录浏览器提示单击选中/双击进入');
  assert(
    appSource.includes('workspace-tab-key') && html.includes('editor-tab-key')
    && html.includes('workspace-cycle-hint') && stylesSource.includes('.workspace-tab-key'),
    '工作区页签/编辑器页签显示直达快捷键组合',
  );
  assert(
    appSource.includes('preparePayloadIncremental') && appSource.includes('budgetMs'),
    '预载建树按空闲时间分片，避免 j/k 长任务卡顿',
  );
  assert(
    editorSource.includes('warmQuickpickPreview') && editorSource.includes('pending: true')
    && stylesSource.includes('.quickpick-preview.pending'),
    '引用预览保留旧内容并预取邻项，j/k 不闪烁',
  );
  assert(
    html.includes('sidebar-trigger') && html.includes('insights-trigger')
    && appSource.includes('initAutoPanels') && appSource.includes('pointerenter')
    && stylesSource.includes('.panel-trigger') && stylesSource.includes('sidebar-visible'),
    '两侧栏默认隐藏，悬停边缘滑入',
  );
  assert(
    appSource.includes("binding: 'Ctrl+Alt+B'") && appSource.includes("binding: 'Ctrl+Alt+I'")
    && appSource.includes("case 'panel.tree'") && appSource.includes("case 'panel.insights'")
    && appSource.includes('toggle(name)') && appSource.includes('panel.pinned')
    && html.includes('panel-shortcuts') && html.includes('nvim-panel-hints')
    && stylesSource.includes('.panel-shortcuts'),
    '代码树/分析栏支持 Ctrl+Alt+B / Ctrl+Alt+I 开关，并在代码窗口显示组合键',
  );
  assert(
    html.includes('code-nav-bar') && html.includes('nav-tree') && html.includes('nav-insights')
    && html.includes('打开代码树') && html.includes('打开代码解释窗口')
    && stylesSource.includes('.code-nav-bar') && stylesSource.includes('.code-nav-arrow'),
    '代码窗口上方显示左右箭头与 Ctrl+Alt+B/I 提示',
  );
  assert(
    appSource.includes('createKeyboardNav') && appSource.includes("binding: 'Ctrl+Alt+K'")
    && appSource.includes("binding: 'Ctrl+Alt+F'") && appSource.includes('keyboardNav.toggle')
    && editorSource.includes('visibleMatches') && editorSource.includes('jumpToMatch')
    && stylesSource.includes('.cr-hint-layer') && stylesSource.includes('.cr-hint-badge'),
    'Ctrl+Alt+K 标签跳转 / Ctrl+Alt+F 两字符定位（easymotion/sneak）',
  );
  assert(
    navSource.includes('cm-gutters') && navSource.includes('textBoundsOf')
    && navSource.includes('badgeCandidates'),
    'Ctrl+Alt+K 标签放在行号槽/目标文字之外，不遮挡导航目标',
  );
  assert(
    !navSource.includes('KeyL') && html.includes('Ctrl+Alt+F') && !html.includes('Ctrl+Alt+L 两字符'),
    '两字符定位不再使用与系统锁屏冲突的 Ctrl+Alt+L',
  );
  assert(
    navSource.includes("kind: 'editor-line'") && navSource.includes('visibleLines')
    && editorSource.includes('function visibleLines') && editorSource.includes('function jumpToLine')
    && navSource.includes('followFocus') && appSource.includes("await activateTreeRow(row)"),
    '全键盘跳转覆盖代码行，并在打开新窗口/重渲染后把焦点跟进',
  );
  assert(
    appSource.includes('showTreeMenu') && appSource.includes('shiftKey && event.key === \'F10\'')
    && appSource.includes('focusFirstMenuItem') && appSource.includes('commitOverlayReturnFocus'),
    '右键菜单/历史菜单/提交详情支持键盘操作与焦点回收',
  );
  assert(
    appSource.includes('question-animation') && appSource.includes('animate: wantsAnimation')
    && appSource.includes('explanation.animation') && appSource.includes('data-nav')
    && appSource.includes('focusExplanationPanel') && appSource.includes('createVimNav'),
    '问题框可请求 3D 动画，解释窗口支持键盘导航',
  );
  assert(
    vimNavSource.includes("'summary'") && vimNavSource.includes("key === 'G'")
    && vimNavSource.includes('scrollableFor') && vimNavSource.includes('CONTAINER_SELECTOR')
    && appSource.includes('summary, input, select, textarea')
    && editorSource.includes("event.key === 'G'") && appSource.includes("key === 'G'"),
    '任意窗口支持 j/k/gg/G，提交详情 Diff（summary）可键盘展开',
  );
  assert(
    vimNavSource.includes("key === 'PageDown'") && vimNavSource.includes('halfStep')
    && vimNavSource.includes("key === 'H'") && vimNavSource.includes('countBuffer'),
    '任意窗口支持计数、半屏/整屏、H/M/L 与 0/^/$ Vim 动作',
  );
  assert(
    vimNavSource.includes("key === '/'") && vimNavSource.includes('findTextMatches')
    && vimNavSource.includes('CSS.highlights') && stylesSource.includes('::highlight(cr-vim-search)'),
    '任意窗口支持 / 窗口内搜索与 n/N 命中高亮',
  );
  assert(
    appSource.includes('treeCount') && appSource.includes("key === '/')")
    && appSource.includes("elements.treeFilter.focus()"),
    '文件树支持计数/翻屏/H/M/L 并用 / 跳到过滤框',
  );
  assert(
    appSource.includes('focusInside') && appSource.includes("window.__crPanels?.pin('insights')")
    && html.includes('去代码树/收起') && html.includes('去代码解释窗口/收起'),
    'Ctrl+Alt+B/I 已打开时聚焦窗口而不是关闭，焦点在窗口内才收起',
  );
  assert(
    appSource.includes('focusMoved') && appSource.includes('markFocusMoved')
    && appSource.includes('if (active && panel.el.contains(active)) return;'),
    '解释返回后自动聚焦解释窗口；焦点在面板内时不自动收起',
  );
  assert(
    html.includes('animation-overlay') && html.includes('question-presets') && html.includes('reading-trail')
    && stylesSource.includes('.animation-overlay') && stylesSource.includes('.evidence-card'),
    '内嵌 3D 动画/证据链/阅读路径样式存在',
  );
  assert(
    html.includes('nvim-note') && !html.includes('nvim-statusbar')
    && stylesSource.includes('.nvim-bar') && stylesSource.includes('min-height: 28px'),
    'nvim 工具条紧凑、去掉底部重复状态栏',
  );
  assert(html.includes('函数提交历史'), '首页函数提交历史标题');
  assert(!html.includes('/vendor/ace/ace.js'), '首页不再加载 Ace');

  assert(html.includes('tab-nvim') && html.includes('nvim-term') && html.includes('nvim-status'), '首页包含 nvim 面板容器');
  assert(html.includes('nvim-note') && html.includes('nvim-keys') && html.includes('nvim-keymap-dialog'), '首页包含本地快捷键状态栏与映射弹窗');
  assert(html.includes('commit-overlay') && html.includes('editor-env-dialog'), '首页包含提交弹窗与编辑器环境对话框');
  assert(appSource.includes('function showCommit') && appSource.includes('faq-toggle'), '前端提交弹窗与 FAQ 折叠实现存在');
  assert(appSource.includes('historyCoversLine') && appSource.includes('cachedFunctionHistory'), '前端函数内移动不重复刷新历史');
  assert(appSource.includes('loadReferencePreview') && editorSource.includes('quickpick-preview'), '前端引用列表带上下文预览');
  assert(
    appSource.includes('openWorkspaceSearch') && appSource.includes('workspace-search-')
    && editorSource.includes('quickpick-input') && editorSource.includes('updateQuickpickItems')
    && html.includes('Ctrl+Alt+P'),
    '前端工作区搜索：输入框 + 引用窗口预览 + Ctrl+Alt+P / \\s 入口',
  );
  assert(appSource.includes('applyEditorFont') && appSource.includes('code-reader-theme-v2'), '前端同步本地字体并以本地主题为默认');
  assert(
    appSource.includes("binding: 'Ctrl+Alt+1'") && appSource.includes("binding: 'Ctrl+Alt+2'")
    && appSource.includes("legacy: ['Ctrl+Alt+E']") && appSource.includes("legacy: ['Ctrl+Alt+N']")
    && appSource.includes("case 'editor.mode'") && appSource.includes("case 'nvim.mode'")
    && html.includes('Ctrl+Alt+1') && html.includes('Ctrl+Alt+2'),
    '编辑器/nvim 页签支持 Ctrl+Alt+1 / Ctrl+Alt+2（兼容 Ctrl+Alt+E / Ctrl+Alt+N）切换',
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
  const nvimBlocked = await probeNvim(`ws://127.0.0.1:${testPort}/nvim?repository=${encodeURIComponent(id)}`, []);
  assert(!nvimBlocked.ok, '内置模式下 nvim WS 被拒绝', JSON.stringify(nvimBlocked).slice(0, 200));
  const restored = await api('POST', '/api/editor', { program: 'auto' });
  assert(restored.status === 200 && restored.data.saved?.program === 'auto', '可恢复自动选择');
  const nvimEcho = await probeNvim(`ws://127.0.0.1:${testPort}/nvim?repository=${encodeURIComponent(id)}`, [{ t: 'i', d: 'ping\n' }]);
  assert(nvimEcho.ok, 'nvim WS/PTY 双向转发（stub 回显）', JSON.stringify(nvimEcho).slice(0, 200));
  const nvimBadOrigin = await probeNvim(`ws://127.0.0.1:${testPort}/nvim?repository=${encodeURIComponent(id)}`, [], { origin: 'http://evil.example' });
  assert(!nvimBadOrigin.ok, 'nvim WS 拒绝非本机来源', JSON.stringify(nvimBadOrigin).slice(0, 200));
  const terminalBundle = await fetch(base + '/vendor/xterm/terminal.bundle.js');
  assert(terminalBundle.status === 200, 'xterm 终端预构建包可访问');
  const animationBundle = await fetch(base + '/vendor/three/animation.bundle.js');
  assert(animationBundle.status === 200, 'Three.js 动画运行时预构建包可访问');
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