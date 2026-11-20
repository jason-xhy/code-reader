// 能力：页面布局、侧栏显隐、配色与字体同步。
import { THEMES } from '../editor.js';
import { elements } from './dom.js';
import { state } from './state.js';
import { LAYOUT_KEY, PANEL_HIDE_DELAY } from './config.js';
import { clamp } from './utils.js';

export function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    state.layout = {
      sidebar: clamp(Number(saved.sidebar) || 252, 180, 420),
      insights: clamp(Number(saved.insights) || 372, 280, 640),
      // 旧的“永久折叠”模式已由悬停覆盖层取代，历史值不再生效。
      collapsed: false,
    };
  } catch {
    state.layout = { sidebar: 252, insights: 372, collapsed: false };
  }
}

export function applyLayout() {
  const app = document.getElementById('app');
  app.style.setProperty('--sidebar-width', `${state.layout.sidebar}px`);
  app.style.setProperty('--insights-width', `${state.layout.insights}px`);
  elements.splitterLeft.setAttribute('aria-valuenow', String(state.layout.sidebar));
  elements.splitterRight.setAttribute('aria-valuenow', String(state.layout.insights));
  app.classList.remove('insights-collapsed');
  elements.insightsExpand.hidden = true;
}

export function saveLayout() {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(state.layout));
}

export function initSplitter(side) {
  const handle = side === 'left' ? elements.splitterLeft : elements.splitterRight;
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = side === 'left' ? state.layout.sidebar : state.layout.insights;
    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === 'left') state.layout.sidebar = clamp(startWidth + delta, 180, 420);
      else state.layout.insights = clamp(startWidth - delta, 280, 640);
      applyLayout();
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      saveLayout();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
  // 分隔条也可用键盘调整：聚焦后 ←/→ 步进，Shift 加速。
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 12;
    if (event.key === 'Home') {
      if (side === 'left') state.layout.sidebar = 180;
      else state.layout.insights = 280;
    } else if (event.key === 'End') {
      if (side === 'left') state.layout.sidebar = 420;
      else state.layout.insights = 640;
    } else if (side === 'left') {
      state.layout.sidebar = clamp(state.layout.sidebar + (event.key === 'ArrowRight' ? step : -step), 180, 420);
    } else {
      state.layout.insights = clamp(state.layout.insights + (event.key === 'ArrowLeft' ? step : -step), 280, 640);
    }
    applyLayout();
    saveLayout();
  });
}

// 两侧栏默认收起为覆盖层：鼠标移到左/右边缘或面板上滑入，离开后延迟收起。
// 打开窗口（含悬停滑出）即把焦点交给窗口内容，与快捷键/点击同一语义；
// 焦点进入面板时保持展开；隐藏面板设 inert，避免焦点落进屏幕外。
export function initAutoPanels({ focus = {} } = {}) {
  const app = document.getElementById('app');
  const panels = [
    { name: 'sidebar', el: elements.sidebar, trigger: elements.sidebarTrigger, splitter: elements.splitterLeft },
    { name: 'insights', el: elements.insights, trigger: elements.insightsTrigger, splitter: elements.splitterRight },
  ].filter((panel) => panel.el && panel.trigger);
  const timers = new Map();
  const syncInert = (panel) => {
    if (!panel) return;
    if (app.classList.contains(`${panel.name}-visible`)) panel.el.removeAttribute('inert');
    else panel.el.setAttribute('inert', '');
  };
  const reveal = (panel, { force = false } = {}) => {
    if (!panel) return;
    if (!force && panel.suppress) return;
    clearTimeout(timers.get(panel.name));
    app.classList.add(`${panel.name}-visible`);
    syncInert(panel);
  };
  const conceal = (panel) => {
    if (!panel) return;
    if (panel.pinned) return;
    // 文件树右键菜单是 body 下的浮层，焦点移进去后不在 panel.el 内；
    // 菜单打开期间必须保持侧栏可见，否则侧栏被设为 inert 后 Esc 回焦会落到 body。
    if (panel.name === 'sidebar' && !elements.treeMenu.hidden) return;
    // 焦点在面板里就保持展开——鼠标点击解释窗口/文件树后焦点也在面板内，
    // 只看 :focus-visible 会让鼠标移开时把正在键盘阅读的面板收走。
    const active = document.activeElement;
    if (active && panel.el.contains(active)) return;
    if (panel.el.matches(':hover') || panel.splitter?.matches(':hover')) return;
    if (panel.splitter?.classList.contains('dragging')) return;
    app.classList.remove(`${panel.name}-visible`);
    syncInert(panel);
  };
  const scheduleConceal = (panel) => {
    if (!panel) return;
    clearTimeout(timers.get(panel.name));
    timers.set(panel.name, setTimeout(() => conceal(panel), PANEL_HIDE_DELAY));
  };
  // 收起面板：取消钉住，并在 400ms 内抑制指针重新滑出（指针正停在面板
  // 下方时，布局变化会让浏览器补发 pointerenter，否则刚关就弹开）。
  const closePanel = (panel) => {
    if (!panel) return false;
    panel.pinned = false;
    clearTimeout(timers.get(panel.name));
    app.classList.remove(`${panel.name}-visible`);
    syncInert(panel);
    // 只有指针正停在面板/边缘上时才抑制 400ms：否则布局变化会让浏览器补发
    // pointerenter，刚关就弹开。指针不在附近时不应拦截用户随后的主动滑入。
    const pointerOver = panel.el.matches(':hover')
      || panel.trigger?.matches(':hover')
      || panel.splitter?.matches(':hover');
    if (pointerOver) {
      panel.suppress = true;
      clearTimeout(panel.suppressTimer);
      panel.suppressTimer = setTimeout(() => { panel.suppress = false; }, 400);
    }
    return true;
  };
  // Ctrl+Alt+B / Ctrl+Alt+I 的面板语义在 navigation 模块里统一处理（见「去这个窗口」），
  // 这里的 toggle 只保留给加载状态等内部使用。
  const toggle = (panel) => {
    if (!panel) return false;
    if (app.classList.contains(`${panel.name}-visible`)) closePanel(panel);
    else {
      panel.pinned = true;
      panel.suppress = false;
      reveal(panel, { force: true });
    }
    return true;
  };
  // 鼠标滑出面板是「打开/激活窗口」：与 Ctrl+Alt+B/I 一样把焦点交给窗口内容。
  // 否则窗口可见但焦点仍在代码窗，j/k 等按键会继续落在编辑器里。
  const openByPointer = (panel) => {
    if (!panel) return;
    // 搜索/引用列表打开时，面板不抢前台也不抢焦点：quickpick 的 j/k 与输入
    // 必须留在列表里。隐藏面板会让指针下的 trigger 重新收到 pointerenter，
    // 这里直接短路，避免「打开搜索 → 侧栏弹出 → 焦点被抢」。
    const quickpick = document.getElementById('quickpick');
    if (quickpick && !quickpick.hidden) return;
    if (document.querySelector('dialog[open]')) return;
    const commit = document.getElementById('commit-overlay');
    if (commit && !commit.hidden) return;
    reveal(panel);
    // reveal 可能因 suppress（刚收起 400ms 内）被跳过：没真正打开就不移交焦点。
    if (!app.classList.contains(`${panel.name}-visible`)) return;
    // 焦点已在窗口内部时不打断（指针移进正在阅读的窗口不该重排焦点）。
    const active = document.activeElement;
    if (active && panel.el.contains(active)) return;
    focus[panel.name]?.();
  };
  for (const panel of panels) {
    panel.trigger.addEventListener('pointerenter', () => openByPointer(panel));
    panel.trigger.addEventListener('pointerleave', () => scheduleConceal(panel));
    panel.el.addEventListener('pointerenter', () => openByPointer(panel));
    panel.el.addEventListener('pointerleave', () => scheduleConceal(panel));
    panel.el.addEventListener('focusin', () => reveal(panel, { force: true }));
    panel.el.addEventListener('focusout', (event) => {
      if (panel.el.contains(event.relatedTarget)) return;
      scheduleConceal(panel);
    });
    panel.splitter?.addEventListener('pointerenter', () => reveal(panel));
    panel.splitter?.addEventListener('pointerleave', () => scheduleConceal(panel));
    // 初始默认收起：同步一次 inert，避免隐藏面板里的元素参与 Tab 顺序。
    syncInert(panel);
  }
  const byName = (name) => panels.find((panel) => panel.name === name);
  const hidePanel = (panel) => {
    if (!panel) return;
    // 显式收起侧栏时同步关掉右键菜单，避免菜单留在已 inert 的侧栏之外。
    if (panel.name === 'sidebar') elements.treeMenu.hidden = true;
    closePanel(panel);
  };
  window.__crPanels = {
    show(name) {
      reveal(byName(name), { force: true });
    },
    hide(name) {
      hidePanel(byName(name));
    },
    hideAll() {
      for (const panel of panels) hidePanel(panel);
    },
    toggle(name) {
      return toggle(byName(name));
    },
    pin(name) {
      const panel = byName(name);
      if (!panel) return;
      panel.pinned = true;
      panel.suppress = false;
      reveal(panel, { force: true });
    },
    unpin(name) {
      const panel = byName(name);
      if (panel) panel.pinned = false;
    },
    conceal(name) {
      scheduleConceal(byName(name));
    },
    isPinned(name) {
      return Boolean(byName(name)?.pinned);
    },
    isVisible(name) {
      return app.classList.contains(`${name}-visible`);
    },
  };
}

export function applyShellTheme(palette) {
  if (!palette) return;
  const root = document.documentElement.style;
  root.setProperty('--panel', palette.shell.panel);
  root.setProperty('--panel-deep', palette.shell.background);
  root.setProperty('--border', palette.shell.border);
  root.setProperty('--accent', palette.shell.accent);
  root.setProperty('--muted', palette.shell.muted);
  document.body.style.background = palette.shell.background;
  document.body.style.color = palette.shell.text;
}

// 字体同步：配色由本地 nvim 高亮生成后，字体也要跟本地终端一致。
export function applyEditorFont(font) {
  const root = document.documentElement.style;
  const family = typeof font?.family === 'string' ? font.family.replace(/["']/g, ' ').trim() : '';
  const size = Number(font?.sizePx);
  if (!family) {
    root.removeProperty('--cr-editor-font');
    root.removeProperty('--cr-editor-font-size');
    root.removeProperty('--cr-editor-line-height');
    return;
  }
  root.setProperty('--cr-editor-font', `"${family}", "SFMono-Regular", Consolas, "Liberation Mono", monospace`);
  if (Number.isFinite(size) && size >= 9 && size <= 28) {
    root.setProperty('--cr-editor-font-size', `${Math.round(size)}px`);
    root.setProperty('--cr-editor-line-height', `${Math.round(size * 1.6)}px`);
  } else {
    root.removeProperty('--cr-editor-font-size');
    root.removeProperty('--cr-editor-line-height');
  }
}

export function populateThemes() {
  elements.themeSelect.replaceChildren();
  if (state.editorProfile?.available) {
    const option = document.createElement('option');
    option.value = 'local';
    option.textContent = `本地 · ${state.editorProfile.colorscheme || 'vim/neovim'}`;
    elements.themeSelect.append(option);
  }
  for (const theme of THEMES) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    elements.themeSelect.append(option);
  }
  elements.themeSelect.value = state.theme;
  if (!elements.themeSelect.value) {
    state.theme = 'one-dark';
    elements.themeSelect.value = state.theme;
  }
}