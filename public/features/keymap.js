// 能力：快捷键设置对话框（查看/改绑全局快捷键）。
// 存在的理由：输入法与桌面环境会抢走 Ctrl+Alt+X（fcitx 默认 Ctrl+Alt+P、
// UKUI 锁屏 Ctrl+Alt+L），页面根本收不到按键，无法在运行时探测，只能让用户改绑。
import { elements } from '../core/dom.js';
import { noteFocusIntent } from '../core/state.js';
import { renderWorkspaceTabs } from './workspace.js';
import {
  KEYMAP_ACTIONS,
  bindingDisplay,
  bindingFromEvent,
  bindingVariants,
  getBinding,
  isCustomized,
  resetBindings,
  setBinding,
  validateBinding,
} from '../core/keymap.js';

let capturing = null;
let captureHandler = null;
let progressTimer = null;

export function initKeymapFeature() {
  elements.keymapSettings?.addEventListener('click', openKeymapDialog);
  elements.keymapClose?.addEventListener('click', () => elements.keymapDialog.close());
  elements.keymapDone?.addEventListener('click', () => elements.keymapDialog.close());
  elements.keymapDialog?.addEventListener('click', (event) => {
    if (event.target === elements.keymapDialog) elements.keymapDialog.close();
  });
  elements.keymapDialog?.addEventListener('close', () => {
    stopCapture();
    renderKeymapList();
  });
  elements.keymapReset?.addEventListener('click', () => {
    resetBindings();
    elements.keymapError.textContent = '';
    flashProgress('已恢复默认');
    renderKeymapList();
    renderShortcutHints();
  });
  renderShortcutHints();
}

// 状态栏/箭头提示里的组合键必须跟着改绑走，否则用户改完键位界面还在教旧键。
export function renderShortcutHints() {
  const compact = (id) => bindingDisplay(id);
  const spaced = (id) => bindingDisplay(id, { spaced: true });
  const tree = compact('panel.tree');
  const insights = compact('panel.insights');
  const hint = compact('nav.hint');
  const sneak = compact('nav.sneak');
  const search = compact('search.workspace');
  const trail = compact('trail.open');

  if (elements.panelShortcuts) {
    elements.panelShortcuts.textContent = `${tree} 代码树 · ${insights} 分析 · ${hint} 跳转 · ${sneak} 两字符 · ${search} 搜索 · ${trail} 阅读路径`;
  }
  const extra = document.querySelector('.code-nav-extra');
  if (extra) extra.textContent = `${hint} 全键盘跳转 · ${sneak} 两字符定位 · ${search} 工作区搜索 · ${trail} 阅读路径`;
  const navTreeKey = elements.navTree?.querySelector('kbd');
  if (navTreeKey) navTreeKey.textContent = spaced('panel.tree');
  const navInsightsKey = elements.navInsights?.querySelector('kbd');
  if (navInsightsKey) navInsightsKey.textContent = spaced('panel.insights');
  if (elements.navTree) {
    elements.navTree.title = `${spaced('panel.tree')} 去代码树/收起（焦点已在树内时再按收起；被输入法占用时用 Ctrl+Alt+Shift 变体或左下角「快捷键」改绑）`;
  }
  if (elements.navInsights) {
    elements.navInsights.title = `${spaced('panel.insights')} 去代码解释窗口/收起（焦点已在窗口内时再按收起；被输入法占用时用 Ctrl+Alt+Shift 变体或左下角「快捷键」改绑）`;
  }
  const tabEditorKey = elements.tabEditor?.querySelector('.editor-tab-key');
  if (tabEditorKey) tabEditorKey.textContent = compact('editor.mode');
  const tabNvimKey = elements.tabNvim?.querySelector('.editor-tab-key');
  if (tabNvimKey) tabNvimKey.textContent = compact('nvim.mode');
  const cycleKeys = document.querySelector('.workspace-cycle-hint')?.querySelectorAll('kbd');
  if (cycleKeys && cycleKeys.length >= 2) {
    cycleKeys[0].textContent = compact('workspace.prev');
    cycleKeys[1].textContent = compact('workspace.next');
  }
  // 工作区页签上方的直达键也在页签渲染时从 keymap 读；改绑后重建一次页签。
  if ((elements.workspaceTabs?.children.length || 0) > 0) renderWorkspaceTabs();
}

export function openKeymapDialog() {
  if (!elements.keymapDialog) return;
  elements.keymapError.textContent = '';
  elements.keymapProgress.textContent = '';
  stopCapture();
  renderKeymapList();
  noteFocusIntent();
  elements.keymapDialog.showModal();
}

function flashProgress(text) {
  elements.keymapProgress.textContent = text;
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => { elements.keymapProgress.textContent = ''; }, 1600);
}

function renderKeymapList() {
  if (!elements.keymapList) return;
  elements.keymapList.replaceChildren();
  for (const action of KEYMAP_ACTIONS) {
    const row = document.createElement('div');
    row.className = 'keymap-row';
    row.dataset.action = action.id;
    if (isCustomized(action.id)) row.classList.add('customized');
    const label = document.createElement('span');
    label.className = 'keymap-label';
    label.textContent = action.label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keymap-binding';
    if (capturing?.action.id === action.id) {
      button.classList.add('capturing');
      button.textContent = '按下新组合键…（Esc 取消）';
    } else {
      button.textContent = getBinding(action.id);
    }
    button.title = '点击后按下新的组合键';
    button.addEventListener('click', () => startCapture(action, button));
    const variants = document.createElement('span');
    variants.className = 'keymap-variants';
    const extra = bindingVariants(action.id).slice(1);
    const legacy = action.legacy?.length ? `兼容 ${action.legacy.join(' / ')}` : '';
    variants.textContent = [...extra, legacy].filter(Boolean).join(' · ')
      || (action.digit ? 'Shift 必需（区别于 Ctrl+Alt+数字）' : '');
    row.append(label, button, variants);
    elements.keymapList.append(row);
  }
}

function startCapture(action, button) {
  stopCapture();
  capturing = { action, button };
  button.classList.add('capturing');
  button.textContent = '按下新组合键…（Esc 取消）';
  elements.keymapError.textContent = '';
  // window 的捕获阶段先于 document 上的全局快捷键路由，保证改绑时不会误触面板。
  captureHandler = (event) => {
    if (!capturing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      stopCapture();
      renderKeymapList();
      return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    const spec = bindingFromEvent(event);
    if (!spec) {
      elements.keymapError.textContent = '无法识别该组合键，请按字母/数字/符号键';
      return;
    }
    const check = validateBinding(spec);
    if (!check.ok) {
      elements.keymapError.textContent = check.error;
      return;
    }
    const result = setBinding(capturing.action.id, spec);
    if (!result.ok) {
      elements.keymapError.textContent = result.error;
      return;
    }
    const actionId = capturing.action.id;
    stopCapture();
    renderKeymapList();
    renderShortcutHints();
    // 列表重建会丢焦点：回到刚改绑的那一行，方便继续用键盘调整。
    elements.keymapList.querySelector(`.keymap-row[data-action="${actionId}"] .keymap-binding`)
      ?.focus({ preventScroll: true });
    flashProgress('已保存，立即生效');
  };
  window.addEventListener('keydown', captureHandler, true);
}

function stopCapture() {
  if (captureHandler) window.removeEventListener('keydown', captureHandler, true);
  captureHandler = null;
  capturing = null;
  for (const button of document.querySelectorAll('.keymap-binding.capturing')) {
    button.classList.remove('capturing');
  }
}