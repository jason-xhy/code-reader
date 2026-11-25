// 数据层：应用运行时状态与跨模块共享的单例。
// 功能模块只读写这里的数据，不各自维护副本；编辑器实例通过 setEditor 注入。
export const state = {
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
  // 当前仓库的 kconfig 取值（/kconfig/values 接口）：null = 未加载/不支持，
  // { available, stale, values } = 已加载；置灰功能只在 !stale && values 时启用。
  kconfigValues: null,
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
  docsError: '',
  docsStatsData: [],
  treeContext: null,
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

// 工作区：每个打开过的仓库一份会话快照（payload + 当前文件/光标/折叠目录/分支）。
export const sessions = new Map();

// 应用级跳转栈（跨文件 gd/gr 后 Ctrl-o / Ctrl-i）。
export const jumpStack = [];
export const jumpForwardStack = [];

// 编辑器实例由 app.js 创建后注入；其它模块通过 live binding 读取。
export let editor = null;

export function setEditor(value) {
  editor = value;
}

// 焦点意图纪元：用户每把焦点交给一个窗口/弹层（文件树、解释窗、quickpick、
// 对话框等）就递增。异步源码加载回来时只在纪元未变时接管焦点——否则迟到的
// 内容会把用户刚打开的窗口抢走（2026-11-20 七期 grill 实锤：加载在飞时开窗，
// 700ms 后 CM6 view.focus() 把焦点抢回代码窗）。
let focusIntent = 0;

export function noteFocusIntent() {
  focusIntent += 1;
}

export function getFocusIntent() {
  return focusIntent;
}