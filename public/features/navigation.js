// 能力：阅读导航（跳转栈、gd/gr、阅读路径、\e/:e 文件、两侧栏入口）。
import { elements } from '../core/dom.js';
import { state, jumpStack, jumpForwardStack, editor, noteFocusIntent } from '../core/state.js';
import { api } from '../core/api.js';
import { focusTree } from './tree.js';

let deps = {};

export function initNavigationFeature(dependencies) {
  deps = dependencies;
  elements.navTree.addEventListener('click', () => toggleCodeTreePanel());
  elements.navInsights.addEventListener('click', () => toggleInsightsPanel());
}

// ---- 阅读路径 ----

export function pushReadingTrail(location) {
  if (!location?.path) return;
  const entry = { path: location.path, line: location.line || 1 };
  const existing = state.readingTrail.findIndex((item) => item.path === entry.path && item.line === entry.line);
  if (existing >= 0) state.readingTrail.splice(existing, 1);
  state.readingTrail.push(entry);
  if (state.readingTrail.length > 8) state.readingTrail.shift();
  renderReadingTrail();
}

export function renderReadingTrail() {
  const trail = state.readingTrail;
  elements.readingTrail.replaceChildren();
  elements.readingTrail.hidden = !trail.length;
  if (!trail.length) return;
  const label = document.createElement('span');
  label.className = 'trail-label';
  label.textContent = '阅读路径';
  elements.readingTrail.append(label);
  trail.forEach((location, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'trail-sep';
      separator.textContent = '→';
      elements.readingTrail.append(separator);
    }
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'trail-chip';
    if (location.path === state.currentFile && location.line === state.activeLine) chip.classList.add('current');
    chip.textContent = `${location.path.split('/').pop()}:${location.line}`;
    chip.title = `${location.path}:${location.line}`;
    chip.addEventListener('click', () => {
      jumpTo({ path: location.path, line: location.line, character: 0 });
    });
    elements.readingTrail.append(chip);
  });
}

// ---- 两侧栏入口 ----

// 两侧栏共用入口：键盘 Ctrl+Alt+B/I 与代码窗口上方的箭头按钮走同一条路径。
// 语义是「去这个窗口」而不是盲目开关：面板已打开但焦点不在里面时，把焦点送进去；
// 只有焦点已经在面板内时，再按一次才收起。
export function closeCodeTreePanel({ restoreFocus = true } = {}) {
  treeFocusRequest += 1;
  window.__crPanels?.hide('sidebar');
  if (restoreFocus) {
    if (editor) editor.focus();
    else elements.navTree?.focus({ preventScroll: true });
  }
}

export function toggleCodeTreePanel() {
  const app = document.getElementById('app');
  const visible = app.classList.contains('sidebar-visible');
  const focusInside = Boolean(document.activeElement?.closest?.('.sidebar'));
  if (visible && focusInside) {
    // 收起后焦点回代码窗；侧栏里的节点随即隐藏，不能再把焦点留在提示按钮上。
    closeCodeTreePanel();
    return;
  }
  window.__crPanels?.pin('sidebar');
  requestTreeFocus();
}

// 页面刷新后文件树数据仍在异步恢复：第一次 Ctrl+Alt+B 时 focusTree() 可能
// 因为还没有行而失败（面板已滑出、焦点却留在编辑器）。这里在短时间内重试。
let treeFocusRequest = 0;

// 键盘导航跳到代码行时，焦点由编辑器接管：作废仍在跑的文件树补焦点重试。
export function cancelTreeFocusRequest() {
  treeFocusRequest += 1;
}

function requestTreeFocus() {
  const app = document.getElementById('app');
  const token = ++treeFocusRequest;
  const origin = document.activeElement;
  const deadline = Date.now() + 4000;
  let focusedAt = 0;
  const treeHasFocus = () => {
    const active = document.activeElement;
    return Boolean(active && (active === elements.fileTree || elements.fileTree.contains(active)));
  };
  const attempt = () => {
    if (token !== treeFocusRequest) return;
    const active = document.activeElement;
    if (treeHasFocus()) {
      if (!focusedAt) focusedAt = Date.now();
      // 聚焦成功后留一个短暂观察窗：重载恢复流程可能在随后一帧把焦点设回
      // 编辑器，树重渲染也可能把焦点冲掉；这里以 activeElement 实况为准继续补。
      if (Date.now() - focusedAt < 700 && Date.now() < deadline) setTimeout(attempt, 120);
      return;
    }
    focusedAt = 0;
    // 顶层弹层在场时不要把焦点拽到背后的文件树。
    if (document.querySelector('dialog[open]') || !elements.commitOverlay.hidden || !elements.animationOverlay.hidden) return;
    // 用户把焦点移到别处则放弃。重载恢复流程会把焦点设回编辑器，继续重试。
    if (active?.closest?.('.sidebar')) return;
    if (active !== origin && active !== document.body && active !== document.documentElement && !active?.closest?.('#editor-host')) return;
    // 重载恢复期面板 class 可能晚一帧才置位：未可见时也继续按 120ms 重试。
    if (!app.classList.contains('sidebar-visible')) {
      if (Date.now() < deadline) setTimeout(attempt, 120);
      return;
    }
    focusTree();
    // focusTree() 返回 true 不代表焦点真的留下（树重渲染/恢复流程都可能冲掉），
    // 下一次 attempt 以 activeElement 实况复核，不在树内就继续重试。
    if (Date.now() < deadline) setTimeout(attempt, 120);
  };
  attempt();
}

export function closeInsightsPanel({ restoreFocus = true } = {}) {
  window.__crPanels?.hide('insights');
  if (restoreFocus) editor?.focus();
}

export function toggleInsightsPanel() {
  const app = document.getElementById('app');
  const visible = app.classList.contains('insights-visible');
  const focusInside = Boolean(document.activeElement?.closest?.('.insights'));
  if (visible && focusInside) {
    // 焦点已在解释窗口里：再按一次收起，焦点回代码窗。
    closeInsightsPanel();
    return;
  }
  // 隐藏时打开；悬停/已打开时钉住；随后聚焦解释窗口以便 j/k 导航。
  window.__crPanels?.pin('insights');
  // 打开即交焦点：延迟 200ms 会让紧随其后的 j/k 仍落在编辑器里（表现为“没转移焦点”）。
  deps.focusExplanationPanel();
  // 首次从隐藏态滑出时再补一次：个别浏览器会忽略对刚取消 inert 元素的首帧聚焦。
  if (!visible) setTimeout(deps.focusExplanationPanel, 0);
}

// ---- 跳转 ----

export async function jumpTo(location, pushCurrent = true) {
  if (!state.repository || !location) return;
  if (pushCurrent && state.currentFile) {
    jumpStack.push({ path: state.currentFile, line: editor.getCursor().line, character: editor.getCursor().character });
    jumpForwardStack.length = 0;
  }
  if (location.path === state.currentFile) {
    editor.revealPosition(location.line, location.character);
    state.activeLine = location.line;
    deps.fetchFunctionHistory(location.line);
  } else {
    await deps.selectFile(location.path, { line: location.line, character: location.character });
    state.activeLine = location.line;
    deps.fetchFunctionHistory(location.line);
  }
  pushReadingTrail(location);
}

export async function gotoDefinition() {
  if (!state.repository || !state.currentFile) return;
  const position = editor.getCursor();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/lsp/goto-definition`, {
      method: 'POST',
      body: JSON.stringify({
        path: state.currentFile,
        line: position.line,
        character: position.character,
        content: editor.getValue(),
      }),
    });
    if (!data.locations.length) {
      elements.sourceStatus.textContent = '未找到定义';
      return;
    }
    if (data.locations.length === 1) {
      await jumpTo(data.locations[0]);
      return;
    }
    // 引用/定义列表覆盖代码区，收起两侧悬停面板避免遮住列表。
    window.__crPanels?.hideAll();
    noteFocusIntent();
    editor.showQuickpick(data.locations, (picked) => {
      jumpTo(picked);
    });
  } catch (error) {
    elements.sourceStatus.textContent = `跳转失败：${error.message}`;
  }
}

const referencePreviewCache = new Map();

// 引用列表与工作区搜索共用同一份上下文预览（带缓存）。
export async function loadContextPreview(item) {
  if (!state.repository) throw new Error('仓库已关闭');
  const key = `${state.repository.id}:${state.repository.head}:${item.path}:${item.line}`;
  if (referencePreviewCache.has(key)) return referencePreviewCache.get(key);
  const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/context?path=${encodeURIComponent(item.path)}&line=${encodeURIComponent(item.line)}&radius=10`);
  referencePreviewCache.set(key, data);
  if (referencePreviewCache.size > 200) {
    referencePreviewCache.delete(referencePreviewCache.keys().next().value);
  }
  return data;
}

export const loadReferencePreview = loadContextPreview;

export async function gotoReferences() {
  if (!state.repository || !state.currentFile) return;
  const position = editor.getCursor();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/lsp/references`, {
      method: 'POST',
      body: JSON.stringify({
        path: state.currentFile,
        line: position.line,
        character: position.character,
        content: editor.getValue(),
      }),
    });
    if (!data.locations.length) {
      elements.sourceStatus.textContent = '未找到引用';
      return;
    }
    if (data.locations.length === 1) {
      await jumpTo(data.locations[0]);
      return;
    }
    window.__crPanels?.hideAll();
    noteFocusIntent();
    editor.showQuickpick(data.locations, (picked) => {
      jumpTo(picked);
    }, {
      title: `${data.locations.length} 个引用 · j/k 或 ↑↓ 选择 · Enter 跳转 · Esc 取消`,
      preview: loadContextPreview,
    });
  } catch (error) {
    elements.sourceStatus.textContent = `引用查询失败：${error.message}`;
  }
}

export function currentLocation() {
  return state.currentFile
    ? { path: state.currentFile, line: editor.getCursor().line, character: editor.getCursor().character }
    : null;
}

export async function jumpBack() {
  const target = jumpStack.pop();
  if (!target) {
    elements.sourceStatus.textContent = '跳转栈为空';
    return false;
  }
  const current = currentLocation();
  if (current) jumpForwardStack.push(current);
  await jumpTo(target, false);
  return true;
}

export async function jumpForward() {
  const target = jumpForwardStack.pop();
  if (!target) return false;
  const current = currentLocation();
  if (current) jumpStack.push(current);
  await jumpTo(target, false);
  return true;
}

// ---- :e / :vi 路径解析 ----

export function resolveExPath(value) {
  let target = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!target) return null;
  target = target.replace(/^\.\//, '');
  if (target.startsWith('/')) {
    const root = String(state.repository?.root || '').replace(/\/+$/, '');
    if (!root || !(target === root || target.startsWith(`${root}/`))) return null;
    target = target.slice(root.length).replace(/^\/+/, '');
  }
  if (state.fileSet.has(target)) return target;
  const lower = target.toLowerCase();
  const exact = state.files.find((filePath, index) => state.filesLower[index] === lower);
  if (exact) return exact;
  return state.files.find((filePath, index) => state.filesLower[index].endsWith(`/${lower}`)) || null;
}

export function openExFile(value) {
  const target = resolveExPath(value);
  if (!target) {
    elements.sourceStatus.textContent = `未找到文件：${value}`;
    return false;
  }
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  deps.selectFile(target);
  return true;
}

export function exFileCompletions(prefix) {
  const lower = String(prefix || '').toLowerCase();
  if (!lower) return [];
  const starts = [];
  const contains = [];
  for (let index = 0; index < state.files.length; index += 1) {
    const filePath = state.files[index];
    const fileLower = state.filesLower[index];
    if (fileLower.startsWith(lower)) starts.push(filePath);
    else if (fileLower.includes(lower)) contains.push(filePath);
    if (starts.length >= 12) break;
  }
  return [...starts, ...contains].slice(0, 12);
}