// 能力：编辑器环境、本地 profile、主题联动与 nvim 面板切换。
import { elements } from '../core/dom.js';
import { state, editor, noteFocusIntent } from '../core/state.js';
import { api } from '../core/api.js';
import { THEME_KEY } from '../core/config.js';
import { applyEditorFont, applyShellTheme, populateThemes } from '../core/layout.js';

export function initEditorModeFeature() {
  elements.themeSelect.addEventListener('change', () => {
    const id = elements.themeSelect.value;
    const palette = editor.setTheme(id);
    state.theme = id;
    state.themeExplicit = true;
    localStorage.setItem(THEME_KEY, id);
    applyShellTheme(palette);
  });
  elements.tabEditor.addEventListener('click', () => setEditorMode('editor'));
  elements.tabNvim.addEventListener('click', () => setEditorMode('nvim'));
  elements.nvimClose.addEventListener('click', closeNvim);
  elements.nvimRestart.addEventListener('click', restartNvim);
  elements.nvimOpenCurrent.addEventListener('click', openCurrentInNvim);
  elements.nvimKeys.addEventListener('click', () => {
    renderNvimKeymaps();
    noteFocusIntent();
    elements.nvimKeymapDialog.showModal();
  });
  elements.nvimKeymapClose.addEventListener('click', () => elements.nvimKeymapDialog.close());
  elements.editorEnvSettings.addEventListener('click', () => openEditorEnvDialog());
  elements.editorEnvClose.addEventListener('click', () => elements.editorEnvDialog.close());
  elements.editorEnvRefresh.addEventListener('click', async () => {
    elements.editorEnvProgress.textContent = '检测中…';
    await loadEditorEnv({ openDialog: true });
    await loadEditorProfile({ refresh: true }).catch(() => {});
    renderEditorEnvDialog();
    elements.editorEnvProgress.textContent = '';
  });
  for (const radio of document.querySelectorAll('input[name="editor-env-program"]')) {
    radio.addEventListener('change', () => {
      elements.editorEnvCommand.disabled = radio.value !== 'custom';
    });
  }
  elements.editorEnvSave.addEventListener('click', async () => {
    const program = document.querySelector('input[name="editor-env-program"]:checked')?.value || 'auto';
    elements.editorEnvProgress.textContent = '保存中…';
    elements.editorEnvError.textContent = '';
    try {
      state.editorEnv = await api('/api/editor', {
        method: 'POST',
        body: JSON.stringify({
          program,
          command: elements.editorEnvCommand.value.trim(),
          appName: elements.editorEnvAppName.value.trim(),
        }),
      });
      applyEditorAvailability();
      renderEditorEnvDialog();
      elements.editorEnvProgress.textContent = '已保存';
      setTimeout(() => { elements.editorEnvProgress.textContent = ''; }, 1500);
      loadEditorProfile({ refresh: true }).catch(() => {});
    } catch (error) {
      elements.editorEnvError.textContent = error.message;
      elements.editorEnvProgress.textContent = '';
    }
  });
}

// 顶栏「设置」菜单与侧栏按钮共用同一条打开路径。
export async function openEditorEnvDialog() {
  noteFocusIntent();
  elements.editorEnvDialog.showModal();
  renderEditorEnvDialog();
  await loadEditorEnv({ openDialog: true });
  if (!state.editorProfile?.available) await loadEditorProfile();
  renderEditorEnvDialog();
}

export function renderEditorEnvDialog() {
  const env = state.editorEnv;
  const detected = elements.editorEnvDetected;
  detected.replaceChildren();
  const row = (label, value) => {
    const line = document.createElement('div');
    line.className = 'editor-env-row';
    const name = document.createElement('span');
    name.className = 'editor-env-row-label';
    name.textContent = label;
    const text = document.createElement('span');
    text.className = 'editor-env-row-value';
    text.textContent = value;
    line.append(name, text);
    return line;
  };
  const describe = (label, info) => {
    if (!info) return row(label, '检测中…');
    if (!info.available) return row(label, '未检测到');
    const managers = info.managers?.length ? `（${info.managers.join('、')}）` : '';
    return row(label, `${info.version || '已安装'} · 配置${info.hasConfig ? '有' : '无'} · 插件 ${info.pluginCount} 个${managers}`);
  };
  detected.append(describe('neovim', env?.nvim), describe('vim', env?.vim));
  const activeText = env?.available
    ? `${env.active.program === 'custom' ? `自定义命令 ${env.active.command}` : env.active.program}${env.active.appName ? `（配置名 ${env.active.appName}）` : ''}`
    : '内置编辑器（未关联本地 vim/neovim）';
  detected.append(row('当前编辑器', activeText));
  const font = state.editorProfile?.available ? state.editorProfile.font : null;
  if (font?.family) {
    const size = font.points ? ` · ${font.points}pt` : '';
    const px = font.sizePx ? ` → ${font.sizePx}px` : '';
    detected.append(row('同步字体', `${font.family}${size}${px}`));
  }
  const program = env?.saved?.program || 'auto';
  for (const radio of document.querySelectorAll('input[name="editor-env-program"]')) radio.checked = radio.value === program;
  elements.editorEnvCommand.value = env?.saved?.command || '';
  elements.editorEnvAppName.value = env?.saved?.appName || '';
  elements.editorEnvCommand.disabled = program !== 'custom';
  elements.editorEnvError.textContent = '';
}

export function applyEditorAvailability() {
  const available = Boolean(state.editorEnv?.available);
  elements.tabNvim.disabled = !available;
  elements.tabNvim.title = available
    ? '在浏览器内运行本地 vim/neovim（真实插件与键位）· Ctrl+Alt+2'
    : '未检测到本地 vim/neovim：使用内置编辑器（点顶栏「设置 → 编辑器环境」关联）';
  elements.editorTabsHint.textContent = available
    ? 'vim/neovim 为真实本地进程：:w 会写盘，插件与 LSP 使用你的本地配置'
    : '未检测到本地 vim/neovim，使用内置编辑器 · 可在顶栏「设置 → 编辑器环境」关联';
  if (!available && state.editorMode === 'nvim') closeNvim();
}

export async function loadEditorEnv({ openDialog = false } = {}) {
  try {
    state.editorEnv = await api('/api/editor');
  } catch (error) {
    state.editorEnv = null;
    if (openDialog) elements.editorEnvError.textContent = `检测失败：${error.message}`;
  }
  applyEditorAvailability();
  if (openDialog) renderEditorEnvDialog();
  return state.editorEnv;
}

function displayKeymapKey(lhs, leader) {
  let value = String(lhs || '');
  if (leader && value.startsWith(leader)) {
    value = `${leader === ' ' ? '<Space>' : '<Leader>'}${value.slice(leader.length)}`;
  }
  if (!value) return '<空>';
  return value;
}

function normalKeymaps(profile) {
  return (profile?.keymaps || []).filter((map) => map.mode === 'n' && map.desc && !map.lhs.startsWith('<'));
}

// 状态栏只放“本地配置里真实存在”的映射：优先 leader 映射，其次普通模式描述映射。
export function renderNvimShortcuts() {
  const profile = state.editorProfile;
  if (!profile?.available) {
    elements.nvimNote.textContent = profile?.error
      ? `本地配置不可用：${profile.error}`
      : '未关联本地 vim/neovim；快捷键以内置编辑器为准';
    elements.nvimNote.title = '';
    return;
  }
  const maps = normalKeymaps(profile);
  const leader = profile.leader || '';
  const leaderMaps = leader ? maps.filter((map) => map.lhs.startsWith(leader)) : [];
  const chosen = (leaderMaps.length ? leaderMaps : maps).slice(0, 5);
  const parts = chosen.map((map) => `${displayKeymapKey(map.lhs, leader)} ${map.desc}`);
  const remaining = maps.length - chosen.length;
  elements.nvimNote.textContent = `本地 ${profile.editor.program} · ${profile.colorscheme} · ${parts.join(' · ')}${remaining > 0 ? ` · +${remaining}` : ''}`;
  elements.nvimNote.title = maps
    .map((map) => `${displayKeymapKey(map.lhs, leader)}  ${map.desc}`)
    .join('\n');
}

export function renderNvimKeymaps() {
  const profile = state.editorProfile;
  elements.nvimKeymapBody.replaceChildren();
  if (!profile?.available) {
    elements.nvimKeymapSubtitle.textContent = profile?.error || '未读取到本地 vim/neovim 配置。';
    const empty = document.createElement('div');
    empty.className = 'nvim-keymap-empty';
    empty.textContent = '请先在顶栏「设置 → 编辑器环境」关联本地 vim/neovim。';
    elements.nvimKeymapBody.append(empty);
    return;
  }
  const leader = profile.leader || '';
  elements.nvimKeymapSubtitle.textContent = `来源：${profile.editor.program} ${profile.editor.version || ''} · colorscheme ${profile.colorscheme} · leader ${leader === ' ' ? '<Space>' : (leader || '未设置')}`;
  const labels = { n: '普通模式', v: '可视模式', x: '可视模式（选择）', i: '插入模式', o: '操作符待决', t: '终端模式', c: '命令行模式' };
  const byMode = new Map();
  for (const map of profile.keymaps || []) {
    if (!byMode.has(map.mode)) byMode.set(map.mode, []);
    byMode.get(map.mode).push(map);
  }
  let count = 0;
  for (const [mode, maps] of [...byMode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const group = document.createElement('section');
    group.className = 'nvim-keymap-group';
    const heading = document.createElement('h3');
    heading.textContent = `${labels[mode] || mode}（${mode}）`;
    group.append(heading);
    for (const map of maps) {
      const row = document.createElement('div');
      row.className = 'nvim-keymap-row';
      const key = document.createElement('kbd');
      key.textContent = displayKeymapKey(map.lhs, leader);
      const desc = document.createElement('span');
      desc.className = 'nvim-keymap-desc';
      desc.textContent = map.desc || map.rhs || '';
      const modeTag = document.createElement('span');
      modeTag.className = 'nvim-keymap-mode';
      modeTag.textContent = map.mode;
      row.append(key, desc, modeTag);
      group.append(row);
      count += 1;
    }
    elements.nvimKeymapBody.append(group);
  }
  if (!count) {
    const empty = document.createElement('div');
    empty.className = 'nvim-keymap-empty';
    empty.textContent = '本地配置没有返回可显示的按键映射。';
    elements.nvimKeymapBody.append(empty);
  }
}

export async function loadEditorProfile({ refresh = false } = {}) {
  try {
    state.editorProfile = await api(`/api/editor/profile${refresh ? '?refresh=1' : ''}`);
  } catch (error) {
    state.editorProfile = { available: false, error: error.message };
  }
  const profile = state.editorProfile;
  if (profile?.available) {
    if (!state.themeExplicit && state.theme !== 'local') state.theme = 'local';
    editor.setProfile(profile);
    applyEditorFont(profile.font);
    const palette = editor.setTheme(state.theme);
    applyShellTheme(palette);
    window.CodeReaderTerminal?.setTheme(profile);
  } else {
    editor.setProfile(null);
    applyEditorFont(null);
    if (state.theme === 'local') {
      state.theme = 'one-dark';
      applyShellTheme(editor.setTheme(state.theme));
    }
  }
  populateThemes();
  renderNvimShortcuts();
  return profile;
}

export function setEditorMode(mode) {
  const nvim = mode === 'nvim';
  if (nvim && !state.editorEnv?.available) {
    elements.sourceStatus.textContent = '未关联本地 vim/neovim，继续使用内置编辑器';
    return;
  }
  if (nvim && !state.repository) {
    elements.sourceStatus.textContent = '先打开一个仓库再使用 nvim';
    return;
  }
  state.editorMode = nvim ? 'nvim' : 'editor';
  elements.tabEditor.classList.toggle('active', !nvim);
  elements.tabEditor.setAttribute('aria-selected', String(!nvim));
  elements.tabNvim.classList.toggle('active', nvim);
  elements.tabNvim.setAttribute('aria-selected', String(nvim));
  elements.nvimHost.hidden = !nvim;
  elements.codeArea.classList.toggle('mode-nvim', nvim);
  if (!nvim) {
    editor?.focus();
    return;
  }
  // nvim 终端优先占满代码区：切到 nvim 时收起两侧覆盖面板。
  window.__crPanels?.hideAll();
  const file = state.currentFile;
  const line = file ? editor.getCursor().line : 1;
  window.CodeReaderTerminal?.open({ repositoryId: state.repository.id, file, line });
}

export function closeNvim() {
  window.CodeReaderTerminal?.close();
  setEditorMode('editor');
}

export function restartNvim() {
  if (!state.repository) return;
  window.CodeReaderTerminal?.close();
  setEditorMode('nvim');
}

export function openCurrentInNvim() {
  if (!state.repository) return;
  if (!state.currentFile) {
    elements.sourceStatus.textContent = '先在代码树选择一个文件';
    return;
  }
  if (state.editorMode !== 'nvim') {
    setEditorMode('nvim');
    return;
  }
  window.CodeReaderTerminal?.openFile(state.currentFile, editor.getCursor().line);
}