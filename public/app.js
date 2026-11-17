import { createEditor } from './editor.js';

const $ = (selector) => document.querySelector(selector);

const elements = {
  openMenu: $('#open-menu'),
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
  repositoryBranch: $('#repository-branch'),
  repositoryTags: $('#repository-tags'),
  lspBadge: $('#lsp-badge'),
  lspState: $('#lsp-state'),
  currentFile: $('#current-file'),
  sourceStatus: $('#source-status'),
  codeEmpty: $('#code-empty'),
  editorHost: $('#editor-host'),
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
};

const state = {
  repository: null,
  files: [],
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
};

const jumpStack = [];
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
  if (!response.ok) throw new Error(data?.error?.message || `请求失败（HTTP ${response.status}）`);
  return data;
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
      marker.textContent = child.directory ? (state.collapsed.has(child.path) && !filter ? '▶' : '▼') : '·';
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = child.name;
      button.append(marker, name);
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
  elements.repositoryBranch.textContent = repo ? `分支 ${repo.branch}` : '分支 —';
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

function renderLspState() {
  const lsp = state.lsp;
  if (!state.repository) {
    elements.lspBadge.textContent = 'LSP —';
    elements.lspState.textContent = 'LSP 未检测';
    return;
  }
  if (lsp.initialized) {
    elements.lspBadge.textContent = `LSP ${lsp.engine}`;
    elements.lspState.textContent = `${lsp.engine} 就绪 · gd 跳定义 · gr 跳引用`;
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

async function loadRepository(data) {
  state.repository = data.repository;
  state.files = data.files;
  state.tree = buildTree(data.files);
  state.collapsed = new Set();
  const collectDirectories = (node) => {
    for (const child of node.children.values()) {
      if (!child.directory) continue;
      state.collapsed.add(child.path);
      collectDirectories(child);
    }
  };
  collectDirectories(state.tree);
  state.currentFile = null;
  state.source = null;
  state.activeLine = null;
  state.history = null;
  state.explanation = null;
  state.historyCache.clear();
  jumpStack.length = 0;
  closeQuestion();
  elements.treeFilter.value = '';
  renderRepository();
  renderTree();
  renderSource();
  renderHistory();
  renderExplanation();
  scheduleLspPolling();
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
    closeQuestion();
    renderTree();
    renderHistory();
    renderExplanation();
  }
  elements.currentFile.textContent = filePath;
  if (!switching) {
    if (reveal) editor.revealPosition(reveal.line, reveal.character);
    return;
  }
  elements.sourceStatus.textContent = '正在读取源码…';
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/file?path=${encodeURIComponent(filePath)}`);
    if (state.currentFile !== filePath) return;
    state.source = data;
    renderSource();
    if (reveal) editor.revealPosition(reveal.line, reveal.character);
  } catch (error) {
    if (state.currentFile !== filePath) return;
    editor.hide();
    elements.codeEmpty.hidden = false;
    elements.codeEmpty.querySelector('h1').textContent = '无法读取文件';
    elements.codeEmpty.querySelector('p').textContent = error.message;
    elements.sourceStatus.textContent = '读取失败';
  }
}

async function fetchLineHistory(line) {
  if (!state.repository || state.currentFile === null || state.activeLine !== line) return;
  const filePath = state.currentFile;
  const key = `${state.repository.head}:${filePath}:${line}`;
  if (state.historyCache.has(key)) {
    state.history = { path: filePath, line, status: 'done', commits: state.historyCache.get(key) };
    renderHistory();
    return;
  }
  state.historyController?.abort();
  const controller = new AbortController();
  state.historyController = controller;
  state.history = { path: filePath, line, status: 'loading', commits: [] };
  renderHistory();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/line-history?path=${encodeURIComponent(filePath)}&line=${line}`, { signal: controller.signal });
    if (state.activeLine !== line || state.currentFile !== filePath) return;
    state.historyCache.set(key, data.commits);
    state.history = { path: filePath, line, status: 'done', commits: data.commits };
    renderHistory();
  } catch (error) {
    if (error.name === 'AbortError' || state.activeLine !== line || state.currentFile !== filePath) return;
    state.history = { path: filePath, line, status: 'error', message: error.message, commits: [] };
    renderHistory();
  }
}

function renderHistory() {
  const history = state.history;
  elements.historyContent.replaceChildren();
  if (!history) {
    elements.historyAnchor.textContent = '光标所在行';
    elements.historyContent.className = 'insight-content empty-insight';
    elements.historyContent.textContent = '移动光标查看该行最近的 5 次变更';
    return;
  }
  elements.historyContent.className = 'insight-content';
  elements.historyAnchor.textContent = `${history.path}:${history.line}`;
  if (history.status === 'loading') {
    elements.historyContent.className = 'insight-content empty-insight loading';
    elements.historyContent.textContent = '正在查询行级 Git 历史…';
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
    elements.historyContent.textContent = '该行没有提交历史';
    return;
  }
  const list = document.createElement('div');
  list.className = 'commit-list';
  for (const commit of history.commits) {
    const item = document.createElement('div');
    item.className = 'commit';
    const hash = document.createElement('span');
    hash.className = 'commit-hash';
    hash.textContent = commit.hash;
    item.append(hash, document.createTextNode(` ${commit.subject}`));
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
  } catch (error) {
    state.explanation = { status: 'error', path: filePath, line, message: error.message };
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
  }
  if (location.path === state.currentFile) {
    editor.revealPosition(location.line, location.character);
    state.activeLine = location.line;
    fetchLineHistory(location.line);
  } else {
    await selectFile(location.path, { line: location.line, character: location.character });
    state.activeLine = location.line;
    fetchLineHistory(location.line);
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
    });
  } catch (error) {
    elements.sourceStatus.textContent = `引用查询失败：${error.message}`;
  }
}

async function jumpBack() {
  const target = jumpStack.pop();
  if (!target) {
    elements.sourceStatus.textContent = '跳转栈为空';
    return;
  }
  await jumpTo(target, false);
}

editor = createEditor({
  onCursorLine(line) {
    state.activeLine = line;
    if (state.source && line > state.source.lines) {
      state.history = null;
      renderHistory();
      return;
    }
    fetchLineHistory(line);
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
    jumpBack();
  },
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
      editor: editor?.snapshot() || null,
      jumpStackDepth: jumpStack.length,
    };
  },
};

elements.openMenu.addEventListener('click', showOpenDialog);
elements.dialogClose.addEventListener('click', closeOpenDialog);
elements.localTab.addEventListener('click', () => setOpenMode('local'));
elements.remoteTab.addEventListener('click', () => setOpenMode('remote'));
elements.openForm.addEventListener('submit', openRepository);
elements.treeFilter.addEventListener('input', renderTree);
elements.fileTree.addEventListener('click', (event) => {
  const row = event.target.closest('.tree-row');
  if (!row) return;
  if (row.dataset.directory === 'true') {
    const path = row.dataset.path;
    if (state.collapsed.has(path)) state.collapsed.delete(path);
    else state.collapsed.add(path);
    renderTree();
  } else {
    jumpStack.length = 0;
    selectFile(row.dataset.path);
  }
});
elements.questionCancel.addEventListener('click', closeQuestion);
elements.questionSubmit.addEventListener('click', submitQuestion);
elements.openDialog.addEventListener('cancel', (event) => {
  if (state.opening) event.preventDefault();
});

document.addEventListener('keydown', (event) => {
  if (editor.quickpickKeydown(event)) return;
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
renderLspState();
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
