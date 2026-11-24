// 能力：仓库视图（分支、Git 状态、同步、自动暂存、LSP 状态）。
import { elements } from '../core/dom.js';
import { state, sessions } from '../core/state.js';
import { api } from '../core/api.js';
import { hideNotice, showNotice } from '../core/notice.js';

let deps = {};

export function initRepositoryFeature(dependencies) {
  deps = dependencies;
  elements.branchSelect.addEventListener('change', () => {
    const target = elements.branchSelect.value;
    if (target) switchBranch(target);
  });
  elements.syncButton.addEventListener('click', () => {
    syncRepositoryFromRemote();
  });
  elements.repoNoticeAction.addEventListener('click', () => {
    const action = state.noticeAction;
    if (action) action();
  });
  elements.repoNoticeClose.addEventListener('click', hideNotice);
}

export function renderRepository() {
  const repo = state.repository;
  elements.repositoryName.textContent = repo?.name || '未打开仓库';
  renderBranches();
  elements.repositoryTags.replaceChildren();
  if (!repo || repo.tags.length === 0) {
    elements.repositoryTags.textContent = 'Tag —';
  } else {
    for (const tag of repo.tags) {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.textContent = tag;
      elements.repositoryTags.append(badge);
    }
  }
  elements.fileCount.textContent = `${state.files.length} 个文件`;
  elements.treeFilter.disabled = !repo;
}

function branchLabel(branch) {
  let label = branch.name;
  if (branch.ahead || branch.behind) label += ` ↑${branch.ahead} ↓${branch.behind}`;
  if (branch.type === 'remote' && branch.hasLocal) label += '（已有本地分支）';
  return label;
}

export function renderBranches() {
  const select = elements.branchSelect;
  select.replaceChildren();
  if (!state.repository) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '分支 —';
    select.append(option);
    select.disabled = true;
    elements.syncButton.disabled = true;
    return;
  }
  const locals = state.branches.filter((branch) => branch.type === 'local');
  const remotes = state.branches.filter((branch) => branch.type === 'remote');
  if (!locals.some((branch) => branch.current)) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = `detached @ ${state.repository.head}`;
    option.disabled = true;
    option.selected = true;
    select.append(option);
  }
  const appendGroup = (label, branches) => {
    if (!branches.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const branch of branches) {
      const option = document.createElement('option');
      option.value = branch.name;
      option.textContent = branchLabel(branch);
      if (branch.current) option.selected = true;
      group.append(option);
    }
    select.append(group);
  };
  appendGroup('本地分支', locals);
  appendGroup('远程分支', remotes);
  select.disabled = state.busy;
  elements.syncButton.disabled = state.busy;
}

export async function loadBranches() {
  const repository = state.repository;
  if (!repository) {
    state.branches = [];
    renderBranches();
    return;
  }
  let branches = [];
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(repository.id)}/branches`);
    branches = data.branches || [];
  } catch {
    branches = [];
  }
  // 请求期间切换了仓库：丢弃过期响应，避免分支列表串仓。
  if (state.repository?.id !== repository.id) return;
  state.branches = branches;
  const session = sessions.get(state.sessionKey);
  if (session) {
    session.branches = branches;
    session.branchesLoaded = true;
  }
  renderBranches();
}

export async function reloadCurrentFile() {
  if (!state.repository || !state.currentFile) return;
  const filePath = state.currentFile;
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/file?path=${encodeURIComponent(filePath)}`);
    if (state.currentFile !== filePath) return;
    state.source = data;
    deps.renderSource();
  } catch {
    // 文件可能已不存在，保留当前视图
  }
}

export async function restoreStashes(shas) {
  if (!state.repository || !shas.length) return;
  state.busy = true;
  renderBranches();
  let restored = 0;
  try {
    for (const sha of [...shas].reverse()) {
      await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/stashes/pop`, {
        method: 'POST',
        body: JSON.stringify({ sha }),
      });
      restored += 1;
    }
    await reloadCurrentFile();
    showNotice(`已恢复 ${restored} 个自动暂存`);
  } catch (error) {
    await reloadCurrentFile();
    showNotice(`恢复修改失败：${error.message}（已恢复 ${restored} 个）`, { error: true });
  } finally {
    state.busy = false;
    renderBranches();
    refreshStashNotice();
  }
}

export async function refreshStashNotice() {
  if (!state.repository || state.noticeAction) return;
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/stashes`);
    const stashes = data.stashes || [];
    if (!stashes.length) return;
    showNotice(`有 ${stashes.length} 个自动暂存修改待恢复：${stashes[0].message}`, {
      label: '恢复修改',
      action: () => restoreStashes(stashes.map((stash) => stash.sha)),
    });
  } catch {
    // 忽略查询失败
  }
}

export async function switchBranch(target) {
  if (!state.repository || state.busy || !target) return;
  state.busy = true;
  renderBranches();
  elements.sourceStatus.textContent = `正在切换到 ${target}…`;
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch: target }),
    });
    await deps.loadRepository(data, { preserveFile: true, stashNotice: false });
    const stashes = data.checkout?.stashes || [];
    if (stashes.length) {
      const files = stashes.reduce((total, stash) => total + (stash.files || 0), 0);
      showNotice(`已自动暂存 ${files} 个文件并切换到 ${data.repository.branch}；需要时点“恢复修改”。`, {
        label: '恢复修改',
        action: () => restoreStashes(stashes.map((stash) => stash.sha)),
      });
    } else {
      showNotice(`已切换到 ${data.repository.branch}`);
    }
    elements.sourceStatus.textContent = '';
  } catch (error) {
    elements.sourceStatus.textContent = '';
    showNotice(`切换分支失败：${error.message}`, { error: true });
    await loadBranches();
  } finally {
    state.busy = false;
    renderBranches();
  }
}

export async function syncRepositoryFromRemote() {
  if (!state.repository || state.busy) return;
  state.busy = true;
  elements.syncButton.textContent = '更新中…';
  renderBranches();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/sync`, { method: 'POST' });
    await deps.loadRepository(data, { preserveFile: true, stashNotice: false });
    const sync = data.sync || {};
    const messages = {
      'fast-forwarded': `已从 ${sync.upstream} 快进 ${sync.behind} 个提交`,
      'up-to-date': sync.ahead > 0 ? `已是最新（本地领先 ${sync.ahead} 个提交）` : '已是最新',
      'dirty': `远程有 ${sync.behind} 个新提交，但工作区有未提交修改，未自动更新`,
      'diverged': `本地与 ${sync.upstream} 已分叉（领先 ${sync.ahead}，落后 ${sync.behind}），未自动合并`,
      'no-upstream': '当前分支没有设置上游远程分支',
      'error': `更新失败：${sync.message || '无法快进'}`,
    };
    const failed = sync.action === 'dirty' || sync.action === 'diverged' || sync.action === 'error';
    showNotice(messages[sync.action] || '更新完成', { error: failed });
  } catch (error) {
    showNotice(`更新失败：${error.message}`, { error: true });
  } finally {
    state.busy = false;
    elements.syncButton.textContent = '更新';
    renderBranches();
    refreshStashNotice();
  }
}

export function renderLspState() {
  const lsp = state.lsp;
  if (!state.repository) {
    elements.lspBadge.textContent = 'LSP —';
    elements.lspState.textContent = 'LSP 未检测';
    return;
  }
  if (lsp.initialized) {
    const version = lsp.engineVersion ? ` ${lsp.engineVersion}` : '';
    elements.lspBadge.textContent = `LSP ${lsp.engine}${lsp.engineVersion ? ` ${lsp.engineVersion.split('.')[0]}` : ''}`;
    elements.lspState.textContent = `${lsp.engine}${version} 就绪 · gd 跳定义 · gr 跳引用`;
  } else if (lsp.available) {
    elements.lspBadge.textContent = 'LSP 启动中';
    elements.lspState.textContent = '语言服务器初始化中…';
  } else {
    elements.lspBadge.textContent = 'LSP 不可用';
    elements.lspState.textContent = lsp.detail || '未检测到 clangd/ccls';
  }
  elements.lspBadge.title = lsp.detail || '语言服务器状态';
}

async function pollLspStatus() {
  const repository = state.repository;
  if (!repository) return;
  let lsp;
  try {
    lsp = await api(`/api/repositories/${encodeURIComponent(repository.id)}/lsp/status`);
  } catch {
    lsp = { available: false, engine: null, initialized: false, detail: '状态查询失败' };
  }
  if (state.repository?.id !== repository.id) return;
  state.lsp = lsp;
  renderLspState();
  // 引擎缺失型失败可恢复（clangd 装好后自动就绪），继续轮询；其它失败停止。
  if (state.lsp.initialized
    || (!state.lsp.available && state.lsp.detail && !state.lsp.recoverable)) {
    clearTimeout(state.lspTimer);
    state.lspTimer = null;
  }
}

export function scheduleLspPolling() {
  clearTimeout(state.lspTimer);
  state.lsp = { available: false, engine: null, initialized: false, detail: '' };
  renderLspState();
  state.lspTimer = setTimeout(function tick() {
    pollLspStatus().finally(() => {
      if (state.repository && !state.lsp.initialized) {
        state.lspTimer = setTimeout(tick, 5000);
      }
    });
  }, 500);
}