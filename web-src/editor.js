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

export function createEditor({ onCursorLine, onAsk, onGotoDefinition, onGotoReferences, onJumpBack, onJumpForward, onFocusTree, onOpenFile, onExComplete, onHelp, theme = 'one-dark', profile = null }) {
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
    const handled = typeof onJumpBack === 'function' && onJumpBack();
    if (!handled) runVimJump('<C-o>', 'readerJumpBack');
  });
  Vim.mapCommand('<C-o>', 'action', 'readerJumpBack', undefined, { context: 'normal' });
  Vim.defineAction('readerJumpForward', () => {
    const handled = typeof onJumpForward === 'function' && onJumpForward();
    if (!handled) runVimJump('<C-i>', 'readerJumpForward');
  });
  Vim.mapCommand('<C-i>', 'action', 'readerJumpForward', undefined, { context: 'normal' });

  Vim.defineEx('ask', 'ask', () => onAsk());
  Vim.defineEx('gd', 'gd', () => onGotoDefinition());
  Vim.defineEx('gr', 'gr', () => onGotoReferences());
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

  const EX_COMMAND_NAMES = [
    'ask', 'colorscheme', 'e', 'edit', 'gd', 'gr', 'help', 'map', 'nmap', 'norm',
    'q', 'qa', 'set', 'sort', 'tree', 'vi', 'vmap', 'vsplit', 'w', 'wq',
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
  updateCursorPos();

  function openFile(filePath, content) {
    state.loaded = false;
    state.path = filePath;
    view.setState(EditorState.create({
      doc: String(content ?? ''),
      extensions: extensionsFor(filePath),
    }));
    view.scrollDOM.scrollTop = 0;
    view.focus();
    state.loaded = true;
    attachVimEvents();
    updateVimMode();
    updateCursorPos();
  }

  function revealPosition(line, character = 0) {
    if (!view) return;
    const doc = view.state.doc;
    const number = Math.min(Math.max(1, line), doc.lines);
    const info = doc.line(number);
    const position = Math.min(info.from + Math.max(0, character), info.to);
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: 'center' }),
    });
    view.focus();
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

  function renderQuickpick() {
    const items = state.quickpickItems || [];
    quickpick.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'quickpick-heading';
    heading.textContent = state.quickpickTitle
      || `${items.length} 个跳转目标 · ↑↓ 选择 · Enter 跳转 · Esc 取消`;
    quickpick.append(heading);
    const body = document.createElement('div');
    body.className = 'quickpick-body';
    const list = document.createElement('div');
    list.className = 'quickpick-list';
    items.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `quickpick-row${index === state.quickpickIndex ? ' active' : ''}`;
      const indexElement = document.createElement('span');
      indexElement.className = 'quickpick-index';
      indexElement.textContent = String(index + 1);
      const target = document.createElement('span');
      target.className = 'quickpick-target';
      target.textContent = `${item.path}:${item.line}:${item.character + 1}`;
      row.append(indexElement, target);
      row.addEventListener('click', () => pickQuickpick(index));
      row.addEventListener('mouseenter', () => setQuickpickIndex(index));
      list.append(row);
    });
    body.append(list);
    if (state.quickpickPreviewLoader) {
      const preview = document.createElement('div');
      preview.className = 'quickpick-preview';
      renderQuickpickPreview(preview);
      body.append(preview);
    }
    quickpick.append(body);
  }

  // 引用预览的另一窗口：显示选中引用前后 10 行，并标出所在函数（Caller）。
  function renderQuickpickPreview(container) {
    const preview = state.quickpickPreview;
    container.classList.toggle('pending', Boolean(preview?.pending));
    if (!preview || preview.status === 'loading') {
      container.textContent = '正在读取引用上下文…';
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
    quickpick.focus();
  }

  function showQuickpick(items, onPick, options = {}) {
    state.quickpickItems = items;
    state.quickpickIndex = 0;
    state.quickpickOnPick = onPick;
    state.quickpickTitle = options.title || '';
    state.quickpickPreviewLoader = typeof options.preview === 'function' ? options.preview : null;
    state.quickpickPreview = null;
    state.quickpickPreviewToken += 1;
    quickpick.classList.toggle('has-preview', Boolean(state.quickpickPreviewLoader));
    renderQuickpick();
    quickpick.hidden = false;
    quickpick.tabIndex = -1;
    quickpick.focus();
    if (state.quickpickPreviewLoader) loadQuickpickPreview(0);
  }

  function pickQuickpick(index) {
    const items = state.quickpickItems || [];
    const callback = state.quickpickOnPick;
    const item = items[index];
    closeQuickpick();
    if (item && callback) callback(item);
  }

  function closeQuickpick() {
    state.quickpickItems = null;
    state.quickpickOnPick = null;
    state.quickpickTitle = '';
    state.quickpickPreviewLoader = null;
    state.quickpickPreview = null;
    state.quickpickPreviewToken += 1;
    quickpick.hidden = true;
    quickpick.classList.remove('has-preview');
    quickpick.replaceChildren();
    focus();
  }

  function quickpickKeydown(event) {
    const items = state.quickpickItems;
    if (!items) return false;
    if (event.defaultPrevented) return true;
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
    view.dispatch({ selection: { anchor: match.from, head: match.to ?? match.from }, scrollIntoView: true });
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