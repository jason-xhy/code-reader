// 前端配置层：常量、默认值、静态文案。这里只放"值"，不放行为。
// 新增功能时优先在此登记配置，避免魔法数字散落在功能模块里。

// v2：本地主题成为默认选项后重置旧版本保存的配色选择。
export const THEME_KEY = 'code-reader-theme-v2';
export const LAYOUT_KEY = 'code-reader-layout';

// 明确要求动画解释的关键词；与问题输入框的复选框共同决定是否请求 3D 动画。
export const ANIMATION_HINT_RE = /(动画|动图|三维|3D|可视化|three\.?js|animation)/i;

export const PANEL_HIDE_DELAY = 220;
export const PREPARED_LIMIT = 4;
export const MAX_PREPARED_FILES = 200_000;
export const TREE_FILTER_LIMIT = 200;
export const SEARCH_DEBOUNCE_MS = 140;

export const QUESTION_PRESETS = [
  { label: '函数目的', text: '这个函数的目的是什么？请结合调用方说明它在整体流程中的角色。' },
  { label: '数据流', text: '梳理当前函数的数据流：输入从哪里来，经过哪些变换，输出到哪里。' },
  { label: '设计原因', text: '这段代码为什么这样设计？请结合 Git 历史和上下文解释取舍。' },
  { label: '规范依据', text: '这段代码遵循了哪些规范/协议要求？请给出具体章节依据。' },
  { label: '3D 动画', text: '请用 Three.js 3D 动画解释当前函数的执行步骤，以及代码如何按照规范执行。' },
];

export const FILE_ICONS = new Map(Object.entries({
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