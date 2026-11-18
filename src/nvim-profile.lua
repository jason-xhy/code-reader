-- code-reader：在 headless nvim 中读取用户本地配置实际生效的配色/选项/映射。
-- 由 src/editor-profile.js 通过 CR_PROFILE_SCRIPT / CR_PROFILE_OUT 环境变量调用。
-- 探测本地 neovim 实际生效的配色、显示选项与按键映射，供 code-reader 内置编辑器对齐。
local function hex(value)
  if type(value) ~= 'number' then return nil end
  return string.format('#%06x', value)
end

local groups = {
  'Normal', 'Comment', 'Constant', 'String', 'Character', 'Number', 'Boolean',
  'Identifier', 'Function', 'Statement', 'Conditional', 'Repeat', 'Label',
  'Operator', 'Keyword', 'Exception', 'PreProc', 'Include', 'Define', 'Macro',
  'Type', 'StorageClass', 'Structure', 'Typedef', 'Special', 'SpecialChar',
  'Tag', 'Delimiter', 'SpecialComment', 'Debug', 'Underlined', 'Error', 'Todo',
  'Visual', 'Cursor', 'CursorLine', 'CursorLineNr', 'LineNr', 'SignColumn',
  'Pmenu', 'PmenuSel', 'PmenuSbar', 'PmenuThumb', 'Search', 'IncSearch',
  'CurSearch', 'StatusLine', 'StatusLineNC', 'WinSeparator', 'VertSplit',
  'TabLine', 'TabLineFill', 'TabLineSel', 'Directory', 'Title', 'MatchParen',
  'DiffAdd', 'DiffDelete', 'DiffChange', 'DiffText', 'Added', 'Removed',
  'Changed', 'NormalFloat', 'FloatBorder', 'NonText', 'Whitespace',
  'IndentBlanklineChar', 'IblIndent', 'IblScope', 'DiagnosticError',
  'DiagnosticWarn', 'DiagnosticInfo', 'DiagnosticHint', 'ErrorMsg', 'WarningMsg',
  'MoreMsg', 'Question', 'Folded', 'FoldColumn', 'SpellBad', 'SpellCap',
}

-- treesitter 组才是屏幕上实际生效的颜色。开启 treesitter 后 legacy 组
-- （Statement/Identifier/...）与真实渲染不一致（例：Identifier=#c099ff，
-- 而 @variable=#c8d3f5），内置编辑器只读 legacy 组会整体配色跑偏。
local tsGroups = {
  '@comment', '@comment.documentation', '@keyword', '@keyword.function',
  '@keyword.return', '@keyword.conditional', '@keyword.repeat', '@keyword.storage',
  '@keyword.type', '@keyword.import', '@keyword.operator', '@keyword.exception',
  '@string', '@string.escape', '@string.regexp', '@string.special',
  '@number', '@number.float', '@boolean', '@constant', '@constant.builtin',
  '@function', '@function.call', '@function.builtin', '@function.macro', '@function.method',
  '@type', '@type.builtin', '@type.qualifier', '@type.definition',
  '@variable', '@variable.parameter', '@variable.member', '@variable.builtin',
  '@property', '@field', '@attribute', '@label', '@namespace', '@module',
  '@operator', '@punctuation', '@punctuation.bracket', '@punctuation.delimiter',
  '@preproc', '@define', '@include', '@macro', '@constructor', '@tag',
  '@text.title', '@text.uri', '@markup.link', '@markup.heading', '@markup.raw',
  '@markup.strong', '@markup.emphasis',
}
for _, name in ipairs(tsGroups) do groups[#groups + 1] = name end

local function groupColor(name)
  local ok, hl = pcall(vim.api.nvim_get_hl, 0, { name = name, link = false })
  if not ok or type(hl) ~= 'table' then return nil end
  if not hl.fg and not hl.bg then
    -- 未定义的高亮组在 nvim_get_hl 里可能返回空表，链接目标需手动解析。
    local okId, id = pcall(vim.fn.hlID, name)
    if okId and id and id ~= 0 then
      local link = vim.fn.synIDattr(id, 'link', 'gui')
      if link and link ~= '' and link ~= name then
        local ok2, target = pcall(vim.api.nvim_get_hl, 0, { name = link, link = false })
        if ok2 and type(target) == 'table' then hl = target end
      end
    end
  end
  if type(hl) ~= 'table' or (not hl.fg and not hl.bg) then return nil end
  local out = { fg = hex(hl.fg), bg = hex(hl.bg), sp = hex(hl.sp) }
  if hl.bold then out.bold = true end
  if hl.italic then out.italic = true end
  if hl.underline then out.underline = true end
  if hl.strikethrough then out.strikethrough = true end
  if hl.reverse then out.reverse = true end
  return out
end

local function collectColors()
  local colors = {}
  for _, name in ipairs(groups) do
    local color = groupColor(name)
    if color then colors[name] = color end
  end
  return colors
end

local function collectKeymaps()
  local modes = { 'n', 'v', 'x', 'i', 'o', 't' }
  local keymaps = {}
  local seen = {}
  for _, mode in ipairs(modes) do
    local ok, maps = pcall(vim.api.nvim_get_keymap, mode)
    if ok and type(maps) == 'table' then
      for _, map in ipairs(maps) do
        local lhs = map.lhs or ''
        if map.desc and map.desc ~= '' and not lhs:match('^<Plug>') and not lhs:match('^<SNR>') then
          local key = mode .. '\0' .. lhs
          if not seen[key] then
            seen[key] = true
            keymaps[#keymaps + 1] = {
              mode = mode,
              lhs = lhs,
              rhs = map.rhs or '',
              desc = map.desc,
              silent = map.silent == 1,
              sid = map.sid,
            }
          end
        end
      end
    end
  end
  table.sort(keymaps, function(a, b)
    if a.mode ~= b.mode then return a.mode < b.mode end
    return a.lhs < b.lhs
  end)
  return keymaps
end

local function opt(name)
  local ok, value = pcall(function() return vim.o[name] end)
  if ok then return value end
  return nil
end

local function writeProfile()
  local profile = {
    colorscheme = vim.g.colors_name,
    background = vim.o.background,
    termguicolors = vim.o.termguicolors,
    guifont = opt('guifont'),
    options = {
      tabstop = opt('tabstop'),
      shiftwidth = opt('shiftwidth'),
      softtabstop = opt('softtabstop'),
      expandtab = opt('expandtab'),
      number = opt('number'),
      relativenumber = opt('relativenumber'),
      cursorline = opt('cursorline'),
      wrap = opt('wrap'),
      scrolloff = opt('scrolloff'),
      list = opt('list'),
      listchars = opt('listchars'),
      colorcolumn = opt('colorcolumn'),
      signcolumn = opt('signcolumn'),
      foldenable = opt('foldenable'),
      foldmethod = opt('foldmethod'),
      foldlevel = opt('foldlevel'),
      showbreak = opt('showbreak'),
      conceallevel = opt('conceallevel'),
    },
    leader = vim.g.mapleader,
    localleader = vim.g.maplocalleader,
    colors = collectColors(),
    keymaps = collectKeymaps(),
  }
  local out = vim.env.CR_PROFILE_OUT or '/tmp/cr-nvim-profile.json'
  local encoded = vim.json.encode(profile)
  local file = assert(io.open(out, 'w'))
  file:write(encoded)
  file:close()
  vim.cmd('qa!')
end

-- -c 命令在 VimEnter 之前执行；lazy.nvim 的 VeryLazy 插件映射在 VimEnter 之后才注册，
-- 因此延迟到 VimEnter 再收集，保证拿到插件定义的映射。
if #vim.api.nvim_list_uis() == 0 then
  vim.api.nvim_create_autocmd('VimEnter', {
    once = true,
    callback = function()
      vim.defer_fn(writeProfile, 150)
    end,
  })
else
  writeProfile()
end