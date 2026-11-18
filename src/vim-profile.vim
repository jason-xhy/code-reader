set nocompatible
" code-reader：在 Vim 中读取本地配置实际生效的配色/显示选项/映射。
" 由 src/editor-profile.js 通过 CR_PROFILE_OUT 环境变量调用。
let s:groups = [
      \ 'Normal', 'Comment', 'Constant', 'String', 'Character', 'Number', 'Boolean',
      \ 'Identifier', 'Function', 'Statement', 'Conditional', 'Repeat', 'Label',
      \ 'Operator', 'Keyword', 'Exception', 'PreProc', 'Include', 'Define', 'Macro',
      \ 'Type', 'StorageClass', 'Structure', 'Typedef', 'Special', 'SpecialChar',
      \ 'Tag', 'Delimiter', 'SpecialComment', 'Debug', 'Underlined', 'Error', 'Todo',
      \ 'Visual', 'Cursor', 'CursorLine', 'CursorLineNr', 'LineNr', 'SignColumn',
      \ 'Pmenu', 'PmenuSel', 'PmenuSbar', 'PmenuThumb', 'Search', 'IncSearch',
      \ 'StatusLine', 'StatusLineNC', 'VertSplit', 'TabLine', 'TabLineFill',
      \ 'TabLineSel', 'Directory', 'Title', 'MatchParen', 'DiffAdd', 'DiffDelete',
      \ 'DiffChange', 'DiffText', 'NormalFloat', 'FloatBorder', 'NonText',
      \ 'Whitespace', 'ErrorMsg', 'WarningMsg', 'MoreMsg', 'Question', 'Folded',
      \ 'FoldColumn' ]

let s:colors = {}
for s:name in s:groups
  let s:id = hlID(s:name)
  if s:id == 0 | continue | endif
  let s:target = synIDtrans(s:id)
  let s:entry = {}
  let s:fg = synIDattr(s:target, 'fg#', 'gui')
  let s:bg = synIDattr(s:target, 'bg#', 'gui')
  if s:fg != '' | let s:entry.fg = s:fg | endif
  if s:bg != '' | let s:entry.bg = s:bg | endif
  if s:entry != {} | let s:colors[s:name] = s:entry | endif
endfor

let s:dump = []
redir => s:mapdump
silent map
silent map!
redir END
let s:dump = split(s:mapdump, "\n")

let s:profile = {
      \ 'colorscheme': get(g:, 'colors_name', ''),
      \ 'background': &background,
      \ 'termguicolors': &termguicolors,
      \ 'guifont': &guifont,
      \ 'leader': get(g:, 'mapleader', ''),
      \ 'localleader': get(g:, 'maplocalleader', ''),
      \ 'options': {
      \   'tabstop': &tabstop,
      \   'shiftwidth': &shiftwidth,
      \   'softtabstop': &softtabstop,
      \   'expandtab': &expandtab,
      \   'number': &number,
      \   'relativenumber': &relativenumber,
      \   'cursorline': &cursorline,
      \   'wrap': &wrap,
      \   'scrolloff': &scrolloff,
      \   'list': &list,
      \   'listchars': &listchars,
      \   'colorcolumn': &colorcolumn,
      \   'signcolumn': get(g:, 'signcolumn', ''),
      \   'foldenable': &foldenable,
      \   'foldmethod': &foldmethod,
      \   'foldlevel': &foldlevel,
      \   'showbreak': &showbreak,
      \   'conceallevel': &conceallevel,
      \ },
      \ 'colors': s:colors,
      \ 'mapdump': s:dump,
      \ }

call writefile([json_encode(s:profile)], $CR_PROFILE_OUT)
qa!