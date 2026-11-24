// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: CM6 编辑器层与 code-reader UI 契约强绑定
// grill: 成品检索=skill 库无 code-reader CM6 编辑器成品; 输入固定=固定 createEditor 选项与 DOM id; 步骤机械=构建 extensions/绑定 vim; 判读固定=CM6 state 与 vim 事件; 失效场景=构造不出（仅本应用）
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import { tags } from '@lezer/highlight';
import { THEMES, themeById, themeExtensionFor, profileTheme, C_TOKEN_TAGS } from './themes.js';
export { THEMES } from './themes.js';
import { cpp, java } from '@codemirror/legacy-modes/mode/clike';
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { html, xml } from '@codemirror/legacy-modes/mode/xml';
import { css } from '@codemirror/legacy-modes/mode/css';
import { sql } from '@codemirror/legacy-modes/mode/sql';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { r } from '@codemirror/legacy-modes/mode/r';
import { toml } from '@codemirror/legacy-modes/mode/toml';

// Ctrl-i 在 Vim 中是 jump forward，但 CodeMirror defaultKeymap 先把它绑定为
// selectParentSyntax（视觉上像进入 Visual）。Vim 模式下从 defaultKeymap 移除，
// 让 @replit/codemirror-vim 的 <C-i> -> jumpListWalk(forward) 生效。
const DEFAULT_KEYMAP_WITHOUT_CTRL_I = defaultKeymap.filter((binding) => binding.key !== 'Mod-i');

// Vim 的 INSERT/REPLACE 模式才把 Tab 用于缩进；NORMAL/VISUAL 模式不注册 Tab
// 绑定（返回 false），让浏览器默认行为把焦点移出编辑器。静态 indentWithTab
// 会在所有模式吃掉 Tab/Shift+Tab，使编辑器成为无法用 Tab 离开的焦点陷阱。
function vimTypingMode(view) {
  const vimState = getCM(view)?.state?.vim;
  if (!vimState) return false;
  const mode = String(vimState.mode || '');
  return vimState.insertMode === true || mode.startsWith('insert') || mode.startsWith('replace');
}

const VIM_TAB_KEYMAP = Prec.highest(keymap.of([
  {
    key: 'Tab',
    run: (view) => (vimTypingMode(view) ? indentMore(view) : false),
    shift: (view) => (vimTypingMode(view) ? indentLess(view) : false),
  },
]));

// C/C++ 的 legacy 模式只输出 keyword/type/variable 粗粒度 token，而本地 nvim
// 走 treesitter：struct/return/const、函数调用、成员访问、全大写宏颜色各不相同。
// 在 legacy token 之上做一层词法细化，并用 tokenTable 映射到独立 tag。
const C_TYPE_KEYWORDS = new Set(['struct', 'union', 'enum', 'typedef']);
const C_QUALIFIERS = new Set(['const', 'volatile', 'restrict']);
const C_STORAGE = new Set(['static', 'extern', 'register', 'auto', 'inline', 'asm', 'fortran', 'thread_local']);
const C_CONTROL = new Set(['if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do', 'break', 'continue', 'goto']);
const C_OPERATOR_KEYWORDS = new Set(['sizeof', 'alignof', 'offsetof', '_Alignof']);
const C_BASIC_TYPES = new Set(['int', 'long', 'char', 'short', 'double', 'float', 'unsigned', 'signed', 'void', 'bool', '_Bool', '_Complex']);
const C_TYPE_POSITIONS = new Set([null, ';', '{', '}', '(', ',', 'comment', 'keywordType', 'keywordStorage', 'typeNameToken', 'builtinType']);

const C_TOKEN_TABLE = {
  keywordReturn: C_TOKEN_TAGS.keywordReturn,
  keywordType: C_TOKEN_TAGS.keywordType,
  keywordStorage: C_TOKEN_TAGS.keywordStorage,
  keywordControl: tags.controlKeyword,
  keywordOperator: tags.operatorKeyword,
  constantName: C_TOKEN_TAGS.constantName,
  callName: C_TOKEN_TAGS.callName,
  memberName: C_TOKEN_TAGS.memberName,
  typeNameToken: C_TOKEN_TAGS.typeNameToken,
  builtinType: C_TOKEN_TAGS.builtinType,
};

function refineC(parser) {
  return {
    ...parser,
    tokenTable: C_TOKEN_TABLE,
    token(stream, state) {
      const previous = state.crPrevious;
      const style = parser.token(stream, state);
      let refined = style;
      if (style === 'keyword') {
        const word = stream.current();
        if (word === 'return') refined = 'keywordReturn';
        else if (C_TYPE_KEYWORDS.has(word) || C_QUALIFIERS.has(word)) refined = 'keywordType';
        else if (C_STORAGE.has(word)) refined = 'keywordStorage';
        else if (C_CONTROL.has(word)) refined = 'keywordControl';
        else if (C_OPERATOR_KEYWORDS.has(word)) refined = 'keywordOperator';
      } else if (style === 'type') {
        refined = C_BASIC_TYPES.has(stream.current()) ? 'builtinType' : 'typeNameToken';
      } else if (style === 'def') {
        // struct/typedef 后面的名字也会被 legacy 模式判成 def；只有后接
        // '(' 的才是函数定义，其余按类型名处理。
        refined = stream.match(/^\s*\(/, false) ? 'callName' : 'typeNameToken';
      } else if (style === 'variable') {
        const word = stream.current();
        const before = (stream.string || '').slice(0, stream.start);
        if (/(?:\.|->)\s*$/.test(before)) refined = 'memberName';
        else if (stream.match(/^\s*\(/, false)) refined = 'callName';
        else if (/^[A-Z][A-Z0-9_]*$/.test(word)) refined = 'constantName';
        else if ((previous === undefined || C_TYPE_POSITIONS.has(previous)) && stream.match(/^\s*(?:\*|[A-Za-z_])/, false)) refined = 'typeNameToken';
      }
      state.crPrevious = refined;
      return refined;
    },
  };
}

const C_PARSER = refineC(cpp);

const MODES_BY_EXTENSION = new Map(Object.entries({
  c: C_PARSER,
  h: C_PARSER,
  cc: C_PARSER,
  cpp: C_PARSER,
  cxx: C_PARSER,
  hpp: C_PARSER,
  s: C_PARSER,
  java: java,
  py: python,
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  ts: typescript,
  go: go,
  rs: rust,
  sh: shell,
  bash: shell,
  json: json,
  yaml: yaml,
  yml: yaml,
  html: html,
  css: css,
  xml: xml,
  sql: sql,
  pl: perl,
  perl: perl,
  rb: ruby,
  lua: lua,
  r: r,
  toml: toml,
}));

function extensionOf(filePath) {
  const index = String(filePath || '').lastIndexOf('.');
  return index === -1 ? '' : filePath.slice(index + 1).toLowerCase();
}

function languageFor(filePath) {
  const parser = MODES_BY_EXTENSION.get(extensionOf(filePath));
  return parser ? StreamLanguage.define(parser) : [];
}

class WhitespaceWidget extends WidgetType {
  constructor(text, className) {
    super();
    this.text = text;
    this.className = className;
  }

  eq(other) {
    return other.text === this.text && other.className === this.className;
  }

  toDOM() {
    const element = document.createElement('span');
    element.className = `cm-ws-mark ${this.className}`;
    element.textContent = this.text;
    return element;
  }

  ignoreEvent() {
    return true;
  }
}

function listChars(value) {
  const result = {};
  for (const part of String(value || '').split(',')) {
    const index = part.indexOf(':');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const character = part.slice(index + 1).trim().charAt(0);
    if (character) result[key] = character;
  }
  return result;
}

// 按本地 list/listchars 显示 tab、尾随空格与不换行空格（对应 nvim 的 » / · / ␣）。
function whitespaceExtension(options) {
  if (!options?.list) return [];
  const chars = listChars(options.listchars);
  if (!chars.tab && !chars.trail && !chars.nbsp) return [];
  const build = (view) => {
    const widgets = [];
    const doc = view.state.doc;
    for (const range of view.visibleRanges) {
      let position = range.from;
      while (position <= range.to && widgets.length < 4000) {
        const line = doc.lineAt(position);
        const text = line.text;
        const special = /\t|\u00a0/g;
        let match;
        while ((match = special.exec(text)) && widgets.length < 4000) {
          const character = match[0];
          const absolute = line.from + match.index;
          if (character === '\t' && chars.tab) {
            widgets.push(Decoration.widget({ widget: new WhitespaceWidget(chars.tab, 'cm-ws-tab'), side: -1 }).range(absolute));
          } else if (character === '\u00a0' && chars.nbsp) {
            widgets.push(Decoration.widget({ widget: new WhitespaceWidget(chars.nbsp, 'cm-ws-nbsp'), side: -1 }).range(absolute));
          }
        }
        if (chars.trail) {
          const match = /[ ]+$/.exec(text);
          if (match) {
            const start = line.from + match.index;
            for (let index = 0; index < match[0].length && widgets.length < 4000; index += 1) {
              widgets.push(Decoration.widget({ widget: new WhitespaceWidget(chars.trail, 'cm-ws-trail'), side: -1 }).range(start + index));
            }
          }
        }
        if (line.to >= doc.length) break;
        position = line.to + 1;
      }
      if (widgets.length >= 4000) break;
    }
    return Decoration.set(widgets, true);
  };
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = build(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  }, { decorations: (value) => value.decorations });
  return [plugin];
}

export function createEditor({ onCursorLine, onAsk, onGotoDefinition, onGotoReferences, onJumpBack, onJumpForward, onFocusTree, onOpenFile, onExComplete, onHelp, onWorkspaceSearch, onKeymap, onReadingTrail, theme = 'one-dark', profile = null }) {
  const host = document.getElementById('editor-host');
  const mount = document.getElementById('editor');
  const quickpick = document.getElementById('quickpick');
  const vimModeElement = document.getElementById('vim-mode');
  const cursorPosElement = document.getElementById('cursor-pos');
  const languageCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const displayCompartment = new Compartment();
  let currentTheme = theme === 'local' ? 'local' : themeById(theme).id;
  let currentProfile = profile?.available ? profile : null;

  function paletteFor(id) {
    if (id === 'local') return currentProfile ? profileTheme(currentProfile) : themeById(THEMES[0].id);
    return themeById(id);
  }

  function themeExtensionsFor(id) {
    return themeExtensionFor(paletteFor(id));
  }

  function displayExtensions() {
    if (!currentProfile) {
      return [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine()];
    }
    const options = currentProfile.options || {};
    const tabstop = Number.isInteger(options.tabstop) ? Math.min(Math.max(options.tabstop, 1), 16) : 4;
    const shiftwidth = Number.isInteger(options.shiftwidth) ? Math.max(options.shiftwidth, 1) : tabstop;
    const extensions = [
      EditorState.tabSize.of(tabstop),
      indentUnit.of(options.expandtab ? ' '.repeat(shiftwidth) : '\t'),
      EditorView.theme({ '.cm-content': { tabSize: String(tabstop) } }),
    ];
    if (options.number !== false) {
      extensions.push(lineNumbers());
      if (options.cursorline) extensions.push(highlightActiveLineGutter());
    }
    if (options.cursorline) extensions.push(highlightActiveLine());
    if (options.wrap) extensions.push(EditorView.lineWrapping);
    extensions.push(...whitespaceExtension(options));
    return extensions;
  }

  const state = {
    loaded: false,
    path: null,
    quickpickItems: null,
    quickpickIndex: 0,
    quickpickOnPick: null,
    quickpickTitle: '',
    quickpickPreviewLoader: null,
    quickpickPreview: null,
    quickpickPreviewToken: 0,
    // 搜索型 quickpick：标题下方的输入框、空态文案与会话标识。
    quickpickInput: null,
    quickpickInputElement: null,
    quickpickEmptyText: '',
    quickpickSession: null,
  };
  let cursorTimer = null;
  let view = null;
  // gg 连击窗口（引用列表）：700ms 内按两次 g 跳到第一项。
  let quickpickGPressedAt = 0;

  Vim.defineAction('readerGotoDefinition', () => onGotoDefinition());
  Vim.mapCommand('gd', 'action', 'readerGotoDefinition', undefined, { context: 'normal' });
  Vim.defineAction('readerGotoReferences', () => onGotoReferences());
  Vim.mapCommand('gr', 'action', 'readerGotoReferences', undefined, { context: 'normal' });
  Vim.defineAction('readerAskLine', () => onAsk());
  Vim.mapCommand('\\c', 'action', 'readerAskLine', undefined, { context: 'normal' });
  Vim.defineAction('readerFocusTree', () => {
    if (typeof onFocusTree === 'function') onFocusTree();
  });
  Vim.mapCommand('\\e', 'action', 'readerFocusTree', undefined, { context: 'normal' });
  Vim.defineAction('readerWorkspaceSearch', () => {
    if (typeof onWorkspaceSearch === 'function') onWorkspaceSearch();
  });
  Vim.mapCommand('\\s', 'action', 'readerWorkspaceSearch', undefined, { context: 'normal' });

  // Ctrl-o / Ctrl-i：优先走应用级跳转栈（跨文件 gd/gr 有效）；栈空时回退到
  // codemirror-vim 自带的 jumplist（G/gg/搜索等 vim 动作）。
  function runVimJump(key, actionName) {
    const cm = view ? getCM(view) : null;
    if (!cm) return;
    Vim.unmap(key, 'normal');
    try {
      Vim.handleKey(cm, key, 'normal');
    } finally {
      Vim.mapCommand(key, 'action', actionName, undefined, { context: 'normal' });
    }
  }
  Vim.defineAction('readerJumpBack', () => {
    Promise.resolve(typeof onJumpBack === 'function' && onJumpBack()).then((handled) => {
      if (!handled) runVimJump('<C-o>', 'readerJumpBack');
    }).catch((error) => { document.getElementById('source-status').textContent = `跳回失败：${error.message}`; });
  });
  Vim.mapCommand('<C-o>', 'action', 'readerJumpBack', undefined, { context: 'normal' });
  Vim.defineAction('readerJumpForward', () => {
    Promise.resolve(typeof onJumpForward === 'function' && onJumpForward()).then((handled) => {
      if (!handled) runVimJump('<C-i>', 'readerJumpForward');
    }).catch((error) => { document.getElementById('source-status').textContent = `前进失败：${error.message}`; });
  });
  Vim.mapCommand('<C-i>', 'action', 'readerJumpForward', undefined, { context: 'normal' });

  Vim.defineEx('ask', 'ask', () => onAsk());
  Vim.defineEx('gd', 'gd', () => onGotoDefinition());
  Vim.defineEx('gr', 'gr', () => onGotoReferences());
  Vim.defineEx('grep', 'grep', () => onWorkspaceSearch());
  Vim.defineEx('search', 'search', () => onWorkspaceSearch());
  Vim.defineEx('help', 'h', () => {
    if (typeof onHelp === 'function') onHelp();
  });
  const openExFile = (params) => {
    const target = String(params?.argString || '').trim();
    if (!target || typeof onOpenFile !== 'function') return;
    onOpenFile(target);
  };
  Vim.defineEx('e', 'e', (cm, params) => openExFile(params));
  Vim.defineEx('edit', 'edit', (cm, params) => openExFile(params));
  Vim.defineEx('vi', 'vi', (cm, params) => openExFile(params));
  Vim.defineEx('vsplit', 'vs', (cm, params) => openExFile(params));
  Vim.defineEx('tree', 'tree', () => {
    if (typeof onFocusTree === 'function') onFocusTree();
  });
  // 快捷键改绑与阅读路径列表：与左下角「快捷键」/ Ctrl+Alt+R 同一条能力路径。
  Vim.defineEx('keys', 'keys', () => {
    if (typeof onKeymap === 'function') onKeymap();
  });
  Vim.defineEx('keymap', 'keymap', () => {
    if (typeof onKeymap === 'function') onKeymap();
  });
  Vim.defineEx('trail', 'trail', () => {
    if (typeof onReadingTrail === 'function') onReadingTrail();
  });

  const EX_COMMAND_NAMES = [
    'ask', 'colorscheme', 'e', 'edit', 'gd', 'gr', 'grep', 'help', 'keymap', 'keys', 'map',
    'nmap', 'norm', 'q', 'qa', 'search', 'set', 'sort', 'trail', 'tree', 'vi', 'vmap',
    'vsplit', 'w', 'wq',
  ];
  const FILE_EX_COMMANDS = new Set(['e', 'edit', 'vi', 'vsplit']);
  function exCompletions(value) {
    const text = String(value || '').replace(/^:/, '');
    const space = text.search(/\s/);
    if (space === -1) {
      return EX_COMMAND_NAMES
        .filter((name) => name.startsWith(text))
        .sort()
        .map((name) => `${name} `);
    }
    const command = text.slice(0, space);
    if (!FILE_EX_COMMANDS.has(command) || typeof onExComplete !== 'function') return [];
    const argument = text.slice(space + 1);
    return onExComplete(argument).map((filePath) => `${command} ${filePath}`);
  }
  const searchHistory = [];
  document.addEventListener('keydown', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || event.isComposing) return;
    const panel = input.closest('.cm-vim-panel');
    if (!panel || !/^[/?]/.test(panel.textContent.trim())) return;
    if (event.key === 'ArrowUp') {
      if (!searchHistory.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const index = Math.min((input.__crHistoryIndex ?? -1) + 1, searchHistory.length - 1);
      input.__crHistoryIndex = index;
      input.value = searchHistory[index];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (event.key === 'Enter') {
      if (input.value) {
        const old = searchHistory.indexOf(input.value);
        if (old >= 0) searchHistory.splice(old, 1);
        searchHistory.unshift(input.value);
        searchHistory.splice(100);
      }
      // Let Vim commit the query before removing focus from its command input.
      setTimeout(() => {
        if (document.activeElement === input) {
          Vim.handleKey(getCM(view), '<Esc>');
          view.focus();
        }
      }, 0);
    } else if (event.key.length === 1 || event.key === 'Backspace') {
      input.__crHistoryIndex = -1;
    }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const panel = input.closest('.cm-vim-panel');
    if (!panel || !panel.textContent.startsWith(':')) return;
    const candidates = exCompletions(input.value);
    if (!candidates.length) return;
    event.preventDefault();
    event.stopPropagation();
    let cycle = input.__crExCompletion;
    if (!cycle || cycle.value !== input.value) {
      cycle = { value: input.value, index: 0, items: candidates };
      input.__crExCompletion = cycle;
    }
    const next = cycle.items[cycle.index % cycle.items.length];
    cycle.index += 1;
    cycle.value = next;
    input.value = next;
    input.setSelectionRange(next.length, next.length);
  }, true);

  const appKeymap = Prec.highest(keymap.of([
    ...['o', 'i'].map((key) => ({
      key: `Ctrl-${key}`,
      run: () => {
        if (vimTypingMode(view)) return false;
        Vim.handleKey(getCM(view), `<C-${key}>`, 'normal');
        return true;
      },
    })),
    {
      key: 'Ctrl-]',
      run: () => {
        onGotoDefinition();
        return true;
      },
    },
  ]));

  function updateCursorPos() {
    if (!view) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    cursorPosElement.textContent = `${line.number}:${head - line.from + 1}`;
  }

  function vimStateOf() {
    try {
      return view ? getCM(view)?.state?.vim || null : null;
    } catch {
      return null;
    }
  }

  function updateVimMode() {
    let label = '--NORMAL--';
    const vimState = vimStateOf();
    if (vimState) {
      const mode = String(vimState.mode || '');
      if (mode.startsWith('insert') || vimState.insertMode) label = '--INSERT--';
      else if (mode === 'visual line' || vimState.visualLine) label = '--VISUAL LINE--';
      else if (mode === 'visual block' || vimState.visualBlock) label = '--VISUAL BLOCK--';
      else if (mode.startsWith('visual') || vimState.visualMode) label = '--VISUAL--';
      if (vimState.status) label += ` ${vimState.status}`;
    }
    vimModeElement.textContent = label;
  }

  function attachVimEvents() {
    const cm = view ? getCM(view) : null;
    if (!cm || cm.__readerVimBound) return;
    cm.__readerVimBound = true;
    for (const event of ['vim-mode-change', 'vim-command-done', 'vim-keypress']) {
      if (typeof cm.on === 'function') cm.on(event, () => setTimeout(updateVimMode, 0));
    }
  }

  // ---- NORMAL 模式的文本输入保护 ----
  // NORMAL/VISUAL 模式下不该有任何文本写入文档，但输入法组字会绕过 vim 命令层
  // 直接提交文本：上游 @replit/codemirror-vim 把单字符提交当成 vim 按键（提交
  // "i" 会进入 INSERT），多字符提交则按普通文本插进代码里（切换输入法时把整串
  // 拼音落进源码）。这里在 inputHandler 最前层直接丢弃 NORMAL/VISUAL 下的组字
  // 提交；CM6 在所有 handler 返回 true 且 state 未变化时会 view.update([]) 从
  // state 重置 DOM，所以不需要再手工清 DOM。r/f/t 等需要字面字符的动作例外。
  // 例外二是输入法「直通键」：中文模式（半角标点）下 shift+8 这类符号键不进
  // 组字，keydown 只报 Process，随后直接提交单个符号字符——它本来就是 vim 命令
  // 键（* 搜光标下单词、#、%、数字计数…），必须转交 vim 执行；否则输入法一开，
  // 这些命令全部失效。区分依据：提交前后没有任何组字（composition）事件。
  let imeFlashTimer = null;
  // 最近一次组字事件（compositionstart/update/end）的时间。组字提交往往在
  // compositionend 之后才被 CM 的 DOMObserver 处理成文本输入，所以用一个短
  // 时间窗把「刚从组字里出来的提交」也归为组字文本，继续丢弃。
  let compositionSeenAt = 0;
  const COMPOSITION_RECENT_MS = 350;

  function noteComposition() {
    compositionSeenAt = Date.now();
  }

  // 直通键可能提交的符号字符：单个 ASCII 可打印字符按原样交给 vim；全角符号
  // （输入法全角标点模式下 shift+8 提交的是 '＊'）还原成对应 ASCII 再交。中文
  // 标点模式下部分符号键提交的是 CJK 标点（'/' → '、'、'.' → '。'、'$' → '￥'、
  // '<' → '《'、'>' → '》'、'`' → '·'），同样还原成原键的 ASCII 命令字符，否则
  // '/' 搜索、'.' 重复这些命令在中文标点下全部失效。
  const IME_PUNCT_KEY = new Map([
    ['、', '/'],
    ['。', '.'],
    ['￥', '$'],
    ['《', '<'],
    ['》', '>'],
    ['·', '`'],
  ]);
  function directVimKey(text) {
    if (text.length !== 1) return null;
    const code = text.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) return text;
    if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
    return IME_PUNCT_KEY.get(text) || null;
  }

  function flashTextInputIgnored() {
    if (!vimModeElement) return;
    vimModeElement.textContent = '--NORMAL-- 已忽略文字输入（按 i 插入）';
    clearTimeout(imeFlashTimer);
    imeFlashTimer = setTimeout(() => updateVimMode(), 1800);
  }

  function textInputGuard() {
    return Prec.highest(EditorView.inputHandler.of((targetView, from, to, text) => {
      if (!text) return false;
      const cm = getCM(targetView);
      const vimState = cm?.state?.vim;
      if (!vimState || vimState.insertMode) return false;
      // r / f / t 等动作正在等一个字面字符：输入法字符就是它要的字符。
      if (vimState.expectLiteralNext) return false;
      // 非组字提交的可打印单字符 = 输入法直通键，当 vim 命令键执行。调用形态
      // 与上游 vim 插件自己的 inputHandler 一致（fake KeyboardEvent 只带 key）。
      // 返回 true 兜底：即使该键在 vim 里没有映射，文本也绝不能写进文档。
      const composing = targetView.composing
        || Date.now() - compositionSeenAt < COMPOSITION_RECENT_MS;
      const directKey = composing ? null : directVimKey(text);
      if (directKey && typeof cm?.state?.vimPlugin?.handleKey === 'function') {
        cm.state.vimPlugin.handleKey({
          key: directKey,
          preventDefault() {},
          stopPropagation() {},
        });
        clearTimeout(imeFlashTimer);
        updateVimMode();
        return true;
      }
      // CM 在组字期间（inputState.composing > 0）忽略所有按键；我们丢弃了提交
      // 文本，个别浏览器/输入法路径不会补 compositionend，必须显式结束组字，
      // 否则之后的 j/k/i 全部失效（vim 也只看到 Process 键）。上游插件在
      // forceEndComposition 里同样用合成 compositionend 收尾。
      targetView.contentDOM.dispatchEvent(new CustomEvent('compositionend'));
      clearTimeout(imeFlashTimer);
      flashTextInputIgnored();
      return true;
    }));
  }

  function getCursor() {
    if (!view) return { line: 1, character: 0 };
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return { line: line.number, character: head - line.from };
  }

  function onSelectionChanged() {
    updateCursorPos();
    setTimeout(updateVimMode, 0);
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
      if (state.loaded) onCursorLine(getCursor().line);
    }, 180);
  }

  function extensionsFor(filePath) {
    return [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      languageCompartment.of(languageFor(filePath)),
      themeCompartment.of(themeExtensionsFor(currentTheme)),
      displayCompartment.of(displayExtensions()),
      appKeymap,
      VIM_TAB_KEYMAP,
      textInputGuard(),
      keymap.of([...DEFAULT_KEYMAP_WITHOUT_CTRL_I, ...searchKeymap, ...historyKeymap]),
      vim(),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) onSelectionChanged();
      }),
      EditorView.domEventHandlers({
        keydown: () => {
          setTimeout(updateVimMode, 0);
          return false;
        },
      }),
    ];
  }

  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: extensionsFor('') }),
    parent: mount,
  });
  attachVimEvents();
  // 组字事件时间戳：textInputGuard 靠它区分「组字提交（丢弃）」与「直通键
  // 提交（交给 vim）」。挂在 contentDOM 原生事件上，跨 openFile 重建 state
  // 依然有效；guard 合成的 compositionend 也会刷新时间戳，方向是安全的。
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
    view.contentDOM.addEventListener(type, noteComposition);
  }
  updateCursorPos();

  // 打开/定位内容默认把焦点交给编辑器；后台恢复传 focus:false，由调用方在
  // 内容到达后统一决定焦点归属，避免把焦点从用户已打开的窗口抢回来。
  function openFile(filePath, content, { focus = true } = {}) {
    state.loaded = false;
    state.path = filePath;
    view.setState(EditorState.create({
      doc: String(content ?? ''),
      extensions: extensionsFor(filePath),
    }));
    view.scrollDOM.scrollTop = 0;
    if (focus) view.focus();
    state.loaded = true;
    attachVimEvents();
    updateVimMode();
    updateCursorPos();
  }

  function revealPosition(line, character = 0, { focus = true } = {}) {
    if (!view) return;
    const doc = view.state.doc;
    const number = Math.min(Math.max(1, line), doc.lines);
    const info = doc.line(number);
    const position = Math.min(info.from + Math.max(0, character), info.to);
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: 'center' }),
    });
    if (focus) view.focus();
  }

  function show() {
    host.hidden = false;
    view.requestMeasure();
  }

  function hide() {
    host.hidden = true;
  }

  function focus() {
    view.focus();
  }

  function getValue() {
    return view.state.doc.toString();
  }

  function renderQuickpickRow(item, index) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `quickpick-row${index === state.quickpickIndex ? ' active' : ''}`;
    const indexElement = document.createElement('span');
    indexElement.className = 'quickpick-index';
    indexElement.textContent = String(index + 1);
    const target = document.createElement('span');
    target.className = `quickpick-target${item.label ? ' quickpick-target-search' : ''}`;
    if (item.label) {
      // 工作区搜索：函数名/文件名 + 类型 + 位置，完全匹配已在服务端排前。
      const label = document.createElement('span');
      label.className = 'quickpick-label';
      label.textContent = item.label;
      const kind = document.createElement('span');
      kind.className = `quickpick-kind quickpick-kind-${item.kind || 'file'}`;
      kind.textContent = item.detail || '';
      const location = document.createElement('span');
      location.className = 'quickpick-location';
      location.textContent = `${item.path}:${item.line}`;
      target.append(label, kind, location);
    } else {
      target.textContent = `${item.path}:${item.line}:${item.character + 1}`;
    }
    row.append(indexElement, target);
    row.addEventListener('click', () => pickQuickpick(index));
    row.addEventListener('mouseenter', () => setQuickpickIndex(index));
    return row;
  }

  function renderQuickpickList() {
    const list = quickpick.querySelector('.quickpick-list');
    if (!list) return;
    const items = state.quickpickItems || [];
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'quickpick-empty';
      empty.textContent = state.quickpickEmptyText
        || (state.quickpickInput ? '输入关键字开始搜索…' : '没有可选项');
      list.append(empty);
      return;
    }
    items.forEach((item, index) => list.append(renderQuickpickRow(item, index)));
  }

  function renderQuickpick() {
    const items = state.quickpickItems || [];
    quickpick.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'quickpick-heading';
    heading.textContent = state.quickpickTitle
      || `${items.length} 个跳转目标 · ↑↓ 选择 · Enter 跳转 · Esc 取消`;
    quickpick.append(heading);
    state.quickpickInputElement = null;
    if (state.quickpickInput) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'quickpick-input';
      input.placeholder = state.quickpickInput.placeholder || '搜索…';
      input.value = state.quickpickInput.value || '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.addEventListener('input', () => {
        state.quickpickInput.value = input.value;
        if (typeof state.quickpickInput.onChange === 'function') state.quickpickInput.onChange(input.value);
      });
      state.quickpickInputElement = input;
      quickpick.append(input);
    }
    const body = document.createElement('div');
    body.className = 'quickpick-body';
    const list = document.createElement('div');
    list.className = 'quickpick-list';
    body.append(list);
    if (state.quickpickPreviewLoader) {
      const preview = document.createElement('div');
      preview.className = 'quickpick-preview';
      renderQuickpickPreview(preview);
      body.append(preview);
    }
    quickpick.append(body);
    renderQuickpickList();
  }

  // 引用预览的另一窗口：显示选中引用前后 10 行，并标出所在函数（Caller）。
  function renderQuickpickPreview(container) {
    const preview = state.quickpickPreview;
    container.classList.toggle('pending', Boolean(preview?.pending));
    if (!preview || preview.status === 'loading') {
      container.textContent = state.quickpickInput && !preview
        ? '输入关键字后显示上下文预览'
        : '正在读取引用上下文…';
      return;
    }
    if (preview.status === 'error') {
      const error = document.createElement('div');
      error.className = 'quickpick-preview-error';
      error.textContent = preview.message || '上下文读取失败';
      container.append(error);
      return;
    }
    const data = preview.data;
    if (!data) {
      container.textContent = '没有可显示的上下文';
      return;
    }
    const head = document.createElement('div');
    head.className = 'quickpick-preview-head';
    const title = document.createElement('div');
    title.className = 'quickpick-preview-title';
    title.textContent = `${data.path}:${data.line}`;
    const caller = document.createElement('div');
    caller.className = 'quickpick-preview-caller';
    caller.textContent = data.caller
      ? `Caller: ${data.caller}${data.callerStart ? ` · 函数 ${data.callerStart}-${data.callerEnd}` : ''}`
      : 'Caller: （当前行不在可识别的函数内）';
    head.append(title, caller);
    const code = document.createElement('div');
    code.className = 'quickpick-preview-code';
    const width = String(data.lineEnd || data.line || 1).length;
    for (const row of data.lines || []) {
      const lineElement = document.createElement('div');
      lineElement.className = `quickpick-preview-line${row.number === data.line ? ' target' : ''}`;
      const number = document.createElement('span');
      number.className = 'quickpick-preview-number';
      number.textContent = String(row.number).padStart(width, ' ');
      const text = document.createElement('span');
      text.className = 'quickpick-preview-text';
      text.textContent = row.text === '' ? ' ' : row.text;
      lineElement.append(number, text);
      code.append(lineElement);
    }
    container.append(head, code);
  }

  function updateQuickpickSelection() {
    const rows = quickpick.querySelectorAll('.quickpick-row');
    rows.forEach((row, index) => row.classList.toggle('active', index === state.quickpickIndex));
    rows[state.quickpickIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function updateQuickpickPreview() {
    const preview = quickpick.querySelector('.quickpick-preview');
    if (!preview) return;
    preview.replaceChildren();
    renderQuickpickPreview(preview);
  }

  // 预取相邻引用项的上下文：j/k 连续移动时下一个通常已命中缓存，
// 预览不必每次都走「读取中」。
  function warmQuickpickPreview(index) {
    const loader = state.quickpickPreviewLoader;
    const items = state.quickpickItems || [];
    if (!loader || !items.length) return;
    for (const offset of [1, -1]) {
      const neighbor = items[(index + offset + items.length) % items.length];
      if (!neighbor) continue;
      Promise.resolve().then(() => loader(neighbor)).catch(() => {});
    }
  }

  function loadQuickpickPreview(index) {
    const loader = state.quickpickPreviewLoader;
    const items = state.quickpickItems || [];
    const item = items[index];
    if (!loader || !item) return;
    const token = ++state.quickpickPreviewToken;
    // 已经有预览时保留旧内容，只加 pending 提示；直接清空会让面板高度
    // 在「一行提示 ↔ 21 行代码」之间反复跳，j/k 导航时就是用户看到的闪烁。
    if (state.quickpickPreview?.status === 'done') {
      state.quickpickPreview = { ...state.quickpickPreview, pending: true };
    } else {
      state.quickpickPreview = { status: 'loading', item };
    }
    updateQuickpickPreview();
    Promise.resolve()
      .then(() => loader(item))
      .then((data) => {
        if (token !== state.quickpickPreviewToken || !state.quickpickItems) return;
        state.quickpickPreview = { status: 'done', item, data };
        updateQuickpickPreview();
        warmQuickpickPreview(index);
      })
      .catch((error) => {
        if (token !== state.quickpickPreviewToken || !state.quickpickItems) return;
        state.quickpickPreview = { status: 'error', item, message: error.message };
        updateQuickpickPreview();
      });
  }

  function setQuickpickIndex(index) {
    const items = state.quickpickItems;
    if (!items || !items.length) return;
    state.quickpickIndex = ((index % items.length) + items.length) % items.length;
    updateQuickpickSelection();
    if (state.quickpickPreviewLoader) loadQuickpickPreview(state.quickpickIndex);
    // 搜索型 quickpick 的焦点属于输入框；列表导航不能把焦点抢走。
    if (!state.quickpickInputElement) quickpick.focus();
  }

  function showQuickpick(items, onPick, options = {}) {
    state.quickpickItems = items;
    state.quickpickIndex = 0;
    state.quickpickOnPick = onPick;
    state.quickpickTitle = options.title || '';
    state.quickpickPreviewLoader = typeof options.preview === 'function' ? options.preview : null;
    state.quickpickPreview = null;
    state.quickpickPreviewToken += 1;
    state.quickpickInput = options.input || null;
    state.quickpickInputElement = null;
    state.quickpickEmptyText = options.emptyText || '';
    state.quickpickSession = options.sessionId || null;
    quickpick.classList.toggle('has-preview', Boolean(state.quickpickPreviewLoader));
    renderQuickpick();
    quickpick.hidden = false;
    quickpick.tabIndex = -1;
    if (state.quickpickInputElement) state.quickpickInputElement.focus();
    else quickpick.focus();
    if (state.quickpickPreviewLoader) loadQuickpickPreview(0);
  }

  // 搜索输入变化后只重建列表，保留输入框焦点与光标位置。
  function updateQuickpickItems(items, options = {}) {
    if (!state.quickpickItems) return false;
    // 会话标识必须完全一致：搜索请求慢返回时不能覆盖后来打开的引用列表。
    if (options.sessionId && options.sessionId !== state.quickpickSession) return false;
    state.quickpickItems = Array.isArray(items) ? items : [];
    state.quickpickIndex = 0;
    if (typeof options.title === 'string') {
      state.quickpickTitle = options.title;
      const heading = quickpick.querySelector('.quickpick-heading');
      if (heading) heading.textContent = options.title;
    }
    if (typeof options.emptyText === 'string') state.quickpickEmptyText = options.emptyText;
    renderQuickpickList();
    if (state.quickpickPreviewLoader) {
      state.quickpickPreviewToken += 1;
      state.quickpickPreview = null;
      if (state.quickpickItems.length) loadQuickpickPreview(0);
      else updateQuickpickPreview();
    }
    return true;
  }

  function isQuickpickOpen() {
    return Boolean(state.quickpickItems) && !quickpick.hidden;
  }

  function pickQuickpick(index) {
    const items = state.quickpickItems || [];
    const callback = state.quickpickOnPick;
    const item = items[index];
    // 搜索无结果时 Enter 不应关闭面板；只有真正选中一项才跳转。
    if (!item) return;
    closeQuickpick();
    if (callback) callback(item);
  }

  function closeQuickpick() {
    state.quickpickItems = null;
    state.quickpickOnPick = null;
    state.quickpickTitle = '';
    state.quickpickPreviewLoader = null;
    state.quickpickPreview = null;
    state.quickpickPreviewToken += 1;
    state.quickpickInput = null;
    state.quickpickInputElement = null;
    state.quickpickEmptyText = '';
    state.quickpickSession = null;
    quickpick.hidden = true;
    quickpick.classList.remove('has-preview');
    quickpick.replaceChildren();
    focus();
  }

  function quickpickKeydown(event) {
    const items = state.quickpickItems;
    if (!items) return false;
    if (event.defaultPrevented) return true;
    // 搜索输入框聚焦时，字符键属于输入（j/k/数字/Ctrl+d 等都不要当导航）；
    // 只保留列表导航键。
    const typing = event.target instanceof HTMLInputElement
      && event.target.classList.contains('quickpick-input');
    // 输入框里字符键属于搜索词；列表导航用 ↑/↓、PageUp/PageDown，或 Ctrl+j/k。
    const navigationKey = ['Escape', 'ArrowDown', 'ArrowUp', 'Enter', 'PageDown', 'PageUp'].includes(event.key)
      || (event.ctrlKey && (event.key === 'j' || event.key === 'k'));
    if (typing && !navigationKey) {
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeQuickpick();
    } else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'j') || event.key === 'j') {
      event.preventDefault();
      event.stopPropagation();
      setQuickpickIndex(state.quickpickIndex + 1);
    } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'k') || event.key === 'k') {
      event.preventDefault();
      event.stopPropagation();
      setQuickpickIndex(state.quickpickIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      pickQuickpick(state.quickpickIndex);
    } else if (event.ctrlKey && ['d', 'u', 'f', 'b'].includes(event.key)) {
      // 半屏/整屏：Ctrl+d/u/f/b（与其它窗口的 Vim 键一致）。
      event.preventDefault();
      event.stopPropagation();
      const list = quickpick.querySelector('.quickpick-list');
      const rowHeight = quickpick.querySelector('.quickpick-row')?.getBoundingClientRect().height || 24;
      const page = Math.max(1, Math.floor((list?.clientHeight || 240) / Math.max(16, rowHeight)));
      const step = event.key === 'd' || event.key === 'u'
        ? Math.max(1, Math.round(page / 2))
        : page;
      const direction = event.key === 'd' || event.key === 'f' ? 1 : -1;
      setQuickpickIndex(state.quickpickIndex + direction * step);
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      event.stopPropagation();
      const list = quickpick.querySelector('.quickpick-list');
      const rowHeight = quickpick.querySelector('.quickpick-row')?.getBoundingClientRect().height || 24;
      const page = Math.max(1, Math.floor((list?.clientHeight || 240) / Math.max(16, rowHeight)));
      setQuickpickIndex(state.quickpickIndex + (event.key === 'PageDown' ? page : -page));
    } else if (event.key === 'H' || event.key === 'M' || event.key === 'L') {
      event.preventDefault();
      event.stopPropagation();
      const index = event.key === 'H' ? 0
        : event.key === 'M' ? Math.floor((items.length - 1) / 2)
          : items.length - 1;
      setQuickpickIndex(index);
    } else if (event.key === 'G') {
      event.preventDefault();
      event.stopPropagation();
      quickpickGPressedAt = 0;
      setQuickpickIndex(items.length - 1);
    } else if (event.key === 'g') {
      // Vim 风格 gg：连按两次跳到第一项。
      const now = Date.now();
      if (now - quickpickGPressedAt <= 700) {
        quickpickGPressedAt = 0;
        event.preventDefault();
        event.stopPropagation();
        setQuickpickIndex(0);
      } else {
        quickpickGPressedAt = now;
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < items.length) {
        event.preventDefault();
        event.stopPropagation();
        pickQuickpick(index);
      }
    }
    return true;
  }

  quickpick.addEventListener('keydown', quickpickKeydown);

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (!host.hidden) view.requestMeasure();
    });
    observer.observe(host);
  }

  function snapshot() {
    const vimState = vimStateOf();
    let mode = 'NORMAL';
    if (vimState) {
      if (vimState.insertMode || String(vimState.mode || '').startsWith('insert')) mode = 'INSERT';
      else if (vimState.visualMode) mode = 'VISUAL';
    }
    return {
      path: state.path,
      lines: view.state.doc.lines,
      cursor: getCursor(),
      mode,
      quickpickOpen: Boolean(state.quickpickItems),
    };
  }

  // sneak（两字符跳转）只需要当前视口内的匹配：看不到的文本不应生成标签。
  // 返回的是视口坐标，供导航层直接定位徽标；from/to 用于跳转时恢复编辑器选区。
  function visibleMatches(query, limit = 80) {
    const needle = String(query || '');
    if (!needle) return [];
    const matches = [];
    const doc = view.state.doc;
    outer: for (const range of view.visibleRanges) {
      let pos = range.from;
      while (pos <= range.to) {
        const line = doc.lineAt(pos);
        const from = Math.max(line.from, range.from);
        const to = Math.min(line.to, range.to);
        if (to >= from) {
          const text = doc.sliceString(from, to);
          let index = text.indexOf(needle);
          while (index >= 0) {
            const matchFrom = from + index;
            const startCoords = view.coordsAtPos(matchFrom);
            const endCoords = view.coordsAtPos(matchFrom + needle.length);
            const top = Math.min(startCoords?.top ?? 0, endCoords?.top ?? 0);
            const bottom = Math.max(startCoords?.bottom ?? 0, endCoords?.bottom ?? 0);
            if (startCoords && endCoords && bottom > 0 && top < window.innerHeight) {
              const left = Math.min(startCoords.left, endCoords.left);
              // coordsAtPos 是光标矩形（宽度可能为 0），用起止两点合成匹配文本的矩形。
              const right = Math.max(startCoords.right, endCoords.right, left + 4);
              matches.push({
                line: line.number,
                from: matchFrom,
                to: matchFrom + needle.length,
                left,
                top,
                right,
                bottom,
              });
              if (matches.length >= limit) break outer;
            }
            index = text.indexOf(needle, index + Math.max(1, needle.length));
          }
        }
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
    }
    return matches;
  }

  // easymotion 风格行标签：给视口内每个逻辑行首打标签，输入标签即把光标移到该行。
  // 只覆盖视口（visibleRanges），滚动后由导航层重新取坐标。
  function visibleLines(limit = 160) {
    const lines = [];
    const seen = new Set();
    const doc = view.state.doc;
    outer: for (const range of view.visibleRanges) {
      let pos = range.from;
      while (pos <= range.to) {
        const line = doc.lineAt(pos);
        if (!seen.has(line.number)) {
          seen.add(line.number);
          const start = view.coordsAtPos(line.from);
          if (start && start.bottom > 0 && start.top < window.innerHeight) {
            // 行尾坐标只用来给标签算一个可见宽度（超长行不整行铺开）。
            const end = view.coordsAtPos(Math.min(line.to, line.from + 160)) || start;
            const left = Math.min(start.left, end.left);
            const right = Math.max(start.right, end.right, left + 6);
            if (right - left >= 4) {
              lines.push({
                line: line.number,
                from: line.from,
                to: line.to,
                left,
                top: Math.min(start.top, end.top),
                right,
                bottom: Math.max(start.bottom, end.bottom),
              });
            }
          }
          if (lines.length >= limit) break outer;
        }
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
    }
    return lines;
  }

  function coordsAtPosition(pos) {
    try {
      return view.coordsAtPos(pos);
    } catch {
      return null;
    }
  }

  // 行标签跳转：落在行首第一个非空白字符（与 vim 的行跳转一致）。
  function jumpToLine(lineNumber) {
    const total = view.state.doc.lines;
    const number = Math.max(1, Math.min(total, Number(lineNumber) || 1));
    const line = view.state.doc.line(number);
    const first = line.text.search(/\S/);
    view.dispatch({
      selection: { anchor: line.from + (first >= 0 ? first : 0) },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }

  function jumpToMatch(match) {
    if (!match || typeof match.from !== 'number') return false;
    // 光标落在匹配起点，不能设成 from..to 的区间选择：非空选区会被 Vim 插件
    // 当成 VISUAL 模式（Esc 才能退出），两字符定位只是移动光标。
    view.dispatch({ selection: { anchor: match.from }, scrollIntoView: true });
    view.focus();
    return true;
  }

  function setTheme(id) {
    currentTheme = id === 'local' ? 'local' : themeById(id).id;
    const palette = paletteFor(currentTheme);
    view.dispatch({ effects: themeCompartment.reconfigure(themeExtensionsFor(currentTheme)) });
    return palette;
  }

  // 本地 vim/neovim 配置到达后：同步主题（本地 colorscheme）、tab 宽度、缩进、
  // 行号、cursorline、wrap 与 listchars 显示。
  function setProfile(next) {
    currentProfile = next?.available ? next : null;
    view.dispatch({ effects: displayCompartment.reconfigure(displayExtensions()) });
    if (currentTheme === 'local') {
      view.dispatch({ effects: themeCompartment.reconfigure(themeExtensionsFor(currentTheme)) });
    }
    return paletteFor(currentTheme);
  }

  updateVimMode();
  return {
    openFile,
    revealPosition,
    showQuickpick,
    updateQuickpickItems,
    isQuickpickOpen,
    closeQuickpick,
    quickpickKeydown,
    getCursor,
    getValue,
    show,
    hide,
    focus,
    setTheme,
    setProfile,
    snapshot,
    visibleMatches,
    visibleLines,
    coordsAtPosition,
    jumpToMatch,
    jumpToLine,
    themes: THEMES,
  };
}