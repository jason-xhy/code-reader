// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 配色表与 code-reader 编辑器主题强绑定
// grill: 成品检索=skill 库无 code-reader 配色成品; 输入固定=固定主题 id; 步骤机械=按调色板生成 CM6 theme+highlight; 判读固定=编辑器扩展; 失效场景=构造不出（仅本应用）
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

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

export function themeExtension(id) {
  const theme = themeById(id);
  const ui = EditorView.theme({
    '&': { height: '100%', backgroundColor: theme.editor.background, color: theme.editor.foreground },
    '.cm-scroller': {
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: '12px',
      lineHeight: '24px',
    },
    '.cm-content': { caretColor: theme.editor.cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: theme.editor.cursor },
    '.cm-gutters': {
      backgroundColor: theme.editor.background,
      color: theme.editor.gutter,
      borderRight: `1px solid ${theme.editor.border}`,
    },
    '.cm-activeLineGutter': { backgroundColor: theme.editor.gutterActive, color: theme.editor.cursor },
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
  }, { dark: true });
  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: theme.syntax.keyword },
    { tag: tags.string, color: theme.syntax.string },
    { tag: tags.comment, color: theme.syntax.comment, fontStyle: 'italic' },
    { tag: tags.number, color: theme.syntax.number },
    { tag: [tags.bool, tags.null], color: theme.syntax.constant },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: theme.syntax.function },
    { tag: [tags.typeName, tags.className], color: theme.syntax.type },
    { tag: tags.operator, color: theme.syntax.operator },
    { tag: tags.variableName, color: theme.syntax.variable },
    { tag: [tags.propertyName, tags.attributeName], color: theme.syntax.property },
    { tag: [tags.heading, tags.strong], color: theme.syntax.heading, fontWeight: 'bold' },
    { tag: tags.link, color: theme.syntax.link, textDecoration: 'underline' },
  ]);
  return [ui, syntaxHighlighting(highlight)];
}