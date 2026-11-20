// 交互策略层：什么情况下快捷键/键盘导航应该让路。功能模块共用同一判断。
import { elements } from './dom.js';
import { state } from './state.js';

// 表单控件里的按键是正常输入，快捷键不应接管。
export function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.matches('input, textarea, select') || target.isContentEditable);
}

// 顶层弹层在场时，后台快捷键（如 Ctrl+Alt+B）不应抢焦点。
export function topLayerOpen() {
  return Boolean(document.querySelector('dialog[open]'))
    || !elements.commitOverlay.hidden
    || !elements.animationOverlay.hidden
    || state.animationOpen;
}

// 全局组合键统一走这里：忽略输入法组合、重复按键和顶层弹层。
export function shortcutAllowed(event) {
  return !event.isComposing && !event.repeat && !topLayerOpen();
}