// 能力：顶栏「设置」菜单。
// 存在的理由：两侧栏默认收起为悬停覆盖层，侧栏底部那排设置入口
// （LLM 设置/编辑器环境/快捷键/知识库）默认不可见，只能在常驻顶栏提供入口。
// 交互与历史菜单一致：点击开合、↑/↓/Home/End 移动、Esc 返回按钮。
import { elements } from '../core/dom.js';
import { noteFocusIntent } from '../core/state.js';
import { focusFirstMenuItem, menuButtons } from '../core/utils.js';
import { openKeymapDialog } from './keymap.js';
import { openDocsDialog } from './dialogs.js';
import { openEditorEnvDialog } from './editor-mode.js';

// llmSettings 实例在 app.js 里动态 import 后才创建，这里用注册式解耦。
let openLlmSettings = null;

export function initSettingsMenu() {
  elements.settingsMenuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = elements.settingsMenu.hidden;
    elements.settingsMenu.hidden = !willOpen;
    elements.settingsMenuButton.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      noteFocusIntent();
      focusFirstMenuItem(elements.settingsMenu);
    } else {
      elements.settingsMenuButton.focus();
    }
  });
  elements.settingsMenuButton.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    elements.settingsMenuButton.click();
  });
  elements.settingsMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSettingsMenu();
      elements.settingsMenuButton.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = menuButtons(elements.settingsMenu);
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else next = (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  elements.settingsMenu.addEventListener('click', (event) => {
    const item = event.target.closest('.settings-item');
    if (!item) return;
    event.stopPropagation();
    closeSettingsMenu();
    openSetting(item.dataset.setting);
  });
  document.addEventListener('click', (event) => {
    if (!elements.settingsMenu.hidden
      && !elements.settingsMenu.contains(event.target)
      && event.target !== elements.settingsMenuButton) {
      closeSettingsMenu();
    }
  });
}

export function openSettingsMenu() {
  if (!elements.settingsMenu.hidden) return;
  elements.settingsMenuButton.click();
}

function closeSettingsMenu() {
  elements.settingsMenu.hidden = true;
  elements.settingsMenuButton.setAttribute('aria-expanded', 'false');
}

function openSetting(setting) {
  switch (setting) {
    case 'llm':
      openLlmSettings?.();
      break;
    case 'editor-env':
      openEditorEnvDialog();
      break;
    case 'keymap':
      openKeymapDialog();
      break;
    case 'docs':
      openDocsDialog();
      break;
    default:
      break;
  }
}

// app.js 在 llmSettings 创建完成后注册入口；菜单内状态行同步当前配置。
export function registerLlmSettingsOpener(open) {
  openLlmSettings = open;
}

export function updateSettingsLlmStatus(text) {
  elements.settingsLlmStatus.textContent = text;
}
