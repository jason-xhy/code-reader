// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 页面状态机与 code-reader API 强绑定
// grill: 成品检索=skill 库无 code-reader 前端成品; 输入固定=固定 DOM id 与 API 响应; 步骤机械=按仓库/分支/同步事件渲染; 判读固定=API JSON 结果; 失效场景=构造不出（仅本应用）
import { createEditor, THEMES } from './editor.js';

const $ = (selector) => document.querySelector(selector);
// v2：本地主题成为默认选项后重置旧版本保存的配色选择，避免历史
// localStorage（多为早期 one-dark）压过「默认本地」。用户重新选择后照常持久化。
const THEME_KEY = 'code-reader-theme-v2';
const LAYOUT_KEY = 'code-reader-layout';

const elements = {
  openMenu: $('#open-menu'),
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
  questionError: $('#question-error'),
  questionCancel: $('#question-cancel'),
  questionSubmit: $('#question-submit'),
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
};

const state = {
  repository: null,
  files: [],
  filesLower: [],
  fileSet: new Set(),
  tree: null,
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
  layout: { sidebar: 252, insights: 372, collapsed: false },
  theme: 'one-dark',
  themeExplicit: false,
  editorMode: 'editor',
  editorEnv: null,
  editorProfile: null,
};

const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme && (savedTheme === 'local' || THEMES.some((theme) => theme.id === savedTheme))) {
  state.theme = savedTheme;
  state.themeExplicit = true;
}

const jumpStack = [];
const jumpForwardStack = [];
let treeFocusIndex = -1;
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
      collapsed: Boolean(saved.collapsed),
    };
  } catch {
    state.layout = { sidebar: 252, insights: 372, collapsed: false };
  }
}

function applyLayout() {
  const app = document.getElementById('app');
  app.style.setProperty('--sidebar-width', `${state.layout.sidebar}px`);
  app.style.setProperty('--insights-width', `${state.layout.insights}px`);
  app.classList.toggle('insights-collapsed', state.layout.collapsed);
  elements.insightsExpand.hidden = !state.layout.collapsed;
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

async function openHistoryEntry(entry) {
  try {
    const data = entry.source === 'remote'
      ? await api('/api/repositories/open-remote', { method: 'POST', body: JSON.stringify({ url: entry.path, resume: true }) })
      : await api('/api/repositories/open-local', { method: 'POST', body: JSON.stringify({ path: entry.path, resume: true }) });
    await loadRepository(data);
    if (data.resume?.file && state.files.includes(data.resume.file)) {
      await selectFile(data.resume.file, { line: data.resume.line || 1, character: data.resume.character || 0 });
    }
    showNotice(data.resume?.file
      ? `已恢复 ${entry.name} · ${data.resume.file}:${data.resume.line}`
      : `已打开 ${entry.name}（暂无上次文件位置）`);
  } catch (error) {
    showNotice(`打开历史失败：${error.message}`, { error: true });
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

async function loadDirectory(target) {
  elements.dirError.textContent = '';
  try {
    const data = await api(`/api/fs/list?path=${encodeURIComponent(target)}`);
    state.dirBrowserPath = data.path;
    state.dirParent = data.parent;
    elements.dirPath.textContent = data.path;
    elements.dirUp.disabled = !data.parent;
    elements.dirList.replaceChildren();
    for (const entry of data.entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'dir-row';
      row.textContent = entry.name;
      if (entry.git) {
        const badge = document.createElement('span');
        badge.className = 'dir-git';
        badge.textContent = 'Git';
        row.append(badge);
      }
      row.addEventListener('click', () => loadDirectory(entry.path));
      elements.dirList.append(row);
    }
    if (!data.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'field-help';
      empty.textContent = '该目录下没有子目录';
      elements.dirList.append(empty);
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

function buildTree(files) {
  const root = { name: '', path: '', directory: true, children: new Map() };
  for (const file of files) {
    const parts = file.split('/');
    let node = root;
    parts.forEach((part, index) => {
      if (!node.children.has(part)) {
        const directory = index < parts.length - 1;
        node.children.set(part, {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          directory,
          children: directory ? new Map() : null,
        });
      }
      node = node.children.get(part);
    });
  }
  return root;
}

function sortedChildren(node, filter) {
  return [...node.children.values()]
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
  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '没有匹配的文件';
    elements.fileTree.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const filePath of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tree-row tree-row-flat${state.currentFile === filePath ? ' active' : ''}`;
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
  }
  elements.fileTree.append(fragment);
  if (total > matches.length) {
    const note = document.createElement('div');
    note.className = 'empty-tree';
    note.textContent = `仅显示前 ${matches.length} 个匹配（共 ${total} 个），请继续输入缩小范围`;
    elements.fileTree.append(note);
  }
}

function renderTree() {
  elements.fileTree.replaceChildren();
  if (!state.tree) {
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
  if (!state.repository) {
    state.branches = [];
    renderBranches();
    return;
  }
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/branches`);
    state.branches = data.branches || [];
  } catch {
    state.branches = [];
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
  if (!state.repository) return;
  try {
    state.lsp = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/lsp/status`);
  } catch {
    state.lsp = { available: false, engine: null, initialized: false, detail: '状态查询失败' };
  }
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
    ? '在浏览器内运行本地 vim/neovim（真实插件与键位）'
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

async function loadRepository(data, { preserveFile = false, stashNotice = true } = {}) {
  const previousFile = preserveFile ? state.currentFile : null;
  closeNvim();
  closeCommitOverlay();
  state.repository = data.repository;
  state.files = data.files;
  state.filesLower = data.files.map((filePath) => filePath.toLowerCase());
  state.fileSet = new Set(data.files);
  state.status = data.status || {};
  state.tree = buildTree(data.files);
  const storedCollapsed = restoreCollapsed();
  state.collapsed = storedCollapsed || new Set();
  if (!storedCollapsed) {
    const collectDirectories = (node) => {
      for (const child of node.children.values()) {
        if (!child.directory) continue;
        state.collapsed.add(child.path);
        collectDirectories(child);
      }
    };
    collectDirectories(state.tree);
  }
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
  await loadBranches();
  if (previousFile && state.files.includes(previousFile)) {
    await selectFile(previousFile);
  }
  if (stashNotice) await refreshStashNotice();
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

function closeCommitOverlay() {
  state.commitDetail = null;
  elements.commitOverlay.hidden = true;
  elements.commitOverlayBody.replaceChildren();
}

function renderCommitOverlay() {
  const detail = state.commitDetail;
  if (!detail) {
    elements.commitOverlay.hidden = true;
    elements.commitOverlayBody.replaceChildren();
    return;
  }
  elements.commitOverlay.hidden = false;
  const commit = (state.history?.commits || []).find((entry) => entry.hash === detail.hash);
  elements.commitOverlayTitle.textContent = detail.status === 'done'
    ? `${detail.data.short || detail.hash} · ${detail.data.message.split('\n')[0]}`
    : (commit ? `${commit.hash} · ${commit.subject}` : `提交 ${detail.hash}`);
  elements.commitOverlayBody.replaceChildren(renderCommitDetail(detail));
}

async function showCommit(hash) {
  if (!state.repository) return;
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
    const actions = document.createElement('div');
    actions.className = 'faq-actions';
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
    body.append(overview, details, meta, actions);
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
    elements.historyContent.textContent = '正在查询函数级 Git 历史…';
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
}

function openQuestion() {
  if (!state.source || state.explaining) return;
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
  state.explaining = true;
  elements.questionInput.disabled = true;
  elements.questionSubmit.disabled = true;
  elements.questionCancel.disabled = true;
  elements.questionSubmit.textContent = '正在解释…';
  elements.questionError.textContent = '';
  state.explanation = { status: 'loading', path: filePath, line };
  renderExplanation();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/explain`, {
      method: 'POST',
      body: JSON.stringify({ path: filePath, line, question }),
    });
    state.explanation = { status: 'done', path: filePath, line, ...data };
    closeQuestion();
    fetchFaq(line);
  } catch (error) {
    state.explanation = { status: 'error', path: filePath, line, message: error.message, details: error.details };
    elements.questionError.textContent = error.message;
  } finally {
    state.explaining = false;
    elements.questionInput.disabled = false;
    elements.questionSubmit.disabled = false;
    elements.questionCancel.disabled = false;
    elements.questionSubmit.textContent = '确定';
    renderExplanation();
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
      item.textContent = `本地文档：${hit.source}（相关度 ${hit.score}）`;
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
    elements.explanationContent.textContent = 'LLM 正在结合源码分析问题…';
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
      meta.textContent = `版本：${specification.version || '未确认'} · 章节：${specification.section} · ${specification.verified ? '模型标记已核实' : '未核实'}`;
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
  renderSources(card, explanation.sources);
  const note = document.createElement('p');
  note.className = 'model-note';
  note.textContent = `模型：${explanation.model}。内容由模型生成；涉及硬件规范时，请与官方规范原文复核。`;
  card.append(note);
  elements.explanationContent.append(card);
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
  getValue() {
    return editor.getValue();
  },
  closeQuickpick() {
    editor.closeQuickpick();
  },
};

elements.openMenu.addEventListener('click', showOpenDialog);
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
  if (willOpen) await loadReadingHistory();
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
elements.vimHelpClose.addEventListener('click', () => elements.vimHelpDialog.close());
elements.vimHelpDialog.addEventListener('click', (event) => {
  if (event.target === elements.vimHelpDialog) elements.vimHelpDialog.close();
});
elements.docsDialog.addEventListener('click', (event) => {
  if (event.target === elements.docsDialog) elements.docsDialog.close();
});
elements.questionInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (event.isComposing || event.keyCode === 229) return;
  if (event.shiftKey) return;
  event.preventDefault();
  submitQuestion();
});
let treeFilterTimer = null;
elements.treeFilter.addEventListener('input', () => {
  clearTimeout(treeFilterTimer);
  treeFilterTimer = setTimeout(renderTree, 120);
});
elements.fileTree.addEventListener('keydown', (event) => {
  const rows = treeRows();
  if (!rows.length) return;
  if (event.key === 'j' || event.key === 'ArrowDown') {
    treeFocusIndex = Math.min(rows.length - 1, treeFocusIndex + 1);
  } else if (event.key === 'k' || event.key === 'ArrowUp') {
    treeFocusIndex = Math.max(0, treeFocusIndex - 1);
  } else if (event.key === 'Enter' || event.key === 'o') {
    event.preventDefault();
    event.stopPropagation();
    activateTreeRow(rows[treeFocusIndex]);
    return;
  } else if (event.key === 'q' || event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    editor.focus();
    return;
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  updateTreeFocus();
});
elements.fileTree.addEventListener('click', (event) => {
  const row = event.target.closest('.tree-row');
  if (!row) return;
  if (row.dataset.directory === 'true') {
    const path = row.dataset.path;
    if (state.collapsed.has(path)) state.collapsed.delete(path);
    else state.collapsed.add(path);
    persistCollapsed();
    renderTree();
  } else {
    jumpStack.length = 0;
    jumpForwardStack.length = 0;
    selectFile(row.dataset.path);
  }
});
elements.fileTree.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('.tree-row');
  if (!row || !state.repository) return;
  event.preventDefault();
  state.treeContext = { path: row.dataset.path, directory: row.dataset.directory === 'true' };
  elements.treeMenu.hidden = false;
  elements.treeMenu.style.left = `${event.clientX}px`;
  elements.treeMenu.style.top = `${event.clientY}px`;
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
});
document.addEventListener('click', (event) => {
  if (!elements.historyMenu.hidden
    && !elements.historyMenu.contains(event.target)
    && event.target !== elements.historyMenuButton) {
    elements.historyMenu.hidden = true;
  }
  if (!elements.treeMenu.hidden && !elements.treeMenu.contains(event.target)) {
    elements.treeMenu.hidden = true;
  }
});
elements.questionCancel.addEventListener('click', closeQuestion);
elements.questionSubmit.addEventListener('click', submitQuestion);
elements.openDialog.addEventListener('cancel', (event) => {
  if (state.opening) event.preventDefault();
});

// 捕获阶段先处理引用列表按键：否则 CodeMirror/Vim 会先消费 Enter（把当前行换行），
// 弹窗的“Enter 跳转”永远见不到事件。
document.addEventListener('keydown', (event) => {
  editor.quickpickKeydown(event);
}, true);

document.addEventListener('keydown', (event) => {
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
loadLayout();
applyLayout();
initSplitter('left');
initSplitter('right');
populateThemes();
applyShellTheme(editor.setTheme(state.theme));
loadReadingHistory();
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
