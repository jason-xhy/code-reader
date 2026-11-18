// one-shot: code-reader 端到端 API 回归脚本（项目自带工具，非 agent 探索脚本）; no-generalize: 与 code-reader 仓库/API 形态强绑定
// grill: 成品检索=skill 库无 code-reader e2e 成品; 输入固定=临时 bare 仓库+固定 API 路径; 步骤机械=建仓/调 API/断言; 判读固定=HTTP 200 与字段值; 失效场景=构造不出（仅本应用）
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSegment } from '../src/faq.js';
import { parseGoogleResults } from '../src/websearch.js';

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
  assert(!html.includes('/vendor/ace/ace.js'), '首页不再加载 Ace');
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