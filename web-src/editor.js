// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: CM6 编辑器层与 code-reader UI 契约强绑定
// grill: 成品检索=skill 库无 code-reader CM6 编辑器成品; 输入固定=固定 createEditor 选项与 DOM id; 步骤机械=构建 extensions/绑定 vim; 判读固定=CM6 state 与 vim 事件; 失效场景=构造不出（仅本应用）
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import { THEMES, themeById, themeExtension } from './themes.js';
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

const MODES_BY_EXTENSION = new Map(Object.entries({
  c: cpp,
  h: cpp,
  cc: cpp,
  cpp: cpp,
  cxx: cpp,
  hpp: cpp,
  s: cpp,
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

export function createEditor({ onCursorLine, onAsk, onGotoDefinition, onGotoReferences, onJumpBack, onHelp, theme = 'one-dark' }) {
  const host = document.getElementById('editor-host');
  const mount = document.getElementById('editor');
  const quickpick = document.getElementById('quickpick');
  const vimModeElement = document.getElementById('vim-mode');
  const cursorPosElement = document.getElementById('cursor-pos');
  const languageCompartment = new Compartment();
  const themeCompartment = new Compartment();
  let currentTheme = themeById(theme).id;

  const state = {
    loaded: false,
    path: null,
    quickpickItems: null,
    quickpickIndex: 0,
    quickpickOnPick: null,
  };
  let cursorTimer = null;
  let view = null;

  Vim.defineAction('readerGotoDefinition', () => onGotoDefinition());
  Vim.mapCommand('gd', 'action', 'readerGotoDefinition', undefined, { context: 'normal' });
  Vim.defineAction('readerGotoReferences', () => onGotoReferences());
  Vim.mapCommand('gr', 'action', 'readerGotoReferences', undefined, { context: 'normal' });
  Vim.defineAction('readerAskLine', () => onAsk());
  Vim.mapCommand('\\c', 'action', 'readerAskLine', undefined, { context: 'normal' });
  Vim.defineEx('ask', 'ask', () => onAsk());
  Vim.defineEx('gd', 'gd', () => onGotoDefinition());
  Vim.defineEx('gr', 'gr', () => onGotoReferences());
  Vim.defineEx('help', 'h', () => {
    if (typeof onHelp === 'function') onHelp();
  });

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
      lineNumbers(),
      highlightActiveLineGutter(),
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
      highlightActiveLine(),
      highlightSelectionMatches(),
      languageCompartment.of(languageFor(filePath)),
      themeCompartment.of(themeExtension(currentTheme)),
      appKeymap,
      keymap.of([...DEFAULT_KEYMAP_WITHOUT_CTRL_I, ...searchKeymap, ...historyKeymap, indentWithTab]),
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
    heading.textContent = `${items.length} 个跳转目标 · ↑↓ 选择 · Enter 跳转 · Esc 取消`;
    quickpick.append(heading);
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
      row.addEventListener('mouseenter', () => {
        state.quickpickIndex = index;
        renderQuickpick();
      });
      list.append(row);
    });
    quickpick.append(list);
  }

  function showQuickpick(items, onPick) {
    state.quickpickItems = items;
    state.quickpickIndex = 0;
    state.quickpickOnPick = onPick;
    renderQuickpick();
    quickpick.hidden = false;
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
    quickpick.hidden = true;
    focus();
  }

  function quickpickKeydown(event) {
    const items = state.quickpickItems;
    if (!items) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeQuickpick();
    } else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'j')) {
      event.preventDefault();
      event.stopPropagation();
      state.quickpickIndex = (state.quickpickIndex + 1) % items.length;
      renderQuickpick();
    } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'k')) {
      event.preventDefault();
      event.stopPropagation();
      state.quickpickIndex = (state.quickpickIndex - 1 + items.length) % items.length;
      renderQuickpick();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      pickQuickpick(state.quickpickIndex);
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

  function setTheme(id) {
    const palette = themeById(id);
    currentTheme = palette.id;
    view.dispatch({ effects: themeCompartment.reconfigure(themeExtension(currentTheme)) });
    return palette;
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
    snapshot,
    themes: THEMES,
  };
}