const MODES_BY_EXTENSION = new Map(Object.entries({
  '.c': 'c_cpp',
  '.h': 'c_cpp',
  '.cc': 'c_cpp',
  '.cpp': 'c_cpp',
  '.cxx': 'c_cpp',
  '.hpp': 'c_cpp',
  '.S': 'c_cpp',
  '.py': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.go': 'golang',
  '.java': 'java',
  '.rs': 'rust',
  '.sh': 'sh',
  '.bash': 'sh',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.html': 'html',
  '.css': 'css',
  '.xml': 'xml',
  '.sql': 'sql',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mk': 'makefile',
  '.mak': 'makefile',
  '.perl': 'perl',
  '.pl': 'perl',
  '.php': 'php',
  '.rb': 'ruby',
  '.lua': 'lua',
  '.r': 'r',
}));

function extensionOf(filePath) {
  const index = filePath.lastIndexOf('.');
  return index === -1 ? '' : filePath.slice(index).toLowerCase();
}

export function createEditor({ onCursorLine, onAsk, onGotoDefinition, onGotoReferences, onJumpBack }) {
  const host = document.getElementById('editor-host');
  const quickpick = document.getElementById('quickpick');
  const vimModeElement = document.getElementById('vim-mode');
  const cursorPosElement = document.getElementById('cursor-pos');

  ace.config.set('basePath', '/vendor/ace');
  ace.config.set('useWorker', false);

  const editor = ace.edit('editor');
  editor.setTheme('ace/theme/tomorrow_night');
  editor.setKeyboardHandler('ace/keyboard/vim');
  editor.setOptions({
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 12,
    showPrintMargin: false,
    scrollPastEnd: 0.15,
    fixedWidthGutter: true,
    displayIndentGuides: true,
  });
  editor.session.setUseWorker(false);
  editor.session.setTabSize(8);

  const vimModule = ace.require('ace/keyboard/vim');
  const Vim = vimModule.Vim;

  Vim.defineAction('aceGotoDefinition', () => {
    onGotoDefinition(getCursor());
  });
  Vim.mapCommand('gd', 'action', 'aceGotoDefinition', undefined, { context: 'normal' });

  Vim.defineAction('aceGotoReferences', () => {
    onGotoReferences(getCursor());
  });
  Vim.mapCommand('gr', 'action', 'aceGotoReferences', undefined, { context: 'normal' });

  Vim.defineAction('aceJumpBack', () => {
    onJumpBack();
  });
  Vim.mapCommand('<C-t>', 'action', 'aceJumpBack', undefined, { context: 'normal' });

  Vim.defineAction('aceAskLine', () => {
    onAsk(getCursor());
  });
  Vim.mapCommand('\\c', 'action', 'aceAskLine', undefined, { context: 'normal' });
  Vim.defineEx('ask', 'ask', () => {
    onAsk(getCursor());
  });

  editor.commands.addCommand({
    name: 'aceGotoDefinitionKey',
    bindKey: { win: 'Ctrl-]', mac: 'Ctrl-]' },
    exec: () => onGotoDefinition(getCursor()),
  });
  editor.commands.addCommand({
    name: 'aceJumpBackKey',
    bindKey: { win: 'Ctrl-t', mac: 'Ctrl-t' },
    exec: () => onJumpBack(),
  });

  let cursorTimer = null;
  editor.on('changeSelection', () => {
    updateCursorPos();
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
      if (state.loaded) onCursorLine(getCursor().line);
    }, 180);
  });

  editor.on('changeStatus', updateVimMode);

  function getVimState() {
    try {
      return editor.state?.cm?.state?.vim || null;
    } catch {
      return null;
    }
  }

  function updateVimMode() {
    const vim = getVimState();
    let label = '--NORMAL--';
    if (vim) {
      if (vim.insertMode) label = '--INSERT--';
      else if (vim.visualMode) label = vim.visualLine ? '--VISUAL LINE--' : '--VISUAL--';
      if (vim.status) label += ` ${vim.status}`;
    }
    vimModeElement.textContent = label;
  }

  function updateCursorPos() {
    const cursor = editor.getCursorPosition();
    cursorPosElement.textContent = `${cursor.row + 1}:${cursor.column + 1}`;
  }

  const state = {
    loaded: false,
    path: null,
    quickpickItems: null,
    quickpickIndex: 0,
  };

  function setModeForPath(filePath) {
    const name = MODES_BY_EXTENSION.get(extensionOf(filePath)) || null;
    if (name && state.lastMode !== name) {
      state.lastMode = name;
      editor.session.setMode(`ace/mode/${name}`);
    }
  }

  function openFile(filePath, content) {
    state.loaded = false;
    state.path = filePath;
    setModeForPath(filePath);
    editor.session.setValue(content, -1);
    editor.session.setUndoManager(new ace.UndoManager());
    editor.moveCursorTo(0, 0);
    editor.clearSelection();
    editor.scrollToLine(0, false, false, () => {});
    editor.session.getUndoManager().reset();
    state.loaded = true;
    updateVimMode();
    updateCursorPos();
    focus();
  }

  function revealPosition(line, character = 0) {
    if (!state.loaded) return;
    const row = Math.max(0, line - 1);
    const column = Math.max(0, character);
    editor.moveCursorTo(row, column);
    editor.clearSelection();
    editor.scrollToLine(row, true, false, () => {});
    focus();
  }

  function focus() {
    editor.focus();
  }

  function getCursor() {
    const cursor = editor.getCursorPosition();
    return { line: cursor.row + 1, character: cursor.column };
  }

  function getValue() {
    return editor.getValue();
  }

  function showQuickpick(items, onPick) {
    state.quickpickItems = items;
    state.quickpickIndex = 0;
    state.quickpickOnPick = onPick;
    renderQuickpick();
    quickpick.hidden = false;
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

  function show() {
    host.hidden = false;
    editor.resize(true);
  }

  function hide() {
    host.hidden = true;
  }

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (!host.hidden) editor.resize(true);
    });
    observer.observe(host);
  }

  function snapshot() {
    const vim = getVimState();
    return {
      path: state.path,
      lines: editor.session.getLength(),
      cursor: getCursor(),
      mode: vim ? (vim.insertMode ? 'INSERT' : vim.visualMode ? 'VISUAL' : 'NORMAL') : 'NORMAL',
      quickpickOpen: Boolean(state.quickpickItems),
    };
  }

  updateVimMode();
  updateCursorPos();

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
    snapshot,
  };
}
