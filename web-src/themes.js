// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 配色表与 code-reader 编辑器主题强绑定
// grill: 成品检索=skill 库无 code-reader 配色成品; 输入固定=固定主题 id; 步骤机械=按调色板生成 CM6 theme+highlight; 判读固定=编辑器扩展; 失效场景=构造不出（仅本应用）
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { Tag, tags } from '@lezer/highlight';

// 内置 C/C++ 词法比 legacy 模式细：struct/return/const、函数调用、成员访问、
// 全大写宏在 nvim(treesitter) 里各用不同高亮组，这里给它们独立 tag。
export const C_TOKEN_TAGS = {
  keywordReturn: Tag.define(),
  keywordType: Tag.define(),
  keywordStorage: Tag.define(),
  constantName: Tag.define(),
  callName: Tag.define(),
  memberName: Tag.define(),
  typeNameToken: Tag.define(),
  builtinType: Tag.define(),
};

// 主题来源（GitHub 热门 Vim colorscheme 调色板）：
// gruvbox.nvim / nord-vim / dracula/vim / tokyonight.nvim / catppuccin/nvim /
// altercation/vim-colors-solarized / rakr/vim-one / sickill/vim-monokai
export const THEMES = [
  {
    id: 'one-dark',
    name: 'Vim One (Dark)',
    shell: { background: '#282c34', panel: '#21252b', border: '#3a404c', accent: '#61afef', text: '#abb2bf', muted: '#7f8794' },
    editor: { background: '#282c34', foreground: '#abb2bf', gutter: '#5c6370', gutterActive: '#2c313a', activeLine: '#2c313a', selection: '#3e4451', cursor: '#61afef', border: '#3a404c' },
    syntax: { keyword: '#c678dd', string: '#98c379', comment: '#5c6370', number: '#d19a66', function: '#61afef', type: '#e5c07b', operator: '#56b6c2', variable: '#abb2bf', constant: '#d19a66', property: '#e06c75', heading: '#61afef', link: '#61afef' },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    shell: { background: '#282828', panel: '#1d2021', border: '#3c3836', accent: '#fabd2f', text: '#ebdbb2', muted: '#928374' },
    editor: { background: '#282828', foreground: '#ebdbb2', gutter: '#7c6f64', gutterActive: '#3c3836', activeLine: '#3c3836', selection: '#504945', cursor: '#fabd2f', border: '#3c3836' },
    syntax: { keyword: '#fb4934', string: '#b8bb26', comment: '#928374', number: '#d3869b', function: '#b8bb26', type: '#83a598', operator: '#fe8019', variable: '#ebdbb2', constant: '#d3869b', property: '#fabd2f', heading: '#fabd2f', link: '#83a598' },
  },
  {
    id: 'nord',
    name: 'Nord',
    shell: { background: '#2e3440', panel: '#272c36', border: '#3b4252', accent: '#88c0d0', text: '#d8dee9', muted: '#7b88a1' },
    editor: { background: '#2e3440', foreground: '#d8dee9', gutter: '#616e88', gutterActive: '#3b4252', activeLine: '#3b4252', selection: '#434c5e', cursor: '#88c0d0', border: '#3b4252' },
    syntax: { keyword: '#81a1c1', string: '#a3be8c', comment: '#616e88', number: '#b48ead', function: '#88c0d0', type: '#8fbcbb', operator: '#81a1c1', variable: '#d8dee9', constant: '#b48ead', property: '#8fbcbb', heading: '#88c0d0', link: '#88c0d0' },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    shell: { background: '#282a36', panel: '#21222c', border: '#44475a', accent: '#bd93f9', text: '#f8f8f2', muted: '#6272a4' },
    editor: { background: '#282a36', foreground: '#f8f8f2', gutter: '#6272a4', gutterActive: '#44475a', activeLine: '#44475a', selection: '#44475a', cursor: '#bd93f9', border: '#44475a' },
    syntax: { keyword: '#ff79c6', string: '#f1fa8c', comment: '#6272a4', number: '#bd93f9', function: '#50fa7b', type: '#8be9fd', operator: '#ff79c6', variable: '#f8f8f2', constant: '#bd93f9', property: '#8be9fd', heading: '#bd93f9', link: '#8be9fd' },
  },
  {
    id: 'tokyonight',
    name: 'Tokyo Night',
    shell: { background: '#24283b', panel: '#1f2335', border: '#292e42', accent: '#7aa2f7', text: '#c0caf5', muted: '#565f89' },
    editor: { background: '#24283b', foreground: '#c0caf5', gutter: '#565f89', gutterActive: '#292e42', activeLine: '#292e42', selection: '#364a82', cursor: '#7aa2f7', border: '#292e42' },
    syntax: { keyword: '#bb9af7', string: '#9ece6a', comment: '#565f89', number: '#ff9e64', function: '#7aa2f7', type: '#2ac3de', operator: '#89ddff', variable: '#c0caf5', constant: '#ff9e64', property: '#73daca', heading: '#7aa2f7', link: '#7aa2f7' },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    shell: { background: '#1e1e2e', panel: '#181825', border: '#313244', accent: '#89b4fa', text: '#cdd6f4', muted: '#6c7086' },
    editor: { background: '#1e1e2e', foreground: '#cdd6f4', gutter: '#6c7086', gutterActive: '#313244', activeLine: '#313244', selection: '#45475a', cursor: '#89b4fa', border: '#313244' },
    syntax: { keyword: '#cba6f7', string: '#a6e3a1', comment: '#6c7086', number: '#fab387', function: '#89b4fa', type: '#f9e2af', operator: '#89dceb', variable: '#cdd6f4', constant: '#fab387', property: '#94e2d5', heading: '#89b4fa', link: '#89b4fa' },
  },
  {
    id: 'solarized',
    name: 'Solarized Dark',
    shell: { background: '#002b36', panel: '#00252e', border: '#073642', accent: '#268bd2', text: '#839496', muted: '#586e75' },
    editor: { background: '#002b36', foreground: '#839496', gutter: '#586e75', gutterActive: '#073642', activeLine: '#073642', selection: '#0b4a5a', cursor: '#268bd2', border: '#073642' },
    syntax: { keyword: '#859900', string: '#2aa198', comment: '#586e75', number: '#d33682', function: '#268bd2', type: '#b58900', operator: '#6c71c4', variable: '#839496', constant: '#d33682', property: '#2aa198', heading: '#268bd2', link: '#268bd2' },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    shell: { background: '#272822', panel: '#1e1f1c', border: '#3e3d32', accent: '#a6e22e', text: '#f8f8f2', muted: '#75715e' },
    editor: { background: '#272822', foreground: '#f8f8f2', gutter: '#75715e', gutterActive: '#3e3d32', activeLine: '#3e3d32', selection: '#49483e', cursor: '#a6e22e', border: '#3e3d32' },
    syntax: { keyword: '#f92672', string: '#e6db74', comment: '#75715e', number: '#ae81ff', function: '#a6e22e', type: '#66d9ef', operator: '#f92672', variable: '#f8f8f2', constant: '#ae81ff', property: '#66d9ef', heading: '#a6e22e', link: '#66d9ef' },
  },
];

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

// 用本地 vim/neovim 的实际 highlight 组生成同款调色板：内置编辑器打开即与
// 用户终端里的 colorscheme 一致（而不是应用自带的近似主题）。
// 优先取 treesitter 组（@keyword/@function/...）：开启 treesitter 后 legacy 组
// 与屏幕颜色不一致（Identifier 紫色但 @variable 是前景色），legacy 只作兜底。
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function colorOf(colors, group, key = 'fg') {
  const value = colors?.[group]?.[key];
  return HEX_COLOR.test(String(value || '')) ? value : null;
}

export function profileTheme(profile) {
  const colors = profile?.colors || {};
  const pick = (group, key = 'fg') => colorOf(colors, group, key);
  const ts = (name, key = 'fg') => pick(`@${name}`, key);
  const first = (...values) => values.find(Boolean) || null;
  const light = profile?.background === 'light';

  const background = pick('Normal', 'bg') || (light ? '#ffffff' : '#222436');
  const foreground = pick('Normal', 'fg') || (light ? '#000000' : '#c8d3f5');
  const comment = first(ts('comment'), pick('Comment'), pick('NonText')) || (light ? '#0000ff' : '#7f8794');
  const panel = first(pick('Pmenu', 'bg'), pick('NormalFloat', 'bg')) || (light ? '#f0f0f0' : background);
  const border = first(pick('LineNr'), pick('NonText'), pick('WinSeparator')) || (light ? '#cccccc' : '#3b4261');
  const accent = first(ts('function'), pick('Function'), pick('Identifier'), pick('Statement')) || foreground;
  const cursor = pick('Cursor', 'bg') || foreground;
  const gutter = pick('LineNr', 'fg') || comment;
  const activeLine = pick('CursorLine', 'bg') || background;
  const gutterActive = pick('CursorLine', 'bg') || activeLine;
  const gutterActiveText = pick('CursorLineNr', 'fg') || accent;
  const selection = pick('Visual', 'bg') || (light ? '#c8d8f8' : '#44475a');

  const keyword = first(ts('keyword'), pick('Keyword'), pick('Statement')) || (light ? '#af00db' : '#fca7ea');
  const keywordControl = first(ts('keyword.conditional'), ts('keyword.repeat'), ts('keyword.exception'), keyword);
  const keywordReturn = first(ts('keyword.return'), keyword);
  const keywordType = first(ts('keyword.type'), ts('keyword.storage.type'), keyword);
  const keywordStorage = first(ts('keyword.storage'), ts('keyword.storage.modifier'), keyword);
  const keywordImport = first(ts('keyword.import'), ts('keyword.directive'), pick('Include'), keyword);
  const keywordOperator = first(ts('keyword.operator'), pick('Operator'), keyword);
  const string = first(ts('string'), pick('String'), pick('Character')) || (light ? '#008000' : '#c3e88d');
  const stringEscape = first(ts('string.escape'), ts('string.special'), string);
  const number = first(ts('number'), pick('Number'), pick('Constant')) || (light ? '#098658' : '#ff966c');
  const boolean = first(ts('boolean'), pick('Boolean'), number);
  const constant = first(ts('constant'), pick('Constant'), number);
  const constantBuiltin = first(ts('constant.builtin'), pick('Type'), constant);
  const fn = first(ts('function'), pick('Function')) || accent;
  const functionBuiltin = first(ts('function.builtin'), fn);
  const macro = first(ts('function.macro'), pick('Macro'), pick('PreProc'), fn);
  const type = first(ts('type'), pick('Type'), pick('Structure'), pick('Typedef')) || keyword;
  const typeBuiltin = first(ts('type.builtin'), pick('Type'), type);
  const typeQualifier = first(ts('type.qualifier'), keywordType);
  const variable = first(ts('variable'), foreground);
  const parameter = first(ts('variable.parameter'), ts('variable'), variable);
  const member = first(ts('variable.member'), ts('property'), pick('Identifier'), foreground);
  const property = first(ts('property'), ts('variable.member'), pick('Identifier'), foreground);
  const variableBuiltin = first(ts('variable.builtin'), pick('Special'), constant);
  const operator = first(ts('operator'), pick('Operator')) || foreground;
  const punctuation = first(ts('punctuation'), foreground);
  const bracket = first(ts('punctuation.bracket'), punctuation);
  const separator = first(ts('punctuation.delimiter'), punctuation, operator);
  const label = first(ts('label'), pick('Label'), keyword);
  const preproc = first(ts('preproc'), pick('PreProc'), macro);
  const module = first(ts('module'), pick('Include'), type);
  const attribute = first(ts('attribute'), pick('Special'), property);
  const tag = first(ts('tag'), pick('Tag'), keyword);
  const heading = first(ts('markup.heading'), pick('Title'), fn);
  const link = first(ts('markup.link'), pick('Underlined'), ts('text.uri'), accent);

  const fontStyleOf = (tsName, legacyName) => {
    const entry = colors[`@${tsName}`] || (legacyName ? colors[legacyName] : null);
    if (!entry) return undefined;
    return [entry.italic ? 'italic' : '', entry.bold ? 'bold' : ''].filter(Boolean).join(' ') || '';
  };
  const styles = {
    keyword: fontStyleOf('keyword', 'Keyword'),
    keywordControl: fontStyleOf('keyword.conditional', 'Keyword'),
    keywordReturn: fontStyleOf('keyword.return') ?? fontStyleOf('keyword'),
    keywordType: fontStyleOf('keyword.type') ?? fontStyleOf('keyword'),
    keywordStorage: fontStyleOf('keyword.storage') ?? fontStyleOf('keyword'),
    comment: fontStyleOf('comment', 'Comment') ?? 'italic',
  };

  return {
    id: 'local',
    name: `本地 · ${profile?.colorscheme || 'vim'}`,
    dark: !light,
    shell: {
      background,
      panel,
      border,
      accent,
      text: foreground,
      muted: comment,
    },
    editor: {
      background,
      foreground,
      gutter,
      gutterActive,
      gutterActiveText,
      activeLine,
      selection,
      cursor,
      border,
    },
    styles,
    syntax: {
      keyword,
      keywordControl,
      keywordReturn,
      keywordType,
      keywordStorage,
      keywordImport,
      keywordOperator,
      string,
      stringEscape,
      comment,
      number,
      boolean,
      constant,
      constantBuiltin,
      function: fn,
      functionBuiltin,
      macro,
      type,
      typeBuiltin,
      typeQualifier,
      variable,
      parameter,
      member,
      property,
      variableBuiltin,
      operator,
      punctuation,
      bracket,
      separator,
      label,
      preproc,
      module,
      attribute,
      tag,
      heading,
      link,
    },
  };
}

export function themeExtension(id) {
  return themeExtensionFor(themeById(id));
}

export function themeExtensionFor(theme) {
  const ui = EditorView.theme({
    '&': { height: '100%', backgroundColor: theme.editor.background, color: theme.editor.foreground },
    '.cm-scroller': {
      fontFamily: 'var(--cr-editor-font, "SFMono-Regular", Consolas, "Liberation Mono", monospace)',
      fontSize: 'var(--cr-editor-font-size, 12px)',
      lineHeight: 'var(--cr-editor-line-height, 24px)',
    },
    '.cm-content': { caretColor: theme.editor.cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: theme.editor.cursor },
    '.cm-gutters': {
      backgroundColor: theme.editor.background,
      color: theme.editor.gutter,
      borderRight: `1px solid ${theme.editor.border}`,
    },
    '.cm-activeLineGutter': { backgroundColor: theme.editor.gutterActive, color: theme.editor.gutterActiveText || theme.editor.cursor },
    '.cm-activeLine': { backgroundColor: theme.editor.activeLine },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: theme.editor.selection,
    },
    '.cm-panels': { backgroundColor: theme.shell.panel, color: theme.shell.text },
    '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${theme.shell.border}` },
    '.cm-panel input, .cm-panel button': {
      border: `1px solid ${theme.shell.border}`,
      borderRadius: '5px',
      backgroundColor: theme.editor.background,
      color: theme.shell.text,
      padding: '3px 7px',
    },
    '.cm-searchMatch': { backgroundColor: theme.editor.selection, outline: `1px solid ${theme.shell.accent}` },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: theme.shell.accent, color: theme.editor.background },
    '.cm-ws-mark': { color: theme.syntax.comment, opacity: '0.75' },
  }, { dark: theme.dark !== false });
  const syntax = theme.syntax || {};
  const color = (key, ...fallbacks) => {
    for (const candidate of [key, ...fallbacks]) {
      if (syntax[candidate]) return syntax[candidate];
    }
    return theme.editor?.foreground || '#000000';
  };
  // theme.styles 存在时以它为准（空串=明确不加样式，本地主题据此跟随 nvim
  // 是否 italic）；不存在时沿用内置主题的默认样式。
  const font = (key, fallback) => (
    theme.styles && Object.prototype.hasOwnProperty.call(theme.styles, key)
      ? (theme.styles[key] || undefined)
      : fallback
  );
  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: color('keyword'), fontStyle: font('keyword') },
    { tag: tags.controlKeyword, color: color('keywordControl', 'keyword'), fontStyle: font('keywordControl', font('keyword')) },
    { tag: tags.definitionKeyword, color: color('keywordType', 'keyword'), fontStyle: font('keywordType', font('keyword')) },
    { tag: C_TOKEN_TAGS.keywordReturn, color: color('keywordReturn', 'keyword'), fontStyle: font('keywordReturn', font('keyword')) },
    { tag: C_TOKEN_TAGS.keywordType, color: color('keywordType', 'keyword'), fontStyle: font('keywordType', font('keyword')) },
    { tag: C_TOKEN_TAGS.keywordStorage, color: color('keywordStorage', 'keyword'), fontStyle: font('keywordStorage', font('keyword')) },
    { tag: [tags.moduleKeyword, tags.operatorKeyword], color: color('keywordOperator', 'operator') },
    { tag: tags.modifier, color: color('keywordStorage', 'keyword') },
    { tag: tags.string, color: color('string') },
    { tag: [tags.escape, tags.regexp], color: color('stringEscape', 'string') },
    { tag: tags.comment, color: color('comment'), fontStyle: font('comment', 'italic') },
    { tag: tags.number, color: color('number') },
    { tag: tags.bool, color: color('boolean', 'constant') },
    { tag: tags.atom, color: color('boolean', 'constant') },
    { tag: tags.null, color: color('constantBuiltin', 'constant') },
    { tag: C_TOKEN_TAGS.constantName, color: color('constant') },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: color('function') },
    { tag: C_TOKEN_TAGS.callName, color: color('function') },
    { tag: [tags.standard(tags.function(tags.variableName)), tags.standard(tags.variableName)], color: color('functionBuiltin', 'function') },
    { tag: tags.macroName, color: color('macro', 'function') },
    { tag: [tags.typeName, tags.className], color: color('type') },
    { tag: C_TOKEN_TAGS.typeNameToken, color: color('type') },
    { tag: tags.standard(tags.typeName), color: color('typeBuiltin', 'type') },
    { tag: C_TOKEN_TAGS.builtinType, color: color('typeBuiltin', 'type') },
    { tag: tags.operator, color: color('operator') },
    { tag: tags.variableName, color: color('variable') },
    { tag: tags.special(tags.variableName), color: color('variableBuiltin', 'variable') },
    { tag: [tags.propertyName, tags.attributeName], color: color('property') },
    { tag: C_TOKEN_TAGS.memberName, color: color('property') },
    { tag: tags.labelName, color: color('label', 'keyword') },
    { tag: tags.punctuation, color: color('punctuation', 'variable') },
    { tag: tags.bracket, color: color('bracket', 'punctuation') },
    { tag: tags.separator, color: color('separator', 'punctuation') },
    { tag: tags.tagName, color: color('tag', 'keyword') },
    { tag: tags.namespace, color: color('module', 'type') },
    { tag: tags.meta, color: color('preproc', 'comment') },
    { tag: tags.annotation, color: color('attribute', 'property') },
    { tag: [tags.heading, tags.strong], color: color('heading', 'function'), fontWeight: 'bold' },
    { tag: tags.link, color: color('link', 'function'), textDecoration: 'underline' },
  ]);
  return [ui, syntaxHighlighting(highlight)];
}