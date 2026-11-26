// 交互策略层：什么情况下快捷键/键盘导航应该让路。功能模块共用同一判断。
import { elements } from './dom.js';
import { state } from './state.js';

// 表单控件里的按键是正常输入，快捷键不应接管。
export function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.matches('input, textarea, select') || target.isContentEditable);
}

// 顶层弹层在场时，后台快捷键（如 Ctrl+Alt+B）不应抢焦点。
// 消费方（shortcuts.js 捕获层、search.js openWorkspaceSearch）各自结合
// defaultPrevented/isComposing/repeat 判断，不再提供聚合函数。
export function topLayerOpen() {
  return Boolean(document.querySelector('dialog[open]'))
    || !elements.commitOverlay.hidden
    || !elements.animationOverlay.hidden
    || state.animationOpen;
}