// one-shot: code-reader 通用窗口 Vim 键导航（项目固定模块，非 agent 探索脚本）; no-generalize: 依赖 code-reader 的窗口结构（对话框/提交详情/解释栏）
// grill: 成品检索=skill 库无「任意 DOM 窗口完整 Vim 动作」成品; 输入固定=顶层窗口与可聚焦元素（固定选择器）; 步骤机械=定位当前窗口→解析计数/动作→移动焦点或滚动; 判读固定=document.activeElement 与 scrollTop; 失效场景=构造不出（仅本应用）
//
// 任意窗口的 Vim 风格导航（编辑器 / nvim / 文件树 / 引用列表 / 目录浏览器
// / 3D 弹层已有各自键位处理，这里不重复接管）：
//   j / k           列表模式在可聚焦项间移动；阅读模式逐行滚动。可带计数：5j
//   Ctrl+d / Ctrl+u 半屏（列表模式=半页项目）
//   Ctrl+f / Ctrl+b、PageDown / PageUp、Space / Shift+Space 整屏
//   gg / G          首个/最后一个目标；Ngg / NG 跳到第 N 个（阅读模式=第 N 行）
//   H / M / L       列表=首/中/末项；阅读=内容顶部/中间/底部
//   0 / ^ / $       列表=首/末项；阅读=横向滚到最左/最右
//   o               激活当前列表项（Enter 走浏览器原生路径）
//   / 查询 Enter    在当前窗口内搜索；n / N 下一个 / 上一个；Esc 清除高亮
const ITEM_SELECTOR = [
  'a[href]',
  'button',
  'summary',
  '[data-nav]',
  '[tabindex="0"]',
].join(',');

// 自带按键处理的区域：CodeMirror（Vim 模式）、xterm（nvim）、标签层、
// 文件树、目录浏览器、搜索条。
const OWN_KEYS_SELECTOR = [
  '#editor-host',
  '#nvim-host',
  '#animation-overlay',
  '#file-tree',
  '.dir-list',
  '.cr-hint-layer',
  '.xterm',
  '.vim-search',
].join(',');

// 只有这些容器才启用通用导航，避免在页面上按 j/k 触发无关滚动。
const CONTAINER_SELECTOR = '.insight-content, #history-menu, #tree-menu, .question-editor, .reading-trail';

// 覆盖层/对话框里的滚动区不一定包含焦点（焦点常在标题栏按钮上）。
const SCROLL_FALLBACKS = [
  '.commit-overlay-body',
  '.vim-help-body',
  '.editor-env-body',
  '.docs-body',
  '.nvim-keymap-body',
].join(',');

const G_WINDOW_MS = 700;
const SEARCH_HIGHLIGHT = 'cr-vim-search';
const SEARCH_CURRENT = 'cr-vim-search-current';
const SEARCH_LIMIT = 800;

function isVisible(element) {
  if (!element?.isConnected || element.disabled) return false;
  if (element.closest('[hidden], [inert]')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  return element.getClientRects().length > 0;
}

function itemsIn(root) {
  return [...root.querySelectorAll(ITEM_SELECTOR)]
    .filter((element) => element !== root && !element.matches('.insight-content') && isVisible(element));
}

// 当前顶层窗口：原生 dialog > 3D 弹层（交还 iframe）> 提交详情 > 焦点所在面板/菜单。
function scopeFor() {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) return dialog;
  const animation = document.getElementById('animation-overlay');
  if (animation && !animation.hidden) return null;
  const commit = document.getElementById('commit-overlay');
  if (commit && !commit.hidden) return commit.querySelector('.commit-overlay-card') || commit;
  const active = document.activeElement;
  if (!(active instanceof Element)) return null;
  if (active.closest(OWN_KEYS_SELECTOR)) return null;
  const container = active.closest(CONTAINER_SELECTOR);
  if (container) return container;
  const section = active.closest('.insight-section');
  if (section) return section;
  const insights = active.closest('.insights');
  if (insights) return insights;
  return null;
}

function isScrollable(element) {
  if (!element || element.scrollHeight <= element.clientHeight + 1) return false;
  const style = window.getComputedStyle(element);
  return style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay';
}

function scrollableFor(root, active) {
  let node = active instanceof Element ? active : null;
  while (node && node !== root) {
    if (isScrollable(node)) return node;
    node = node.parentElement;
  }
  if (isScrollable(root)) return root;
  for (const element of root.querySelectorAll(SCROLL_FALLBACKS)) {
    if (isScrollable(element)) return element;
  }
  return null;
}

// j/k 一次滚一行，行高取容器的实际 line-height。
function lineStep(scroller) {
  const style = window.getComputedStyle(scroller);
  const lineHeight = parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return Math.min(48, Math.max(12, Math.round(lineHeight)));
  const fontSize = parseFloat(style.fontSize);
  return Math.round((Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 13) * 1.6);
}

function halfStep(scroller) {
  return Math.max(lineStep(scroller), Math.round(scroller.clientHeight / 2));
}

function pageStep(scroller) {
  return Math.max(lineStep(scroller) * 4, Math.round(scroller.clientHeight * 0.9));
}

function pageCount(items, scroller) {
  const height = scroller?.clientHeight || window.innerHeight;
  const heights = items.slice(0, 12)
    .map((item) => item.getBoundingClientRect().height)
    .filter((value) => value > 0);
  const average = heights.length ? heights.reduce((sum, value) => sum + value, 0) / heights.length : 26;
  return Math.max(1, Math.floor(height / Math.max(14, average)));
}

const supportsHighlight = typeof Highlight === 'function'
  && typeof CSS !== 'undefined'
  && Boolean(CSS.highlights);

// 收集窗口内可见文本节点的搜索匹配（纯文本、大小写不敏感，不做正则）。
export function findTextMatches(root, query) {
  const needle = String(query || '').toLowerCase();
  if (!needle) return [];
  const matches = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, noscript, .vim-search')) return NodeFilter.FILTER_REJECT;
      // 跳过隐藏面板（对话框里未激活的页签等），否则计数会把不可见文本算进去。
      if (parent.closest('[hidden], [inert]') || !parent.getClientRects().length) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node && matches.length < SEARCH_LIMIT) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    let from = 0;
    while (matches.length < SEARCH_LIMIT) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      matches.push(range);
      from = at + Math.max(1, needle.length);
    }
    node = walker.nextNode();
  }
  return matches;
}

export function createVimNav() {
  let gPressedAt = 0;
  let countBuffer = '';
  let activeSearch = null;

  function resetPrefixes() {
    countBuffer = '';
    gPressedAt = 0;
  }

  function focusIndex(items, index) {
    if (!items.length) return false;
    const target = items[Math.max(0, Math.min(items.length - 1, index))];
    target?.focus?.({ preventScroll: false });
    return true;
  }

  function clearHighlights() {
    if (!supportsHighlight) return;
    CSS.highlights.delete(SEARCH_HIGHLIGHT);
    CSS.highlights.delete(SEARCH_CURRENT);
  }

  function paintSearch(state) {
    if (!supportsHighlight) return;
    const ranges = state.ranges.filter((range) => range.startContainer.isConnected);
    if (!ranges.length) {
      clearHighlights();
      return;
    }
    CSS.highlights.set(SEARCH_HIGHLIGHT, new Highlight(...ranges));
    CSS.highlights.set(SEARCH_CURRENT, new Highlight(ranges[state.index]));
  }

  function revealRange(scroller, range) {
    if (!scroller || !range || !range.startContainer.isConnected) return;
    const rect = range.getBoundingClientRect();
    if (!rect.height && !rect.width) return;
    const box = scroller.getBoundingClientRect();
    const margin = 18;
    if (rect.top < box.top + 6) scroller.scrollTop -= (box.top - rect.top) + margin;
    else if (rect.bottom > box.bottom - 6) scroller.scrollTop += (rect.bottom - box.bottom) + margin;
  }

  function removeSearchBar() {
    const bar = activeSearch?.bar;
    // 先置空再移除：移除聚焦元素会同步触发 blur，blur 处理器里还会调到这里，
    // 重复 remove 会抛 NotFoundError 并打断后续的焦点恢复。
    if (activeSearch) activeSearch.bar = null;
    if (bar?.isConnected) bar.remove();
  }

  // 移除搜索框时浏览器会把焦点收到 body；同一事件里立刻 focus 会被随后的
  // focus fix-up 覆盖，所以再补一次 setTimeout(0)。
  function restoreFocusSoon(previous, root) {
    const apply = () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      else if (root instanceof HTMLElement && root.isConnected) root.focus?.({ preventScroll: true });
    };
    apply();
    setTimeout(apply, 0);
  }

  function closeSearch(restoreFocus = true) {
    if (!activeSearch) return false;
    const { root, previous } = activeSearch;
    removeSearchBar();
    clearHighlights();
    activeSearch = null;
    if (restoreFocus) restoreFocusSoon(previous, root);
    return true;
  }

  function searchScope() {
    if (!activeSearch) return null;
    if (!activeSearch.root.isConnected) {
      activeSearch = null;
      clearHighlights();
      return null;
    }
    return activeSearch;
  }

  function cycleSearch(direction) {
    const state = searchScope();
    if (!state) return false;
    const ranges = state.ranges.filter((range) => range.startContainer.isConnected);
    if (!ranges.length) return false;
    state.ranges = ranges;
    state.index = (state.index + direction + ranges.length) % ranges.length;
    paintSearch(state);
    revealRange(state.scroller, ranges[state.index]);
    return true;
  }

  function openSearch(root, scroller, previous) {
    closeSearch(false);
    const bar = document.createElement('div');
    bar.className = 'vim-search';
    bar.setAttribute('role', 'search');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vim-search-input';
    input.placeholder = '本窗口内搜索';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const counter = document.createElement('span');
    counter.className = 'vim-search-count';
    bar.append(input, counter);
    const host = root.closest('dialog[open]') || document.body;
    const rect = root.getBoundingClientRect();
    const width = Math.min(320, Math.max(200, Math.round(rect.width - 24)));
    bar.style.position = 'fixed';
    bar.style.width = `${width}px`;
    bar.style.top = `${Math.max(8, Math.round(rect.top + 8))}px`;
    bar.style.left = `${Math.max(8, Math.round(Math.min(rect.right - width - 12, window.innerWidth - width - 12)))}px`;
    host.append(bar);

    const state = { root, scroller, previous, query: '', ranges: [], index: 0, bar, input, counter };
    activeSearch = state;
    const update = () => {
      state.query = input.value;
      state.ranges = state.query ? findTextMatches(root, state.query) : [];
      state.index = 0;
      paintSearch(state);
      counter.textContent = state.query
        ? (state.ranges.length ? `${state.ranges.length} 处` : '无匹配')
        : '';
      if (state.ranges.length) revealRange(scroller, state.ranges[0]);
    };
    input.addEventListener('input', update);
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSearch(true);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        update();
        if (!state.ranges.length) counter.textContent = state.query ? '无匹配' : '';
        // 回车一律退出输入态：保留已有高亮供 n/N 跳转；即使无匹配也不能
        // 继续把 n/N 当成查询字符追加到输入框里。
        removeSearchBar();
        restoreFocusSoon(previous, root);
      }
    });
    input.addEventListener('blur', () => {
      // 搜索条失焦（鼠标点到别处）：保留已输入查询与高亮，n/N 仍可用。
      if (activeSearch === state && activeSearch.bar) removeSearchBar();
    });
    input.focus();
    return true;
  }

  function gotoPosition(units, listMode, items, scroller) {
    if (listMode) return focusIndex(items, units - 1);
    if (scroller) {
      scroller.scrollTop = (units - 1) * lineStep(scroller);
      return true;
    }
    return false;
  }

  function handleKeydown(event) {
    // isComposing = 组字进行中（键属于输入法）；keyCode 229（Process）不再早退：
    // fcitx 透传英文时 keydown 也可能带 229 而 key 仍是真实字母（树侧 tree.js
    // 已同款修复），否则解释栏/历史/菜单/阅读路径的 j/k/gg/G 在输入法开启时
    // 全部失效。key 为 'Process' 时不会命中任何命令分支，无副作用。
    if (event.defaultPrevented || event.isComposing) return false;
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest('.vim-search')) return false;
    // 表单控件里按键是正常输入，不接管。
    if (target.matches('input, textarea, select') || target.isContentEditable) return false;
    if (target.closest(OWN_KEYS_SELECTOR)) return false;
    if (event.metaKey || event.altKey) return false;
    const ctrl = event.ctrlKey;
    const key = event.key;
    if (ctrl && !['d', 'u', 'f', 'b'].includes(key.toLowerCase())) return false;

    const root = scopeFor();
    if (!root) {
      resetPrefixes();
      return false;
    }

    // 数字计数前缀：0 只有在前导计数后才累积，否则是「行首/首项」动作。
    if (!ctrl && /^[0-9]$/.test(key) && !(key === '0' && !countBuffer)) {
      countBuffer = `${countBuffer}${key}`.slice(-6);
      event.preventDefault();
      return true;
    }

    const count = countBuffer ? Number(countBuffer) : 0;
    const items = itemsIn(root);
    const active = document.activeElement;
    const index = items.indexOf(active);
    const scroller = scrollableFor(root, active);
    // 只有一个可聚焦项（如 Vim 帮助/本地快捷键只有关闭按钮）时视为阅读
    // 模式：j/k/G/gg 滚动内容，而不是在唯一的按钮上原地打转。
    // data-vim-list：显式列表容器（函数提交历史）。焦点落在容器本身、
    // 内容又可滚动时，j/k 仍应在列表项之间移动，而不是逐行滚文本。
    const explicitList = root.hasAttribute?.('data-vim-list');
    const listMode = explicitList || (index >= 0 && (items.length > 1 || !scroller));
    const finished = () => {
      resetPrefixes();
      return true;
    };

    // gg / Ngg / NG：首个目标或第 N 个目标。
    if (key === 'g') {
      const now = Date.now();
      const doubleTap = now - gPressedAt <= G_WINDOW_MS;
      gPressedAt = doubleTap ? 0 : now;
      event.preventDefault();
      if (!doubleTap) return true;
      event.stopPropagation();
      return gotoPosition(count || 1, listMode, items, scroller) ? finished() : false;
    }
    gPressedAt = 0;

    if (key === 'G') {
      event.preventDefault();
      event.stopPropagation();
      const units = count || (listMode ? items.length : null);
      if (listMode) {
        return focusIndex(items, units ? units - 1 : items.length - 1) ? finished() : false;
      }
      if (scroller) {
        scroller.scrollTop = count ? (count - 1) * lineStep(scroller) : scroller.scrollHeight;
        return finished();
      }
      if (items.length) return focusIndex(items, items.length - 1) ? finished() : false;
      resetPrefixes();
      return false;
    }

    if (key === 'j' || key === 'k') {
      const delta = key === 'j' ? 1 : -1;
      const times = count || 1;
      event.preventDefault();
      event.stopPropagation();
      if (listMode) {
        // 焦点还在列表容器本身（index=-1）时：j 进首项、k 进末项。
        const nextIndex = index < 0
          ? (delta > 0 ? 0 : items.length - 1)
          : index + delta * times;
        if (!focusIndex(items, nextIndex)) return false;
        return finished();
      }
      if (scroller) {
        scroller.scrollTop += delta * times * lineStep(scroller);
        return finished();
      }
      if (items.length) {
        focusIndex(items, delta > 0 ? 0 : items.length - 1);
        return finished();
      }
      resetPrefixes();
      return false;
    }

    // 半屏 / 整屏：Ctrl+d/u/f/b、PageUp/PageDown、Space/Shift+Space。
    const pageDown = (ctrl && key.toLowerCase() === 'f')
      || key === 'PageDown'
      || (key === ' ' && !event.shiftKey);
    const pageUp = (ctrl && key.toLowerCase() === 'b')
      || key === 'PageUp'
      || (key === ' ' && event.shiftKey);
    const halfDown = ctrl && key.toLowerCase() === 'd';
    const halfUp = ctrl && key.toLowerCase() === 'u';
    if (pageDown || pageUp || halfDown || halfUp) {
      // 列表模式下的空格保留给按钮的原生激活，不抢。
      if (key === ' ' && listMode) return false;
      const direction = pageDown || halfDown ? 1 : -1;
      const times = count || 1;
      event.preventDefault();
      event.stopPropagation();
      if (listMode) {
        const step = pageCount(items, scroller) * times;
        const unit = halfDown || halfUp ? Math.max(1, Math.round(step / 2)) : step;
        return focusIndex(items, index + direction * unit) ? finished() : false;
      }
      if (scroller) {
        const step = halfDown || halfUp ? halfStep(scroller) : pageStep(scroller);
        scroller.scrollTop += direction * step * times;
        return finished();
      }
      resetPrefixes();
      return false;
    }

    if (key === 'H' || key === 'M' || key === 'L') {
      event.preventDefault();
      event.stopPropagation();
      if (listMode) {
        const position = key === 'H' ? 0 : key === 'M' ? Math.floor((items.length - 1) / 2) : items.length - 1;
        return focusIndex(items, position) ? finished() : false;
      }
      if (scroller) {
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = key === 'H' ? 0 : key === 'M' ? Math.round(max / 2) : max;
        return finished();
      }
      if (items.length) {
        return focusIndex(items, key === 'H' ? 0 : key === 'M' ? Math.floor((items.length - 1) / 2) : items.length - 1)
          ? finished()
          : false;
      }
      resetPrefixes();
      return false;
    }

    if (key === '0' || key === '^' || key === '$') {
      event.preventDefault();
      event.stopPropagation();
      if (listMode) {
        return focusIndex(items, key === '$' ? items.length - 1 : 0) ? finished() : false;
      }
      // 阅读模式：横向滚动（代码块/宽表）。
      if (scroller && scroller.scrollWidth > scroller.clientWidth + 1) {
        scroller.scrollLeft = key === '$' ? scroller.scrollWidth : 0;
      }
      return finished();
    }

    if (key === 'o' && listMode) {
      event.preventDefault();
      event.stopPropagation();
      const item = items[index];
      if (item && typeof item.click === 'function') item.click();
      return finished();
    }

    if (key === '/') {
      event.preventDefault();
      event.stopPropagation();
      return openSearch(root, scroller, active instanceof HTMLElement ? active : null);
    }

    if (key === 'n' || key === 'N') {
      const state = searchScope();
      // 只在发起搜索的窗口里响应 n/N，避免把别的窗口滚走。
      if (!state || state.root !== root) {
        resetPrefixes();
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      const cycled = cycleSearch(key === 'n' ? 1 : -1);
      if (cycled) {
        if (state.counter) state.counter.textContent = `${state.index + 1}/${state.ranges.length}`;
      }
      return finished();
    }

    resetPrefixes();
    return false;
  }

  // closeSearch 供外层 Esc 层级使用：搜索条打开时先清搜索，再退回阅读容器。
  return { handleKeydown, closeSearch };
}