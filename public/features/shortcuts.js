// 能力：全局快捷键与键盘导航装配。
// 这里只做"按键 → 能力"的路由；具体动作全部落在 navigation/workspace/search 等模块。
import { createKeyboardNav } from '../keyboard-nav.js';
import { createVimNav } from '../vim-nav.js';
import { elements } from '../core/dom.js';
import { state, editor } from '../core/state.js';
import { isEditableTarget } from '../core/policies.js';
import { activateWorkspaceByIndex, activateWorkspaceByOffset } from './workspace.js';
import {
  cancelTreeFocusRequest,
  closeInsightsPanel,
  gotoDefinition,
  gotoReferences,
  toggleCodeTreePanel,
  toggleInsightsPanel,
} from './navigation.js';
import { setEditorMode } from './editor-mode.js';
import { closeAnimation, closeCommitOverlay, closeQuestion, openQuestion } from './insights.js';
import { openWorkspaceSearch } from './search.js';

export function initShortcuts() {
  // 全键盘导航层：easymotion 风格标签跳转（含代码行）+ sneak 风格两字符定位。
  // Ctrl+Alt+L 被 UKUI 锁屏（screensaver:<Ctrl><Alt>l）在 X 层抓走，网页收不到，
  // 两字符定位改用 Ctrl+Alt+F（F=find）。
  const keyboardNav = createKeyboardNav({
    getEditor: () => editor,
    toggleSidebar: toggleCodeTreePanel,
    toggleInsights: toggleInsightsPanel,
    cancelTreeFocus: cancelTreeFocusRequest,
  });

  // 任意窗口的 Vim 键导航（解释栏/提交详情/对话框/菜单）：j/k 移动或滚动，gg/G 首尾。
  // 放在冒泡阶段，让文件树、目录浏览器、CodeMirror 等既有按键处理先执行。
  const vimNav = createVimNav();
  document.addEventListener('keydown', (event) => {
    vimNav.handleKeydown(event);
  });

  // 捕获阶段先处理导航层与引用列表按键：否则 CodeMirror/Vim 会先消费 Enter
  // （把当前行换行），弹窗的“Enter 跳转”永远见不到事件。
  document.addEventListener('keydown', (event) => {
    if (keyboardNav.handleKeydown(event)) return;
    editor?.quickpickKeydown(event);
  }, true);

  // 编辑器 ⇄ nvim 页签切换：Ctrl+Alt+1 / Ctrl+Alt+2（主键位）。
  // 旧键 Ctrl+Alt+E / Ctrl+Alt+N 保留兼容，但 Ctrl+Alt+E 常被桌面环境注册成全局
  // 快捷键（如 UKUI 的 peony-qt2 = 文件管理器），在 X 层就被抓走、网页收不到。
  // 工作区切仓：Ctrl+Alt+[ / ] 前后切换，Ctrl+Alt+Shift+1..9 直达第 N 个页签。
  // 两侧栏入口：Ctrl+Alt+B（代码树）/ Ctrl+Alt+I（分析与解释）——「去这个窗口」。
  // 工作区搜索：Ctrl+Alt+P（P=project search），复用 gr 引用窗口。
  // 捕获阶段消费事件：否则 CodeMirror / xterm 会先把组合键当成输入。
  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || !event.altKey || event.metaKey || event.repeat || event.isComposing) return;
    if (event.shiftKey) {
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit) {
        event.preventDefault();
        event.stopPropagation();
        activateWorkspaceByIndex(Number(digit[1]) - 1);
        return;
      }
      // Shift+B/I/K/F 作为备用键：Ctrl+Alt+B/I 被输入法/桌面占用时仍可使用。
    }
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      event.preventDefault();
      event.stopPropagation();
      activateWorkspaceByOffset(event.code === 'BracketLeft' ? -1 : 1);
      return;
    }
    if (event.code === 'KeyB') {
      event.preventDefault();
      event.stopPropagation();
      toggleCodeTreePanel();
      return;
    }
    if (event.code === 'KeyI') {
      event.preventDefault();
      event.stopPropagation();
      toggleInsightsPanel();
      return;
    }
    if (event.code === 'KeyK' || event.code === 'KeyF') {
      event.preventDefault();
      event.stopPropagation();
      keyboardNav.toggle(event.code === 'KeyK' ? 'hint' : 'sneak');
      return;
    }
    if (event.code === 'KeyP') {
      event.preventDefault();
      event.stopPropagation();
      openWorkspaceSearch();
      return;
    }
    const mode = event.code === 'Digit1' || event.code === 'KeyE' ? 'editor'
      : event.code === 'Digit2' || event.code === 'KeyN' ? 'nvim'
        : null;
    if (!mode) return;
    event.preventDefault();
    event.stopPropagation();
    setEditorMode(mode);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.animationOpen) {
      event.preventDefault();
      closeAnimation();
      return;
    }
    if (event.key === 'Escape' && !elements.commitOverlay.hidden) {
      event.preventDefault();
      closeCommitOverlay();
      return;
    }
    if (event.key === 'Escape' && state.questionOpen) {
      event.preventDefault();
      closeQuestion();
      editor?.focus();
      return;
    }
    // 解释栏：焦点在内部控件上时，Esc 先退回所在内容容器；已在容器上时
  // 直接收起窗口（不再需要先跳到解释区再按第二次）。搜索条打开时先清搜索。
    if (event.key === 'Escape') {
      const active = document.activeElement;
      const insights = elements.insights;
      if (insights && active instanceof Element && insights.contains(active)) {
        event.preventDefault();
        if (document.querySelector('.vim-search')) {
          vimNav.closeSearch();
          return;
        }
        const content = active.closest('.insight-content');
        if (content && content !== active) {
          content.focus({ preventScroll: true });
          return;
        }
        if (content) {
          closeInsightsPanel();
          return;
        }
        elements.explanationContent.focus({ preventScroll: true });
        return;
      }
    }
    const editing = isEditableTarget(event.target);
    const dialogOpen = Boolean(document.querySelector('dialog[open]'));
    if (event.altKey && event.key === '.') {
      event.preventDefault();
      gotoDefinition();
      return;
    }
    if (event.altKey && event.key === 'r') {
      event.preventDefault();
      gotoReferences();
      return;
    }
    if (event.key.toLowerCase() === 'c' && !editing && !dialogOpen && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      openQuestion();
    }
  });

  elements.vimHelpClose.addEventListener('click', () => elements.vimHelpDialog.close());
  // :help 从 Vim ex 命令行打开，原生关闭时要恢复的输入框已被移除，焦点会落到
  // body；帮助窗口的入口就是编辑器，关闭后统一把焦点送回编辑器。
  elements.vimHelpDialog.addEventListener('close', () => {
    editor?.focus();
    // 原生 dialog 在 close 之后还会做一次焦点恢复，可能把焦点又放回已关闭的
    // 对话框按钮；下一个宏任务再补一次，确保焦点落在编辑器。
    setTimeout(() => editor?.focus(), 0);
  });
  elements.vimHelpDialog.addEventListener('click', (event) => {
    if (event.target === elements.vimHelpDialog) elements.vimHelpDialog.close();
  });

  return { keyboardNav, vimNav };
}