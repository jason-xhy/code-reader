// 应用装配层：创建编辑器、串联各能力模块、提供自动化测试入口。
// 具体能力在 features/*，共享数据/配置/策略在 core/*；本文件不再堆叠功能实现。
import { createEditor, THEMES } from './editor.js';
import { elements } from './core/dom.js';
import { state, setEditor, editor, jumpStack, jumpForwardStack } from './core/state.js';
import { api } from './core/api.js';
import { THEME_KEY } from './core/config.js';
import { showNotice } from './core/notice.js';
import {
  applyLayout,
  applyShellTheme,
  initAutoPanels,
  initSplitter,
  loadLayout,
  populateThemes,
} from './core/layout.js';
import {
  buildTree,
  focusTree,
  initTreeFeature,
  preparePayload,
  renderTree,
  restoreCollapsed,
} from './features/tree.js';
import { initReadingHistory, loadReadingHistory } from './features/reading-history.js';
import {
  initRepositoryFeature,
  loadBranches,
  refreshStashNotice,
  renderLspState,
  renderRepository,
  scheduleLspPolling,
} from './features/repository.js';
import {
  closeAnimation,
  closeCommitOverlay,
  closeQuestion,
  fetchFaq,
  fetchFunctionHistory,
  focusExplanationPanel,
  initInsightsFeature,
  openQuestion,
  renderExplanation,
  renderFaq,
  renderHistory,
} from './features/insights.js';
import {
  exFileCompletions,
  gotoDefinition,
  gotoReferences,
  initNavigationFeature,
  jumpBack,
  jumpForward,
  jumpTo,
  openExFile,
  pushReadingTrail,
  renderReadingTrail,
} from './features/navigation.js';
import {
  activateWorkspaceEntry,
  captureSession,
  initWorkspaceFeature,
  renderWorkspaceTabs,
  repositoryKey,
  restoreWorkspace,
  storeSession,
} from './features/workspace.js';
import {
  closeNvim,
  initEditorModeFeature,
  loadEditorEnv,
  loadEditorProfile,
  renderNvimShortcuts,
} from './features/editor-mode.js';
import { initDialogsFeature } from './features/dialogs.js';
import { initSearchFeature, openWorkspaceSearch } from './features/search.js';
import { initShortcuts } from './features/shortcuts.js';

// v2：本地主题成为默认选项后重置旧版本保存的配色选择，避免历史
// localStorage（多为早期 one-dark）压过「默认本地」。用户重新选择后照常持久化。
const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme && (savedTheme === 'local' || THEMES.some((theme) => theme.id === savedTheme))) {
  state.theme = savedTheme;
  state.themeExplicit = true;
}

// ---- 阅读核心：打开仓库 / 选择文件 / 渲染源码 ----

// 两侧栏是「窗口」：窗口持有焦点时，后台内容到达不能把焦点抢回代码窗。
// 与 layout.js 的「打开窗口即窗口持有焦点」配套——内容加载不是用户导航。
function sidePanelOwnsFocus() {
  const active = document.activeElement;
  return Boolean(active?.closest?.('.sidebar, .insights'));
}

function renderSource({ focus = true } = {}) {
  state.historyController?.abort();
  elements.questionEditor.hidden = true;
  state.questionOpen = false;
  const hasSource = Boolean(state.source);
  elements.codeEmpty.hidden = hasSource;
  if (hasSource) {
    editor.show();
    editor.openFile(state.currentFile, state.source.content, { focus });
  } else {
    editor.hide();
  }
  elements.currentFile.textContent = state.currentFile || '尚未选择文件';
  elements.sourceStatus.textContent = hasSource
    ? `${state.source.lines} 行 · ${state.source.path}`
    : '';
}

// focus: 'always' = 用户导航，加载完把焦点交给代码窗；
//        'auto'   = 页面恢复等后台加载，只有没有别的窗口持有焦点时才接管。
async function selectFile(filePath, reveal = null, { focus = 'always' } = {}) {
  const background = focus === 'auto';
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
    if (reveal) editor.revealPosition(reveal.line, reveal.character, { focus: !background });
    if (background && !sidePanelOwnsFocus()) editor.focus();
    scheduleHistoryTouch();
    return;
  }
  elements.sourceStatus.textContent = '正在读取源码…';
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/file?path=${encodeURIComponent(filePath)}`);
    if (state.currentFile !== filePath) return;
    state.source = data;
    renderSource({ focus: !background });
    if (reveal) editor.revealPosition(reveal.line, reveal.character, { focus: !background });
    // 恢复期间用户可能已打开代码树/解释窗口：内容到达后按实况决定焦点归属。
    if (background && !sidePanelOwnsFocus()) editor.focus();
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

function applyRepositoryPayload(data, { collapsed = null, branches = [], prepared = null } = {}) {
  // 切仓/重新打开时关闭遗留的搜索或引用列表，避免旧仓库结果在新仓库里跳转。
  if (editor?.isQuickpickOpen()) editor.closeQuickpick();
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

// ---- 编辑器与能力模块装配 ----

const editorInstance = createEditor({
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
  onWorkspaceSearch() {
    openWorkspaceSearch();
  },
  theme: state.theme,
});
setEditor(editorInstance);

// 能力模块初始化：每个模块自己挂 DOM 事件，app.js 只注入跨模块依赖。
initTreeFeature({
  api,
  selectFile,
  loadRepository,
  showNotice,
});
initReadingHistory({ loadRepository, selectFile });
initRepositoryFeature({ loadRepository, renderSource });
initInsightsFeature({ jumpTo });
initNavigationFeature({ selectFile, fetchFunctionHistory, focusExplanationPanel });
initEditorModeFeature();
initDialogsFeature({ loadRepository });
initWorkspaceFeature({ loadRepository, selectFile, applyRepositoryPayload, renderSource, closeNvim });
initSearchFeature({ jumpTo });
const { keyboardNav, vimNav } = initShortcuts();

// ---- 自动化/调试入口（对外契约，浏览器验收脚本依赖）----

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
  openWorkspaceSearch() {
    return openWorkspaceSearch();
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
  // 自动化/调试入口：键盘导航与引用列表的实时状态。
  keyboardNav: keyboardNav.snapshot(),
  vimNav: Boolean(vimNav),
};

// ---- 初始化 ----

renderRepository();
renderTree();
renderHistory();
renderExplanation();
renderFaq();
renderLspState();
renderReadingTrail();
loadLayout();
applyLayout();
initSplitter('left');
initSplitter('right');
initAutoPanels({
  focus: {
    // 悬停滑出与快捷键/点击同义：窗口一打开，焦点就交给窗口内容。
    sidebar: () => {
      if (!focusTree()) elements.fileTree.focus({ preventScroll: true });
    },
    insights: () => focusExplanationPanel(),
  },
});
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