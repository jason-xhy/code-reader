// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 页面状态机与 code-reader API 强绑定
// grill: 成品检索=skill 库无 code-reader 前端成品; 输入固定=固定 DOM id 与 API 响应; 步骤机械=按仓库/分支/同步事件渲染; 判读固定=API JSON 结果; 失效场景=构造不出（仅本应用）
import { createEditor, THEMES } from './editor.js';
import { createAnimationHtml } from './animation-html.js';
import { createKeyboardNav } from './keyboard-nav.js';
import { createVimNav } from './vim-nav.js';

const $ = (selector) => document.querySelector(selector);
// v2：本地主题成为默认选项后重置旧版本保存的配色选择，避免历史
// localStorage（多为早期 one-dark）压过「默认本地」。用户重新选择后照常持久化。
const THEME_KEY = 'code-reader-theme-v2';
const LAYOUT_KEY = 'code-reader-layout';
// 明确要求动画解释的关键词；与问题输入框的复选框共同决定是否向 LLM 请求 3D 动画。
const ANIMATION_HINT_RE = /(动画|动图|三维|3D|可视化|three\.?js|animation)/i;

const elements = {
  openMenu: $('#open-menu'),
  workspaceBar: $('#workspace-bar'),
  workspaceTabs: $('#workspace-tabs'),
  workspaceAdd: $('#workspace-add'),
  sidebar: $('.sidebar'),
  insights: $('.insights'),
  sidebarTrigger: $('#sidebar-trigger'),
  insightsTrigger: $('#insights-trigger'),
  historyMenuButton: $('#history-menu-button'),
  historyMenu: $('#history-menu'),
  docsSettings: $('#docs-settings'),
  docsDialog: $('#docs-dialog'),
  docsClose: $('#docs-close'),
  docsPathInput: $('#docs-path-input'),
  docsAdd: $('#docs-add'),
  docsDirList: $('#docs-dir-list'),
  docsWebEnabled: $('#docs-web-enabled'),
  docsStats: $('#docs-stats'),
  docsError: $('#docs-error'),
  docsSave: $('#docs-save'),
  docsReindex: $('#docs-reindex'),
  docsProgress: $('#docs-progress'),
  browseButton: $('#browse-button'),
  dirBrowser: $('#dir-browser'),
  dirUp: $('#dir-up'),
  dirPath: $('#dir-path'),
  dirPick: $('#dir-pick'),
  dirList: $('#dir-list'),
  dirError: $('#dir-error'),
  themeSelect: $('#theme-select'),
  splitterLeft: $('#splitter-left'),
  splitterRight: $('#splitter-right'),
  insightsToggle: $('#insights-toggle'),
  insightsExpand: $('#insights-expand'),
  faqSection: $('#faq-section'),
  faqAnchor: $('#faq-anchor'),
  faqContent: $('#faq-content'),
  treeMenu: $('#tree-menu'),
  openDialog: $('#open-dialog'),
  dialogClose: $('#dialog-close'),
  openForm: $('#open-form'),
  openSubmit: $('#open-submit'),
  openError: $('#open-error'),
  openProgress: $('#open-progress'),
  localTab: $('#local-tab'),
  remoteTab: $('#remote-tab'),
  localPanel: $('#local-panel'),
  remotePanel: $('#remote-panel'),
  localPath: $('#local-path'),
  remoteUrl: $('#remote-url'),
  treeFilter: $('#tree-filter'),
  fileTree: $('#file-tree'),
  fileCount: $('#file-count'),
  llmStatus: $('#llm-status'),
  repositoryName: $('#repository-name'),
  branchSelect: $('#branch-select'),
  syncButton: $('#sync-button'),
  repoNotice: $('#repo-notice'),
  repoNoticeText: $('#repo-notice-text'),
  repoNoticeAction: $('#repo-notice-action'),
  repoNoticeClose: $('#repo-notice-close'),
  vimHelpDialog: $('#vim-help-dialog'),
  vimHelpClose: $('#vim-help-close'),
  repositoryTags: $('#repository-tags'),
  lspBadge: $('#lsp-badge'),
  lspState: $('#lsp-state'),
  currentFile: $('#current-file'),
  sourceStatus: $('#source-status'),
  codeEmpty: $('#code-empty'),
  editorHost: $('#editor-host'),
  codeArea: $('#code-area'),
  tabEditor: $('#tab-editor'),
  tabNvim: $('#tab-nvim'),
  nvimHost: $('#nvim-host'),
  nvimStatus: $('#nvim-status'),
  nvimNote: $('#nvim-note'),
  nvimKeys: $('#nvim-keys'),
  nvimKeymapDialog: $('#nvim-keymap-dialog'),
  nvimKeymapBody: $('#nvim-keymap-body'),
  nvimKeymapSubtitle: $('#nvim-keymap-subtitle'),
  nvimKeymapClose: $('#nvim-keymap-close'),
  nvimOpenCurrent: $('#nvim-open-current'),
  nvimRestart: $('#nvim-restart'),
  nvimClose: $('#nvim-close'),
  questionEditor: $('#question-editor'),
  questionAnchor: $('#question-anchor'),
  questionInput: $('#question-input'),
  questionAnimation: $('#question-animation'),
  questionError: $('#question-error'),
  questionCancel: $('#question-cancel'),
  questionSubmit: $('#question-submit'),
  questionPresets: $('#question-presets'),
  readingTrail: $('#reading-trail'),
  animationOverlay: $('#animation-overlay'),
  animationFrame: $('#animation-frame'),
  animationDownload: $('#animation-download'),
  animationClose: $('#animation-close'),
  historyAnchor: $('#history-anchor'),
  historyContent: $('#history-content'),
  explanationAnchor: $('#explanation-anchor'),
  explanationContent: $('#explanation-content'),
  commitOverlay: $('#commit-overlay'),
  commitOverlayTitle: $('#commit-overlay-title'),
  commitOverlayBody: $('#commit-overlay-body'),
  commitOverlayClose: $('#commit-overlay-close'),
  editorTabsHint: $('#editor-tabs-hint'),
  editorEnvSettings: $('#editor-env-settings'),
  editorEnvDialog: $('#editor-env-dialog'),
  editorEnvClose: $('#editor-env-close'),
  editorEnvDetected: $('#editor-env-detected'),
  editorEnvCommand: $('#editor-env-command'),
  editorEnvAppName: $('#editor-env-appname'),
  editorEnvError: $('#editor-env-error'),
  editorEnvProgress: $('#editor-env-progress'),
  editorEnvRefresh: $('#editor-env-refresh'),
  editorEnvSave: $('#editor-env-save'),
  navTree: $('#nav-tree'),
  navInsights: $('#nav-insights'),
};

const state = {
  repository: null,
  files: [],
  filesLower: [],
  fileSet: new Set(),
  tree: null,
  filterMatches: [],
  filterTotal: 0,
  filterIndex: -1,
  collapsed: new Set(),
  currentFile: null,
  source: null,
  activeLine: null,
  openMode: 'local',
  opening: false,
  history: null,
  historyController: null,
  historyCache: new Map(),
  explanation: null,
  questionOpen: false,
  explaining: false,
  lsp: { available: false, engine: null, initialized: false, detail: '' },
  lspTimer: null,
  branches: [],
  busy: false,
  noticeAction: null,
  status: {},
  historyList: [],
  commitCache: new Map(),
  commitDetail: null,
  faqEntries: [],
  faqController: null,
  faqKey: null,
  docsConfig: { directories: [], webEnabled: true },
  docsDraft: [],
  dirBrowserPath: '',
  dirParent: null,
  dirEntries: [],
  dirSelected: -1,
  dirTypeBuffer: '',
  dirTypeTimer: null,
  layout: { sidebar: 252, insights: 372, collapsed: false },
  theme: 'one-dark',
  themeExplicit: false,
  editorMode: 'editor',
  editorEnv: null,
  editorProfile: null,
readingTrail: [],
  animationOpen: false,
  animationRuntime: null,
  workspace: { entries: [], activeKey: null },
  sessionKey: null,
  switching: false,
};

let animationUrls = null;

const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme && (savedTheme === 'local' || THEMES.some((theme) => theme.id === savedTheme))) {
  state.theme = savedTheme;
  state.themeExplicit = true;
}

// 工作区：每个打开过的仓库一份会话快照（payload + 当前文件/光标/折叠目录/分支）。
// 切换仓库只重建视图，不重新扫描代码树；页面刷新后由服务端 workspace.json 恢复。
const sessions = new Map();
// 切仓期间再次触发快捷键/点击时只保留最后一个目标，当前切换结束后接着执行，
// 让连续按 Ctrl+Alt+] 时仍能落到最后想要的仓库。
let pendingWorkspaceSwitch = null;
const jumpStack = [];
const jumpForwardStack = [];
let treeFocusIndex = -1;
// 文件树的 gg 连击窗口与数字计数（与 Vim 一致：gg 回首个文件、5j 下移 5 行）。
let treeGPressedAt = 0;
let treeCount = '';
let editor = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`服务返回了无效响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || `请求失败（HTTP ${response.status}）`);
    error.code = data?.error?.code;
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    state.layout = {
      sidebar: clamp(Number(saved.sidebar) || 252, 180, 420),
      insights: clamp(Number(saved.insights) || 372, 280, 640),
      // 旧的“永久折叠”模式已由悬停覆盖层取代，历史值不再生效。
      collapsed: false,
    };
  } catch {
    state.layout = { sidebar: 252, insights: 372, collapsed: false };
  }
}

function applyLayout() {
  const app = document.getElementById('app');
  app.style.setProperty('--sidebar-width', `${state.layout.sidebar}px`);
  app.style.setProperty('--insights-width', `${state.layout.insights}px`);
  elements.splitterLeft.setAttribute('aria-valuenow', String(state.layout.sidebar));
  elements.splitterRight.setAttribute('aria-valuenow', String(state.layout.insights));
  app.classList.remove('insights-collapsed');
  elements.insightsExpand.hidden = true;
}

function saveLayout() {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(state.layout));
}

function initSplitter(side) {
  const handle = side === 'left' ? elements.splitterLeft : elements.splitterRight;
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = side === 'left' ? state.layout.sidebar : state.layout.insights;
    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === 'left') state.layout.sidebar = clamp(startWidth + delta, 180, 420);
      else state.layout.insights = clamp(startWidth - delta, 280, 640);
      applyLayout();
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      saveLayout();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
  // 分隔条也可用键盘调整：聚焦后 ←/→ 步进，Shift 加速。
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 12;
    if (event.key === 'Home') {
      if (side === 'left') state.layout.sidebar = 180;
      else state.layout.insights = 280;
    } else if (event.key === 'End') {
      if (side === 'left') state.layout.sidebar = 420;
      else state.layout.insights = 640;
    } else if (side === 'left') {
      state.layout.sidebar = clamp(state.layout.sidebar + (event.key === 'ArrowRight' ? step : -step), 180, 420);
    } else {
      state.layout.insights = clamp(state.layout.insights + (event.key === 'ArrowLeft' ? step : -step), 280, 640);
    }
    applyLayout();
    saveLayout();
  });
}

// 两侧栏默认收起为覆盖层：鼠标移到左/右边缘或面板上滑入，离开后延迟收起。
// 焦点进入面板（\e 聚焦文件树、点击过滤框/历史项）时保持展开。
const PANEL_HIDE_DELAY = 220;

function initAutoPanels() {
  const app = document.getElementById('app');
  const panels = [
    { name: 'sidebar', el: elements.sidebar, trigger: elements.sidebarTrigger, splitter: elements.splitterLeft },
    { name: 'insights', el: elements.insights, trigger: elements.insightsTrigger, splitter: elements.splitterRight },
  ].filter((panel) => panel.el && panel.trigger);
  const timers = new Map();
  // 收起的侧栏只是 transform 移出屏幕，内部元素仍会进入 Tab 顺序（焦点环
  // 落到不可见处）。用 inert 把隐藏面板整体移出焦点/交互范围。
  const syncInert = (panel) => {
    if (!panel) return;
    if (app.classList.contains(`${panel.name}-visible`)) panel.el.removeAttribute('inert');
    else panel.el.setAttribute('inert', '');
  };
  const reveal = (panel, { force = false } = {}) => {
    if (!panel) return;
    if (!force && panel.suppress) return;
    clearTimeout(timers.get(panel.name));
    app.classList.add(`${panel.name}-visible`);
    syncInert(panel);
  };
  const conceal = (panel) => {
    if (!panel) return;
    if (panel.pinned) return;
    // 焦点在面板里就保持展开——鼠标点击解释窗口/文件树后焦点也在面板内，
    // 只看 :focus-visible 会让鼠标移开时把正在键盘阅读的面板收走。
    const active = document.activeElement;
    if (active && panel.el.contains(active)) return;
    if (panel.el.matches(':hover') || panel.splitter?.matches(':hover')) return;
    if (panel.splitter?.classList.contains('dragging')) return;
    app.classList.remove(`${panel.name}-visible`);
    syncInert(panel);
  };
  const scheduleConceal = (panel) => {
    if (!panel) return;
    clearTimeout(timers.get(panel.name));
    timers.set(panel.name, setTimeout(() => conceal(panel), PANEL_HIDE_DELAY));
  };
  // Ctrl+Alt+B / Ctrl+Alt+I 的面板语义在 toggle*Panel 里统一处理（见「去这个窗口」注释），
  // 这里的 toggle 只保留给加载状态等内部使用（可见则关闭并解除钉住，隐藏则钉住并打开）。
  const toggle = (panel) => {
    if (!panel) return false;
    if (app.classList.contains(`${panel.name}-visible`)) {
      panel.pinned = false;
      clearTimeout(timers.get(panel.name));
      app.classList.remove(`${panel.name}-visible`);
      syncInert(panel);
      // 面板在鼠标下方收起时，避免指针立刻触发 pointerenter 又弹开。
      panel.suppress = true;
      clearTimeout(panel.suppressTimer);
      panel.suppressTimer = setTimeout(() => { panel.suppress = false; }, 400);
    } else {
      panel.pinned = true;
      panel.suppress = false;
      reveal(panel, { force: true });
    }
    return true;
  };
  for (const panel of panels) {
    panel.trigger.addEventListener('pointerenter', () => reveal(panel));
    panel.trigger.addEventListener('pointerleave', () => scheduleConceal(panel));
    panel.el.addEventListener('pointerenter', () => reveal(panel));
    panel.el.addEventListener('pointerleave', () => scheduleConceal(panel));
    panel.el.addEventListener('focusin', () => reveal(panel, { force: true }));
    panel.el.addEventListener('focusout', (event) => {
      if (panel.el.contains(event.relatedTarget)) return;
      scheduleConceal(panel);
    });
    panel.splitter?.addEventListener('pointerenter', () => reveal(panel));
    panel.splitter?.addEventListener('pointerleave', () => scheduleConceal(panel));
    // 初始默认收起：同步一次 inert，避免隐藏面板里的元素参与 Tab 顺序。
    syncInert(panel);
  }
  const byName = (name) => panels.find((panel) => panel.name === name);
  const hidePanel = (panel) => {
    if (!panel) return;
    clearTimeout(timers.get(panel.name));
    app.classList.remove(`${panel.name}-visible`);
    syncInert(panel);
  };
  window.__crPanels = {
    show(name) {
      reveal(byName(name), { force: true });
    },
    hide(name) {
      hidePanel(byName(name));
    },
    hideAll() {
      for (const panel of panels) hidePanel(panel);
    },
    toggle(name) {
      return toggle(byName(name));
    },
    pin(name) {
      const panel = byName(name);
      if (!panel) return;
      panel.pinned = true;
      panel.suppress = false;
      reveal(panel, { force: true });
    },
    isPinned(name) {
      return Boolean(byName(name)?.pinned);
    },
    isVisible(name) {
      return app.classList.contains(`${name}-visible`);
    },
  };
}

function applyShellTheme(palette) {
  if (!palette) return;
  const root = document.documentElement.style;
  root.setProperty('--panel', palette.shell.panel);
  root.setProperty('--panel-deep', palette.shell.background);
  root.setProperty('--border', palette.shell.border);
  root.setProperty('--accent', palette.shell.accent);
  root.setProperty('--muted', palette.shell.muted);
  document.body.style.background = palette.shell.background;
  document.body.style.color = palette.shell.text;
}

// 字体同步：配色由本地 nvim 高亮生成后，字体也要跟本地终端一致。CM6 主题
// 通过 CSS 变量读取这里的值，nvim 面板由 terminal.js 单独应用 profile.font。
function applyEditorFont(font) {
  const root = document.documentElement.style;
  const family = typeof font?.family === 'string' ? font.family.replace(/["']/g, ' ').trim() : '';
  const size = Number(font?.sizePx);
  if (!family) {
    root.removeProperty('--cr-editor-font');
    root.removeProperty('--cr-editor-font-size');
    root.removeProperty('--cr-editor-line-height');
    return;
  }
  root.setProperty('--cr-editor-font', `"${family}", "SFMono-Regular", Consolas, "Liberation Mono", monospace`);
  if (Number.isFinite(size) && size >= 9 && size <= 28) {
    root.setProperty('--cr-editor-font-size', `${Math.round(size)}px`);
    root.setProperty('--cr-editor-line-height', `${Math.round(size * 1.6)}px`);
  } else {
    root.removeProperty('--cr-editor-font-size');
    root.removeProperty('--cr-editor-line-height');
  }
}

function populateThemes() {
  elements.themeSelect.replaceChildren();
  if (state.editorProfile?.available) {
    const option = document.createElement('option');
    option.value = 'local';
    option.textContent = `本地 · ${state.editorProfile.colorscheme || 'vim/neovim'}`;
    elements.themeSelect.append(option);
  }
  for (const theme of THEMES) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    elements.themeSelect.append(option);
  }
  elements.themeSelect.value = state.theme;
  if (!elements.themeSelect.value) {
    state.theme = 'one-dark';
    elements.themeSelect.value = state.theme;
  }
}

function relativeTime(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

async function loadReadingHistory() {
  try {
    const data = await api('/api/history');
    state.historyList = data.repositories || [];
  } catch {
    state.historyList = [];
  }
  renderReadingHistory();
}

function menuButtons(menu) {
  return [...menu.querySelectorAll('button:not(:disabled)')];
}

function focusFirstMenuItem(menu) {
  menuButtons(menu)[0]?.focus();
}

function renderReadingHistory() {
  const menu = elements.historyMenu;
  menu.replaceChildren();
  if (!state.historyList.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '还没有阅读历史';
    menu.append(empty);
    return;
  }
  for (const entry of state.historyList) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const pathLine = document.createElement('span');
    pathLine.textContent = entry.path;
    const position = document.createElement('span');
    position.textContent = entry.lastFile
      ? `${entry.lastFile}:${entry.lastLine} · ${relativeTime(entry.updatedAt)}`
      : `未打开文件 · ${relativeTime(entry.updatedAt)}`;
    button.append(name, pathLine, position);
    button.addEventListener('click', () => {
      menu.hidden = true;
      openHistoryEntry(entry);
    });
    menu.append(button);
  }
  const footer = document.createElement('div');
  footer.className = 'history-footer';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'button small';
  clear.textContent = '清空历史';
  clear.addEventListener('click', async () => {
    try {
      await api('/api/history', { method: 'DELETE' });
      state.historyList = [];
      renderReadingHistory();
    } catch (error) {
      showNotice(`清空历史失败：${error.message}`, { error: true });
    }
  });
  footer.append(clear);
  menu.append(footer);
}

async function openHistoryEntry(entry, { silent = false } = {}) {
  try {
    const data = entry.source === 'remote'
      ? await api('/api/repositories/open-remote', { method: 'POST', body: JSON.stringify({ url: entry.path, resume: true }) })
      : await api('/api/repositories/open-local', { method: 'POST', body: JSON.stringify({ path: entry.path, resume: true }) });
    await loadRepository(data);
    if (data.resume?.file && state.files.includes(data.resume.file)) {
      await selectFile(data.resume.file, { line: data.resume.line || 1, character: data.resume.character || 0 });
    }
    if (!silent) {
      showNotice(data.resume?.file
        ? `已恢复 ${entry.name} · ${data.resume.file}:${data.resume.line}`
        : `已打开 ${entry.name}（暂无上次文件位置）`);
    }
  } catch (error) {
    if (!silent) showNotice(`打开历史失败：${error.message}`, { error: true });
    else console.error('[workspace] 恢复阅读历史失败：', error);
  }
}

function repositoryKey(repository) {
  if (!repository) return null;
  if (repository.source === 'remote') return `remote:${repository.remoteUrl || repository.root}`;
  return `local:${repository.root}`;
}

function renderWorkspaceTabs() {
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
function captureSession() {
  if (!state.sessionKey) return null;
  const session = sessions.get(state.sessionKey);
  if (!session) return null;
  session.currentFile = state.currentFile;
  if (state.currentFile && state.source) session.cursor = editor.getCursor();
  session.activeLine = state.activeLine;
  session.branches = state.branches;
  session.collapsed = state.collapsed;
  return session;
}

function storeSession(key, data, prepared = null) {
  if (!key) return;
  sessions.set(key, {
    key,
    data,
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
  closeNvim();
  closeCommitOverlay();
  state.sessionKey = session.key;
  const prepared = preparedForSession(session);
  applyRepositoryPayload(session.data, {
    collapsed: session.collapsed,
    branches: session.branches || [],
    prepared,
  });
  if (session.currentFile && state.files.includes(session.currentFile)) {
    await selectFile(session.currentFile, {
      line: session.cursor?.line || 1,
      character: session.cursor?.character || 0,
    });
  }
  // 预载时已取回分支就绪标记，切仓不再触发一次 git for-each-ref。
  if (!session.branchesLoaded) loadBranches();
}

async function activateWorkspaceEntry(entry, options = {}) {
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
      await loadRepository(data);
      if (data.resume?.file && state.files.includes(data.resume.file)) {
        await selectFile(data.resume.file, { line: data.resume.line || 1, character: data.resume.character || 0 });
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
function activateWorkspaceByOffset(offset) {
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
function activateWorkspaceByIndex(index) {
  const target = (state.workspace?.entries || [])[index];
  if (!target || target.key === state.sessionKey) return false;
  activateWorkspaceEntry(target);
  return true;
}

async function closeWorkspaceEntry(entry) {
  if (!entry || state.switching) return;
  state.switching = true;
  try {
    captureSession();
    const result = await api('/api/workspace/close', { method: 'POST', body: JSON.stringify({ key: entry.key }) });
    sessions.delete(entry.key);
    const wasActive = state.sessionKey === entry.key;
    state.workspace = { entries: result.entries || [], activeKey: result.activeKey || null };
    if (!wasActive) {
      renderWorkspaceTabs();
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

function clearWorkspaceView() {
  closeNvim();
  closeCommitOverlay();
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
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  closeQuestion();
  elements.treeFilter.value = '';
  renderRepository();
  renderTree();
  renderSource();
  renderHistory();
  renderExplanation();
  renderFaq();
  renderLspState();
  // 工作区全关后没有仓库入口，先把文件树滑出来提示「打开」。
  window.__crPanels?.show('sidebar');
}

// 后台预载工作区里的其它仓库：切换时直接命中内存会话，不再等待仓库扫描。
// 预载同时补齐分支列表与代码树派生数据，并在空闲时建树，避免切仓时卡主线程。
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

// 页面加载即恢复工作区与上次位置：服务端 workspace.json 记录打开的仓库与当前仓库，
// 每个仓库的 file/line/character 由阅读历史保存。
async function restoreWorkspace() {
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
      await loadRepository(data);
      if (data.resume?.file && state.files.includes(data.resume.file)) {
        await selectFile(data.resume.file, {
          line: data.resume.line || 1,
          character: data.resume.character || 0,
        });
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

let historyTouchTimer = null;

function scheduleHistoryTouch() {
  if (!state.repository) return;
  clearTimeout(historyTouchTimer);
  historyTouchTimer = setTimeout(() => {
    if (!state.repository) return;
    const cursor = editor ? editor.getCursor() : { character: 0 };
    api('/api/history/touch', {
      method: 'POST',
      body: JSON.stringify({
        repositoryId: state.repository.id,
        file: state.currentFile || undefined,
        line: state.activeLine || undefined,
        character: cursor.character,
      }),
    }).catch(() => {});
  }, 900);
}

async function loadDocsConfig() {
  try {
    const data = await api('/api/docs/config');
    state.docsConfig = data.config || { directories: [], webEnabled: true };
    state.docsDraft = [...state.docsConfig.directories];
    state.docsStatsData = data.directories || [];
  } catch (error) {
    state.docsError = error.message;
  }
  renderDocsDialog();
}

function renderDocsDialog() {
  elements.docsDirList.replaceChildren();
  for (const directory of state.docsDraft) {
    const row = document.createElement('div');
    row.className = 'docs-dir';
    const label = document.createElement('span');
    label.textContent = directory;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'faq-delete';
    remove.textContent = '移除';
    remove.addEventListener('click', () => {
      state.docsDraft = state.docsDraft.filter((value) => value !== directory);
      renderDocsDialog();
    });
    row.append(label, remove);
    elements.docsDirList.append(row);
  }
  if (!state.docsDraft.length) {
    const empty = document.createElement('div');
    empty.className = 'field-help';
    empty.textContent = '尚未指定文档目录；当前仓库的 Documentation/docs/doc 仍会自动纳入。';
    elements.docsDirList.append(empty);
  }
  elements.docsWebEnabled.checked = state.docsConfig.webEnabled !== false;
  const indexed = (state.docsStatsData || []).filter((entry) => entry.indexed);
  elements.docsStats.textContent = indexed.length
    ? `已索引 ${indexed.reduce((total, entry) => total + entry.files, 0)} 个文件 / ${indexed.reduce((total, entry) => total + entry.chunks, 0)} 个片段`
    : '索引将在首次提问检索时建立（PDF 使用 pdftotext 抽取）。';
  elements.docsError.textContent = state.docsError || '';
}

async function openDocsDialog() {
  state.docsError = '';
  await loadDocsConfig();
  elements.docsDialog.showModal();
}

function selectDirIndex(index, { focus = true } = {}) {
  const rows = [...elements.dirList.querySelectorAll('.dir-row')];
  if (!rows.length) {
    state.dirSelected = -1;
    return;
  }
  const target = Math.max(0, Math.min(index, rows.length - 1));
  state.dirSelected = target;
  rows.forEach((row, rowIndex) => {
    const selected = rowIndex === target;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', String(selected));
    // roving tabindex：整个目录列表只占一个 Tab 停靠点，方向键在项间移动。
    row.tabIndex = selected ? 0 : -1;
  });
  const row = rows[target];
  row.scrollIntoView({ block: 'nearest' });
  if (focus) row.focus();
}

// 双击/Enter 才“确认”选中：回填路径并进入该目录；单击只高亮。
async function enterDirIndex(index) {
  const entry = state.dirEntries[index];
  if (!entry) return;
  elements.localPath.value = entry.path;
  await loadDirectory(entry.path);
  // 进入后由 loadDirectory 把焦点放到新目录的当前项，继续按字母导航。
}

// 字母导航：与文件管理器一致，连续同字母循环，800ms 内多字母按前缀匹配。
function typeAheadDir(char) {
  const lower = char.toLowerCase();
  const entries = state.dirEntries;
  if (!entries.length) return;
  const count = entries.length;
  let buffer = state.dirTypeBuffer;
  let start = state.dirSelected >= 0 ? state.dirSelected : 0;
  if (buffer && buffer.length === 1 && buffer === lower) {
    start = (state.dirSelected + 1 + count) % count;
  } else {
    buffer += lower;
  }
  state.dirTypeBuffer = buffer;
  clearTimeout(state.dirTypeTimer);
  state.dirTypeTimer = setTimeout(() => { state.dirTypeBuffer = ''; }, 800);
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    if (entries[index].name.toLowerCase().startsWith(buffer)) {
      selectDirIndex(index);
      return;
    }
  }
}

function renderDirList() {
  elements.dirList.replaceChildren();
  state.dirEntries.forEach((entry, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dir-row';
    row.dataset.path = entry.path;
    row.dataset.index = String(index);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.tabIndex = -1;
    row.textContent = entry.name;
    if (entry.git) {
      const badge = document.createElement('span');
      badge.className = 'dir-git';
      badge.textContent = 'Git';
      row.append(badge);
    }
    row.addEventListener('click', () => selectDirIndex(index));
    row.addEventListener('dblclick', () => enterDirIndex(index));
    elements.dirList.append(row);
  });
  if (!state.dirEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'field-help';
    empty.textContent = '该目录下没有子目录';
    elements.dirList.append(empty);
  }
}

async function loadDirectory(target) {
  elements.dirError.textContent = '';
  try {
    const data = await api(`/api/fs/list?path=${encodeURIComponent(target)}`);
    state.dirBrowserPath = data.path;
    state.dirParent = data.parent;
    state.dirEntries = data.entries || [];
    state.dirSelected = -1;
    state.dirTypeBuffer = '';
    elements.dirPath.textContent = data.path;
    elements.dirUp.disabled = !data.parent;
    renderDirList();
    // 打开/切换目录后焦点进入列表当前项，↑/↓ 才能从当前项开始移动。
    if (!elements.dirBrowser.hidden) {
      if (state.dirEntries.length) selectDirIndex(0);
      else elements.dirList.focus({ preventScroll: true });
    }
  } catch (error) {
    elements.dirError.textContent = error.message;
  }
}

function setOpenMode(mode) {
  state.openMode = mode;
  const local = mode === 'local';
  elements.localTab.classList.toggle('active', local);
  elements.remoteTab.classList.toggle('active', !local);
  elements.localTab.setAttribute('aria-selected', String(local));
  elements.remoteTab.setAttribute('aria-selected', String(!local));
  elements.localPanel.hidden = !local;
  elements.remotePanel.hidden = local;
  elements.openError.textContent = '';
  (local ? elements.localPath : elements.remoteUrl).focus();
}

function showOpenDialog() {
  elements.openError.textContent = '';
  elements.openProgress.textContent = '';
  elements.openDialog.showModal();
  setOpenMode(state.openMode);
}

function closeOpenDialog() {
  if (!state.opening) elements.openDialog.close();
}

function isSortedPaths(files) {
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1] > files[index]) return false;
  }
  return true;
}

// 顺序建树：git ls-files 基本按路径排序，利用“与上一条路径的公共前缀”复用节点，
// 省掉逐段 Map 查找。kernel 仓（约 10 万文件）比逐段 has/get 快约 2 倍；
// 乱序输入先排序副本，保持原有节点集合不变。
function buildTree(files) {
  const list = isSortedPaths(files) ? files : [...files].sort();
  const root = { name: '', path: '', directory: true, children: [] };
  const stack = [root];
  let lastParts = [];
  for (const file of list) {
    const parts = file.split('/');
    let common = 0;
    const limit = Math.min(lastParts.length, parts.length);
    while (common < limit && lastParts[common] === parts[common]) common += 1;
    stack.length = common + 1;
    let parent = stack[common];
    let prefix = common === 0 ? '' : parent.path;
    for (let index = common; index < parts.length; index += 1) {
      const part = parts[index];
      const directory = index < parts.length - 1;
      const path = prefix ? `${prefix}/${part}` : part;
      const node = { name: part, path, directory, children: directory ? [] : null };
      parent.children.push(node);
      if (directory) {
        stack.push(node);
        parent = node;
        prefix = path;
      }
    }
    lastParts = parts;
  }
  return root;
}

// 工作区会话的派生数据（小写表/路径集合/代码树）按仓库缓存：切仓时不再重扫
// 10 万路径（约 300–450ms）。只缓存最近若干个仓库，避免多仓工作区常驻过多内存。
const PREPARED_LIMIT = 4;
const MAX_PREPARED_FILES = 200_000;
const preparedOrder = [];

function preparePayload(data) {
  const files = Array.isArray(data?.files) ? data.files : [];
  if (files.length > MAX_PREPARED_FILES) return null;
  return {
    filesLower: files.map((filePath) => filePath.toLowerCase()),
    fileSet: new Set(files),
    tree: buildTree(files),
  };
}

function rememberPrepared(key) {
  if (!key) return;
  const existing = preparedOrder.indexOf(key);
  if (existing >= 0) preparedOrder.splice(existing, 1);
  preparedOrder.push(key);
  while (preparedOrder.length > PREPARED_LIMIT) {
    const victim = preparedOrder.findIndex((candidate) => candidate !== state.sessionKey);
    if (victim < 0) break;
    const [evicted] = preparedOrder.splice(victim, 1);
    const session = sessions.get(evicted);
    if (session) session.prepared = null;
  }
}

function preparedForSession(session) {
  if (!session?.data) return null;
  if (session.prepared) {
    rememberPrepared(session.key);
    return session.prepared;
  }
  if (session.preparedUnavailable) return null;
  session.prepared = preparePayload(session.data);
  if (session.prepared) rememberPrepared(session.key);
  else session.preparedUnavailable = true;
  return session.prepared;
}

const scheduleIdle = typeof window.requestIdleCallback === 'function'
  ? (callback) => window.requestIdleCallback(callback, { timeout: 1500 })
  : (callback) => setTimeout(callback, 120);

// 预载仓库的派生数据切成 ≤12ms 的片：9.8 万路径一次建树约 280ms，直接放在
// requestIdleCallback 里会在 j/k 导航时卡出一个明显长任务。这里分三段
// （小写表 → 路径集合 → 代码树）逐片推进，片间让出主线程。
function preparePayloadIncremental(data, onDone, { budgetMs = 10 } = {}) {
  const files = Array.isArray(data?.files) ? data.files : [];
  if (files.length > MAX_PREPARED_FILES) {
    onDone(null);
    return;
  }
  const treeFiles = isSortedPaths(files) ? files : [...files].sort();
  const filesLower = new Array(files.length);
  const fileSet = new Set();
  const root = { name: '', path: '', directory: true, children: [] };
  const stack = [root];
  let lastParts = [];
  let phase = 0;
  let index = 0;
  const advance = () => {
    const deadline = performance.now() + budgetMs;
    while (index < files.length) {
      if (phase === 0) {
        filesLower[index] = files[index].toLowerCase();
      } else if (phase === 1) {
        fileSet.add(files[index]);
      } else {
        const parts = treeFiles[index].split('/');
        let common = 0;
        const limit = Math.min(lastParts.length, parts.length);
        while (common < limit && lastParts[common] === parts[common]) common += 1;
        stack.length = common + 1;
        let parent = stack[common];
        let prefix = common === 0 ? '' : parent.path;
        for (let partIndex = common; partIndex < parts.length; partIndex += 1) {
          const part = parts[partIndex];
          const directory = partIndex < parts.length - 1;
          const path = prefix ? `${prefix}/${part}` : part;
          const node = { name: part, path, directory, children: directory ? [] : null };
          parent.children.push(node);
          if (directory) {
            stack.push(node);
            parent = node;
            prefix = path;
          }
        }
        lastParts = parts;
      }
      index += 1;
      if ((index & 127) === 0 && performance.now() > deadline) break;
    }
    if (index < files.length) {
      scheduleIdle(advance);
      return;
    }
    if (phase === 0) {
      phase = 1;
      index = 0;
      scheduleIdle(advance);
      return;
    }
    if (phase === 1) {
      phase = 2;
      index = 0;
      scheduleIdle(advance);
      return;
    }
    onDone({ filesLower, fileSet, tree: root });
  };
  scheduleIdle(advance);
}

function sortedChildren(node, filter) {
  return [...node.children]
    .filter((child) => {
      if (!filter) return true;
      if (!child.directory) return child.path.toLowerCase().includes(filter);
      return child.path.toLowerCase().includes(filter) || sortedChildren(child, filter).length > 0;
    })
    .sort((a, b) => a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1);
}

const FILE_ICONS = new Map(Object.entries({
  c: { label: 'C', className: 'icon-c' },
  h: { label: 'H', className: 'icon-c' },
  cc: { label: 'C+', className: 'icon-c' },
  cpp: { label: 'C+', className: 'icon-c' },
  cxx: { label: 'C+', className: 'icon-c' },
  hpp: { label: 'H+', className: 'icon-c' },
  py: { label: 'Py', className: 'icon-py' },
  js: { label: 'JS', className: 'icon-js' },
  mjs: { label: 'JS', className: 'icon-js' },
  cjs: { label: 'JS', className: 'icon-js' },
  ts: { label: 'TS', className: 'icon-js' },
  go: { label: 'Go', className: 'icon-py' },
  rs: { label: 'Rs', className: 'icon-c' },
  sh: { label: 'Sh', className: 'icon-py' },
  md: { label: 'Md', className: 'icon-md' },
  markdown: { label: 'Md', className: 'icon-md' },
  json: { label: '{}', className: 'icon-cfg' },
  yaml: { label: 'Y', className: 'icon-cfg' },
  yml: { label: 'Y', className: 'icon-cfg' },
}));

function fileIcon(filePath) {
  const index = filePath.lastIndexOf('.');
  const extension = index === -1 ? '' : filePath.slice(index + 1).toLowerCase();
  return FILE_ICONS.get(extension) || { label: '·', className: '' };
}

function statusClass(code) {
  if (!code) return '';
  if (code === '??') return 'status-u';
  if (code.includes('A')) return 'status-a';
  if (code.includes('D')) return 'status-d';
  if (code.includes('M')) return 'status-m';
  return 'status-u';
}

function collapsedStorageKey() {
  return state.repository ? `code-reader-collapsed:${state.repository.id}` : '';
}

function restoreCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(collapsedStorageKey()) || 'null');
    return Array.isArray(raw) ? new Set(raw) : null;
  } catch {
    return null;
  }
}

function persistCollapsed() {
  if (state.repository) {
    localStorage.setItem(collapsedStorageKey(), JSON.stringify([...state.collapsed]));
  }
}

const TREE_FILTER_LIMIT = 200;

function renderFilteredTree(filter) {
  const matches = [];
  let total = 0;
  for (let index = 0; index < state.files.length; index += 1) {
    if (!state.filesLower[index].includes(filter)) continue;
    total += 1;
    if (matches.length < TREE_FILTER_LIMIT) matches.push(state.files[index]);
  }
  state.filterMatches = matches;
  state.filterTotal = total;
  // 只有一个候选时默认高亮，回车可直接打开；多候选由 ↑/↓ 选择。
  if (state.filterIndex < 0 && total === 1 && matches.length === 1) state.filterIndex = 0;
  if (state.filterIndex >= matches.length) state.filterIndex = matches.length - 1;
  if (!total) {
    state.filterIndex = -1;
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '没有匹配的文件';
    elements.fileTree.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  matches.forEach((filePath, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const focused = index === state.filterIndex;
    button.className = `tree-row tree-row-flat${state.currentFile === filePath ? ' active' : ''}${focused ? ' key-focus' : ''}`;
    button.title = filePath;
    button.dataset.path = filePath;
    button.dataset.directory = 'false';
    const icon = fileIcon(filePath);
    const iconElement = document.createElement('span');
    iconElement.className = `file-icon ${icon.className}`;
    iconElement.textContent = icon.label;
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = filePath;
    button.append(iconElement, name);
    fragment.append(button);
  });
  elements.fileTree.append(fragment);
  if (total > matches.length) {
    const note = document.createElement('div');
    note.className = 'empty-tree';
    note.textContent = `仅显示前 ${matches.length} 个匹配（共 ${total} 个），请继续输入缩小范围`;
    elements.fileTree.append(note);
  }
}

function updateFilterFocus(scroll = true) {
  const rows = [...elements.fileTree.querySelectorAll('.tree-row-flat')];
  rows.forEach((row, index) => row.classList.toggle('key-focus', index === state.filterIndex));
  if (scroll && state.filterIndex >= 0) rows[state.filterIndex]?.scrollIntoView({ block: 'nearest' });
}

function openFilteredFile(filePath) {
  if (!filePath) return;
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  selectFile(filePath);
  elements.treeFilter.focus();
}

function renderTree() {
  elements.fileTree.replaceChildren();
  if (!state.tree) {
    state.filterMatches = [];
    state.filterTotal = 0;
    state.filterIndex = -1;
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '打开一个本地或远程 Git 仓库';
    elements.fileTree.append(empty);
    return;
  }
  const filter = elements.treeFilter.value.trim().toLowerCase();
  if (filter) {
    renderFilteredTree(filter);
    return;
  }
  state.filterMatches = [];
  state.filterTotal = 0;
  state.filterIndex = -1;
  const fragment = document.createDocumentFragment();
  let visible = 0;

  const appendNode = (node, depth) => {
    for (const child of sortedChildren(node, filter)) {
      visible += 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tree-row${child.directory ? ' directory' : ''}${state.currentFile === child.path ? ' active' : ''}`;
      button.style.paddingLeft = `${6 + depth * 14}px`;
      button.title = child.path;
      button.dataset.path = child.path;
      button.dataset.directory = String(child.directory);

      const marker = document.createElement('span');
      marker.className = child.directory ? 'tree-arrow' : 'tree-file-mark';
      marker.textContent = child.directory ? (state.collapsed.has(child.path) && !filter ? '▶' : '▼') : '';
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = child.name;
      button.append(marker);
      if (!child.directory) {
        const icon = fileIcon(child.path);
        const iconElement = document.createElement('span');
        iconElement.className = `file-icon ${icon.className}`;
        iconElement.textContent = icon.label;
        button.append(iconElement);
      }
      button.append(name);
      const status = child.directory ? null : state.status[child.path];
      if (status) {
        const badge = document.createElement('span');
        badge.className = `tree-status ${statusClass(status)}`;
        badge.textContent = status;
        badge.title = `Git 状态：${status}`;
        button.append(badge);
      }
      fragment.append(button);

      if (child.directory && (filter || !state.collapsed.has(child.path))) appendNode(child, depth + 1);
    }
  };
  appendNode(state.tree, 0);
  if (!visible) {
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '没有匹配的文件';
    elements.fileTree.append(empty);
  } else {
    elements.fileTree.append(fragment);
  }
}

function renderRepository() {
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

function renderBranches() {
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

async function loadBranches() {
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

function showNotice(text, { label = '', action = null, error = false } = {}) {
  elements.repoNotice.hidden = false;
  elements.repoNotice.classList.toggle('error', error);
  elements.repoNoticeText.textContent = text;
  state.noticeAction = action;
  elements.repoNoticeAction.hidden = !(label && action);
  if (label && action) elements.repoNoticeAction.textContent = label;
}

function hideNotice() {
  elements.repoNotice.hidden = true;
  state.noticeAction = null;
}

async function reloadCurrentFile() {
  if (!state.repository || !state.currentFile) return;
  const filePath = state.currentFile;
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/file?path=${encodeURIComponent(filePath)}`);
    if (state.currentFile !== filePath) return;
    state.source = data;
    renderSource();
  } catch {
    // 文件可能已不存在，保留当前视图
  }
}

async function restoreStashes(shas) {
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

async function refreshStashNotice() {
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

async function switchBranch(target) {
  if (!state.repository || state.busy || !target) return;
  state.busy = true;
  renderBranches();
  elements.sourceStatus.textContent = `正在切换到 ${target}…`;
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch: target }),
    });
    await loadRepository(data, { preserveFile: true, stashNotice: false });
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

async function syncRepositoryFromRemote() {
  if (!state.repository || state.busy) return;
  state.busy = true;
  elements.syncButton.textContent = '更新中…';
  renderBranches();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/sync`, { method: 'POST' });
    await loadRepository(data, { preserveFile: true, stashNotice: false });
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

function renderLspState() {
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
  if (state.lsp.initialized || (!state.lsp.available && state.lsp.detail)) {
    clearTimeout(state.lspTimer);
    state.lspTimer = null;
  }
}

function scheduleLspPolling() {
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

function renderEditorEnvDialog() {
  const env = state.editorEnv;
  const detected = elements.editorEnvDetected;
  detected.replaceChildren();
  const row = (label, value) => {
    const line = document.createElement('div');
    line.className = 'editor-env-row';
    const name = document.createElement('span');
    name.className = 'editor-env-row-label';
    name.textContent = label;
    const text = document.createElement('span');
    text.className = 'editor-env-row-value';
    text.textContent = value;
    line.append(name, text);
    return line;
  };
  const describe = (label, info) => {
    if (!info) return row(label, '检测中…');
    if (!info.available) return row(label, '未检测到');
    const managers = info.managers?.length ? `（${info.managers.join('、')}）` : '';
    return row(label, `${info.version || '已安装'} · 配置${info.hasConfig ? '有' : '无'} · 插件 ${info.pluginCount} 个${managers}`);
  };
  detected.append(describe('neovim', env?.nvim), describe('vim', env?.vim));
  const activeText = env?.available
    ? `${env.active.program === 'custom' ? `自定义命令 ${env.active.command}` : env.active.program}${env.active.appName ? `（配置名 ${env.active.appName}）` : ''}`
    : '内置编辑器（未关联本地 vim/neovim）';
  detected.append(row('当前编辑器', activeText));
  const font = state.editorProfile?.available ? state.editorProfile.font : null;
  if (font?.family) {
    const size = font.points ? ` · ${font.points}pt` : '';
    const px = font.sizePx ? ` → ${font.sizePx}px` : '';
    detected.append(row('同步字体', `${font.family}${size}${px}`));
  }
  const program = env?.saved?.program || 'auto';
  for (const radio of document.querySelectorAll('input[name="editor-env-program"]')) radio.checked = radio.value === program;
  elements.editorEnvCommand.value = env?.saved?.command || '';
  elements.editorEnvAppName.value = env?.saved?.appName || '';
  elements.editorEnvCommand.disabled = program !== 'custom';
  elements.editorEnvError.textContent = '';
}

function applyEditorAvailability() {
  const available = Boolean(state.editorEnv?.available);
  elements.tabNvim.disabled = !available;
  elements.tabNvim.title = available
    ? '在浏览器内运行本地 vim/neovim（真实插件与键位）· Ctrl+Alt+2'
    : '未检测到本地 vim/neovim：使用内置编辑器（点左下角「编辑器环境」关联）';
  elements.editorTabsHint.textContent = available
    ? 'vim/neovim 为真实本地进程：:w 会写盘，插件与 LSP 使用你的本地配置'
    : '未检测到本地 vim/neovim，使用内置编辑器 · 可在左下角「编辑器环境」关联';
  if (!available && state.editorMode === 'nvim') closeNvim();
}

async function loadEditorEnv({ openDialog = false } = {}) {
  try {
    state.editorEnv = await api('/api/editor');
  } catch (error) {
    state.editorEnv = null;
    if (openDialog) elements.editorEnvError.textContent = `检测失败：${error.message}`;
  }
  applyEditorAvailability();
  if (openDialog) renderEditorEnvDialog();
  return state.editorEnv;
}

function displayKeymapKey(lhs, leader) {
  let value = String(lhs || '');
  if (leader && value.startsWith(leader)) {
    value = `${leader === ' ' ? '<Space>' : '<Leader>'}${value.slice(leader.length)}`;
  }
  if (!value) return '<空>';
  return value;
}

function normalKeymaps(profile) {
  return (profile?.keymaps || []).filter((map) => map.mode === 'n' && map.desc && !map.lhs.startsWith('<'));
}

// 状态栏只放“本地配置里真实存在”的映射：优先 leader 映射，其次普通模式描述映射。
function renderNvimShortcuts() {
  const profile = state.editorProfile;
  if (!profile?.available) {
    elements.nvimNote.textContent = profile?.error
      ? `本地配置不可用：${profile.error}`
      : '未关联本地 vim/neovim；快捷键以内置编辑器为准';
    elements.nvimNote.title = '';
    return;
  }
  const maps = normalKeymaps(profile);
  const leader = profile.leader || '';
  const leaderMaps = leader ? maps.filter((map) => map.lhs.startsWith(leader)) : [];
  const chosen = (leaderMaps.length ? leaderMaps : maps).slice(0, 5);
  const parts = chosen.map((map) => `${displayKeymapKey(map.lhs, leader)} ${map.desc}`);
  const remaining = maps.length - chosen.length;
  elements.nvimNote.textContent = `本地 ${profile.editor.program} · ${profile.colorscheme} · ${parts.join(' · ')}${remaining > 0 ? ` · +${remaining}` : ''}`;
  elements.nvimNote.title = maps
    .map((map) => `${displayKeymapKey(map.lhs, leader)}  ${map.desc}`)
    .join('\n');
}

function renderNvimKeymaps() {
  const profile = state.editorProfile;
  elements.nvimKeymapBody.replaceChildren();
  if (!profile?.available) {
    elements.nvimKeymapSubtitle.textContent = profile?.error || '未读取到本地 vim/neovim 配置。';
    const empty = document.createElement('div');
    empty.className = 'nvim-keymap-empty';
    empty.textContent = '请先在左下角「编辑器环境」关联本地 vim/neovim。';
    elements.nvimKeymapBody.append(empty);
    return;
  }
  const leader = profile.leader || '';
  elements.nvimKeymapSubtitle.textContent = `来源：${profile.editor.program} ${profile.editor.version || ''} · colorscheme ${profile.colorscheme} · leader ${leader === ' ' ? '<Space>' : (leader || '未设置')}`;
  const labels = { n: '普通模式', v: '可视模式', x: '可视模式（选择）', i: '插入模式', o: '操作符待决', t: '终端模式', c: '命令行模式' };
  const byMode = new Map();
  for (const map of profile.keymaps || []) {
    if (!byMode.has(map.mode)) byMode.set(map.mode, []);
    byMode.get(map.mode).push(map);
  }
  let count = 0;
  for (const [mode, maps] of [...byMode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const group = document.createElement('section');
    group.className = 'nvim-keymap-group';
    const heading = document.createElement('h3');
    heading.textContent = `${labels[mode] || mode}（${mode}）`;
    group.append(heading);
    for (const map of maps) {
      const row = document.createElement('div');
      row.className = 'nvim-keymap-row';
      const key = document.createElement('kbd');
      key.textContent = displayKeymapKey(map.lhs, leader);
      const desc = document.createElement('span');
      desc.className = 'nvim-keymap-desc';
      desc.textContent = map.desc || map.rhs || '';
      const modeTag = document.createElement('span');
      modeTag.className = 'nvim-keymap-mode';
      modeTag.textContent = map.mode;
      row.append(key, desc, modeTag);
      group.append(row);
      count += 1;
    }
    elements.nvimKeymapBody.append(group);
  }
  if (!count) {
    const empty = document.createElement('div');
    empty.className = 'nvim-keymap-empty';
    empty.textContent = '本地配置没有返回可显示的按键映射。';
    elements.nvimKeymapBody.append(empty);
  }
}

async function loadEditorProfile({ refresh = false } = {}) {
  try {
    state.editorProfile = await api(`/api/editor/profile${refresh ? '?refresh=1' : ''}`);
  } catch (error) {
    state.editorProfile = { available: false, error: error.message };
  }
  const profile = state.editorProfile;
  if (profile?.available) {
    if (!state.themeExplicit && state.theme !== 'local') state.theme = 'local';
    editor.setProfile(profile);
    applyEditorFont(profile.font);
    const palette = editor.setTheme(state.theme);
    applyShellTheme(palette);
    window.CodeReaderTerminal?.setTheme(profile);
  } else {
    editor.setProfile(null);
    applyEditorFont(null);
    if (state.theme === 'local') {
      state.theme = 'one-dark';
      applyShellTheme(editor.setTheme(state.theme));
    }
  }
  populateThemes();
  renderNvimShortcuts();
  return profile;
}

function setEditorMode(mode) {
  const nvim = mode === 'nvim';
  if (nvim && !state.editorEnv?.available) {
    elements.sourceStatus.textContent = '未关联本地 vim/neovim，继续使用内置编辑器';
    return;
  }
  if (nvim && !state.repository) {
    elements.sourceStatus.textContent = '先打开一个仓库再使用 nvim';
    return;
  }
  state.editorMode = nvim ? 'nvim' : 'editor';
  elements.tabEditor.classList.toggle('active', !nvim);
  elements.tabEditor.setAttribute('aria-selected', String(!nvim));
  elements.tabNvim.classList.toggle('active', nvim);
  elements.tabNvim.setAttribute('aria-selected', String(nvim));
  elements.nvimHost.hidden = !nvim;
  elements.codeArea.classList.toggle('mode-nvim', nvim);
  if (!nvim) {
    editor?.focus();
    return;
  }
  // nvim 终端优先占满代码区：切到 nvim 时收起两侧覆盖面板。
  window.__crPanels?.hideAll();
  const file = state.currentFile;
  const line = file ? editor.getCursor().line : 1;
  window.CodeReaderTerminal?.open({ repositoryId: state.repository.id, file, line });
}

function closeNvim() {
  window.CodeReaderTerminal?.close();
  setEditorMode('editor');
}

function restartNvim() {
  if (!state.repository) return;
  window.CodeReaderTerminal?.close();
  setEditorMode('nvim');
}

function openCurrentInNvim() {
  if (!state.repository) return;
  if (!state.currentFile) {
    elements.sourceStatus.textContent = '先在代码树选择一个文件';
    return;
  }
  if (state.editorMode !== 'nvim') {
    setEditorMode('nvim');
    return;
  }
  window.CodeReaderTerminal?.openFile(state.currentFile, editor.getCursor().line);
}

function applyRepositoryPayload(data, { collapsed = null, branches = [], prepared = null } = {}) {
  state.repository = data.repository;
  state.files = data.files;
  state.filesLower = prepared?.filesLower || data.files.map((filePath) => filePath.toLowerCase());
  state.fileSet = prepared?.fileSet || new Set(data.files);
  state.status = data.status || {};
  state.tree = prepared?.tree || buildTree(data.files);
  const storedCollapsed = collapsed || restoreCollapsed();
  state.collapsed = storedCollapsed || new Set();
  if (!storedCollapsed) {
    const collectDirectories = (node) => {
      for (const child of node.children) {
        if (!child.directory) continue;
        state.collapsed.add(child.path);
        collectDirectories(child);
      }
    };
    collectDirectories(state.tree);
  }
  state.branches = branches;
  state.currentFile = null;
  state.source = null;
  state.activeLine = null;
  state.history = null;
  state.explanation = null;
  state.historyCache.clear();
  state.commitDetail = null;
  state.faqEntries = [];
  state.faqKey = null;
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  closeQuestion();
  elements.treeFilter.value = '';
  renderRepository();
  renderTree();
  renderSource();
  renderHistory();
  renderExplanation();
  renderFaq();
  scheduleLspPolling();
}

async function loadRepository(data, { preserveFile = false, stashNotice = true } = {}) {
  const previousFile = preserveFile ? state.currentFile : null;
  // 打开/切换仓库前先保存当前仓库的阅读位置，供工作区页签切回。
  captureSession();
  closeNvim();
  closeCommitOverlay();
  const entryKey = data.workspace?.entryKey || state.sessionKey || repositoryKey(data.repository);
  state.sessionKey = entryKey;
  if (data.workspace) {
    state.workspace = {
      entries: data.workspace.entries || [],
      activeKey: data.workspace.activeKey || entryKey,
    };
    renderWorkspaceTabs();
  }
  const prepared = preparePayload(data);
  applyRepositoryPayload(data, { prepared });
  await loadBranches();
  if (previousFile && state.files.includes(previousFile)) {
    await selectFile(previousFile);
  }
  if (stashNotice) await refreshStashNotice();
  // 建树/小写表只做一次：当前仓库的会话缓存直接复用，切走再切回无需重建。
  storeSession(entryKey, data, prepared);
}

async function openRepository(event) {
  event.preventDefault();
  if (state.opening) return;
  const local = state.openMode === 'local';
  const value = (local ? elements.localPath : elements.remoteUrl).value.trim();
  if (!value) {
    elements.openError.textContent = local ? '请输入本地仓库路径' : '请输入远程仓库地址';
    return;
  }
  state.opening = true;
  elements.openSubmit.disabled = true;
  elements.dialogClose.disabled = true;
  elements.openError.textContent = '';
  elements.openProgress.textContent = local ? '正在读取仓库…' : '正在克隆仓库，大型仓库可能需要数分钟…';
  try {
    const data = await api(local ? '/api/repositories/open-local' : '/api/repositories/open-remote', {
      method: 'POST',
      body: JSON.stringify(local ? { path: value } : { url: value }),
    });
    await loadRepository(data);
    elements.openDialog.close();
  } catch (error) {
    elements.openError.textContent = error.message;
  } finally {
    state.opening = false;
    elements.openSubmit.disabled = false;
    elements.dialogClose.disabled = false;
    elements.openProgress.textContent = '';
  }
}

function renderSource() {
  state.historyController?.abort();
  elements.questionEditor.hidden = true;
  state.questionOpen = false;
  const hasSource = Boolean(state.source);
  elements.codeEmpty.hidden = hasSource;
  if (hasSource) {
    editor.show();
    editor.openFile(state.currentFile, state.source.content);
  } else {
    editor.hide();
  }
  elements.currentFile.textContent = state.currentFile || '尚未选择文件';
  elements.sourceStatus.textContent = hasSource
    ? `${state.source.lines} 行 · ${state.source.path}`
    : '';
}

async function selectFile(filePath, reveal = null) {
  if (!state.repository || (state.currentFile === filePath && !reveal)) return;
  const switching = state.currentFile !== filePath;
  state.currentFile = filePath;
  if (switching) {
    state.source = null;
    state.activeLine = null;
    state.history = null;
    state.explanation = null;
    state.commitDetail = null;
    closeCommitOverlay();
    state.faqEntries = [];
    state.faqKey = null;
    closeQuestion();
    closeAnimation();
    renderTree();
    renderHistory();
    renderExplanation();
    renderFaq();
  }
  elements.currentFile.textContent = filePath;
  if (!switching) {
    if (reveal) editor.revealPosition(reveal.line, reveal.character);
    scheduleHistoryTouch();
    return;
  }
  elements.sourceStatus.textContent = '正在读取源码…';
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/file?path=${encodeURIComponent(filePath)}`);
    if (state.currentFile !== filePath) return;
    state.source = data;
    renderSource();
    if (reveal) editor.revealPosition(reveal.line, reveal.character);
    const line = reveal?.line || 1;
    state.activeLine = line;
    pushReadingTrail({ path: filePath, line });
    fetchFunctionHistory(line);
    fetchFaq(line);
    scheduleHistoryTouch();
  } catch (error) {
    if (state.currentFile !== filePath) return;
    editor.hide();
    elements.codeEmpty.hidden = false;
    elements.codeEmpty.querySelector('h1').textContent = '无法读取文件';
    elements.codeEmpty.querySelector('p').textContent = error.message;
    elements.sourceStatus.textContent = '读取失败';
  }
}

// 光标移动时只有跨出当前函数范围才重新查询；函数内部移动保持现有面板内容，
// 避免内核大仓上每次 j/k 都触发 blame 请求与面板闪烁。
function historyCoversLine(history, filePath, line) {
  return Boolean(history)
    && history.status === 'done'
    && history.path === filePath
    && Number.isInteger(history.lineStart)
    && Number.isInteger(history.lineEnd)
    && line >= history.lineStart
    && line <= history.lineEnd
    && (!history.head || !state.repository?.head || history.head === state.repository.head);
}

// 缓存按服务端返回的函数区间命中：同一函数内不同行共用一条历史。
function cachedFunctionHistory(filePath, line) {
  if (!state.repository) return null;
  const prefix = `${state.repository.head}:`;
  const key = `${prefix}${filePath}:${line}`;
  if (state.historyCache.has(key)) return state.historyCache.get(key);
  for (const [cacheKey, value] of state.historyCache) {
    if (!cacheKey.startsWith(prefix)) continue;
    if (value.path === filePath && line >= value.lineStart && line <= value.lineEnd) return value;
  }
  return null;
}

async function fetchFunctionHistory(line) {
  if (!state.repository || state.currentFile === null || state.activeLine !== line) return;
  const filePath = state.currentFile;
  if (historyCoversLine(state.history, filePath, line)) return;
  const cached = cachedFunctionHistory(filePath, line);
  if (cached) {
    state.history = { path: filePath, line, status: 'done', ...cached };
    renderHistory();
    return;
  }
  state.historyController?.abort();
  const key = `${state.repository.head}:${filePath}:${line}`;
  const controller = new AbortController();
  state.historyController = controller;
  state.history = { path: filePath, line, status: 'loading', commits: [] };
  renderHistory();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/function-history?path=${encodeURIComponent(filePath)}&line=${line}`, { signal: controller.signal });
    if (state.activeLine !== line || state.currentFile !== filePath) return;
    state.historyCache.set(key, data);
    state.history = { path: filePath, line, status: 'done', ...data };
    renderHistory();
  } catch (error) {
    if (error.name === 'AbortError' || state.activeLine !== line || state.currentFile !== filePath) return;
    state.history = { path: filePath, line, status: 'error', message: error.message, commits: [] };
    renderHistory();
  }
}

let commitOverlayReturnFocus = null;
let commitOverlayReturnHash = null;

// 提交详情打开/关闭都会重渲染函数历史列表：原按钮节点可能已被替换，
// 回收焦点时按提交哈希找到同一行（找不到再退回 body）。
function restoreCommitFocus() {
  const target = commitOverlayReturnFocus;
  const hash = commitOverlayReturnHash;
  commitOverlayReturnFocus = null;
  commitOverlayReturnHash = null;
  // 打开时下方分析栏可能被收起（inert）导致焦点先落到 body；body 不能作为
  // 恢复目标，必须走哈希回退找回同一提交行。
  if (target?.isConnected && target !== document.body) {
    window.__crPanels?.show('insights');
    target.focus({ preventScroll: true });
    return;
  }
  if (!hash) return;
  // 打开提交详情时分析栏被收起并设为 inert；恢复焦点前先展开，否则 inert
  // 会阻止程序化聚焦（focus 静默失败）。
  window.__crPanels?.show('insights');
  const header = [...elements.historyContent.querySelectorAll('.commit-header')]
    .find((node) => node.querySelector('.commit-hash')?.textContent === hash);
  header?.focus({ preventScroll: true });
}

function closeCommitOverlay() {
  state.commitDetail = null;
  elements.commitOverlay.hidden = true;
  elements.commitOverlayBody.replaceChildren();
  restoreCommitFocus();
}

function renderCommitOverlay() {
  const detail = state.commitDetail;
  if (!detail) {
    const wasOpen = !elements.commitOverlay.hidden;
    elements.commitOverlay.hidden = true;
    elements.commitOverlayBody.replaceChildren();
    if (wasOpen) restoreCommitFocus();
    return;
  }
  const opening = elements.commitOverlay.hidden;
  elements.commitOverlay.hidden = false;
  const commit = (state.history?.commits || []).find((entry) => entry.hash === detail.hash);
  elements.commitOverlayTitle.textContent = detail.status === 'done'
    ? `${detail.data.short || detail.hash} · ${detail.data.message.split('\n')[0]}`
    : (commit ? `${commit.hash} · ${commit.subject}` : `提交 ${detail.hash}`);
  elements.commitOverlayBody.replaceChildren(renderCommitDetail(detail));
  if (opening) {
    commitOverlayReturnFocus = document.activeElement;
    commitOverlayReturnHash = detail.hash;
    // 覆盖层不是原生 dialog：打开时主动聚焦关闭按钮，Tab 在面板内循环。
    setTimeout(() => elements.commitOverlayClose.focus({ preventScroll: true }), 0);
  }
}

elements.commitOverlay.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  // summary 是原生可聚焦元素（Enter/Space 展开 Diff）；漏掉它会把 Tab 困在
  // 关闭按钮上，键盘用户无法打开 diff。
  const focusable = [...elements.commitOverlay.querySelectorAll('button, a[href], summary, input, select, textarea, [tabindex="0"], [data-nav]')]
    .filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

async function showCommit(hash) {
  if (!state.repository) return;
  window.__crPanels?.hide('insights');
  if (state.commitCache.has(hash)) {
    state.commitDetail = { hash, status: 'done', data: state.commitCache.get(hash) };
    renderCommitOverlay();
    renderHistory();
    return;
  }
  state.commitDetail = { hash, status: 'loading' };
  renderCommitOverlay();
  renderHistory();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/commit?hash=${encodeURIComponent(hash)}`);
    state.commitCache.set(hash, data);
    if (state.commitDetail?.hash === hash) {
      state.commitDetail = { hash, status: 'done', data };
      renderCommitOverlay();
      renderHistory();
    }
  } catch (error) {
    if (state.commitDetail?.hash === hash) {
      state.commitDetail = { hash, status: 'error', message: error.message };
      renderCommitOverlay();
      renderHistory();
    }
  }
}

function renderDiff(diff) {
  const pre = document.createElement('pre');
  pre.className = 'commit-diff';
  const lines = String(diff || '').split('\n');
  const limit = Math.min(lines.length, 3000);
  for (let index = 0; index < limit; index += 1) {
    const line = lines[index];
    const span = document.createElement('span');
    span.textContent = `${line}\n`;
    if (line.startsWith('@@')) span.className = 'diff-hunk';
    else if (line.startsWith('+') && !line.startsWith('+++')) span.className = 'diff-add';
    else if (line.startsWith('-') && !line.startsWith('---')) span.className = 'diff-del';
    pre.append(span);
  }
  if (lines.length > limit) {
    const note = document.createElement('div');
    note.className = 'field-help';
    note.textContent = `diff 过长，仅显示前 ${limit} 行（共 ${lines.length} 行）`;
    pre.append(note);
  }
  return pre;
}

function renderCommitDetail(detail) {
  const box = document.createElement('div');
  box.className = 'commit-detail';
  if (detail.status === 'loading') {
    box.textContent = '正在读取提交详情…';
    return box;
  }
  if (detail.status === 'error') {
    const error = document.createElement('div');
    error.className = 'error-card';
    error.textContent = detail.message;
    box.append(error);
    return box;
  }
  const data = detail.data;
  const identity = document.createElement('div');
  identity.className = 'faq-meta';
  identity.textContent = `提交 ${data.short || data.hash}（${data.hash}）`;
  const meta = document.createElement('div');
  meta.className = 'faq-meta';
  meta.textContent = `${data.author} <${data.email}> · ${new Date(data.date).toLocaleString()}`;
  const message = document.createElement('pre');
  message.className = 'commit-message';
  message.textContent = data.message;
  const files = document.createElement('ul');
  files.className = 'commit-files';
  for (const file of data.files.slice(0, 100)) {
    const item = document.createElement('li');
    item.textContent = `${file.path}  +${file.added} -${file.deleted}`;
    files.append(item);
  }
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = `Diff（${data.files.length} 个文件${data.truncated ? '，已截断' : ''}）`;
  details.append(summary, renderDiff(data.diff));
  box.append(identity, meta, message, files, details);
  return box;
}

async function fetchFaq(line) {
  if (!state.repository || !state.currentFile) {
    state.faqEntries = [];
    renderFaq();
    return;
  }
  const filePath = state.currentFile;
  state.faqController?.abort();
  const controller = new AbortController();
  state.faqController = controller;
  try {
    const data = await api(
      `/api/repositories/${encodeURIComponent(state.repository.id)}/faq?path=${encodeURIComponent(filePath)}&line=${line}`,
      { signal: controller.signal },
    );
    if (state.currentFile !== filePath || controller.signal.aborted) return;
    state.faqEntries = data.entries || [];
    state.faqKey = `${filePath}:${line}`;
  } catch (error) {
    if (error.name === 'AbortError' || state.currentFile !== filePath) return;
    state.faqEntries = [];
  }
  renderFaq();
}

function renderFaq() {
  const entries = state.faqEntries || [];
  if (!entries.length || !state.currentFile) {
    elements.faqSection.hidden = true;
    elements.faqContent.replaceChildren();
    elements.faqAnchor.textContent = '';
    return;
  }
  const first = entries[0];
  elements.faqSection.hidden = false;
  elements.faqAnchor.textContent = `${first.file}:${first.lineStart}-${first.lineEnd}${first.symbol ? ` · ${first.symbol}` : ''}`;
  elements.faqContent.replaceChildren();
  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'faq-card';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'faq-question faq-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    const questionText = document.createElement('span');
    questionText.className = 'faq-question-text';
    questionText.textContent = entry.question;
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'faq-toggle-icon';
    toggleIcon.textContent = '▸';
    toggle.append(questionText, toggleIcon);
    const body = document.createElement('div');
    body.className = 'faq-body';
    body.hidden = true;
    const overview = document.createElement('p');
    overview.textContent = entry.overview;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '展开逐点分析与总结';
    const list = document.createElement('ol');
    list.className = 'detail-list';
    for (const detail of entry.details || []) {
      const item = document.createElement('li');
      item.textContent = detail;
      list.append(item);
    }
    const summaryText = document.createElement('p');
    summaryText.textContent = entry.summary;
    details.append(summary, list, summaryText);
    const meta = document.createElement('div');
    meta.className = 'faq-meta';
    const symbol = document.createElement('span');
    symbol.textContent = `${entry.kind || 'range'} · ${entry.symbol || '未命名段'}`;
    const head = document.createElement('span');
    head.textContent = `HEAD ${entry.head || '—'}`;
    const time = document.createElement('span');
    time.textContent = relativeTime(entry.updatedAt);
    meta.append(symbol, head, time);
    if (entry.stale) {
      const badge = document.createElement('span');
      badge.className = 'faq-stale';
      badge.textContent = `已过期${entry.staleReason ? `：${entry.staleReason}` : ''}`;
      meta.append(badge);
    }
    const actions = document.createElement('div');
    actions.className = 'faq-actions';
    if (entry.stale) {
      const reask = document.createElement('button');
      reask.type = 'button';
      reask.className = 'faq-reask';
      reask.textContent = '按当前代码重问';
      reask.addEventListener('click', () => {
        openQuestion();
        elements.questionInput.value = entry.question;
        elements.questionInput.focus();
      });
      actions.append(reask);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'faq-delete';
    remove.textContent = '删除此 FAQ';
    remove.addEventListener('click', async () => {
      try {
        await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/faq/delete`, {
          method: 'POST',
          body: JSON.stringify({ id: entry.id }),
        });
        fetchFaq(state.activeLine || entry.line);
      } catch (error) {
        showNotice(`删除 FAQ 失败：${error.message}`, { error: true });
      }
    });
    actions.append(remove);
    toggle.addEventListener('click', () => {
      const expanded = body.hidden;
      body.hidden = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggleIcon.textContent = expanded ? '▾' : '▸';
    });
    body.append(overview, details);
    body.append(meta, actions);
    card.append(toggle, body);
    elements.faqContent.append(card);
  }
}

function renderHistory() {
  const history = state.history;
  elements.historyContent.replaceChildren();
  if (!history) {
    elements.historyAnchor.textContent = '当前函数';
    elements.historyContent.className = 'insight-content empty-insight';
    elements.historyContent.textContent = '移动光标查看当前函数的最近提交';
    return;
  }
  elements.historyContent.className = 'insight-content';
  const range = history.lineStart && history.lineEnd ? `${history.lineStart}-${history.lineEnd}` : history.line;
  elements.historyAnchor.textContent = `${history.path}:${range}${history.symbol ? ` · ${history.symbol}` : ''}`;
  if (history.status === 'loading') {
    elements.historyContent.className = 'insight-content empty-insight loading';
    elements.historyContent.textContent = history.deep
      ? '正在执行 git log -L 追踪函数演变（大仓库可能需要较长时间）…'
      : '正在查询函数级 Git 历史…';
    return;
  }
  if (history.status === 'error') {
    const error = document.createElement('div');
    error.className = 'error-card';
    error.textContent = history.message;
    elements.historyContent.append(error);
    return;
  }
  if (history.commits.length === 0) {
    elements.historyContent.className = 'insight-content empty-insight';
    elements.historyContent.textContent = '该函数没有提交历史';
    return;
  }
  const list = document.createElement('div');
  list.className = 'commit-list';
  for (const commit of history.commits) {
    const item = document.createElement('div');
    item.className = 'commit';
    const detail = state.commitDetail && state.commitDetail.hash === commit.hash ? state.commitDetail : null;
    if (detail) item.classList.add('active');
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'commit-header';
    const hash = document.createElement('span');
    hash.className = 'commit-hash';
    hash.textContent = commit.hash;
    const subject = document.createElement('span');
    subject.className = 'commit-subject';
    subject.textContent = ` ${commit.subject}`;
    header.append(hash, subject);
    header.addEventListener('click', () => showCommit(commit.hash));
    item.append(header);
    list.append(item);
  }
  elements.historyContent.append(list);
  const actions = document.createElement('div');
  actions.className = 'history-actions';
  if (history.mode === 'evolution') {
    const mode = document.createElement('span');
    mode.className = 'history-mode';
    mode.textContent = '深层演变模式（git log -L 跨提交追踪函数体）';
    actions.append(mode);
  } else {
    const deep = document.createElement('button');
    deep.type = 'button';
    deep.className = 'button small';
    deep.textContent = '深层演变（git log -L，较慢）';
    deep.title = '追踪函数体在历次提交中的修改，而不是当前代码行的最新改动';
    deep.addEventListener('click', () => fetchFunctionHistoryDeep(state.activeLine || history.line));
    actions.append(deep);
  }
  elements.historyContent.append(actions);
}

// renderHistory 会重建整个列表：点「深层演变」后历史区立即切成加载态，
// 原按钮节点被移除会把焦点丢到 body；加载完成再次渲染时同样要收回来。
function focusHistoryPanel() {
  const target = elements.historyContent.querySelector('.history-actions .button') || elements.historyContent;
  // 加载态没有按钮可聚焦：让历史内容容器临时可聚焦，j/k 仍可滚动它。
  if (target === elements.historyContent) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

async function fetchFunctionHistoryDeep(line) {
  if (!state.repository || !state.currentFile || !Number.isInteger(line)) return;
  const filePath = state.currentFile;
  state.historyController?.abort();
  const controller = new AbortController();
  state.historyController = controller;
  const keepFocus = elements.historyContent.contains(document.activeElement);
  // 渲染后只在“焦点原本在历史区、且没有被用户移到别处”时补聚焦，
  // 避免异步返回时把正在编辑的焦点抢回来。
  const restoreFocus = () => {
    if (!keepFocus) return;
    const active = document.activeElement;
    if (active !== document.body && !elements.historyContent.contains(active)) return;
    focusHistoryPanel();
  };
  state.history = { path: filePath, line, status: 'loading', deep: true, commits: [] };
  renderHistory();
  restoreFocus();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/function-history?path=${encodeURIComponent(filePath)}&line=${encodeURIComponent(line)}&deep=1`, { signal: controller.signal });
    if (state.currentFile !== filePath || controller.signal.aborted) return;
    state.history = { path: filePath, line, status: 'done', ...data };
    renderHistory();
    restoreFocus();
  } catch (error) {
    if (error.name === 'AbortError' || state.currentFile !== filePath) return;
    state.history = { path: filePath, line, status: 'error', message: error.message, commits: [] };
    renderHistory();
    restoreFocus();
  }
}

function openQuestion() {
  if (!state.source || state.explaining) return;
  window.__crPanels?.hideAll();
  const line = editor.getCursor().line;
  state.activeLine = line;
  state.questionOpen = true;
  elements.questionEditor.hidden = false;
  elements.questionAnchor.textContent = `${state.currentFile}:${line}`;
  elements.questionError.textContent = '';
  elements.questionInput.disabled = false;
  elements.questionSubmit.disabled = false;
  elements.questionSubmit.textContent = '确定';
  elements.questionInput.focus();
}

function closeQuestion() {
  state.questionOpen = false;
  state.explaining = false;
  elements.questionEditor.hidden = true;
  elements.questionError.textContent = '';
  elements.questionInput.value = '';
  if (elements.questionAnimation) elements.questionAnimation.checked = false;
}

async function submitQuestion() {
  if (!state.questionOpen || state.explaining) return;
  const question = elements.questionInput.value.trim();
  if (!question) {
    elements.questionError.textContent = '请输入想问的问题';
    return;
  }
  const filePath = state.currentFile;
  const line = state.activeLine;
  const wantsAnimation = Boolean(elements.questionAnimation?.checked);
  state.explaining = true;
  elements.questionInput.disabled = true;
  elements.questionSubmit.disabled = true;
  elements.questionCancel.disabled = true;
  elements.questionSubmit.textContent = wantsAnimation ? '正在生成文字与 3D 动画…' : '正在解释…';
  elements.questionError.textContent = '';
  state.explanation = { status: 'loading', path: filePath, line, animationRequested: wantsAnimation };
  renderExplanation();
  // 回答返回时，如果用户这段时间没有主动把焦点移到别处，就打开解释窗口并
  // 把焦点交给内容区——答案一到即可 j/k 阅读。用户切去别处则不抢焦点。
  let focusMoved = false;
  const markFocusMoved = () => { focusMoved = true; };
  document.addEventListener('focusin', markFocusMoved, true);
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/explain`, {
      method: 'POST',
      body: JSON.stringify({ path: filePath, line, question, animate: wantsAnimation }),
    });
    state.explanation = { status: 'done', path: filePath, line, ...data };
    closeQuestion();
    fetchFaq(line);
  } catch (error) {
    state.explanation = { status: 'error', path: filePath, line, message: error.message, details: error.details };
    elements.questionError.textContent = error.message;
  } finally {
    document.removeEventListener('focusin', markFocusMoved, true);
    state.explaining = false;
    elements.questionInput.disabled = false;
    elements.questionSubmit.disabled = false;
    elements.questionCancel.disabled = false;
    elements.questionSubmit.textContent = '确定';
    renderExplanation();
    if (!focusMoved && state.explanation && state.explanation.status !== 'loading') {
      window.__crPanels?.pin('insights');
      setTimeout(focusExplanationPanel, 0);
    }
  }
}

function appendHeading(parent, text) {
  const heading = document.createElement('h3');
  heading.textContent = text;
  parent.append(heading);
}

function appendDiagnostic(parent, title, value) {
  if (value === undefined || value === null || value === '') return;
  const details = document.createElement('details');
  details.className = 'error-details';
  const summary = document.createElement('summary');
  summary.textContent = title;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'copy-detail';
  copy.textContent = '复制原文';
  const pre = document.createElement('pre');
  pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(pre.textContent).catch(() => {});
  });
  details.append(summary, copy, pre);
  parent.append(details);
}

function appendDiagnostics(container, details) {
  if (!details || typeof details !== 'object') return;
  if (details.request) {
    appendDiagnostic(
      container,
      '网页端发送的请求内容',
      `POST ${details.request.url}\n协议：${details.request.protocol} · 模型：${details.request.model}\n\n${details.request.body}`,
    );
  }
  if (details.response) {
    appendDiagnostic(container, 'LLM 返回的完整内容', `HTTP ${details.response.status}\n\n${details.response.body}`);
  }
  if (details.output) appendDiagnostic(container, '模型输出（解析失败原文）', details.output);
  if (details.retry) {
    appendDiagnostic(
      container,
      '重试请求与返回',
      `POST ${details.retry.request?.url || ''}\n\n${details.retry.response ? `HTTP ${details.retry.response.status}\n\n${details.retry.response.body}` : ''}`,
    );
  }
  if (details.error) appendDiagnostic(container, '网络错误', details.error);
}

function renderSources(card, sources) {
  if (!sources) return;
  const local = Array.isArray(sources.local) ? sources.local : [];
  const web = Array.isArray(sources.web) ? sources.web : [];
  if (!local.length && !web.length && !sources.webError && !sources.searchedFiles) return;
  const box = document.createElement('div');
  box.className = 'sources';
  const heading = document.createElement('h3');
  heading.textContent = '参考来源';
  box.append(heading);
  if (local.length) {
    const list = document.createElement('ul');
    for (const hit of local) {
      const item = document.createElement('li');
      const location = [hit.section, hit.page ? `第 ${hit.page} 页` : ''].filter(Boolean).join(' · ');
      item.textContent = `本地文档：${hit.source}${location ? `（${location}）` : ''}（相关度 ${hit.score}）`;
      list.append(item);
    }
    box.append(list);
  }
  if (web.length) {
    const list = document.createElement('ul');
    for (const hit of web) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = hit.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.nav = 'source';
      link.textContent = hit.title || hit.url;
      const engine = hit.engine === 'google' ? 'Google' : hit.engine === 'bing' ? 'Bing' : '网络';
      item.append(document.createTextNode(`网络（未核验 · ${engine}）：`), link);
      list.append(item);
    }
    box.append(list);
  }
  if (sources.webError) {
    const note = document.createElement('p');
    note.textContent = `网络检索：${sources.webError}`;
    box.append(note);
  }
  if (sources.searchedFiles) {
    const note = document.createElement('p');
    note.textContent = `本地文档检索范围：${sources.searchedFiles} 个文件`;
    box.append(note);
  }
  card.append(box);
}

function renderExplanation() {
  const explanation = state.explanation;
  elements.explanationContent.replaceChildren();
  if (!explanation) {
    elements.explanationAnchor.textContent = '';
    elements.explanationContent.className = 'insight-content empty-insight';
    elements.explanationContent.textContent = '在任意源码行按 \\c（Vim 模式）或 c（编辑器未聚焦时），输入问题并点击“确定”。';
    return;
  }
  elements.explanationAnchor.textContent = `${explanation.path}:${explanation.line}`;
  if (explanation.status === 'loading') {
    elements.explanationContent.className = 'insight-content empty-insight loading';
    elements.explanationContent.textContent = explanation.animationRequested
      ? 'LLM 正在结合源码与规范生成文字解释和 3D 动画…'
      : 'LLM 正在结合源码分析问题…';
    return;
  }
  if (explanation.status === 'error') {
    elements.explanationContent.className = 'insight-content';
    const error = document.createElement('div');
    error.className = 'error-card';
    error.textContent = explanation.message;
    appendDiagnostics(error, explanation.details);
    elements.explanationContent.append(error);
    return;
  }

  elements.explanationContent.className = 'insight-content';
  const card = document.createElement('article');
  card.className = 'explanation-card';
  appendHeading(card, '概述');
  const overview = document.createElement('p');
  overview.textContent = explanation.explanation.overview;
  card.append(overview);
  appendHeading(card, '逐点分析');
  const details = document.createElement('ol');
  details.className = 'detail-list';
  for (const detail of explanation.explanation.details) {
    const item = document.createElement('li');
    item.textContent = detail;
    details.append(item);
  }
  card.append(details);
  if (explanation.explanation.evidence?.length) {
    appendHeading(card, '证据');
    const kindLabels = { code: '代码', documentation: '文档', inference: '推断' };
    for (const item of explanation.explanation.evidence) {
      const evidenceCard = document.createElement('div');
      evidenceCard.className = `evidence-card evidence-${item.kind}`;
      const head = document.createElement('div');
      head.className = 'evidence-head';
      const badge = document.createElement('span');
      badge.className = 'evidence-kind';
      badge.textContent = kindLabels[item.kind] || '推断';
      head.append(badge);
      if (item.kind === 'code' && item.file && item.lineStart && state.fileSet.has(item.file)) {
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'evidence-loc';
        jump.textContent = `${item.file}:${item.lineStart}${item.lineEnd && item.lineEnd !== item.lineStart ? `-${item.lineEnd}` : ''}`;
        jump.addEventListener('click', () => jumpTo({ path: item.file, line: item.lineStart, character: 0 }));
        head.append(jump);
      } else if (item.kind === 'documentation' && (item.source || item.section)) {
        const location = document.createElement('span');
        location.className = 'evidence-loc-static';
        location.textContent = [item.source, item.section, item.page ? `第 ${item.page} 页` : ''].filter(Boolean).join(' · ');
        head.append(location);
      }
      const claim = document.createElement('p');
      claim.textContent = item.claim;
      evidenceCard.append(head, claim);
      if (item.excerpt) {
        const excerpt = document.createElement('details');
        excerpt.className = 'evidence-excerpt';
        const excerptSummary = document.createElement('summary');
        excerptSummary.textContent = '查看原文摘录';
        const pre = document.createElement('pre');
        pre.textContent = item.excerpt;
        excerpt.append(excerptSummary, pre);
        evidenceCard.append(excerpt);
      }
      card.append(evidenceCard);
    }
  }
  if (explanation.explanation.specifications.length) {
    appendHeading(card, '硬件协议规范依据');
    for (const specification of explanation.explanation.specifications) {
      const spec = document.createElement('div');
      spec.className = 'spec-card';
      const title = document.createElement('div');
      title.className = 'spec-title';
      title.textContent = specification.name;
      const meta = document.createElement('div');
      meta.className = 'spec-meta';
      const location = [specification.source, specification.section, specification.page ? `第 ${specification.page} 页` : ''].filter(Boolean).join(' · ');
      meta.textContent = `版本：${specification.version || '未确认'} · ${location || `章节：${specification.section}`} · ${specification.verified ? '已在本地文档中核实' : '未核实'}`;
      const relevance = document.createElement('div');
      relevance.textContent = specification.relevance;
      spec.append(title, meta, relevance);
      card.append(spec);
    }
  }
  appendHeading(card, '总结');
  const summary = document.createElement('p');
  summary.textContent = explanation.explanation.summary;
  card.append(summary);
  if (explanation.explanation.nextSteps?.length) {
    appendHeading(card, '建议继续阅读');
    const nextList = document.createElement('div');
    nextList.className = 'next-steps';
    for (const step of explanation.explanation.nextSteps) {
      if (!state.fileSet.has(step.file)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'next-step';
      const location = document.createElement('span');
      location.className = 'next-step-loc';
      location.textContent = `${step.file}:${step.line}`;
      const reason = document.createElement('span');
      reason.className = 'next-step-reason';
      reason.textContent = step.reason;
      button.append(location, reason);
      button.addEventListener('click', () => jumpTo({ path: step.file, line: step.line, character: 0 }));
      nextList.append(button);
    }
    if (nextList.children.length) card.append(nextList);
  }
  if (explanation.explanation.animation) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'button primary animation-open';
    open.textContent = '查看 3D 动画演示';
    open.addEventListener('click', () => openAnimation(explanation.explanation.animation, open));
    card.append(open);
  }
  renderSources(card, explanation.sources);
  const note = document.createElement('p');
  note.className = 'model-note';
  note.textContent = `模型：${explanation.model}。内容由模型生成；涉及硬件规范时，请与官方规范原文复核。`;
  card.append(note);
  elements.explanationContent.append(card);
}

const QUESTION_PRESETS = [
  { label: '函数目的', text: '这个函数的目的是什么？请结合调用方说明它在整体流程中的角色。' },
  { label: '数据流', text: '梳理当前函数的数据流：输入从哪里来，经过哪些变换，输出到哪里。' },
  { label: '设计原因', text: '这段代码为什么这样设计？请结合 Git 历史和上下文解释取舍。' },
  { label: '规范依据', text: '这段代码遵循了哪些规范/协议要求？请给出具体章节依据。' },
  { label: '3D 动画', text: '请用 Three.js 3D 动画解释当前函数的执行步骤，以及代码如何按照规范执行。' },
];

function renderQuestionPresets() {
  elements.questionPresets.replaceChildren();
  for (const preset of QUESTION_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-chip';
    button.textContent = preset.label;
    button.title = preset.text;
    button.addEventListener('click', () => {
      elements.questionInput.value = preset.text;
      elements.questionInput.focus();
    });
    elements.questionPresets.append(button);
  }
}

function pushReadingTrail(location) {
  if (!location?.path) return;
  const entry = { path: location.path, line: location.line || 1 };
  const existing = state.readingTrail.findIndex((item) => item.path === entry.path && item.line === entry.line);
  if (existing >= 0) state.readingTrail.splice(existing, 1);
  state.readingTrail.push(entry);
  if (state.readingTrail.length > 8) state.readingTrail.shift();
  renderReadingTrail();
}

function renderReadingTrail() {
  const trail = state.readingTrail;
  elements.readingTrail.replaceChildren();
  elements.readingTrail.hidden = !trail.length;
  if (!trail.length) return;
  const label = document.createElement('span');
  label.className = 'trail-label';
  label.textContent = '阅读路径';
  elements.readingTrail.append(label);
  trail.forEach((location, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'trail-sep';
      separator.textContent = '→';
      elements.readingTrail.append(separator);
    }
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'trail-chip';
    if (location.path === state.currentFile && location.line === state.activeLine) chip.classList.add('current');
    chip.textContent = `${location.path.split('/').pop()}:${location.line}`;
    chip.title = `${location.path}:${location.line}`;
    chip.addEventListener('click', () => {
      jumpTo({ path: location.path, line: location.line, character: 0 });
    });
    elements.readingTrail.append(chip);
  });
}

function closeAnimationUrls() {
  if (!animationUrls) return;
  URL.revokeObjectURL(animationUrls.previewUrl);
  URL.revokeObjectURL(animationUrls.offlineUrl);
  animationUrls = null;
}

let animationReturnFocus = null;

function closeAnimation() {
  if (!state.animationOpen && !animationUrls) return;
  state.animationOpen = false;
  elements.animationOverlay.hidden = true;
  elements.animationFrame.src = 'about:blank';
  elements.animationDownload.removeAttribute('href');
  closeAnimationUrls();
  const target = animationReturnFocus;
  animationReturnFocus = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
}

async function openAnimation(animation, trigger = null) {
  if (!animation) return;
  if (!state.animationOpen) animationReturnFocus = trigger || document.activeElement;
  state.animationOpen = true;
  elements.animationOverlay.hidden = false;
  elements.animationFrame.src = 'about:blank';
  elements.animationDownload.removeAttribute('href');
  elements.animationClose.focus({ preventScroll: true });
  try {
    if (!state.animationRuntime) {
      const response = await fetch('/vendor/three/animation.bundle.js');
      if (!response.ok) throw new Error('动画运行时缺失，请先执行 npm run build:vendor');
      state.animationRuntime = await response.text();
    }
    closeAnimationUrls();
    const previewHtml = createAnimationHtml(animation, '', {
      runtimeUrl: new URL('/vendor/three/animation.bundle.js', window.location.origin).href,
    });
    const offlineHtml = createAnimationHtml(animation, state.animationRuntime);
    const previewUrl = URL.createObjectURL(new Blob([previewHtml], { type: 'text/html' }));
    const offlineUrl = URL.createObjectURL(new Blob([offlineHtml], { type: 'text/html' }));
    animationUrls = { previewUrl, offlineUrl };
    elements.animationFrame.src = previewUrl;
    elements.animationDownload.href = offlineUrl;
    elements.animationDownload.download = `${(animation.title || 'code-animation').replace(/[\\/:*?"<>|]/g, '_')}.html`;
  } catch (error) {
    closeAnimation();
    showNotice(`动画加载失败：${error.message}`, { error: true });
  }
}

// 解释窗口获得焦点后由通用 Vim 导航层（vim-nav.js）接管 j/k/gg/G：
// 焦点在内容容器上=阅读模式（逐行滚动），Tab/点击进入链接后=列表模式（项间移动）。
function focusExplanationPanel() {
  // 延迟聚焦可能晚于“打开 3D 动画/提交详情/对话框”：顶层弹层在场时不要抢焦点。
  if (state.animationOpen || !elements.animationOverlay.hidden) return;
  if (!elements.commitOverlay.hidden || document.querySelector('dialog[open]')) return;
  // 面板已被收起时不要再聚焦（聚焦会触发 focusin 把面板重新滑出来）。
  if (!document.getElementById('app').classList.contains('insights-visible')) return;
  elements.explanationContent.focus({ preventScroll: true });
}

// 两侧栏共用入口：键盘 Ctrl+Alt+B/I 与代码窗口上方的箭头按钮走同一条路径。
// 语义是「去这个窗口」而不是盲目开关：面板已打开但焦点不在里面时，把焦点送进去；
// 只有焦点已经在面板内时，再按一次才收起（否则用户在看代码时按 Ctrl+Alt+I
// 会把刚开着的解释窗口关掉，永远进不去）。
function toggleCodeTreePanel() {
  const app = document.getElementById('app');
  const visible = app.classList.contains('sidebar-visible');
  const focusInside = Boolean(document.activeElement?.closest?.('.sidebar'));
  if (visible && focusInside) {
    // 收起后焦点回代码窗；侧栏里的节点随即隐藏，不能再把焦点留在提示按钮上。
    treeFocusRequest += 1;
    window.__crPanels?.toggle('sidebar');
    if (editor) editor.focus();
    else elements.navTree?.focus({ preventScroll: true });
    return;
  }
  window.__crPanels?.pin('sidebar');
  requestTreeFocus();
}

// 页面刷新后文件树数据仍在异步恢复：第一次 Ctrl+Alt+B 时 focusTree() 可能
// 因为还没有行而失败（面板已滑出、焦点却留在编辑器）。这里在短时间内重试，
// 等树渲染出来后补聚焦；用户中途把焦点移到别处则放弃，避免抢焦点。
let treeFocusRequest = 0;

// 键盘导航跳到代码行时，焦点由编辑器接管：作废仍在跑的文件树补焦点重试，
// 否则它的观察窗会把焦点从编辑器抢回文件树（K 跳行后 j/k 仍作用在树上）。
function cancelTreeFocusRequest() {
  treeFocusRequest += 1;
}

function requestTreeFocus() {
  const app = document.getElementById('app');
  const token = ++treeFocusRequest;
  const origin = document.activeElement;
  const deadline = Date.now() + 4000;
  let focusedAt = 0;
  const treeHasFocus = () => {
    const active = document.activeElement;
    return Boolean(active && (active === elements.fileTree || elements.fileTree.contains(active)));
  };
  const attempt = () => {
    if (token !== treeFocusRequest) return;
    const active = document.activeElement;
    if (treeHasFocus()) {
      if (!focusedAt) focusedAt = Date.now();
      // 聚焦成功后留一个短暂观察窗：重载恢复流程可能在随后一帧把焦点设回
      // 编辑器，树重渲染也可能把焦点冲掉；这里以 activeElement 实况为准继续补。
      if (Date.now() - focusedAt < 700 && Date.now() < deadline) setTimeout(attempt, 120);
      return;
    }
    focusedAt = 0;
    // 顶层弹层在场时不要把焦点拽到背后的文件树（Ctrl+Alt+B 在对话框里也能按到）。
    if (document.querySelector('dialog[open]') || !elements.commitOverlay.hidden || !elements.animationOverlay.hidden) return;
    // 用户把焦点移到别处则放弃。重载恢复流程会把焦点设回编辑器（origin 可能
    // 还是 body），这属于恢复时序而不是用户操作，继续重试。
    if (active?.closest?.('.sidebar')) return;
    if (active !== origin && active !== document.body && active !== document.documentElement && !active?.closest?.('#editor-host')) return;
    // 重载恢复期面板 class 可能晚一帧才置位：未可见时也继续按 120ms 重试。
    if (!app.classList.contains('sidebar-visible')) {
      if (Date.now() < deadline) setTimeout(attempt, 120);
      return;
    }
    focusTree();
    // focusTree() 返回 true 不代表焦点真的留下（树重渲染/恢复流程都可能冲掉），
    // 下一次 attempt 以 activeElement 实况复核，不在树内就继续重试。
    if (Date.now() < deadline) setTimeout(attempt, 120);
  };
  attempt();
}

function toggleInsightsPanel() {
  const app = document.getElementById('app');
  const visible = app.classList.contains('insights-visible');
  const focusInside = Boolean(document.activeElement?.closest?.('.insights'));
  if (visible && focusInside) {
    // 焦点已在解释窗口里：再按一次收起，焦点回代码窗。
    window.__crPanels.toggle('insights');
    editor?.focus();
    return;
  }
  // 隐藏时打开；悬停/已打开时钉住；随后聚焦解释窗口以便 j/k 导航。
  window.__crPanels?.pin('insights');
  setTimeout(focusExplanationPanel, visible ? 0 : 200);
}

async function jumpTo(location, pushCurrent = true) {
  if (!state.repository || !location) return;
  if (pushCurrent && state.currentFile) {
    jumpStack.push({ path: state.currentFile, line: editor.getCursor().line, character: editor.getCursor().character });
    jumpForwardStack.length = 0;
  }
  if (location.path === state.currentFile) {
    editor.revealPosition(location.line, location.character);
    state.activeLine = location.line;
    fetchFunctionHistory(location.line);
  } else {
    await selectFile(location.path, { line: location.line, character: location.character });
    state.activeLine = location.line;
    fetchFunctionHistory(location.line);
  }
  pushReadingTrail(location);
}

async function gotoDefinition() {
  if (!state.repository || !state.currentFile) return;
  const position = editor.getCursor();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/lsp/goto-definition`, {
      method: 'POST',
      body: JSON.stringify({
        path: state.currentFile,
        line: position.line,
        character: position.character,
        content: editor.getValue(),
      }),
    });
    if (!data.locations.length) {
      elements.sourceStatus.textContent = '未找到定义';
      return;
    }
    if (data.locations.length === 1) {
      await jumpTo(data.locations[0]);
      return;
    }
    // 引用/定义列表覆盖代码区，收起两侧悬停面板避免遮住列表。
    window.__crPanels?.hideAll();
    editor.showQuickpick(data.locations, (picked) => {
      jumpTo(picked);
    });
  } catch (error) {
    elements.sourceStatus.textContent = `跳转失败：${error.message}`;
  }
}

const referencePreviewCache = new Map();

async function loadReferencePreview(item) {
  if (!state.repository) throw new Error('仓库已关闭');
  const key = `${state.repository.id}:${state.repository.head}:${item.path}:${item.line}`;
  if (referencePreviewCache.has(key)) return referencePreviewCache.get(key);
  const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/context?path=${encodeURIComponent(item.path)}&line=${encodeURIComponent(item.line)}&radius=10`);
  referencePreviewCache.set(key, data);
  if (referencePreviewCache.size > 200) {
    referencePreviewCache.delete(referencePreviewCache.keys().next().value);
  }
  return data;
}

async function gotoReferences() {
  if (!state.repository || !state.currentFile) return;
  const position = editor.getCursor();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/lsp/references`, {
      method: 'POST',
      body: JSON.stringify({
        path: state.currentFile,
        line: position.line,
        character: position.character,
        content: editor.getValue(),
      }),
    });
    if (!data.locations.length) {
      elements.sourceStatus.textContent = '未找到引用';
      return;
    }
    if (data.locations.length === 1) {
      await jumpTo(data.locations[0]);
      return;
    }
    window.__crPanels?.hideAll();
    editor.showQuickpick(data.locations, (picked) => {
      jumpTo(picked);
    }, {
      title: `${data.locations.length} 个引用 · j/k 或 ↑↓ 选择 · Enter 跳转 · Esc 取消`,
      preview: loadReferencePreview,
    });
  } catch (error) {
    elements.sourceStatus.textContent = `引用查询失败：${error.message}`;
  }
}

function currentLocation() {
  return state.currentFile
    ? { path: state.currentFile, line: editor.getCursor().line, character: editor.getCursor().character }
    : null;
}

async function jumpBack() {
  const target = jumpStack.pop();
  if (!target) {
    elements.sourceStatus.textContent = '跳转栈为空';
    return false;
  }
  const current = currentLocation();
  if (current) jumpForwardStack.push(current);
  await jumpTo(target, false);
  return true;
}

async function jumpForward() {
  const target = jumpForwardStack.pop();
  if (!target) return false;
  const current = currentLocation();
  if (current) jumpStack.push(current);
  await jumpTo(target, false);
  return true;
}

function resolveExPath(value) {
  let target = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!target) return null;
  target = target.replace(/^\.\//, '');
  if (target.startsWith('/')) {
    const root = String(state.repository?.root || '').replace(/\/+$/, '');
    if (!root || !(target === root || target.startsWith(`${root}/`))) return null;
    target = target.slice(root.length).replace(/^\/+/, '');
  }
  if (state.fileSet.has(target)) return target;
  const lower = target.toLowerCase();
  const exact = state.files.find((filePath, index) => state.filesLower[index] === lower);
  if (exact) return exact;
  return state.files.find((filePath, index) => state.filesLower[index].endsWith(`/${lower}`)) || null;
}

function openExFile(value) {
  const target = resolveExPath(value);
  if (!target) {
    elements.sourceStatus.textContent = `未找到文件：${value}`;
    return false;
  }
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  selectFile(target);
  return true;
}

function exFileCompletions(prefix) {
  const lower = String(prefix || '').toLowerCase();
  if (!lower) return [];
  const starts = [];
  const contains = [];
  for (let index = 0; index < state.files.length; index += 1) {
    const filePath = state.files[index];
    const fileLower = state.filesLower[index];
    if (fileLower.startsWith(lower)) starts.push(filePath);
    else if (fileLower.includes(lower)) contains.push(filePath);
    if (starts.length >= 12) break;
  }
  return [...starts, ...contains].slice(0, 12);
}

function treeRows() {
  return Array.from(elements.fileTree.querySelectorAll('.tree-row'));
}

function updateTreeFocus() {
  const rows = treeRows();
  if (!rows.length) return;
  treeFocusIndex = Math.max(0, Math.min(treeFocusIndex, rows.length - 1));
  rows.forEach((row, index) => row.classList.toggle('key-focus', index === treeFocusIndex));
  rows[treeFocusIndex].scrollIntoView({ block: 'nearest' });
}

function focusTree() {
  if (!state.repository) return false;
  const rows = treeRows();
  if (!rows.length) return false;
  // 文件树默认收起为覆盖层：键盘聚焦时先滑出，避免焦点落在屏幕外。
  window.__crPanels?.show('sidebar');
  treeFocusIndex = rows.findIndex((row) => row.dataset.path === state.currentFile);
  if (treeFocusIndex < 0) treeFocusIndex = 0;
  updateTreeFocus();
  elements.fileTree.focus();
  return true;
}

async function activateTreeRow(row) {
  if (!row) return;
  if (row.dataset.directory === 'true') {
    const target = row.dataset.path;
    if (state.collapsed.has(target)) state.collapsed.delete(target);
    else state.collapsed.add(target);
    persistCollapsed();
    renderTree();
    treeFocusIndex = treeRows().findIndex((item) => item.dataset.path === target);
    updateTreeFocus();
    elements.fileTree.focus();
    return;
  }
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  await selectFile(row.dataset.path);
  editor.focus();
}

editor = createEditor({
  onCursorLine(line) {
    state.activeLine = line;
    if (state.source && line > state.source.lines) {
      state.history = null;
      renderHistory();
      return;
    }
    fetchFunctionHistory(line);
    fetchFaq(line);
    scheduleHistoryTouch();
  },
  onAsk() {
    openQuestion();
  },
  onGotoDefinition() {
    gotoDefinition();
  },
  onGotoReferences() {
    gotoReferences();
  },
  onJumpBack() {
    return jumpBack();
  },
  onJumpForward() {
    return jumpForward();
  },
  onFocusTree() {
    return focusTree();
  },
  onOpenFile(value) {
    return openExFile(value);
  },
  onExComplete(value) {
    return exFileCompletions(value);
  },
  onHelp() {
    elements.vimHelpDialog.showModal();
  },
  theme: state.theme,
});

window.__ts = {
  snapshot() {
    return {
      repository: state.repository,
      fileCount: state.files.length,
      currentFile: state.currentFile,
      sourceLines: state.source?.lines || 0,
      activeLine: state.activeLine,
      history: state.history,
      explanation: state.explanation,
      questionOpen: state.questionOpen,
      explaining: state.explaining,
      keyboardNav: globalThis.__crKeyboardNavState || null,
      lsp: state.lsp,
      theme: state.theme,
      editorProfile: state.editorProfile
        ? {
          available: Boolean(state.editorProfile.available),
          colorscheme: state.editorProfile.colorscheme || null,
          colors: Object.keys(state.editorProfile.colors || {}).length,
          keymaps: (state.editorProfile.keymaps || []).length,
          error: state.editorProfile.error || null,
        }
        : null,
      editor: editor?.snapshot() || null,
      jumpStackDepth: jumpStack.length,
readingTrail: state.readingTrail,
      animationOpen: state.animationOpen,
      workspace: {
        entries: state.workspace.entries.map((entry) => ({ key: entry.key, name: entry.name, path: entry.path })),
        activeKey: state.sessionKey,
      },
    };
  },
  async switchRepository(name) {
    const entry = state.workspace.entries.find((candidate) => candidate.name === name || candidate.key === name);
    if (!entry) throw new Error(`工作区没有仓库：${name}`);
    await activateWorkspaceEntry(entry);
    return {
      repository: state.repository?.name || null,
      currentFile: state.currentFile,
      activeLine: state.activeLine,
      cursor: editor.getCursor(),
    };
  },
  // 自动化/调试入口：直接打开文件位置与触发引用查询。
  async openFile(file, line = 1, character = 0) {
    const before = {
      currentFile: state.currentFile,
      repository: Boolean(state.repository),
      activeLine: state.activeLine,
    };
    await selectFile(file, { line, character });
    return {
      before,
      currentFile: state.currentFile,
      activeLine: state.activeLine,
      sourceLines: state.source?.lines || 0,
      cursor: editor.getCursor(),
      historyStatus: state.history?.status || null,
    };
  },
  gotoReferences() {
    return gotoReferences();
  },
  // 自动化入口：构造一个带预览的引用列表，验证 j/k 切换预览不闪烁。
  showTestQuickpick() {
    const items = [1, 2, 3, 4].map((index) => ({ path: `test/ref${index}.c`, line: index, character: 0 }));
    const delays = [40, 2000, 40, 2000];
    editor.showQuickpick(items, () => {}, {
      title: 'preview-flicker-test',
      preview: (item) => new Promise((resolve) => {
        setTimeout(() => resolve({
          path: item.path,
          line: item.line,
          lineStart: item.line,
          lineEnd: item.line,
          caller: null,
          lines: [{ number: item.line, text: `preview ${item.line}` }],
        }), delays[item.line - 1]);
      }),
    });
    return true;
  },
  // 自动化入口：渲染一条带证据链/下一跳/新版 3D 动画的解释，验证新 UI。
  showTestUnderstanding() {
    const file = state.currentFile || 'test.c';
    const line = state.activeLine || 1;
    state.explanation = {
      status: 'done',
      path: file,
      line,
      model: 'test-model',
      explanation: {
        overview: '测试概述：证据链、建议继续阅读与内嵌 3D 动画。',
        details: ['测试细节一', '测试细节二'],
        summary: '测试总结',
        evidence: [
          { claim: '当前函数处理事件', kind: 'code', file, lineStart: line, lineEnd: line },
          { claim: '规范要求先初始化再写寄存器', kind: 'documentation', source: 'spec.md', section: '3.2', page: 7, excerpt: '初始化后再写寄存器。' },
          { claim: '这里可能是性能取舍', kind: 'inference' },
        ],
        nextSteps: [{ file, line: Math.max(1, line + 1), reason: '继续阅读下一行' }],
        specifications: [],
        animation: {
          title: '测试执行动画',
          summary: '两步演示',
          nodes: [{ id: 'a', label: '入口', kind: 'code' }, { id: 'b', label: '输出', kind: 'output' }],
          steps: [
            { title: '第一步', detail: '进入函数', node: 'a', file, lineStart: line, lineEnd: line, spec: '' },
            { title: '第二步', detail: '产生输出', node: 'b', from: 'a', to: 'b', file, lineStart: line, lineEnd: line, spec: '' },
          ],
        },
      },
      sources: {
        local: [],
        web: [
          { title: '示例来源一', url: 'https://example.com/spec1', engine: 'google' },
          { title: '示例来源二', url: 'https://example.com/spec2', engine: 'google' },
        ],
        searchedFiles: 0,
      },
    };
    renderExplanation();
    window.__crPanels?.pin('insights');
    setTimeout(focusExplanationPanel, 200);
    return true;
  },
  // 自动化入口：按窗口返回文件列表，避免把 10 万路径塞进 snapshot。
  fileList(offset = 0, limit = 50) {
    const start = Math.max(0, Number(offset) || 0);
    const count = Math.max(0, Math.min(Number(limit) || 0, 2000));
    return state.files.slice(start, start + count);
  },
  getValue() {
    return editor.getValue();
  },
  // 自动化/调试入口：当前视口内的两字符匹配（sneak 使用同一数据源）。
  visibleMatches(query, limit = 80) {
    return editor.visibleMatches(query, limit);
  },
  closeQuickpick() {
    editor.closeQuickpick();
  },
};

elements.openMenu.addEventListener('click', showOpenDialog);
elements.workspaceAdd.addEventListener('click', showOpenDialog);
elements.tabEditor.addEventListener('click', () => setEditorMode('editor'));
elements.tabNvim.addEventListener('click', () => setEditorMode('nvim'));
elements.nvimClose.addEventListener('click', closeNvim);
elements.nvimRestart.addEventListener('click', restartNvim);
elements.nvimOpenCurrent.addEventListener('click', openCurrentInNvim);
elements.nvimKeys.addEventListener('click', () => {
  renderNvimKeymaps();
  elements.nvimKeymapDialog.showModal();
});
elements.nvimKeymapClose.addEventListener('click', () => elements.nvimKeymapDialog.close());
elements.commitOverlayClose.addEventListener('click', closeCommitOverlay);
elements.commitOverlay.addEventListener('click', (event) => {
  if (event.target === elements.commitOverlay) closeCommitOverlay();
});
elements.animationClose.addEventListener('click', closeAnimation);
elements.animationOverlay.addEventListener('click', (event) => {
  if (event.target === elements.animationOverlay) closeAnimation();
});
// 动画弹层不是原生 dialog：Tab 在弹层内循环，避免焦点跑到背后的编辑器。
window.addEventListener('message', (event) => {
  if (event.source !== elements.animationFrame?.contentWindow) return;
  if (event.data?.type === 'code-reader-animation-close') closeAnimation();
});
elements.animationOverlay.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusable = [...elements.animationOverlay.querySelectorAll('a[href], button, iframe, [tabindex="0"]')]
    .filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
elements.editorEnvSettings.addEventListener('click', async () => {
  elements.editorEnvDialog.showModal();
  renderEditorEnvDialog();
  await loadEditorEnv({ openDialog: true });
  if (!state.editorProfile?.available) await loadEditorProfile();
  renderEditorEnvDialog();
});
elements.editorEnvClose.addEventListener('click', () => elements.editorEnvDialog.close());
elements.editorEnvRefresh.addEventListener('click', async () => {
  elements.editorEnvProgress.textContent = '检测中…';
  await loadEditorEnv({ openDialog: true });
  await loadEditorProfile({ refresh: true }).catch(() => {});
  renderEditorEnvDialog();
  elements.editorEnvProgress.textContent = '';
});
for (const radio of document.querySelectorAll('input[name="editor-env-program"]')) {
  radio.addEventListener('change', () => {
    elements.editorEnvCommand.disabled = radio.value !== 'custom';
  });
}
elements.editorEnvSave.addEventListener('click', async () => {
  const program = document.querySelector('input[name="editor-env-program"]:checked')?.value || 'auto';
  elements.editorEnvProgress.textContent = '保存中…';
  elements.editorEnvError.textContent = '';
  try {
    state.editorEnv = await api('/api/editor', {
      method: 'POST',
      body: JSON.stringify({
        program,
        command: elements.editorEnvCommand.value.trim(),
        appName: elements.editorEnvAppName.value.trim(),
      }),
    });
    applyEditorAvailability();
    renderEditorEnvDialog();
    elements.editorEnvProgress.textContent = '已保存';
    setTimeout(() => { elements.editorEnvProgress.textContent = ''; }, 1500);
    loadEditorProfile({ refresh: true }).catch(() => {});
  } catch (error) {
    elements.editorEnvError.textContent = error.message;
    elements.editorEnvProgress.textContent = '';
  }
});
elements.dialogClose.addEventListener('click', closeOpenDialog);
elements.localTab.addEventListener('click', () => setOpenMode('local'));
elements.remoteTab.addEventListener('click', () => setOpenMode('remote'));
elements.openForm.addEventListener('submit', openRepository);
elements.historyMenuButton.addEventListener('click', async (event) => {
  event.stopPropagation();
  const willOpen = elements.historyMenu.hidden;
  elements.historyMenu.hidden = !willOpen;
  elements.historyMenuButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    await loadReadingHistory();
    focusFirstMenuItem(elements.historyMenu);
  } else {
    elements.historyMenuButton.focus();
  }
});
elements.historyMenuButton.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown') return;
  event.preventDefault();
  elements.historyMenuButton.click();
});
elements.historyMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    elements.historyMenu.hidden = true;
    elements.historyMenuButton.setAttribute('aria-expanded', 'false');
    elements.historyMenuButton.focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = menuButtons(elements.historyMenu);
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement);
  let next;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else next = (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
elements.docsSettings.addEventListener('click', openDocsDialog);
elements.docsClose.addEventListener('click', () => elements.docsDialog.close());
elements.docsAdd.addEventListener('click', () => {
  const value = elements.docsPathInput.value.trim();
  if (!value) return;
  if (!value.startsWith('/')) {
    state.docsError = '请输入绝对路径';
    renderDocsDialog();
    return;
  }
  if (!state.docsDraft.includes(value)) state.docsDraft.push(value);
  elements.docsPathInput.value = '';
  state.docsError = '';
  renderDocsDialog();
});
elements.docsSave.addEventListener('click', async () => {
  elements.docsProgress.textContent = '正在保存…';
  state.docsError = '';
  try {
    await api('/api/docs/config', {
      method: 'POST',
      body: JSON.stringify({ directories: state.docsDraft, webEnabled: elements.docsWebEnabled.checked }),
    });
    await loadDocsConfig();
    elements.docsProgress.textContent = '已保存';
  } catch (error) {
    state.docsError = error.message;
    renderDocsDialog();
  } finally {
    setTimeout(() => { elements.docsProgress.textContent = ''; }, 1500);
  }
});
elements.docsReindex.addEventListener('click', async () => {
  elements.docsProgress.textContent = '正在清空索引…';
  try {
    await api('/api/docs/reindex', { method: 'POST' });
    await loadDocsConfig();
    elements.docsProgress.textContent = '索引已清空，下次检索时重建';
  } catch (error) {
    state.docsError = error.message;
    renderDocsDialog();
    elements.docsProgress.textContent = '';
  }
});
elements.browseButton.addEventListener('click', async () => {
  if (!elements.dirBrowser.hidden) {
    elements.dirBrowser.hidden = true;
    return;
  }
  elements.dirBrowser.hidden = false;
  await loadDirectory(elements.localPath.value.trim() || '');
});
elements.dirUp.addEventListener('click', () => {
  if (state.dirParent) loadDirectory(state.dirParent);
});
elements.dirPick.addEventListener('click', () => {
  if (state.dirBrowserPath) {
    elements.localPath.value = state.dirBrowserPath;
    elements.dirBrowser.hidden = true;
  }
});
elements.dirList.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  if (!state.dirEntries.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const base = state.dirSelected < 0 ? (delta > 0 ? -1 : 0) : state.dirSelected;
    selectDirIndex((base + delta + state.dirEntries.length) % state.dirEntries.length);
    return;
  }
  if (event.key === 'Enter') {
    if (state.dirSelected < 0) return;
    event.preventDefault();
    enterDirIndex(state.dirSelected);
    return;
  }
  if (event.key.length === 1 && event.key.trim()) {
    event.preventDefault();
    typeAheadDir(event.key);
  }
});
elements.themeSelect.addEventListener('change', () => {
  const id = elements.themeSelect.value;
  const palette = editor.setTheme(id);
  state.theme = id;
  state.themeExplicit = true;
  localStorage.setItem(THEME_KEY, id);
  applyShellTheme(palette);
});
elements.insightsToggle.addEventListener('click', () => {
  state.layout.collapsed = true;
  applyLayout();
  saveLayout();
});
elements.insightsExpand.addEventListener('click', () => {
  state.layout.collapsed = false;
  applyLayout();
  saveLayout();
});
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
elements.navTree.addEventListener('click', () => toggleCodeTreePanel());
elements.navInsights.addEventListener('click', () => toggleInsightsPanel());
elements.vimHelpClose.addEventListener('click', () => elements.vimHelpDialog.close());
// :help 从 Vim ex 命令行打开，原生关闭时要恢复的输入框已被移除，焦点会落到
// body；帮助窗口的入口就是编辑器，关闭后统一把焦点送回编辑器。
elements.vimHelpDialog.addEventListener('close', () => {
  editor?.focus();
  // 原生 dialog 在 close 之后还会做一次焦点恢复，可能把焦点又放回已关闭的
  // 对话框按钮；下一个宏任务再补一次，确保焦点落在编辑器。
  setTimeout(() => editor?.focus(), 0);
});
elements.vimHelpDialog.addEventListener('click', (event) => {
  if (event.target === elements.vimHelpDialog) elements.vimHelpDialog.close();
});
elements.docsDialog.addEventListener('click', (event) => {
  if (event.target === elements.docsDialog) elements.docsDialog.close();
});
elements.questionInput.addEventListener('input', () => {
  if (ANIMATION_HINT_RE.test(elements.questionInput.value)) elements.questionAnimation.checked = true;
});
elements.questionInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (event.isComposing || event.keyCode === 229) return;
  if (event.shiftKey) return;
  event.preventDefault();
  submitQuestion();
});
// 解释窗口：点击空白处先让内容容器获得焦点（阅读模式）；Esc 先退回容器，
// 再按一次回编辑器。j/k/gg/G 由通用 Vim 导航层处理。
elements.explanationContent.addEventListener('click', (event) => {
  if (event.target.closest('[data-nav], a, button, summary')) return;
  elements.explanationContent.focus();
});
elements.explanationContent.addEventListener('keydown', (event) => {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (document.activeElement !== elements.explanationContent) {
    elements.explanationContent.focus({ preventScroll: true });
    return;
  }
  editor?.focus();
});
let treeFilterTimer = null;
let treeFilterPending = false;
function flushTreeFilter() {
  if (!treeFilterPending) return;
  clearTimeout(treeFilterTimer);
  treeFilterTimer = null;
  treeFilterPending = false;
  renderTree();
}
elements.treeFilter.addEventListener('input', () => {
  // 输入变化后旧的候选下标失效；单候选会在渲染时自动高亮。
  state.filterIndex = -1;
  treeFilterPending = true;
  clearTimeout(treeFilterTimer);
  treeFilterTimer = setTimeout(() => {
    treeFilterTimer = null;
    treeFilterPending = false;
    renderTree();
  }, 120);
});
// 过滤框内直接键盘导航：↑/↓ 选择候选，Enter 打开。多候选需先选中，
// 只有一个候选时 Enter 直接打开（与用户操作习惯一致）。
elements.treeFilter.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // Esc 退出过滤：清空过滤条件并回到文件树（否则焦点会留在输入框里）。
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(treeFilterTimer);
    treeFilterTimer = null;
    treeFilterPending = false;
    elements.treeFilter.value = '';
    state.filterIndex = -1;
    renderTree();
    if (!focusTree()) elements.fileTree.focus({ preventScroll: true });
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
  if (!elements.treeFilter.value.trim()) return;
  flushTreeFilter();
  const matches = state.filterMatches;
  if (!matches.length) return;
  if (event.key === 'Enter') {
    const target = state.filterIndex >= 0
      ? matches[state.filterIndex]
      : (state.filterTotal === 1 ? matches[0] : null);
    if (!target) return;
    event.preventDefault();
    openFilteredFile(target);
    return;
  }
  event.preventDefault();
  const delta = event.key === 'ArrowDown' ? 1 : -1;
  if (state.filterIndex < 0) state.filterIndex = delta > 0 ? 0 : matches.length - 1;
  else state.filterIndex = (state.filterIndex + delta + matches.length) % matches.length;
  updateFilterFocus();
});
elements.fileTree.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  const rows = treeRows();
  if (!rows.length) return;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    const row = rows[Math.max(0, Math.min(treeFocusIndex, rows.length - 1))];
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = row.getBoundingClientRect();
    showTreeMenu(
      { path: row.dataset.path, directory: row.dataset.directory === 'true' },
      rect.left + 6,
      rect.bottom,
    );
    return;
  }
  if (event.altKey || event.metaKey) return;
  const key = event.key;
  const ctrl = event.ctrlKey;
  // 数字计数（5j / 3G / 12gg），0 单独出现表示首项。
  if (!ctrl && /^[0-9]$/.test(key) && !(key === '0' && !treeCount)) {
    treeCount = `${treeCount}${key}`.slice(-6);
    event.preventDefault();
    return;
  }
  const count = treeCount ? Number(treeCount) : 0;
  const pageItems = Math.max(1, Math.floor(elements.fileTree.clientHeight / 27));
  const clampIndex = (value) => Math.max(0, Math.min(rows.length - 1, value));
  const finish = () => {
    treeCount = '';
    treeGPressedAt = 0;
    event.preventDefault();
    event.stopPropagation();
    updateTreeFocus();
  };
  if (key === 'j' || key === 'ArrowDown') {
    treeFocusIndex = clampIndex(treeFocusIndex + (count || 1));
  } else if (key === 'k' || key === 'ArrowUp') {
    treeFocusIndex = clampIndex(treeFocusIndex - (count || 1));
  } else if (ctrl && (key === 'd' || key === 'u' || key === 'f' || key === 'b')) {
    // 半屏/整屏：Ctrl+d/u/f/b（文件树行高固定，按可视行数翻）。
    const half = Math.max(1, Math.round(pageItems / 2));
    const step = key === 'd' || key === 'u' ? half : pageItems;
    const direction = key === 'd' || key === 'f' ? 1 : -1;
    treeFocusIndex = clampIndex(treeFocusIndex + direction * step * (count || 1));
  } else if (key === 'PageDown' || key === 'PageUp') {
    treeFocusIndex = clampIndex(treeFocusIndex + (key === 'PageDown' ? 1 : -1) * pageItems);
  } else if (key === 'H' || key === 'M' || key === 'L') {
    treeFocusIndex = key === 'H' ? 0 : key === 'M' ? Math.floor((rows.length - 1) / 2) : rows.length - 1;
  } else if (key === '0' || key === '^') {
    treeFocusIndex = 0;
  } else if (key === '$') {
    treeFocusIndex = rows.length - 1;
  } else if (key === 'G') {
    treeFocusIndex = count ? clampIndex(count - 1) : rows.length - 1;
  } else if (key === 'g') {
    // Vim 风格 gg：700ms 内连按两次跳到第一个文件；带计数（12gg）跳到第 12 个。
    const now = Date.now();
    if (now - treeGPressedAt <= 700) {
      treeFocusIndex = count ? clampIndex(count - 1) : 0;
    } else {
      treeGPressedAt = now;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  } else if (key === 'Enter' || key === 'o') {
    const targetIndex = treeFocusIndex;
    treeCount = '';
    treeGPressedAt = 0;
    event.preventDefault();
    event.stopPropagation();
    activateTreeRow(rows[clampIndex(targetIndex)]);
    return;
  } else if (key === 'q' || key === 'Escape') {
    treeCount = '';
    treeGPressedAt = 0;
    event.preventDefault();
    event.stopPropagation();
    editor.focus();
    return;
  } else if (key === '/') {
    // / 直接跳到过滤框：文件太多时先过滤再 j/k 选择。
    treeCount = '';
    treeGPressedAt = 0;
    event.preventDefault();
    event.stopPropagation();
    elements.treeFilter.focus();
    elements.treeFilter.select();
    return;
  } else {
    treeCount = '';
    treeGPressedAt = 0;
    return;
  }
  finish();
});
elements.fileTree.addEventListener('click', async (event) => {
  const row = event.target.closest('.tree-row');
  if (!row) return;
  // 目录展开会重建整棵树：与键盘激活共用一条路径，焦点留在同路径的新行上。
  await activateTreeRow(row);
});
function showTreeMenu(context, left, top) {
  if (!context) return;
  state.treeContext = context;
  elements.treeMenu.hidden = false;
  elements.treeMenu.style.left = `${left}px`;
  elements.treeMenu.style.top = `${top}px`;
  focusFirstMenuItem(elements.treeMenu);
}

elements.fileTree.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('.tree-row');
  if (!row || !state.repository) return;
  event.preventDefault();
  showTreeMenu(
    { path: row.dataset.path, directory: row.dataset.directory === 'true' },
    event.clientX,
    event.clientY,
  );
});
elements.treeMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    elements.treeMenu.hidden = true;
    elements.fileTree.focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = menuButtons(elements.treeMenu);
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement);
  let next;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else next = (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
elements.treeMenu.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || !state.treeContext) return;
  const action = button.dataset.action;
  const context = state.treeContext;
  elements.treeMenu.hidden = true;
  if (action === 'copy-relative') {
    await copyText(context.path);
    showNotice('已复制相对路径');
  } else if (action === 'copy-absolute') {
    await copyText(`${state.repository.root.replace(/\/+$/, '')}/${context.path}`);
    showNotice('已复制绝对路径');
  } else if (action === 'refresh-tree') {
    try {
      const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/refresh`, { method: 'POST' });
      await loadRepository(data, { preserveFile: true, stashNotice: false });
    } catch (error) {
      showNotice(`刷新失败：${error.message}`, { error: true });
    }
  }
  // 键盘激活菜单项（Enter/Space 产生 detail=0 的 click）后把焦点还给文件树。
  if (event.detail === 0) elements.fileTree.focus();
});
document.addEventListener('click', (event) => {
  if (!elements.historyMenu.hidden
    && !elements.historyMenu.contains(event.target)
    && event.target !== elements.historyMenuButton) {
    elements.historyMenu.hidden = true;
    elements.historyMenuButton.setAttribute('aria-expanded', 'false');
  }
  if (!elements.treeMenu.hidden && !elements.treeMenu.contains(event.target)) {
    elements.treeMenu.hidden = true;
  }
});
elements.questionCancel.addEventListener('click', closeQuestion);
elements.questionSubmit.addEventListener('click', submitQuestion);
elements.openDialog.addEventListener('cancel', (event) => {
  if (state.opening) {
    event.preventDefault();
    return;
  }
  // 目录浏览器是对话框内的子面板：Esc 先只关闭它，不关闭整个打开仓库对话框。
  if (!elements.dirBrowser.hidden) {
    event.preventDefault();
    elements.dirBrowser.hidden = true;
    elements.browseButton.focus({ preventScroll: true });
  }
});

// 全键盘导航层：easymotion 风格标签跳转（含代码行）+ sneak 风格两字符定位。
// Ctrl+Alt+L 被 UKUI 锁屏（screensaver:<Ctrl><Alt>l）在 X 层抓走，网页收不到，
// 两字符定位改用 Ctrl+Alt+F（F=find）。
const keyboardNav = createKeyboardNav({
  getEditor: () => editor,
  toggleSidebar: toggleCodeTreePanel,
  toggleInsights: toggleInsightsPanel,
  cancelTreeFocus: cancelTreeFocusRequest,
});

// 任意窗口的 Vim 键导航（解释栏/提交详情/对话框/菜单）：j/k 移动或滚动，gg/G 首尾。
// 放在冒泡阶段，让文件树、目录浏览器、CodeMirror 等既有按键处理先执行。
const vimNav = createVimNav();
document.addEventListener('keydown', (event) => {
  vimNav.handleKeydown(event);
});

// 捕获阶段先处理导航层与引用列表按键：否则 CodeMirror/Vim 会先消费 Enter
// （把当前行换行），弹窗的“Enter 跳转”永远见不到事件。
document.addEventListener('keydown', (event) => {
  if (keyboardNav.handleKeydown(event)) return;
  editor.quickpickKeydown(event);
}, true);

// 编辑器 ⇄ nvim 页签切换：Ctrl+Alt+1 / Ctrl+Alt+2（主键位）。
// 旧键 Ctrl+Alt+E / Ctrl+Alt+N 保留兼容，但 Ctrl+Alt+E 常被桌面环境注册成全局
// 快捷键（如 UKUI 的 peony-qt2 = 文件管理器），在 X 层就被抓走、网页收不到，
// 不能当默认键位用。
// 工作区切仓：Ctrl+Alt+[ / ] 前后切换，Ctrl+Alt+Shift+1..9 直达第 N 个页签。
// 两侧栏入口：Ctrl+Alt+B（代码树）/ Ctrl+Alt+I（分析与解释）——「去这个窗口」：
// 打开并把焦点送进去；焦点已在窗口内时再按才收起（见 toggle*Panel）。
// 捕获阶段消费事件：否则 CodeMirror / xterm 会先把组合键当成输入（nvim 终端会把它发给 PTY）。
// 用 event.code 判键：部分布局（AltGr）下 event.key 会变成别的字符。
document.addEventListener('keydown', (event) => {
  if (!event.ctrlKey || !event.altKey || event.metaKey || event.repeat || event.isComposing) return;
  if (event.shiftKey) {
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (digit) {
      event.preventDefault();
      event.stopPropagation();
      activateWorkspaceByIndex(Number(digit[1]) - 1);
      return;
    }
    // Shift+B/I/K/F 作为备用键：Ctrl+Alt+B/I 被输入法/桌面占用时仍可使用。
  }
  if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
    event.preventDefault();
    event.stopPropagation();
    activateWorkspaceByOffset(event.code === 'BracketLeft' ? -1 : 1);
    return;
  }
  if (event.code === 'KeyB') {
    event.preventDefault();
    event.stopPropagation();
    toggleCodeTreePanel();
    return;
  }
  if (event.code === 'KeyI') {
    event.preventDefault();
    event.stopPropagation();
    toggleInsightsPanel();
    return;
  }
  if (event.code === 'KeyK' || event.code === 'KeyF') {
    event.preventDefault();
    event.stopPropagation();
    keyboardNav.toggle(event.code === 'KeyK' ? 'hint' : 'sneak');
    return;
  }
  const mode = event.code === 'Digit1' || event.code === 'KeyE' ? 'editor'
    : event.code === 'Digit2' || event.code === 'KeyN' ? 'nvim'
    : null;
  if (!mode) return;
  event.preventDefault();
  event.stopPropagation();
  setEditorMode(mode);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.animationOpen) {
    event.preventDefault();
    closeAnimation();
    return;
  }
  if (event.key === 'Escape' && !elements.commitOverlay.hidden) {
    event.preventDefault();
    closeCommitOverlay();
    return;
  }
  if (event.key === 'Escape' && state.questionOpen && !state.explaining) {
    event.preventDefault();
    closeQuestion();
    editor.focus();
    return;
  }
  // 解释栏项列表：焦点在提交行/「深层演变」等控件上时，Esc 先退回阅读容器
  // #explanation-content，再按一次才回编辑器。搜索条打开时先清搜索（优先级
  // 与搜索框自身一致：Esc 只退一层）。
  if (event.key === 'Escape') {
    const active = document.activeElement;
    const insights = elements.insights;
    if (insights && active instanceof Element && insights.contains(active) && !active.closest('#explanation-content')) {
      event.preventDefault();
      if (document.querySelector('.vim-search')) {
        vimNav.closeSearch();
        return;
      }
      elements.explanationContent.focus({ preventScroll: true });
      return;
    }
  }
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
  const dialogOpen = Boolean(document.querySelector('dialog[open]'));
  if (event.altKey && event.key === '.') {
    event.preventDefault();
    gotoDefinition();
    return;
  }
  if (event.altKey && event.key === 'r') {
    event.preventDefault();
    gotoReferences();
    return;
  }
  if (event.key.toLowerCase() === 'c' && !editing && !dialogOpen && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    openQuestion();
  }
});

renderRepository();
renderTree();
renderHistory();
renderExplanation();
renderFaq();
renderLspState();
renderQuestionPresets();
renderReadingTrail();
loadLayout();
applyLayout();
initSplitter('left');
initSplitter('right');
initAutoPanels();
populateThemes();
applyShellTheme(editor.setTheme(state.theme));
loadReadingHistory();
// 刷新页面后默认回到上一次的仓库、文件与行列位置。
restoreWorkspace().catch((error) => console.error('[workspace] 恢复失败：', error));
loadEditorEnv()
  .then(() => loadEditorProfile())
  .catch((error) => {
    console.error('[editor-profile] 加载失败：', error);
    renderNvimShortcuts();
  });
const { createLlmSettings } = await import('./llm-settings.js');
const llmSettings = createLlmSettings({
  api,
  onStatus(llm) {
    elements.llmStatus.textContent = llm.configured ? `${llm.providerName || 'LLM'} · ${llm.model}` : 'LLM 设置';
    elements.llmStatus.title = llm.error || (llm.configured ? '修改厂商、模型或 API Key' : '选择模型并配置 API Key');
  },
});
elements.llmStatus.addEventListener('click', llmSettings.open);
llmSettings.load().catch(() => {});
