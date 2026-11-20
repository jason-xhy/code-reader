// 能力：打开仓库对话框、目录浏览器与文档知识库配置对话框。
import { elements } from '../core/dom.js';
import { state, noteFocusIntent } from '../core/state.js';
import { api } from '../core/api.js';

let deps = {};

export function initDialogsFeature(dependencies) {
  deps = dependencies;
  elements.openMenu.addEventListener('click', showOpenDialog);
  elements.workspaceAdd.addEventListener('click', showOpenDialog);
  elements.dialogClose.addEventListener('click', closeOpenDialog);
  elements.localTab.addEventListener('click', () => setOpenMode('local'));
  elements.remoteTab.addEventListener('click', () => setOpenMode('remote'));
  elements.openForm.addEventListener('submit', openRepository);
  elements.browseButton.addEventListener('click', async () => {
    if (!elements.dirBrowser.hidden) {
      elements.dirBrowser.hidden = true;
      return;
    }
    elements.dirBrowser.hidden = false;
    await loadDirectory(elements.localPath.value.trim() || '');
  });
  elements.dirUp.addEventListener('click', () => {
    if (state.dirParent) loadDirectory(state.dirParent);
  });
  elements.dirPick.addEventListener('click', () => {
    if (state.dirBrowserPath) {
      elements.localPath.value = state.dirBrowserPath;
      elements.dirBrowser.hidden = true;
    }
  });
  elements.dirList.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (!state.dirEntries.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const base = state.dirSelected < 0 ? (delta > 0 ? -1 : 0) : state.dirSelected;
      selectDirIndex((base + delta + state.dirEntries.length) % state.dirEntries.length);
      return;
    }
    if (event.key === 'Enter') {
      if (state.dirSelected < 0) return;
      event.preventDefault();
      enterDirIndex(state.dirSelected);
      return;
    }
    if (event.key.length === 1 && event.key.trim()) {
      event.preventDefault();
      typeAheadDir(event.key);
    }
  });
  elements.openDialog.addEventListener('cancel', (event) => {
    if (state.opening) {
      event.preventDefault();
      return;
    }
    // 目录浏览器是对话框内的子面板：Esc 先只关闭它，不关闭整个打开仓库对话框。
    if (!elements.dirBrowser.hidden) {
      event.preventDefault();
      elements.dirBrowser.hidden = true;
      elements.browseButton.focus({ preventScroll: true });
    }
  });
  elements.docsSettings.addEventListener('click', openDocsDialog);
  elements.docsClose.addEventListener('click', () => elements.docsDialog.close());
  elements.docsDialog.addEventListener('click', (event) => {
    if (event.target === elements.docsDialog) elements.docsDialog.close();
  });
  elements.docsAdd.addEventListener('click', () => {
    const value = elements.docsPathInput.value.trim();
    if (!value) return;
    if (!value.startsWith('/')) {
      state.docsError = '请输入绝对路径';
      renderDocsDialog();
      return;
    }
    if (!state.docsDraft.includes(value)) state.docsDraft.push(value);
    elements.docsPathInput.value = '';
    state.docsError = '';
    renderDocsDialog();
  });
  elements.docsSave.addEventListener('click', async () => {
    elements.docsProgress.textContent = '正在保存…';
    state.docsError = '';
    try {
      await api('/api/docs/config', {
        method: 'POST',
        body: JSON.stringify({ directories: state.docsDraft, webEnabled: elements.docsWebEnabled.checked }),
      });
      await loadDocsConfig();
      elements.docsProgress.textContent = '已保存';
    } catch (error) {
      state.docsError = error.message;
      renderDocsDialog();
    } finally {
      setTimeout(() => { elements.docsProgress.textContent = ''; }, 1500);
    }
  });
  elements.docsReindex.addEventListener('click', async () => {
    elements.docsProgress.textContent = '正在清空索引…';
    try {
      await api('/api/docs/reindex', { method: 'POST' });
      await loadDocsConfig();
      elements.docsProgress.textContent = '索引已清空，下次检索时重建';
    } catch (error) {
      state.docsError = error.message;
      renderDocsDialog();
      elements.docsProgress.textContent = '';
    }
  });
}

// ---- 文档知识库 ----

async function loadDocsConfig() {
  try {
    const data = await api('/api/docs/config');
    state.docsConfig = data.config || { directories: [], webEnabled: true };
    state.docsDraft = [...state.docsConfig.directories];
    state.docsStatsData = data.directories || [];
  } catch (error) {
    state.docsError = error.message;
  }
  renderDocsDialog();
}

function renderDocsDialog() {
  elements.docsDirList.replaceChildren();
  for (const directory of state.docsDraft) {
    const row = document.createElement('div');
    row.className = 'docs-dir';
    const label = document.createElement('span');
    label.textContent = directory;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'faq-delete';
    remove.textContent = '移除';
    remove.addEventListener('click', () => {
      state.docsDraft = state.docsDraft.filter((value) => value !== directory);
      renderDocsDialog();
    });
    row.append(label, remove);
    elements.docsDirList.append(row);
  }
  if (!state.docsDraft.length) {
    const empty = document.createElement('div');
    empty.className = 'field-help';
    empty.textContent = '尚未指定文档目录；当前仓库的 Documentation/docs/doc 仍会自动纳入。';
    elements.docsDirList.append(empty);
  }
  elements.docsWebEnabled.checked = state.docsConfig.webEnabled !== false;
  const indexed = (state.docsStatsData || []).filter((entry) => entry.indexed);
  elements.docsStats.textContent = indexed.length
    ? `已索引 ${indexed.reduce((total, entry) => total + entry.files, 0)} 个文件 / ${indexed.reduce((total, entry) => total + entry.chunks, 0)} 个片段`
    : '索引将在首次提问检索时建立（PDF 使用 pdftotext 抽取）。';
  elements.docsError.textContent = state.docsError || '';
}

async function openDocsDialog() {
  state.docsError = '';
  await loadDocsConfig();
  noteFocusIntent();
  elements.docsDialog.showModal();
}

// ---- 打开仓库对话框 ----

function setOpenMode(mode) {
  state.openMode = mode;
  const local = mode === 'local';
  elements.localTab.classList.toggle('active', local);
  elements.remoteTab.classList.toggle('active', !local);
  elements.localTab.setAttribute('aria-selected', String(local));
  elements.remoteTab.setAttribute('aria-selected', String(!local));
  elements.localPanel.hidden = !local;
  elements.remotePanel.hidden = local;
  elements.openError.textContent = '';
  (local ? elements.localPath : elements.remoteUrl).focus();
}

function showOpenDialog() {
  elements.openError.textContent = '';
  elements.openProgress.textContent = '';
  noteFocusIntent();
  elements.openDialog.showModal();
  setOpenMode(state.openMode);
}

function closeOpenDialog() {
  if (!state.opening) elements.openDialog.close();
}

async function openRepository(event) {
  event.preventDefault();
  if (state.opening) return;
  const local = state.openMode === 'local';
  const value = (local ? elements.localPath : elements.remoteUrl).value.trim();
  if (!value) {
    elements.openError.textContent = local ? '请输入本地仓库路径' : '请输入远程仓库地址';
    return;
  }
  state.opening = true;
  elements.openSubmit.disabled = true;
  elements.dialogClose.disabled = true;
  elements.openError.textContent = '';
  elements.openProgress.textContent = local ? '正在读取仓库…' : '正在克隆仓库，大型仓库可能需要数分钟…';
  try {
    const data = await api(local ? '/api/repositories/open-local' : '/api/repositories/open-remote', {
      method: 'POST',
      body: JSON.stringify(local ? { path: value } : { url: value }),
    });
    await deps.loadRepository(data);
    elements.openDialog.close();
  } catch (error) {
    elements.openError.textContent = error.message;
  } finally {
    state.opening = false;
    elements.openSubmit.disabled = false;
    elements.dialogClose.disabled = false;
    elements.openProgress.textContent = '';
  }
}

// ---- 目录浏览器 ----

function selectDirIndex(index, { focus = true } = {}) {
  const rows = [...elements.dirList.querySelectorAll('.dir-row')];
  if (!rows.length) {
    state.dirSelected = -1;
    return;
  }
  const target = Math.max(0, Math.min(index, rows.length - 1));
  state.dirSelected = target;
  rows.forEach((row, rowIndex) => {
    const selected = rowIndex === target;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', String(selected));
    // roving tabindex：整个目录列表只占一个 Tab 停靠点，方向键在项间移动。
    row.tabIndex = selected ? 0 : -1;
  });
  const row = rows[target];
  row.scrollIntoView({ block: 'nearest' });
  if (focus) row.focus();
}

// 双击/Enter 才“确认”选中：回填路径并进入该目录；单击只高亮。
async function enterDirIndex(index) {
  const entry = state.dirEntries[index];
  if (!entry) return;
  elements.localPath.value = entry.path;
  await loadDirectory(entry.path);
  // 进入后由 loadDirectory 把焦点放到新目录的当前项，继续按字母导航。
}

// 字母导航：与文件管理器一致，连续同字母循环，800ms 内多字母按前缀匹配。
function typeAheadDir(char) {
  const lower = char.toLowerCase();
  const entries = state.dirEntries;
  if (!entries.length) return;
  const count = entries.length;
  let buffer = state.dirTypeBuffer;
  let start = state.dirSelected >= 0 ? state.dirSelected : 0;
  if (buffer && buffer.length === 1 && buffer === lower) {
    start = (state.dirSelected + 1 + count) % count;
  } else {
    buffer += lower;
  }
  state.dirTypeBuffer = buffer;
  clearTimeout(state.dirTypeTimer);
  state.dirTypeTimer = setTimeout(() => { state.dirTypeBuffer = ''; }, 800);
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    if (entries[index].name.toLowerCase().startsWith(buffer)) {
      selectDirIndex(index);
      return;
    }
  }
}

function renderDirList() {
  elements.dirList.replaceChildren();
  state.dirEntries.forEach((entry, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dir-row';
    row.dataset.path = entry.path;
    row.dataset.index = String(index);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.tabIndex = -1;
    row.textContent = entry.name;
    if (entry.git) {
      const badge = document.createElement('span');
      badge.className = 'dir-git';
      badge.textContent = 'Git';
      row.append(badge);
    }
    row.addEventListener('click', () => selectDirIndex(index));
    row.addEventListener('dblclick', () => enterDirIndex(index));
    elements.dirList.append(row);
  });
  if (!state.dirEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'field-help';
    empty.textContent = '该目录下没有子目录';
    elements.dirList.append(empty);
  }
}

async function loadDirectory(target) {
  elements.dirError.textContent = '';
  try {
    const data = await api(`/api/fs/list?path=${encodeURIComponent(target)}`);
    state.dirBrowserPath = data.path;
    state.dirParent = data.parent;
    state.dirEntries = data.entries || [];
    state.dirSelected = -1;
    state.dirTypeBuffer = '';
    elements.dirPath.textContent = data.path;
    elements.dirUp.disabled = !data.parent;
    renderDirList();
    // 打开/切换目录后焦点进入列表当前项，↑/↓ 才能从当前项开始移动。
    if (!elements.dirBrowser.hidden) {
      if (state.dirEntries.length) selectDirIndex(0);
      else elements.dirList.focus({ preventScroll: true });
    }
  } catch (error) {
    elements.dirError.textContent = error.message;
  }
}

