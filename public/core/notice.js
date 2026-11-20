// 共享提示条：所有功能模块通过它显示成功/错误信息。
import { elements } from './dom.js';
import { state } from './state.js';

export function showNotice(text, { label = '', action = null, error = false } = {}) {
  elements.repoNotice.hidden = false;
  elements.repoNotice.classList.toggle('error', error);
  elements.repoNoticeText.textContent = text;
  state.noticeAction = action;
  elements.repoNoticeAction.hidden = !(label && action);
  if (label && action) elements.repoNoticeAction.textContent = label;
}

export function hideNotice() {
  elements.repoNotice.hidden = true;
  state.noticeAction = null;
}