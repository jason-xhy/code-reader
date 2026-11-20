// 能力：阅读历史菜单（最近打开的仓库与位置）。
import { elements } from '../core/dom.js';
import { state, noteFocusIntent } from '../core/state.js';
import { api } from '../core/api.js';
import { focusFirstMenuItem, menuButtons, relativeTime } from '../core/utils.js';
import { showNotice } from '../core/notice.js';

let deps = {};

export function initReadingHistory(dependencies) {
  deps = dependencies;
  elements.historyMenuButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    const willOpen = elements.historyMenu.hidden;
    elements.historyMenu.hidden = !willOpen;
    elements.historyMenuButton.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      await loadReadingHistory();
      noteFocusIntent();
      focusFirstMenuItem(elements.historyMenu);
    } else {
      elements.historyMenuButton.focus();
    }
  });
  elements.historyMenuButton.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    elements.historyMenuButton.click();
  });
  elements.historyMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      elements.historyMenu.hidden = true;
      elements.historyMenuButton.setAttribute('aria-expanded', 'false');
      elements.historyMenuButton.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = menuButtons(elements.historyMenu);
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else next = (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  document.addEventListener('click', (event) => {
    if (!elements.historyMenu.hidden
      && !elements.historyMenu.contains(event.target)
      && event.target !== elements.historyMenuButton) {
      elements.historyMenu.hidden = true;
      elements.historyMenuButton.setAttribute('aria-expanded', 'false');
    }
  });
}

export async function loadReadingHistory() {
  try {
    const data = await api('/api/history');
    state.historyList = data.repositories || [];
  } catch {
    state.historyList = [];
  }
  renderReadingHistory();
}

export function renderReadingHistory() {
  const menu = elements.historyMenu;
  menu.replaceChildren();
  if (!state.historyList.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '还没有阅读历史';
    menu.append(empty);
    return;
  }
  for (const entry of state.historyList) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const pathLine = document.createElement('span');
    pathLine.textContent = entry.path;
    const position = document.createElement('span');
    position.textContent = entry.lastFile
      ? `${entry.lastFile}:${entry.lastLine} · ${relativeTime(entry.updatedAt)}`
      : `未打开文件 · ${relativeTime(entry.updatedAt)}`;
    button.append(name, pathLine, position);
    button.addEventListener('click', () => {
      menu.hidden = true;
      openHistoryEntry(entry);
    });
    menu.append(button);
  }
  const footer = document.createElement('div');
  footer.className = 'history-footer';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'button small';
  clear.textContent = '清空历史';
  clear.addEventListener('click', async () => {
    try {
      await api('/api/history', { method: 'DELETE' });
      state.historyList = [];
      renderReadingHistory();
    } catch (error) {
      showNotice(`清空历史失败：${error.message}`, { error: true });
    }
  });
  footer.append(clear);
  menu.append(footer);
}

export async function openHistoryEntry(entry, { silent = false } = {}) {
  try {
    const data = entry.source === 'remote'
      ? await api('/api/repositories/open-remote', { method: 'POST', body: JSON.stringify({ url: entry.path, resume: true }) })
      : await api('/api/repositories/open-local', { method: 'POST', body: JSON.stringify({ path: entry.path, resume: true }) });
    await deps.loadRepository(data);
    if (data.resume?.file && state.files.includes(data.resume.file)) {
      // 静默恢复（页面加载）不抢已打开窗口的焦点；用户点历史条目仍把焦点交给代码窗。
      await deps.selectFile(
        data.resume.file,
        { line: data.resume.line || 1, character: data.resume.character || 0 },
        { focus: silent ? 'auto' : 'always' },
      );
    }
    if (!silent) {
      showNotice(data.resume?.file
        ? `已恢复 ${entry.name} · ${data.resume.file}:${data.resume.line}`
        : `已打开 ${entry.name}（暂无上次文件位置）`);
    }
  } catch (error) {
    if (!silent) showNotice(`打开历史失败：${error.message}`, { error: true });
    else console.error('[workspace] 恢复阅读历史失败：', error);
  }
}