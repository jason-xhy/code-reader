// 能力：全局快捷键与键盘导航装配。
// 这里只做"按键 → 能力"的路由；具体动作全部落在 navigation/workspace/search 等模块。
import { createKeyboardNav } from '../keyboard-nav.js';
import { createVimNav } from '../vim-nav.js';
import { elements } from '../core/dom.js';
import { state, editor } from '../core/state.js';
import { isEditableTarget, topLayerOpen } from '../core/policies.js';
import { matchAction, matchesAction } from '../core/keymap.js';
import { activateWorkspaceByIndex, activateWorkspaceByOffset } from './workspace.js';
import {
  cancelTreeFocusRequest,
  closeInsightsPanel,
  gotoDefinition,
  gotoReferences,
  openReadingTrailPicker,
  toggleCodeTreePanel,
  toggleInsightsPanel,
} from './navigation.js';
import { setEditorMode } from './editor-mode.js';
import { closeAnimation, closeCommitOverlay, closeQuestion, openQuestion } from './insights.js';
import { openWorkspaceSearch } from './search.js';
import { openSettingsMenu } from './settings-menu.js';

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

  // 编辑器 ⇄ nvim 页签切换、工作区切仓、两侧栏入口、工作区搜索、阅读路径列表。
  // 键位全部来自 core/keymap.js：用户可在「快捷键」设置里改绑（fcitx 默认占用
  // Ctrl+Alt+P、UKUI 占用 Ctrl+Alt+L 这类桌面差异，页面收不到按键，只能改键位）。
  // 所有 Ctrl+Alt+X 同时接受 Ctrl+Alt+Shift+X 备用形态（macOS 另接受 ⌘+Option+X）。
  // 捕获阶段消费事件：否则 CodeMirror / xterm 会先把组合键当成输入。
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    // 顶层弹层（模态对话框/提交详情/动画）在场时全局组合键让路，与
    // search.js openWorkspaceSearch 同一语义：不在弹层背后开侧栏/切模式/
    // 切仓（焦点被 showModal 圈住，但面板状态会被背后改变）。Esc 关闭
    // 弹层的处理在冒泡层，不受此门禁影响。
    if (topLayerOpen()) return;
    const action = matchAction(event);
    if (!action) return;
    let handled = true;
    switch (action) {
      case 'workspace.prev':
        activateWorkspaceByOffset(-1);
        break;
      case 'workspace.next':
        activateWorkspaceByOffset(1);
        break;
      case 'panel.tree':
        toggleCodeTreePanel();
        break;
      case 'panel.insights':
        toggleInsightsPanel();
        break;
      case 'nav.hint':
        keyboardNav.toggle('hint');
        break;
      case 'nav.sneak':
        keyboardNav.toggle('sneak');
        break;
      case 'trail.open':
        openReadingTrailPicker();
        break;
      case 'search.workspace':
        openWorkspaceSearch();
        break;
      case 'settings.open':
        openSettingsMenu();
        break;
      case 'editor.mode':
        setEditorMode('editor');
        break;
      case 'nvim.mode':
        setEditorMode('nvim');
        break;
      default: {
        const slot = action.startsWith('workspace.slot')
          ? Number(action.slice('workspace.slot'.length))
          : 0;
        if (slot >= 1 && slot <= 9) activateWorkspaceByIndex(slot - 1);
        // goto.definition / goto.references 在下面的冒泡阶段处理，与旧行为一致。
        else handled = false;
      }
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
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
    if (matchesAction(event, 'goto.definition')) {
      event.preventDefault();
      gotoDefinition();
      return;
    }
    if (matchesAction(event, 'goto.references')) {
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