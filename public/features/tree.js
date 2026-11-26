// 能力：代码树（建树、过滤、键盘导航、右键菜单）。
// 数据派生（小写表/路径集合/树）按仓库缓存；本模块不依赖 app.js，跨模块动作通过 initTreeFeature 注入。
import { elements } from '../core/dom.js';
import { state, sessions, jumpStack, jumpForwardStack, editor, getFocusIntent, noteFocusIntent } from '../core/state.js';
import { copyText } from '../core/api.js';
import { FILE_ICONS, MAX_PREPARED_FILES, PREPARED_LIMIT, TREE_FILTER_LIMIT } from '../core/config.js';
import { focusFirstMenuItem, scheduleIdle } from '../core/utils.js';

let deps = {};

export function initTreeFeature(dependencies) {
  deps = dependencies;
  wireTreeEvents();
}

export function isSortedPaths(files) {
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1] > files[index]) return false;
  }
  return true;
}

// 顺序建树：git ls-files 基本按路径排序，利用“与上一条路径的公共前缀”复用节点，
// 省掉逐段 Map 查找。kernel 仓（约 10 万文件）比逐段 has/get 快约 2 倍。
export function buildTree(files) {
  const list = isSortedPaths(files) ? files : [...files].sort();
  const root = { name: '', path: '', directory: true, children: [] };
  const stack = [root];
  let lastParts = [];
  for (const file of list) {
    const parts = file.split('/');
    let common = 0;
    const limit = Math.min(lastParts.length, parts.length);
    while (common < limit && lastParts[common] === parts[common]) common += 1;
    stack.length = common + 1;
    let parent = stack[common];
    let prefix = common === 0 ? '' : parent.path;
    for (let index = common; index < parts.length; index += 1) {
      const part = parts[index];
      const directory = index < parts.length - 1;
      const path = prefix ? `${prefix}/${part}` : part;
      const node = { name: part, path, directory, children: directory ? [] : null };
      parent.children.push(node);
      if (directory) {
        stack.push(node);
        parent = node;
        prefix = path;
      }
    }
    lastParts = parts;
  }
  return root;
}

// 工作区会话的派生数据（小写表/路径集合/代码树）按仓库缓存。
const preparedOrder = [];

export function preparePayload(data) {
  const files = Array.isArray(data?.files) ? data.files : [];
  if (files.length > MAX_PREPARED_FILES) return null;
  return {
    filesLower: files.map((filePath) => filePath.toLowerCase()),
    fileSet: new Set(files),
    tree: buildTree(files),
  };
}

export function rememberPrepared(key) {
  if (!key) return;
  const existing = preparedOrder.indexOf(key);
  if (existing >= 0) preparedOrder.splice(existing, 1);
  preparedOrder.push(key);
  while (preparedOrder.length > PREPARED_LIMIT) {
    const victim = preparedOrder.findIndex((candidate) => candidate !== state.sessionKey);
    if (victim < 0) break;
    const [evicted] = preparedOrder.splice(victim, 1);
    const session = sessions.get(evicted);
    if (session) session.prepared = null;
  }
}

export function preparedForSession(session) {
  if (!session?.data) return null;
  if (session.prepared) {
    rememberPrepared(session.key);
    return session.prepared;
  }
  if (session.preparedUnavailable) return null;
  session.prepared = preparePayload(session.data);
  if (session.prepared) rememberPrepared(session.key);
  else session.preparedUnavailable = true;
  return session.prepared;
}

// 预载仓库的派生数据切成 ≤10ms 的片，避免 9.8 万路径建树在 j/k 时卡出长任务。
export function preparePayloadIncremental(data, onDone, { budgetMs = 10 } = {}) {
  const files = Array.isArray(data?.files) ? data.files : [];
  if (files.length > MAX_PREPARED_FILES) {
    onDone(null);
    return;
  }
  const treeFiles = isSortedPaths(files) ? files : [...files].sort();
  const filesLower = new Array(files.length);
  const fileSet = new Set();
  const root = { name: '', path: '', directory: true, children: [] };
  const stack = [root];
  let lastParts = [];
  let phase = 0;
  let index = 0;
  const advance = () => {
    const deadline = performance.now() + budgetMs;
    while (index < files.length) {
      if (phase === 0) {
        filesLower[index] = files[index].toLowerCase();
      } else if (phase === 1) {
        fileSet.add(files[index]);
      } else {
        const parts = treeFiles[index].split('/');
        let common = 0;
        const limit = Math.min(lastParts.length, parts.length);
        while (common < limit && lastParts[common] === parts[common]) common += 1;
        stack.length = common + 1;
        let parent = stack[common];
        let prefix = common === 0 ? '' : parent.path;
        for (let partIndex = common; partIndex < parts.length; partIndex += 1) {
          const part = parts[partIndex];
          const directory = partIndex < parts.length - 1;
          const path = prefix ? `${prefix}/${part}` : part;
          const node = { name: part, path, directory, children: directory ? [] : null };
          parent.children.push(node);
          if (directory) {
            stack.push(node);
            parent = node;
            prefix = path;
          }
        }
        lastParts = parts;
      }
      index += 1;
      if ((index & 127) === 0 && performance.now() > deadline) break;
    }
    if (index < files.length) {
      scheduleIdle(advance);
      return;
    }
    if (phase === 0) {
      phase = 1;
      index = 0;
      scheduleIdle(advance);
      return;
    }
    if (phase === 1) {
      phase = 2;
      index = 0;
      scheduleIdle(advance);
      return;
    }
    onDone({ filesLower, fileSet, tree: root });
  };
  scheduleIdle(advance);
}

export function sortedChildren(node, filter) {
  return [...node.children]
    .filter((child) => {
      if (!filter) return true;
      if (!child.directory) return child.path.toLowerCase().includes(filter);
      return child.path.toLowerCase().includes(filter) || sortedChildren(child, filter).length > 0;
    })
    .sort((a, b) => a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1);
}

export function fileIcon(filePath) {
  const index = filePath.lastIndexOf('.');
  const extension = index === -1 ? '' : filePath.slice(index + 1).toLowerCase();
  return FILE_ICONS.get(extension) || { label: '·', className: '' };
}

export function statusClass(code) {
  if (!code) return '';
  if (code === '??') return 'status-u';
  if (code.includes('A')) return 'status-a';
  if (code.includes('D')) return 'status-d';
  if (code.includes('M')) return 'status-m';
  return 'status-u';
}

function collapsedStorageKey() {
  return state.repository ? `code-reader-collapsed:${state.repository.id}` : '';
}

export function restoreCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(collapsedStorageKey()) || 'null');
    return Array.isArray(raw) ? new Set(raw) : null;
  } catch {
    return null;
  }
}

export function persistCollapsed() {
  if (state.repository) {
    localStorage.setItem(collapsedStorageKey(), JSON.stringify([...state.collapsed]));
  }
}

function renderFilteredTree(filter) {
  const matches = [];
  let total = 0;
  for (let index = 0; index < state.files.length; index += 1) {
    if (!state.filesLower[index].includes(filter)) continue;
    total += 1;
    if (matches.length < TREE_FILTER_LIMIT) matches.push(state.files[index]);
  }
  state.filterMatches = matches;
  state.filterTotal = total;
  // 只有一个候选时默认高亮，回车可直接打开；多候选由 ↑/↓ 选择。
  if (state.filterIndex < 0 && total === 1 && matches.length === 1) state.filterIndex = 0;
  if (state.filterIndex >= matches.length) state.filterIndex = matches.length - 1;
  if (!total) {
    state.filterIndex = -1;
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '没有匹配的文件';
    elements.fileTree.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  matches.forEach((filePath, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const focused = index === state.filterIndex;
    button.className = `tree-row tree-row-flat${state.currentFile === filePath ? ' active' : ''}${focused ? ' key-focus' : ''}`;
    button.title = filePath;
    button.dataset.path = filePath;
    button.dataset.directory = 'false';
    const icon = fileIcon(filePath);
    const iconElement = document.createElement('span');
    iconElement.className = `file-icon ${icon.className}`;
    iconElement.textContent = icon.label;
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = filePath;
    button.append(iconElement, name);
    fragment.append(button);
  });
  elements.fileTree.append(fragment);
  if (total > matches.length) {
    const note = document.createElement('div');
    note.className = 'empty-tree';
    note.textContent = `仅显示前 ${matches.length} 个匹配（共 ${total} 个），请继续输入缩小范围`;
    elements.fileTree.append(note);
  }
}

function updateFilterFocus(scroll = true) {
  const rows = [...elements.fileTree.querySelectorAll('.tree-row-flat')];
  rows.forEach((row, index) => row.classList.toggle('key-focus', index === state.filterIndex));
  if (scroll && state.filterIndex >= 0) rows[state.filterIndex]?.scrollIntoView({ block: 'nearest' });
}

function openFilteredFile(filePath) {
  if (!filePath) return;
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  const intent = getFocusIntent();
  deps.selectFile(filePath).then(() => {
    // 加载期间用户若打开了别的窗口，焦点留在那个窗口，不抢回过滤框。
    if (intent === getFocusIntent()) elements.treeFilter.focus();
  });
}

export function renderTree() {
  const active = document.activeElement;
  const ownedFocus = elements.fileTree.contains(active);
  const path = active?.closest?.('.tree-row')?.dataset.path
    || treeRows()[treeFocusIndex]?.dataset.path;
  renderTreeContents();
  if (ownedFocus) {
    const index = treeRows().findIndex((row) => row.dataset.path === path);
    if (index >= 0) treeFocusIndex = index;
    updateTreeFocus();
    // replaceChildren 会移除正在聚焦的按钮；立即接回焦点，避免按键落到 body。
    elements.fileTree.focus({ preventScroll: true });
  }
}

function renderTreeContents() {
  elements.fileTree.replaceChildren();
  if (!state.tree) {
    state.filterMatches = [];
    state.filterTotal = 0;
    state.filterIndex = -1;
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '打开一个本地或远程 Git 仓库';
    elements.fileTree.append(empty);
    return;
  }
  const filter = elements.treeFilter.value.trim().toLowerCase();
  if (filter) {
    renderFilteredTree(filter);
    return;
  }
  state.filterMatches = [];
  state.filterTotal = 0;
  state.filterIndex = -1;
  const fragment = document.createDocumentFragment();
  let visible = 0;

  const appendNode = (node, depth) => {
    for (const child of sortedChildren(node, filter)) {
      visible += 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tree-row${child.directory ? ' directory' : ''}${state.currentFile === child.path ? ' active' : ''}`;
      button.style.paddingLeft = `${6 + depth * 14}px`;
      button.title = child.path;
      button.dataset.path = child.path;
      button.dataset.directory = String(child.directory);

      const marker = document.createElement('span');
      marker.className = child.directory ? 'tree-arrow' : 'tree-file-mark';
      marker.textContent = child.directory ? (state.collapsed.has(child.path) && !filter ? '▶' : '▼') : '';
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = child.name;
      button.append(marker);
      if (!child.directory) {
        const icon = fileIcon(child.path);
        const iconElement = document.createElement('span');
        iconElement.className = `file-icon ${icon.className}`;
        iconElement.textContent = icon.label;
        button.append(iconElement);
      }
      button.append(name);
      const status = child.directory ? null : state.status[child.path];
      if (status) {
        const badge = document.createElement('span');
        badge.className = `tree-status ${statusClass(status)}`;
        badge.textContent = status;
        badge.title = `Git 状态：${status}`;
        button.append(badge);
      }
      fragment.append(button);

      if (child.directory && (filter || !state.collapsed.has(child.path))) appendNode(child, depth + 1);
    }
  };
  appendNode(state.tree, 0);
  if (!visible) {
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = '没有匹配的文件';
    elements.fileTree.append(empty);
  } else {
    elements.fileTree.append(fragment);
  }
}

// 文件树键盘焦点（Vim 风格：j/k、计数、翻屏、H/M/L、gg/G）。
let treeFocusIndex = -1;
let treeGPressedAt = 0;
let treeCount = '';

export function treeRows() {
  return Array.from(elements.fileTree.querySelectorAll('.tree-row'));
}

export function updateTreeFocus() {
  const rows = treeRows();
  if (!rows.length) return;
  treeFocusIndex = Math.max(0, Math.min(treeFocusIndex, rows.length - 1));
  rows.forEach((row, index) => row.classList.toggle('key-focus', index === treeFocusIndex));
  rows[treeFocusIndex].scrollIntoView({ block: 'nearest' });
  // Tab/鼠标聚焦行按钮时，让真实焦点与导航下标一起移动。
  const activeRow = document.activeElement?.closest?.('.tree-row');
  if (activeRow && elements.fileTree.contains(activeRow) && activeRow !== rows[treeFocusIndex]) {
    rows[treeFocusIndex].focus({ preventScroll: true });
  }
}

export function focusTree() {
  if (!state.repository) return false;
  const rows = treeRows();
  // 数据尚未到达时也必须立即接管键盘，不能让 j/k 穿透到代码窗。
  // 文件树窗口拿到焦点：递增焦点意图，作废加载中代码窗的「迟到接管」。
  noteFocusIntent();
  // 文件树默认收起为覆盖层：键盘聚焦时先滑出，避免焦点落在屏幕外。
  window.__crPanels?.show('sidebar');
  treeFocusIndex = rows.findIndex((row) => row.dataset.path === state.currentFile);
  if (treeFocusIndex < 0) treeFocusIndex = 0;
  updateTreeFocus();
  elements.fileTree.focus();
  return true;
}

export async function activateTreeRow(row) {
  if (!row) return;
  if (row.dataset.directory === 'true') {
    const target = row.dataset.path;
    if (state.collapsed.has(target)) state.collapsed.delete(target);
    else state.collapsed.add(target);
    persistCollapsed();
    renderTree();
    treeFocusIndex = treeRows().findIndex((item) => item.dataset.path === target);
    updateTreeFocus();
    elements.fileTree.focus();
    return;
  }
  jumpStack.length = 0;
  jumpForwardStack.length = 0;
  const intent = getFocusIntent();
  await deps.selectFile(row.dataset.path);
  // 加载期间用户若打开了别的窗口（解释窗/quickpick…），焦点归最新窗口。
  if (intent === getFocusIntent()) editor.focus();
}

function showTreeMenu(context, left, top) {
  if (!context) return;
  state.treeContext = context;
  elements.treeMenu.hidden = false;
  elements.treeMenu.style.left = `${left}px`;
  elements.treeMenu.style.top = `${top}px`;
  noteFocusIntent();
  focusFirstMenuItem(elements.treeMenu);
}

// ---- DOM 事件（由 initTreeFeature 统一挂载，避免散落在 app.js）----

let treeFilterTimer = null;
let treeFilterPending = false;

function flushTreeFilter() {
  if (!treeFilterPending) return;
  clearTimeout(treeFilterTimer);
  treeFilterTimer = null;
  treeFilterPending = false;
  renderTree();
}

function wireTreeEvents() {
  // contenteditable 仅声明这里接管输入（Vimium 据此放行 j/k），树仍是只读数据视图。
  // 输入法直通提交（中文标点 / 全角字符不经组字直接 insertText）：还原成对应
  // ASCII 命令键交给树键处理。中文标点模式下 `/` 提交的是 `、`，不还原的话
  // 过滤框只能鼠标点击进入（映射与编辑器 IME_PUNCT_KEY 同一套）。
  const IME_PUNCT_KEYS = new Map([
    ['、', '/'],
    ['。', '.'],
    ['￥', '$'],
    ['《', '<'],
    ['》', '>'],
    ['·', '`'],
  ]);
  function treeCommandFromCommit(data) {
    if (typeof data !== 'string' || data.length !== 1) return null;
    const code = data.charCodeAt(0);
    // 半角直通字符的 keydown 已被树键处理消费（preventDefault 后不会再有
    // beforeinput），这里再派发会造成同一键双触发。
    if (code >= 0x20 && code <= 0x7e) return null;
    if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
    return IME_PUNCT_KEYS.get(data) || null;
  }
  elements.fileTree.addEventListener('beforeinput', (event) => {
    event.preventDefault();
    const key = event.inputType === 'insertText' ? treeCommandFromCommit(event.data) : null;
    if (!key) return;
    handleTreeKeydown({
      key,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
      stopPropagation() {},
    });
  });
  elements.fileTree.addEventListener('paste', (event) => event.preventDefault());
  elements.fileTree.addEventListener('drop', (event) => event.preventDefault());
  elements.treeFilter.addEventListener('input', () => {
    // 输入变化后旧的候选下标失效；单候选会在渲染时自动高亮。
    state.filterIndex = -1;
    treeFilterPending = true;
    clearTimeout(treeFilterTimer);
    treeFilterTimer = setTimeout(() => {
      treeFilterTimer = null;
      treeFilterPending = false;
      renderTree();
    }, 120);
  });
  // 过滤框内直接键盘导航：↑/↓ 或 Ctrl+j/k 选择候选，Enter 打开，Tab 回树内。
  elements.treeFilter.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    // Ctrl+j / Ctrl+k：字符键仍是过滤词，选择走组合键（与引用/搜索窗口的
    // 输入框约定一致——不能劫持裸 j/k，kernel/jbd2 这类文件名含这些字母）。
    if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'j' || event.key === 'k')) {
      if (!elements.treeFilter.value.trim()) return;
      event.preventDefault();
      event.stopPropagation();
      flushTreeFilter();
      const matches = state.filterMatches;
      if (!matches.length) return;
      const delta = event.key === 'j' ? 1 : -1;
      if (state.filterIndex < 0) state.filterIndex = delta > 0 ? 0 : matches.length - 1;
      else state.filterIndex = (state.filterIndex + delta + matches.length) % matches.length;
      updateFilterFocus();
      return;
    }
    // Tab：保留过滤条件把焦点送回树内，用完整 Vim 键（j/k/gg/G…）选择；
    // Esc 仍是清空过滤并退出。
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (!elements.treeFilter.value.trim()) return;
      event.preventDefault();
      event.stopPropagation();
      flushTreeFilter();
      if (!focusTree()) elements.fileTree.focus({ preventScroll: true });
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Esc 退出过滤：清空过滤条件并回到文件树。
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(treeFilterTimer);
      treeFilterTimer = null;
      treeFilterPending = false;
      elements.treeFilter.value = '';
      state.filterIndex = -1;
      renderTree();
      if (!focusTree()) elements.fileTree.focus({ preventScroll: true });
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
    if (!elements.treeFilter.value.trim()) return;
    flushTreeFilter();
    const matches = state.filterMatches;
    if (!matches.length) return;
    if (event.key === 'Enter') {
      const target = state.filterIndex >= 0
        ? matches[state.filterIndex]
        : (state.filterTotal === 1 ? matches[0] : null);
      if (!target) return;
      event.preventDefault();
      openFilteredFile(target);
      return;
    }
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    if (state.filterIndex < 0) state.filterIndex = delta > 0 ? 0 : matches.length - 1;
    else state.filterIndex = (state.filterIndex + delta + matches.length) % matches.length;
    updateFilterFocus();
  });

  let typePrefix = "", typeTime = 0;
  function handleTreeKeydown(event) {
    // isComposing = 组字进行中（键属于输入法）；keyCode 229（Process）不再早退：
    // fcitx 透传英文时 keydown 也可能带 229 而 key 仍是真实字母；key 为
    // 'Process' 时不会命中任何命令分支，无副作用。
    if (event.isComposing) return;
    let rows = treeRows();
    if (!rows.length && event.key !== 'Escape' && event.key !== 'q') return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const row = rows[Math.max(0, Math.min(treeFocusIndex, rows.length - 1))];
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = row.getBoundingClientRect();
      showTreeMenu(
        { path: row.dataset.path, directory: row.dataset.directory === 'true' },
        rect.left + 6,
        rect.bottom,
      );
      return;
    }
    if (event.altKey || event.metaKey) return;
    const key = event.key;
    const ctrl = event.ctrlKey;
    if (ctrl || !/^[a-z.]$/.test(key) || ['j', 'k', 'g', 'o', 'q'].includes(key)) typePrefix = '';
    // 数字计数（5j / 3G / 12gg），0 单独出现表示首项。
    if (!ctrl && /^[0-9]$/.test(key) && !(key === '0' && !treeCount)) {
      treeCount = `${treeCount}${key}`.slice(-6);
      event.preventDefault();
      return;
    }
    const count = treeCount ? Number(treeCount) : 0;
    const pageItems = Math.max(1, Math.floor(elements.fileTree.clientHeight / 27));
    const clampIndex = (value) => Math.max(0, Math.min(rows.length - 1, value));
    const finish = () => {
      treeCount = '';
      treeGPressedAt = 0;
      event.preventDefault();
      event.stopPropagation();
      updateTreeFocus();
    };
    if (key === 'j' || key === 'ArrowDown') {
      treeFocusIndex = clampIndex(treeFocusIndex + (count || 1));
    } else if (key === 'k' || key === 'ArrowUp') {
      treeFocusIndex = clampIndex(treeFocusIndex - (count || 1));
    } else if (ctrl && (key === 'd' || key === 'u' || key === 'f' || key === 'b')) {
      // 半屏/整屏：Ctrl+d/u/f/b（文件树行高固定，按可视行数翻）。
      const half = Math.max(1, Math.round(pageItems / 2));
      const step = key === 'd' || key === 'u' ? half : pageItems;
      const direction = key === 'd' || key === 'f' ? 1 : -1;
      treeFocusIndex = clampIndex(treeFocusIndex + direction * step * (count || 1));
    } else if (key === 'PageDown' || key === 'PageUp') {
      treeFocusIndex = clampIndex(treeFocusIndex + (key === 'PageDown' ? 1 : -1) * pageItems);
    } else if (key === 'H' || key === 'M' || key === 'L') {
      treeFocusIndex = key === 'H' ? 0 : key === 'M' ? Math.floor((rows.length - 1) / 2) : rows.length - 1;
    } else if (key === '0' || key === '^') {
      treeFocusIndex = 0;
    } else if (key === '$') {
      treeFocusIndex = rows.length - 1;
    } else if (key === 'G') {
      treeFocusIndex = count ? clampIndex(count - 1) : rows.length - 1;
    } else if (key === 'g') {
      // Vim 风格 gg：700ms 内连按两次跳到第一个文件；带计数（12gg）跳到第 12 个。
      const now = Date.now();
      if (now - treeGPressedAt <= 700) {
        treeFocusIndex = count ? clampIndex(count - 1) : 0;
      } else {
        treeGPressedAt = now;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    } else if (key === 'Enter' || key === 'o') {
      typePrefix = '';
      const targetIndex = treeFocusIndex;
      treeCount = '';
      treeGPressedAt = 0;
      event.preventDefault();
      event.stopPropagation();
      activateTreeRow(rows[clampIndex(targetIndex)]);
      return;
    } else if (key === 'q' || key === 'Escape') {
      treeCount = '';
      treeGPressedAt = 0;
      event.preventDefault();
      event.stopPropagation();
      // 关闭是「收起窗口」而不是只把焦点送回编辑器：窗口若留在屏幕上，
      // 用户再按 j/k 会落回代码窗，表现为「窗口开着但导航失效」。
      window.__crPanels?.hide('sidebar');
      editor.focus();
      return;
    } else if (key === '/') {
      // / 直接跳到过滤框：文件太多时先过滤再 j/k 选择。
      treeCount = '';
      treeGPressedAt = 0;
      event.preventDefault();
      event.stopPropagation();
      elements.treeFilter.focus();
      elements.treeFilter.select();
      return;
    } else if (!ctrl && /^[a-z.]$/.test(key)) {
      typePrefix = Date.now() - typeTime < 1200 ? typePrefix + key : key;
      typeTime = Date.now();
      // Exact basenames use the complete repository list, including collapsed directories.
      const exact = state.files.filter(path => path.split('/').pop().toLowerCase() === typePrefix).sort()[0];
      if (exact && !elements.treeFilter.value.trim()) {
        const parts = exact.split('/');
        for (let i = 1; i < parts.length; i++) state.collapsed.delete(parts.slice(0, i).join('/'));
        persistCollapsed();
        renderTreeContents();
        rows = treeRows();
      }
      const names = rows.map(row => row.dataset.path.split('/').pop().toLowerCase());
      let index = exact ? rows.findIndex(row => row.dataset.path === exact) : names.indexOf(typePrefix);
      if (index < 0) index = names.findIndex(name => name.startsWith(typePrefix));
      if (index >= 0) treeFocusIndex = index;
    } else {
      treeCount = '';
      treeGPressedAt = 0;
      return;
    }
    finish();
  }

  elements.fileTree.addEventListener('focusin', (event) => {
    if (!elements.fileTree.contains(event.relatedTarget)) {
      treeCount = '';
      treeGPressedAt = 0;
      typePrefix = '';
    }
    const row = event.target.closest('.tree-row');
    if (!row) return;
    treeFocusIndex = treeRows().indexOf(row);
    updateTreeFocus();
  });
  elements.fileTree.addEventListener('keydown', handleTreeKeydown);

  elements.fileTree.addEventListener('click', async (event) => {
    const row = event.target.closest('.tree-row');
    if (!row) return;
    // 目录展开会重建整棵树：与键盘激活共用一条路径，焦点留在同路径的新行上。
    await activateTreeRow(row);
  });
  elements.fileTree.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.tree-row');
    if (!row || !state.repository) return;
    event.preventDefault();
    showTreeMenu(
      { path: row.dataset.path, directory: row.dataset.directory === 'true' },
      event.clientX,
      event.clientY,
    );
  });
  elements.treeMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      elements.treeMenu.hidden = true;
      elements.fileTree.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...elements.treeMenu.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else next = (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  elements.treeMenu.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || !state.treeContext) return;
    const action = button.dataset.action;
    const context = state.treeContext;
    elements.treeMenu.hidden = true;
    if (action === 'copy-relative') {
      await copyText(context.path);
      deps.showNotice('已复制相对路径');
    } else if (action === 'copy-absolute') {
      await copyText(`${state.repository.root.replace(/\/+$/, '')}/${context.path}`);
      deps.showNotice('已复制绝对路径');
    } else if (action === 'refresh-tree') {
      try {
        const data = await deps.api(`/api/repositories/${encodeURIComponent(state.repository.id)}/refresh`, { method: 'POST' });
        await deps.loadRepository(data, { preserveFile: true, stashNotice: false });
      } catch (error) {
        deps.showNotice(`刷新失败：${error.message}`, { error: true });
      }
    }
    // 键盘激活菜单项（Enter/Space 产生 detail=0 的 click）后把焦点还给文件树。
    if (event.detail === 0) elements.fileTree.focus();
  });
  // 点击空白处关闭右键菜单。
  document.addEventListener('click', (event) => {
    if (!elements.treeMenu.hidden && !elements.treeMenu.contains(event.target)) {
      elements.treeMenu.hidden = true;
      // 菜单打开期间侧栏被禁止自动收起；菜单关闭后按正常规则重新调度。
      if (!elements.sidebar.contains(event.target)) window.__crPanels?.conceal('sidebar');
    }
  });
}