// 能力：多仓库工作区（页签、会话快照、后台预载、刷新恢复）。
import { elements } from '../core/dom.js';
import { state, sessions, jumpStack, jumpForwardStack, editor, getFocusIntent } from '../core/state.js';
import { api } from '../core/api.js';
import { showNotice } from '../core/notice.js';
import { scheduleIdle } from '../core/utils.js';
import {
  preparePayloadIncremental,
  preparedForSession,
  rememberPrepared,
  renderTree,
} from './tree.js';
import { loadBranches, renderLspState, renderRepository } from './repository.js';
import {
  closeCommitOverlay,
  closeQuestion,
  renderExplanation,
  renderFaq,
  renderHistory,
} from './insights.js';
import { openHistoryEntry } from './reading-history.js';
import { renderReadingTrail } from './navigation.js';

let deps = {};

export function initWorkspaceFeature(dependencies) {
  deps = dependencies;
}

export function repositoryKey(repository) {
  if (!repository) return null;
  if (repository.source === 'remote') return `remote:${repository.remoteUrl || repository.root}`;
  return `local:${repository.root}`;
}

export function renderWorkspaceTabs() {
  const entries = state.workspace?.entries || [];
  elements.workspaceBar.hidden = entries.length === 0;
  elements.workspaceTabs.replaceChildren();
  for (const [index, entry] of entries.entries()) {
    const active = entry.key === state.sessionKey;
    const tab = document.createElement('div');
    tab.className = `workspace-tab${active ? ' active' : ''}`;
    tab.dataset.key = entry.key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(active));
    const shortcut = index < 9 ? ` · Ctrl+Alt+Shift+${index + 1}` : '';
    tab.title = `${entry.path}${shortcut}`;
    tab.addEventListener('click', () => activateWorkspaceEntry(entry));
    // 页签上方固定显示直达快捷键，便于发现；第 10 个起没有直达键（保留空行对齐）。
    const key = document.createElement('span');
    key.className = 'workspace-tab-key';
    key.textContent = index < 9 ? `Ctrl+Alt+Shift+${index + 1}` : '';
    key.setAttribute('aria-hidden', 'true');
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'workspace-tab-name';
    name.textContent = entry.name;
    name.title = tab.title;
    name.addEventListener('click', (event) => {
      event.stopPropagation();
      activateWorkspaceEntry(entry);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'workspace-tab-close';
    close.textContent = '×';
    close.title = `从工作区关闭 ${entry.name}`;
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeWorkspaceEntry(entry);
    });
    const main = document.createElement('span');
    main.className = 'workspace-tab-main';
    main.append(name, close);
    tab.append(key, main);
    elements.workspaceTabs.append(tab);
  }
}

function openWorkspaceEntry(entry, { resume = false, activate = true } = {}) {
  const local = entry.source !== 'remote';
  return api(local ? '/api/repositories/open-local' : '/api/repositories/open-remote', {
    method: 'POST',
    body: JSON.stringify(local ? { path: entry.path, resume, activate } : { url: entry.path, resume, activate }),
  });
}

// 保存当前仓库的阅读位置，供切走后再切回。
export function captureSession() {
  if (!state.sessionKey) return null;
  const session = sessions.get(state.sessionKey);
  if (!session) return null;
  session.readingTrail = state.readingTrail.map((entry) => ({ ...entry }));
  session.currentFile = state.currentFile;
  if (state.currentFile && state.source) session.cursor = editor.getCursor();
  session.activeLine = state.activeLine;
  session.branches = state.branches;
  session.collapsed = state.collapsed;
  return session;
}

export function storeSession(key, data, prepared = null) {
  if (!key) return;
  sessions.set(key, {
    key,
    data,
    readingTrail: state.readingTrail.map((entry) => ({ ...entry })),
    currentFile: state.currentFile,
    cursor: state.currentFile && state.source ? editor.getCursor() : { line: 1, character: 0 },
    activeLine: state.activeLine,
    branches: state.branches,
    branchesLoaded: true,
    collapsed: state.collapsed,
    prepared: prepared || null,
  });
  if (prepared) rememberPrepared(key);
}

async function applySession(session) {
  deps.closeNvim();
  closeCommitOverlay();
  state.sessionKey = session.key;
  const prepared = preparedForSession(session);
  deps.applyRepositoryPayload(session.data, {
    readingTrail: session.readingTrail || [],
    collapsed: session.collapsed,
    branches: session.branches || [],
    prepared,
  });
  if (session.currentFile && state.files.includes(session.currentFile)) {
    await deps.selectFile(session.currentFile, {
      line: session.cursor?.line || 1,
      character: session.cursor?.character || 0,
    });
  }
  // 预载时已取回分支就绪标记，切仓不再触发一次 git for-each-ref。
  if (!session.branchesLoaded) loadBranches();
}

// 切仓期间再次触发快捷键/点击时只保留最后一个目标，当前切换结束后接着执行。
let pendingWorkspaceSwitch = null;

export async function activateWorkspaceEntry(entry, options = {}) {
  if (!entry) return;
  if (state.switching) {
    pendingWorkspaceSwitch = { entry, options };
    return;
  }
  if (state.sessionKey === entry.key && state.repository) return;
  state.switching = true;
  elements.sourceStatus.textContent = `正在切换到 ${entry.name}…`;
  try {
    captureSession();
    const cached = sessions.get(entry.key);
    if (cached?.data) {
      await applySession(cached);
      state.workspace.activeKey = entry.key;
      renderWorkspaceTabs();
      api('/api/workspace/activate', { method: 'POST', body: JSON.stringify({ key: entry.key }) }).catch(() => {});
    } else {
      const data = await openWorkspaceEntry(entry, { resume: true });
      await deps.loadRepository(data);
      if (data.resume?.file && state.files.includes(data.resume.file)) {
        await deps.selectFile(data.resume.file, { line: data.resume.line || 1, character: data.resume.character || 0 });
      }
    }
    if (options.announce) showNotice(`已切换到 ${entry.name}`);
    // 页签点击/标签跳转会重建页签 DOM，焦点会掉到 body：切换完成后送进代码区。
    const active = document.activeElement;
    if ((!active || active === document.body || active.closest?.('#workspace-bar')) && state.currentFile) {
      editor?.focus();
    }
  } catch (error) {
    showNotice(`切换仓库失败：${error.message}`, { error: true });
  } finally {
    state.switching = false;
    elements.sourceStatus.textContent = state.source ? `${state.source.lines} 行 · ${state.source.path}` : '';
    const pending = pendingWorkspaceSwitch;
    pendingWorkspaceSwitch = null;
    if (pending && pending.entry.key !== state.sessionKey) activateWorkspaceEntry(pending.entry, pending.options);
  }
}

// Ctrl+Alt+[ / ]：按工作区页签顺序循环切换（跳过当前仓库）。
export function activateWorkspaceByOffset(offset) {
  const entries = state.workspace?.entries || [];
  if (entries.length < 2) return false;
  let index = entries.findIndex((entry) => entry.key === state.sessionKey);
  if (index < 0) index = entries.findIndex((entry) => entry.key === state.workspace.activeKey);
  if (index < 0) index = 0;
  const target = entries[(index + offset + entries.length) % entries.length];
  if (!target || target.key === state.sessionKey) return false;
  activateWorkspaceEntry(target);
  return true;
}

// Ctrl+Alt+Shift+1..9：直达第 N 个工作区页签。
export function activateWorkspaceByIndex(index) {
  const target = (state.workspace?.entries || [])[index];
  if (!target || target.key === state.sessionKey) return false;
  activateWorkspaceEntry(target);
  return true;
}

export async function closeWorkspaceEntry(entry) {
  if (!entry || state.switching) return;
  state.switching = true;
  const focusIntent = getFocusIntent();
  const restoreTabFocus = Boolean(document.activeElement?.closest?.('.workspace-tab-close'));
  try {
    captureSession();
    const result = await api('/api/workspace/close', { method: 'POST', body: JSON.stringify({ key: entry.key }) });
    sessions.delete(entry.key);
    const wasActive = state.sessionKey === entry.key;
    state.workspace = { entries: result.entries || [], activeKey: result.activeKey || null };
    if (!wasActive) {
      renderWorkspaceTabs();
      if (restoreTabFocus && focusIntent === getFocusIntent() && document.activeElement === document.body) {
        elements.workspaceTabs.querySelector('.workspace-tab.active .workspace-tab-name')?.focus({ preventScroll: true });
      }
      return;
    }
    state.sessionKey = null;
    const next = (result.entries || []).find((candidate) => candidate.key === result.activeKey);
    renderWorkspaceTabs();
    state.switching = false;
    if (next) await activateWorkspaceEntry(next);
    else clearWorkspaceView();
  } catch (error) {
    showNotice(`关闭仓库失败：${error.message}`, { error: true });
  } finally {
    state.switching = false;
  }
}

export function clearWorkspaceView() {
  deps.closeNvim();
  closeCommitOverlay();
  if (editor?.isQuickpickOpen()) editor.closeQuickpick();
  state.repository = null;
  state.files = [];
  state.filesLower = [];
  state.fileSet = new Set();
  state.tree = null;
  state.status = {};
  state.branches = [];
  state.currentFile = null;
  state.source = null;
  state.activeLine = null;
  state.history = null;
  state.explanation = null;
  state.commitDetail = null;
  state.faqEntries = [];
  state.faqKey = null;
  state.historyCache.clear();
  state.lsp = { available: false, engine: null, initialized: false, detail: '' };
  state.sessionKey = null;
  state.readingTrail = [];
  renderReadingTrail();
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  closeQuestion();
  elements.treeFilter.value = '';
  renderRepository();
  renderTree();
  deps.renderSource();
  renderHistory();
  renderExplanation();
  renderFaq();
  renderLspState();
  // 工作区全关后没有仓库入口，先把文件树滑出来提示「打开」。
  window.__crPanels?.show('sidebar');
}

// 后台预载工作区里的其它仓库：切换时直接命中内存会话，不再等待仓库扫描。
async function preloadWorkspaceEntry(entry) {
  if (!entry || sessions.has(entry.key) || entry.key === state.sessionKey) return;
  try {
    const data = await openWorkspaceEntry(entry, { resume: true, activate: false });
    if (!(state.workspace.entries || []).some((candidate) => candidate.key === entry.key)) return;
    // 预载期间用户已切到该仓库：已有会话优先，勿用旧的预载结果覆盖。
    if (state.sessionKey === entry.key || sessions.has(entry.key)) return;
    const session = {
      key: entry.key,
      data,
      currentFile: data.resume?.file && data.files.includes(data.resume.file) ? data.resume.file : null,
      cursor: { line: data.resume?.line || 1, character: data.resume?.character || 0 },
      activeLine: null,
      branches: [],
      branchesLoaded: false,
      collapsed: null,
      prepared: null,
    };
    sessions.set(entry.key, session);
    api(`/api/repositories/${encodeURIComponent(data.repository.id)}/branches`)
      .then((result) => {
        if (sessions.get(entry.key) !== session) return;
        session.branches = result.branches || [];
        session.branchesLoaded = true;
      })
      .catch(() => {});
    scheduleIdle(() => {
      if (sessions.get(entry.key) !== session || session.prepared) return;
      preparePayloadIncremental(data, (prepared) => {
        if (sessions.get(entry.key) !== session || session.prepared) return;
        session.prepared = prepared;
        if (prepared) rememberPrepared(entry.key);
        else session.preparedUnavailable = true;
      });
    });
  } catch {
    // 预载失败不打扰当前阅读；用户切到该仓库时再提示
  }
}

// 页面加载即恢复工作区与上次位置。
export async function restoreWorkspace() {
  try {
    const workspace = await api('/api/workspace');
    state.workspace = { entries: workspace.entries || [], activeKey: workspace.activeKey || null };
    renderWorkspaceTabs();
    // 用户已抢先手动打开仓库时不覆盖当前视图。
    if (state.repository) return;
    if (!state.workspace.entries.length) {
      // 旧版本升级：工作区为空时退回最近一次阅读历史。
      const history = await api('/api/history').catch(() => ({ repositories: [] }));
      const recent = (history.repositories || [])[0];
      if (recent) await openHistoryEntry(recent, { silent: true });
      return;
    }
    const active = state.workspace.entries.find((entry) => entry.key === state.workspace.activeKey)
      || state.workspace.entries[0];
    try {
      const data = await openWorkspaceEntry(active, { resume: true, activate: true });
      await deps.loadRepository(data);
      if (data.resume?.file && state.files.includes(data.resume.file)) {
        // 后台恢复：加载期间用户可能已打开代码树/解释窗口，焦点按实况决定。
        await deps.selectFile(data.resume.file, {
          line: data.resume.line || 1,
          character: data.resume.character || 0,
        }, { focus: 'auto' });
      }
    } catch (error) {
      showNotice(`恢复工作区仓库 ${active.name} 失败：${error.message}`, { error: true });
    }
    // 单个仓库恢复失败不影响其它页签；其余仓库后台预载。
    state.workspace.entries
      .filter((entry) => entry.key !== state.sessionKey)
      .forEach((entry, index) => {
        setTimeout(() => preloadWorkspaceEntry(entry), 200 + index * 300);
      });
  } catch (error) {
    console.error('[workspace] 恢复失败：', error);
  } finally {
    // 没有任何仓库可恢复时，滑出文件树提示从「打开」进入。
    if (!state.repository) window.__crPanels?.show('sidebar');
  }
}