// 能力：分析与解释面板（函数历史、FAQ、提交详情、提问、解释与 3D 动画）。
import { createAnimationHtml } from '../animation-html.js';
import { elements } from '../core/dom.js';
import { state, editor, noteFocusIntent } from '../core/state.js';
import { api } from '../core/api.js';
import { showNotice } from '../core/notice.js';
import { ANIMATION_HINT_RE, QUESTION_PRESETS } from '../core/config.js';
import { relativeTime } from '../core/utils.js';

let deps = {};

export function initInsightsFeature(dependencies) {
  deps = dependencies;
  renderQuestionPresets();
  elements.questionCancel.addEventListener('click', closeQuestion);
  elements.questionSubmit.addEventListener('click', submitQuestion);
  elements.questionInput.addEventListener('input', () => {
    if (ANIMATION_HINT_RE.test(elements.questionInput.value)) elements.questionAnimation.checked = true;
  });
  elements.questionInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey) return;
    event.preventDefault();
    submitQuestion();
  });
  // 解释窗口：点击窗口内任意非交互区域（标题栏、分组标题、空白）都把焦点
// 交给对应内容容器，保证随后的 j/k 一定落在窗口里；点击链接/按钮则不抢。
  // Esc：焦点在内部控件上时先退回容器，已在容器上时收起窗口并回代码窗。
  // q：与 Vim 的关窗口语义一致，直接收起。
  elements.insights?.addEventListener('click', (event) => {
    if (event.target.closest('a, button, summary, input, select, textarea, [data-nav], [contenteditable="true"]')) return;
    const section = event.target.closest('.insight-section');
    const target = section?.querySelector('.insight-content') || elements.explanationContent;
    target.focus({ preventScroll: true });
  });
  const closeInsights = () => {
    window.__crPanels?.hide('insights');
    editor?.focus();
  };
  elements.insights?.addEventListener('keydown', (event) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'q') {
      event.preventDefault();
      event.stopPropagation();
      closeInsights();
    }
  });
  elements.explanationContent.addEventListener('keydown', (event) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (document.activeElement !== elements.explanationContent) {
      elements.explanationContent.focus({ preventScroll: true });
      return;
    }
    closeInsights();
  });
  elements.insightsToggle?.addEventListener('click', closeInsights);
  elements.commitOverlayClose.addEventListener('click', closeCommitOverlay);
  elements.commitOverlay.addEventListener('click', (event) => {
    if (event.target === elements.commitOverlay) closeCommitOverlay();
  });
  elements.commitOverlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    // summary 是原生可聚焦元素（Enter/Space 展开 Diff）；漏掉它会把 Tab 困在
    // 关闭按钮上，键盘用户无法打开 diff。
    const focusable = [...elements.commitOverlay.querySelectorAll('button, a[href], summary, input, select, textarea, [tabindex="0"], [data-nav]')]
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  elements.animationClose.addEventListener('click', closeAnimation);
  elements.animationOverlay.addEventListener('click', (event) => {
    if (event.target === elements.animationOverlay) closeAnimation();
  });
  // 动画弹层不是原生 dialog：Tab 在弹层内循环，避免焦点跑到背后的编辑器。
  window.addEventListener('message', (event) => {
    if (event.source !== elements.animationFrame?.contentWindow) return;
    if (event.data?.type === 'code-reader-animation-close') closeAnimation();
  });
  elements.animationOverlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...elements.animationOverlay.querySelectorAll('a[href], button, iframe, [tabindex="0"]')]
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

// ---- 提交详情 ----

let commitOverlayReturnFocus = null;
let commitOverlayReturnHash = null;

// 提交详情打开/关闭都会重渲染函数历史列表：原按钮节点可能已被替换，
// 回收焦点时按提交哈希找到同一行（找不到再退回 body）。
function restoreCommitFocus() {
  const target = commitOverlayReturnFocus;
  const hash = commitOverlayReturnHash;
  commitOverlayReturnFocus = null;
  commitOverlayReturnHash = null;
  // 打开时下方分析栏可能被收起（inert）导致焦点先落到 body；body 不能作为
  // 恢复目标，必须走哈希回退找回同一提交行。
  if (target?.isConnected && target !== document.body) {
    window.__crPanels?.show('insights');
    target.focus({ preventScroll: true });
    return;
  }
  if (!hash) return;
  // 打开提交详情时分析栏被收起并设为 inert；恢复焦点前先展开，否则 inert
  // 会阻止程序化聚焦（focus 静默失败）。
  window.__crPanels?.show('insights');
  const header = [...elements.historyContent.querySelectorAll('.commit-header')]
    .find((node) => node.querySelector('.commit-hash')?.textContent === hash);
  header?.focus({ preventScroll: true });
}

export function closeCommitOverlay() {
  state.commitDetail = null;
  elements.commitOverlay.hidden = true;
  elements.commitOverlayBody.replaceChildren();
  restoreCommitFocus();
}

function renderCommitOverlay() {
  const detail = state.commitDetail;
  if (!detail) {
    const wasOpen = !elements.commitOverlay.hidden;
    elements.commitOverlay.hidden = true;
    elements.commitOverlayBody.replaceChildren();
    if (wasOpen) restoreCommitFocus();
    return;
  }
  const opening = elements.commitOverlay.hidden;
  elements.commitOverlay.hidden = false;
  const commit = (state.history?.commits || []).find((entry) => entry.hash === detail.hash);
  elements.commitOverlayTitle.textContent = detail.status === 'done'
    ? `${detail.data.short || detail.hash} · ${detail.data.message.split('\n')[0]}`
    : (commit ? `${commit.hash} · ${commit.subject}` : `提交 ${detail.hash}`);
  elements.commitOverlayBody.replaceChildren(renderCommitDetail(detail));
  if (opening) {
    commitOverlayReturnFocus = document.activeElement;
    commitOverlayReturnHash = detail.hash;
    // 覆盖层不是原生 dialog：打开时主动聚焦关闭按钮，Tab 在面板内循环。
    setTimeout(() => elements.commitOverlayClose.focus({ preventScroll: true }), 0);
  }
}

async function showCommit(hash) {
  if (!state.repository) return;
  // 工作区未提交修改是合成条目，没有可读取的提交对象。
  if (hash === '0000000') {
    showNotice('未提交的工作区修改没有提交详情');
    return;
  }
  window.__crPanels?.hide('insights');
  if (state.commitCache.has(hash)) {
    state.commitDetail = { hash, status: 'done', data: state.commitCache.get(hash) };
    renderCommitOverlay();
    renderHistory();
    return;
  }
  state.commitDetail = { hash, status: 'loading' };
  renderCommitOverlay();
  renderHistory();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/commit?hash=${encodeURIComponent(hash)}`);
    state.commitCache.set(hash, data);
    if (state.commitDetail?.hash === hash) {
      state.commitDetail = { hash, status: 'done', data };
      renderCommitOverlay();
      renderHistory();
    }
  } catch (error) {
    if (state.commitDetail?.hash === hash) {
      state.commitDetail = { hash, status: 'error', message: error.message };
      renderCommitOverlay();
      renderHistory();
    }
  }
}

function renderDiff(diff) {
  const pre = document.createElement('pre');
  pre.className = 'commit-diff';
  const lines = String(diff || '').split('\n');
  const limit = Math.min(lines.length, 3000);
  for (let index = 0; index < limit; index += 1) {
    const line = lines[index];
    const span = document.createElement('span');
    span.textContent = `${line}\n`;
    if (line.startsWith('@@')) span.className = 'diff-hunk';
    else if (line.startsWith('+') && !line.startsWith('+++')) span.className = 'diff-add';
    else if (line.startsWith('-') && !line.startsWith('---')) span.className = 'diff-del';
    pre.append(span);
  }
  if (lines.length > limit) {
    const note = document.createElement('div');
    note.className = 'field-help';
    note.textContent = `diff 过长，仅显示前 ${limit} 行（共 ${lines.length} 行）`;
    pre.append(note);
  }
  return pre;
}

function renderCommitDetail(detail) {
  const box = document.createElement('div');
  box.className = 'commit-detail';
  if (detail.status === 'loading') {
    box.textContent = '正在读取提交详情…';
    return box;
  }
  if (detail.status === 'error') {
    const error = document.createElement('div');
    error.className = 'error-card';
    error.textContent = detail.message;
    box.append(error);
    return box;
  }
  const data = detail.data;
  const identity = document.createElement('div');
  identity.className = 'faq-meta';
  identity.textContent = `提交 ${data.short || data.hash}（${data.hash}）`;
  const meta = document.createElement('div');
  meta.className = 'faq-meta';
  meta.textContent = `${data.author} <${data.email}> · ${new Date(data.date).toLocaleString()}`;
  const message = document.createElement('pre');
  message.className = 'commit-message';
  message.textContent = data.message;
  const files = document.createElement('ul');
  files.className = 'commit-files';
  for (const file of data.files.slice(0, 100)) {
    const item = document.createElement('li');
    item.textContent = `${file.path}  +${file.added} -${file.deleted}`;
    files.append(item);
  }
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = `Diff（${data.files.length} 个文件${data.truncated ? '，已截断' : ''}）`;
  details.append(summary, renderDiff(data.diff));
  box.append(identity, meta, message, files, details);
  return box;
}

// ---- FAQ ----

export async function fetchFaq(line) {
  if (!state.repository || !state.currentFile) {
    state.faqEntries = [];
    renderFaq();
    return;
  }
  const filePath = state.currentFile;
  state.faqController?.abort();
  const controller = new AbortController();
  state.faqController = controller;
  try {
    const data = await api(
      `/api/repositories/${encodeURIComponent(state.repository.id)}/faq?path=${encodeURIComponent(filePath)}&line=${line}`,
      { signal: controller.signal },
    );
    if (state.currentFile !== filePath || controller.signal.aborted) return;
    state.faqEntries = data.entries || [];
    state.faqKey = `${filePath}:${line}`;
  } catch (error) {
    if (error.name === 'AbortError' || state.currentFile !== filePath) return;
    state.faqEntries = [];
  }
  renderFaq();
}

export function renderFaq() {
  const entries = state.faqEntries || [];
  if (!entries.length || !state.currentFile) {
    elements.faqSection.hidden = true;
    elements.faqContent.replaceChildren();
    elements.faqAnchor.textContent = '';
    return;
  }
  const first = entries[0];
  elements.faqSection.hidden = false;
  elements.faqAnchor.textContent = `${first.file}:${first.lineStart}-${first.lineEnd}${first.symbol ? ` · ${first.symbol}` : ''}`;
  elements.faqContent.replaceChildren();
  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'faq-card';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'faq-question faq-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    const questionText = document.createElement('span');
    questionText.className = 'faq-question-text';
    questionText.textContent = entry.question;
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'faq-toggle-icon';
    toggleIcon.textContent = '▸';
    toggle.append(questionText, toggleIcon);
    const body = document.createElement('div');
    body.className = 'faq-body';
    body.hidden = true;
    const overview = document.createElement('p');
    overview.textContent = entry.overview;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '展开逐点分析与总结';
    const list = document.createElement('ol');
    list.className = 'detail-list';
    for (const detail of entry.details || []) {
      const item = document.createElement('li');
      item.textContent = detail;
      list.append(item);
    }
    const summaryText = document.createElement('p');
    summaryText.textContent = entry.summary;
    details.append(summary, list, summaryText);
    const meta = document.createElement('div');
    meta.className = 'faq-meta';
    const symbol = document.createElement('span');
    symbol.textContent = `${entry.kind || 'range'} · ${entry.symbol || '未命名段'}`;
    const head = document.createElement('span');
    head.textContent = `HEAD ${entry.head || '—'}`;
    const time = document.createElement('span');
    time.textContent = relativeTime(entry.updatedAt);
    meta.append(symbol, head, time);
    if (entry.stale) {
      const badge = document.createElement('span');
      badge.className = 'faq-stale';
      badge.textContent = `已过期${entry.staleReason ? `：${entry.staleReason}` : ''}`;
      meta.append(badge);
    }
    const actions = document.createElement('div');
    actions.className = 'faq-actions';
    if (entry.stale) {
      const reask = document.createElement('button');
      reask.type = 'button';
      reask.className = 'faq-reask';
      reask.textContent = '按当前代码重问';
      reask.addEventListener('click', () => {
        openQuestion();
        elements.questionInput.value = entry.question;
        elements.questionInput.focus();
      });
      actions.append(reask);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'faq-delete';
    remove.textContent = '删除此 FAQ';
    remove.addEventListener('click', async () => {
      try {
        await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/faq/delete`, {
          method: 'POST',
          body: JSON.stringify({ id: entry.id }),
        });
        fetchFaq(state.activeLine || entry.line);
      } catch (error) {
        showNotice(`删除 FAQ 失败：${error.message}`, { error: true });
      }
    });
    actions.append(remove);
    toggle.addEventListener('click', () => {
      const expanded = body.hidden;
      body.hidden = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggleIcon.textContent = expanded ? '▾' : '▸';
    });
    body.append(overview, details);
    body.append(meta, actions);
    card.append(toggle, body);
    elements.faqContent.append(card);
  }
}

// ---- 函数历史 ----

// 光标移动时只有跨出当前函数范围才重新查询；函数内部移动保持现有面板内容。
export function historyCoversLine(history, filePath, line) {
  return Boolean(history)
    && history.status === 'done'
    && history.path === filePath
    && Number.isInteger(history.lineStart)
    && Number.isInteger(history.lineEnd)
    && line >= history.lineStart
    && line <= history.lineEnd
    && (!history.head || !state.repository?.head || history.head === state.repository.head);
}

// 缓存按服务端返回的函数区间命中：同一函数内不同行共用一条历史。
export function cachedFunctionHistory(filePath, line) {
  if (!state.repository) return null;
  const prefix = `${state.repository.head}:`;
  const key = `${prefix}${filePath}:${line}`;
  if (state.historyCache.has(key)) return state.historyCache.get(key);
  for (const [cacheKey, value] of state.historyCache) {
    if (!cacheKey.startsWith(prefix)) continue;
    if (value.path === filePath && line >= value.lineStart && line <= value.lineEnd) return value;
  }
  return null;
}

export async function fetchFunctionHistory(line) {
  if (!state.repository || state.currentFile === null || state.activeLine !== line) return;
  const filePath = state.currentFile;
  if (historyCoversLine(state.history, filePath, line)) return;
  const cached = cachedFunctionHistory(filePath, line);
  if (cached) {
    state.history = { path: filePath, line, status: 'done', ...cached };
    renderHistory();
    return;
  }
  state.historyController?.abort();
  const key = `${state.repository.head}:${filePath}:${line}`;
  const controller = new AbortController();
  state.historyController = controller;
  state.history = { path: filePath, line, status: 'loading', commits: [] };
  renderHistory();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/function-history?path=${encodeURIComponent(filePath)}&line=${line}`, { signal: controller.signal });
    if (state.activeLine !== line || state.currentFile !== filePath) return;
    state.historyCache.set(key, data);
    state.history = { path: filePath, line, status: 'done', ...data };
    renderHistory();
  } catch (error) {
    if (error.name === 'AbortError' || state.activeLine !== line || state.currentFile !== filePath) return;
    state.history = { path: filePath, line, status: 'error', message: error.message, commits: [] };
    renderHistory();
  }
}

export function renderHistory() {
  const history = state.history;
  elements.historyContent.replaceChildren();
  if (!history) {
    elements.historyAnchor.textContent = '当前函数';
    elements.historyContent.className = 'insight-content empty-insight';
    elements.historyContent.textContent = '移动光标查看当前函数的最近提交';
    return;
  }
  elements.historyContent.className = 'insight-content';
  const range = history.lineStart && history.lineEnd ? `${history.lineStart}-${history.lineEnd}` : history.line;
  elements.historyAnchor.textContent = `${history.path}:${range}${history.symbol ? ` · ${history.symbol}` : ''}`;
  if (history.status === 'loading') {
    elements.historyContent.className = 'insight-content empty-insight loading';
    elements.historyContent.textContent = history.deep
      ? '正在执行 git log -L 追踪函数演变（大仓库可能需要较长时间）…'
      : '正在查询函数级 Git 历史…';
    return;
  }
  if (history.status === 'error') {
    const error = document.createElement('div');
    error.className = 'error-card';
    error.textContent = history.message;
    elements.historyContent.append(error);
    return;
  }
  if (history.commits.length === 0) {
    elements.historyContent.className = 'insight-content empty-insight';
    elements.historyContent.textContent = '该函数没有提交历史';
    return;
  }
  const list = document.createElement('div');
  list.className = 'commit-list';
  for (const commit of history.commits) {
    const item = document.createElement('div');
    item.className = 'commit';
    // 未提交的工作区修改是合成条目：只作信息展示，不提供提交详情入口，
    // 避免点击后 git 报 bad revision。
    if (commit.hash === '0000000') {
      item.classList.add('commit-dirty');
      const label = document.createElement('div');
      label.className = 'commit-subject';
      label.textContent = commit.subject;
      item.append(label);
      list.append(item);
      continue;
    }
    const detail = state.commitDetail && state.commitDetail.hash === commit.hash ? state.commitDetail : null;
    if (detail) item.classList.add('active');
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'commit-header';
    const hash = document.createElement('span');
    hash.className = 'commit-hash';
    hash.textContent = commit.hash;
    const subject = document.createElement('span');
    subject.className = 'commit-subject';
    subject.textContent = ` ${commit.subject}`;
    header.append(hash, subject);
    header.addEventListener('click', () => showCommit(commit.hash));
    item.append(header);
    list.append(item);
  }
  elements.historyContent.append(list);
  const actions = document.createElement('div');
  actions.className = 'history-actions';
  if (history.mode === 'evolution') {
    const mode = document.createElement('span');
    mode.className = 'history-mode';
    mode.textContent = '深层演变模式（git log -L 跨提交追踪函数体）';
    actions.append(mode);
  } else {
    const deep = document.createElement('button');
    deep.type = 'button';
    deep.className = 'button small';
    deep.textContent = '深层演变（git log -L，较慢）';
    deep.title = '追踪函数体在历次提交中的修改，而不是当前代码行的最新改动';
    deep.addEventListener('click', () => fetchFunctionHistoryDeep(state.activeLine || history.line));
    actions.append(deep);
  }
  elements.historyContent.append(actions);
  // 面板先打开、提交历史后到时，焦点可能还停在空的解释内容上（j/k 没有任何
  // 落点）。只在焦点确实位于解释内容且面板可见时，把焦点挪到第一条提交。
  const active = document.activeElement;
  if (active === elements.explanationContent
    && elements.explanationContent.classList.contains('empty-insight')
    && document.getElementById('app').classList.contains('insights-visible')) {
    elements.historyContent.querySelector('.commit-header')?.focus({ preventScroll: true });
  }
}

// renderHistory 会重建整个列表：点「深层演变」后历史区立即切成加载态，
// 原按钮节点被移除会把焦点丢到 body；加载完成再次渲染时同样要收回来。
function focusHistoryPanel() {
  const target = elements.historyContent.querySelector('.history-actions .button') || elements.historyContent;
  // 加载态没有按钮可聚焦：让历史内容容器临时可聚焦，j/k 仍可滚动它。
  if (target === elements.historyContent) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

async function fetchFunctionHistoryDeep(line) {
  if (!state.repository || !state.currentFile || !Number.isInteger(line)) return;
  const filePath = state.currentFile;
  state.historyController?.abort();
  const controller = new AbortController();
  state.historyController = controller;
  const keepFocus = elements.historyContent.contains(document.activeElement);
  // 渲染后只在“焦点原本在历史区、且没有被用户移到别处”时补聚焦，
  // 避免异步返回时把正在编辑的焦点抢回来。
  const restoreFocus = () => {
    if (!keepFocus) return;
    const active = document.activeElement;
    if (active !== document.body && !elements.historyContent.contains(active)) return;
    focusHistoryPanel();
  };
  state.history = { path: filePath, line, status: 'loading', deep: true, commits: [] };
  renderHistory();
  restoreFocus();
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/function-history?path=${encodeURIComponent(filePath)}&line=${encodeURIComponent(line)}&deep=1`, { signal: controller.signal });
    if (state.currentFile !== filePath || controller.signal.aborted) return;
    state.history = { path: filePath, line, status: 'done', ...data };
    renderHistory();
    restoreFocus();
  } catch (error) {
    if (error.name === 'AbortError' || state.currentFile !== filePath) return;
    state.history = { path: filePath, line, status: 'error', message: error.message, commits: [] };
    renderHistory();
    restoreFocus();
  }
}

// ---- 提问 ----

export function openQuestion() {
  if (!state.source || state.explaining) return;
  window.__crPanels?.hideAll();
  const line = editor.getCursor().line;
  state.activeLine = line;
  state.questionOpen = true;
  elements.questionEditor.hidden = false;
  elements.questionAnchor.textContent = `${state.currentFile}:${line}`;
  elements.questionError.textContent = '';
  elements.questionInput.disabled = false;
  elements.questionSubmit.disabled = false;
  elements.questionSubmit.textContent = '确定';
  noteFocusIntent();
  elements.questionInput.focus();
}

export function closeQuestion() {
  state.questionOpen = false;
  state.explaining = false;
  elements.questionEditor.hidden = true;
  elements.questionError.textContent = '';
  elements.questionInput.value = '';
  if (elements.questionAnimation) elements.questionAnimation.checked = false;
}

async function submitQuestion() {
  if (!state.questionOpen || state.explaining) return;
  const question = elements.questionInput.value.trim();
  if (!question) {
    elements.questionError.textContent = '请输入想问的问题';
    return;
  }
  const filePath = state.currentFile;
  const line = state.activeLine;
  const wantsAnimation = Boolean(elements.questionAnimation?.checked);
  state.explaining = true;
  elements.questionInput.disabled = true;
  elements.questionSubmit.disabled = true;
  elements.questionCancel.disabled = true;
  elements.questionSubmit.textContent = wantsAnimation ? '正在生成文字与 3D 动画…' : '正在解释…';
  elements.questionError.textContent = '';
  state.explanation = { status: 'loading', path: filePath, line, animationRequested: wantsAnimation };
  renderExplanation();
  // 回答返回时，如果用户这段时间没有主动把焦点移到别处，就打开解释窗口并
  // 把焦点交给内容区——答案一到即可 j/k 阅读。用户切去别处则不抢焦点。
  let focusMoved = false;
  const markFocusMoved = () => { focusMoved = true; };
  document.addEventListener('focusin', markFocusMoved, true);
  try {
    const data = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/explain`, {
      method: 'POST',
      body: JSON.stringify({ path: filePath, line, question, animate: wantsAnimation }),
    });
    state.explanation = { status: 'done', path: filePath, line, ...data };
    closeQuestion();
    fetchFaq(line);
  } catch (error) {
    state.explanation = { status: 'error', path: filePath, line, message: error.message, details: error.details };
    elements.questionError.textContent = error.message;
  } finally {
    document.removeEventListener('focusin', markFocusMoved, true);
    state.explaining = false;
    elements.questionInput.disabled = false;
    elements.questionSubmit.disabled = false;
    elements.questionCancel.disabled = false;
    elements.questionSubmit.textContent = '确定';
    renderExplanation();
    if (!focusMoved && state.explanation && state.explanation.status !== 'loading') {
      window.__crPanels?.pin('insights');
      setTimeout(focusExplanationPanel, 0);
    }
  }
}

export function renderQuestionPresets() {
  elements.questionPresets.replaceChildren();
  for (const preset of QUESTION_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-chip';
    button.textContent = preset.label;
    button.title = preset.text;
    button.addEventListener('click', () => {
      elements.questionInput.value = preset.text;
      elements.questionInput.focus();
    });
    elements.questionPresets.append(button);
  }
}

// ---- 解释渲染 ----

function appendHeading(parent, text) {
  const heading = document.createElement('h3');
  heading.textContent = text;
  parent.append(heading);
}

function appendDiagnostic(parent, title, value) {
  if (value === undefined || value === null || value === '') return;
  const details = document.createElement('details');
  details.className = 'error-details';
  const summary = document.createElement('summary');
  summary.textContent = title;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'copy-detail';
  copy.textContent = '复制原文';
  const pre = document.createElement('pre');
  pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(pre.textContent).catch(() => {});
  });
  details.append(summary, copy, pre);
  parent.append(details);
}

function appendDiagnostics(container, details) {
  if (!details || typeof details !== 'object') return;
  if (details.request) {
    appendDiagnostic(
      container,
      '网页端发送的请求内容',
      `POST ${details.request.url}\n协议：${details.request.protocol} · 模型：${details.request.model}\n\n${details.request.body}`,
    );
  }
  if (details.response) {
    appendDiagnostic(container, 'LLM 返回的完整内容', `HTTP ${details.response.status}\n\n${details.response.body}`);
  }
  if (details.output) appendDiagnostic(container, '模型输出（解析失败原文）', details.output);
  if (details.retry) {
    appendDiagnostic(
      container,
      '重试请求与返回',
      `POST ${details.retry.request?.url || ''}\n\n${details.retry.response ? `HTTP ${details.retry.response.status}\n\n${details.retry.response.body}` : ''}`,
    );
  }
  if (details.error) appendDiagnostic(container, '网络错误', details.error);
}

function renderSources(card, sources) {
  if (!sources) return;
  const local = Array.isArray(sources.local) ? sources.local : [];
  const web = Array.isArray(sources.web) ? sources.web : [];
  if (!local.length && !web.length && !sources.webError && !sources.searchedFiles) return;
  const box = document.createElement('div');
  box.className = 'sources';
  const heading = document.createElement('h3');
  heading.textContent = '参考来源';
  box.append(heading);
  if (local.length) {
    const list = document.createElement('ul');
    for (const hit of local) {
      const item = document.createElement('li');
      const location = [hit.section, hit.page ? `第 ${hit.page} 页` : ''].filter(Boolean).join(' · ');
      item.textContent = `本地文档：${hit.source}${location ? `（${location}）` : ''}（相关度 ${hit.score}）`;
      list.append(item);
    }
    box.append(list);
  }
  if (web.length) {
    const list = document.createElement('ul');
    for (const hit of web) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = hit.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.nav = 'source';
      link.textContent = hit.title || hit.url;
      const engine = hit.engine === 'google' ? 'Google' : hit.engine === 'bing' ? 'Bing' : '网络';
      item.append(document.createTextNode(`网络（未核验 · ${engine}）：`), link);
      list.append(item);
    }
    box.append(list);
  }
  if (sources.webError) {
    const note = document.createElement('p');
    note.textContent = `网络检索：${sources.webError}`;
    box.append(note);
  }
  if (sources.searchedFiles) {
    const note = document.createElement('p');
    note.textContent = `本地文档检索范围：${sources.searchedFiles} 个文件`;
    box.append(note);
  }
  card.append(box);
}

export function renderExplanation() {
  const explanation = state.explanation;
  elements.explanationContent.replaceChildren();
  if (!explanation) {
    elements.explanationAnchor.textContent = '';
    elements.explanationContent.className = 'insight-content empty-insight';
    elements.explanationContent.textContent = '在任意源码行按 \\c（Vim 模式）或 c（编辑器未聚焦时），输入问题并点击“确定”。';
    return;
  }
  elements.explanationAnchor.textContent = `${explanation.path}:${explanation.line}`;
  if (explanation.status === 'loading') {
    elements.explanationContent.className = 'insight-content empty-insight loading';
    elements.explanationContent.textContent = explanation.animationRequested
      ? 'LLM 正在结合源码与规范生成文字解释和 3D 动画…'
      : 'LLM 正在结合源码分析问题…';
    return;
  }
  if (explanation.status === 'error') {
    elements.explanationContent.className = 'insight-content';
    const error = document.createElement('div');
    error.className = 'error-card';
    error.textContent = explanation.message;
    appendDiagnostics(error, explanation.details);
    elements.explanationContent.append(error);
    return;
  }

  elements.explanationContent.className = 'insight-content';
  const card = document.createElement('article');
  card.className = 'explanation-card';
  appendHeading(card, '概述');
  const overview = document.createElement('p');
  overview.textContent = explanation.explanation.overview;
  card.append(overview);
  appendHeading(card, '逐点分析');
  const details = document.createElement('ol');
  details.className = 'detail-list';
  for (const detail of explanation.explanation.details) {
    const item = document.createElement('li');
    item.textContent = detail;
    details.append(item);
  }
  card.append(details);
  if (explanation.explanation.evidence?.length) {
    appendHeading(card, '证据');
    const kindLabels = { code: '代码', documentation: '文档', inference: '推断' };
    for (const item of explanation.explanation.evidence) {
      const evidenceCard = document.createElement('div');
      evidenceCard.className = `evidence-card evidence-${item.kind}`;
      const head = document.createElement('div');
      head.className = 'evidence-head';
      const badge = document.createElement('span');
      badge.className = 'evidence-kind';
      badge.textContent = kindLabels[item.kind] || '推断';
      head.append(badge);
      if (item.kind === 'code' && item.file && item.lineStart && state.fileSet.has(item.file)) {
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'evidence-loc';
        jump.textContent = `${item.file}:${item.lineStart}${item.lineEnd && item.lineEnd !== item.lineStart ? `-${item.lineEnd}` : ''}`;
        jump.addEventListener('click', () => deps.jumpTo({ path: item.file, line: item.lineStart, character: 0 }));
        head.append(jump);
      } else if (item.kind === 'documentation' && (item.source || item.section)) {
        const location = document.createElement('span');
        location.className = 'evidence-loc-static';
        location.textContent = [item.source, item.section, item.page ? `第 ${item.page} 页` : ''].filter(Boolean).join(' · ');
        head.append(location);
      }
      const claim = document.createElement('p');
      claim.textContent = item.claim;
      evidenceCard.append(head, claim);
      if (item.excerpt) {
        const excerpt = document.createElement('details');
        excerpt.className = 'evidence-excerpt';
        const excerptSummary = document.createElement('summary');
        excerptSummary.textContent = '查看原文摘录';
        const pre = document.createElement('pre');
        pre.textContent = item.excerpt;
        excerpt.append(excerptSummary, pre);
        evidenceCard.append(excerpt);
      }
      card.append(evidenceCard);
    }
  }
  if (explanation.explanation.specifications.length) {
    appendHeading(card, '硬件协议规范依据');
    for (const specification of explanation.explanation.specifications) {
      const spec = document.createElement('div');
      spec.className = 'spec-card';
      const title = document.createElement('div');
      title.className = 'spec-title';
      title.textContent = specification.name;
      const meta = document.createElement('div');
      meta.className = 'spec-meta';
      const location = [specification.source, specification.section, specification.page ? `第 ${specification.page} 页` : ''].filter(Boolean).join(' · ');
      meta.textContent = `版本：${specification.version || '未确认'} · ${location || `章节：${specification.section}`} · ${specification.verified ? '已在本地文档中核实' : '未核实'}`;
      const relevance = document.createElement('div');
      relevance.textContent = specification.relevance;
      spec.append(title, meta, relevance);
      card.append(spec);
    }
  }
  appendHeading(card, '总结');
  const summary = document.createElement('p');
  summary.textContent = explanation.explanation.summary;
  card.append(summary);
  if (explanation.explanation.nextSteps?.length) {
    appendHeading(card, '建议继续阅读');
    const nextList = document.createElement('div');
    nextList.className = 'next-steps';
    for (const step of explanation.explanation.nextSteps) {
      if (!state.fileSet.has(step.file)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'next-step';
      const location = document.createElement('span');
      location.className = 'next-step-loc';
      location.textContent = `${step.file}:${step.line}`;
      const reason = document.createElement('span');
      reason.className = 'next-step-reason';
      reason.textContent = step.reason;
      button.append(location, reason);
      button.addEventListener('click', () => deps.jumpTo({ path: step.file, line: step.line, character: 0 }));
      nextList.append(button);
    }
    if (nextList.children.length) card.append(nextList);
  }
  if (explanation.explanation.animation) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'button primary animation-open';
    open.textContent = '查看 3D 动画演示';
    open.addEventListener('click', () => openAnimation(explanation.explanation.animation, open));
    card.append(open);
  }
  renderSources(card, explanation.sources);
  const note = document.createElement('p');
  note.className = 'model-note';
  note.textContent = `模型：${explanation.model}。内容由模型生成；涉及硬件规范时，请与官方规范原文复核。`;
  card.append(note);
  elements.explanationContent.append(card);
}

// 解释窗口获得焦点后由通用 Vim 导航层（vim-nav.js）接管 j/k/gg/G。
export function focusExplanationPanel() {
  // 延迟聚焦可能晚于“打开 3D 动画/提交详情/对话框”：顶层弹层在场时不要抢焦点。
  if (state.animationOpen || !elements.animationOverlay.hidden) return;
  if (!elements.commitOverlay.hidden || document.querySelector('dialog[open]')) return;
  // 面板已被收起时不要再聚焦（聚焦会触发 focusin 把面板重新滑出来）。
  if (!document.getElementById('app').classList.contains('insights-visible')) return;
  // 解释窗口拿到焦点：递增焦点意图，作废加载中代码窗的「迟到接管」。
  noteFocusIntent();
  // 解释还没生成时，解释内容是空的，j/k 无处可去；此时把焦点交给函数提交
  // 历史的第一条，打开窗口即可用 j/k 浏览提交（有解释时仍优先解释内容）。
  const explanationEmpty = elements.explanationContent.classList.contains('empty-insight');
  if (explanationEmpty) {
    const firstCommit = elements.historyContent.querySelector('.commit-header');
    if (firstCommit) {
      firstCommit.focus({ preventScroll: true });
      return;
    }
  }
  elements.explanationContent.focus({ preventScroll: true });
}

// ---- 3D 动画 ----

let animationUrls = null;
let animationReturnFocus = null;

function closeAnimationUrls() {
  if (!animationUrls) return;
  URL.revokeObjectURL(animationUrls.previewUrl);
  URL.revokeObjectURL(animationUrls.offlineUrl);
  animationUrls = null;
}

export function closeAnimation() {
  if (!state.animationOpen && !animationUrls) return;
  state.animationOpen = false;
  elements.animationOverlay.hidden = true;
  elements.animationFrame.src = 'about:blank';
  elements.animationDownload.removeAttribute('href');
  closeAnimationUrls();
  const target = animationReturnFocus;
  animationReturnFocus = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
}

async function openAnimation(animation, trigger = null) {
  if (!animation) return;
  if (!state.animationOpen) animationReturnFocus = trigger || document.activeElement;
  state.animationOpen = true;
  elements.animationOverlay.hidden = false;
  elements.animationFrame.src = 'about:blank';
  elements.animationDownload.removeAttribute('href');
  elements.animationClose.focus({ preventScroll: true });
  try {
    if (!state.animationRuntime) {
      const response = await fetch('/vendor/three/animation.bundle.js');
      if (!response.ok) throw new Error('动画运行时缺失，请先执行 npm run build:vendor');
      state.animationRuntime = await response.text();
    }
    closeAnimationUrls();
    const previewHtml = createAnimationHtml(animation, '', {
      runtimeUrl: new URL('/vendor/three/animation.bundle.js', window.location.origin).href,
    });
    const offlineHtml = createAnimationHtml(animation, state.animationRuntime);
    const previewUrl = URL.createObjectURL(new Blob([previewHtml], { type: 'text/html' }));
    const offlineUrl = URL.createObjectURL(new Blob([offlineHtml], { type: 'text/html' }));
    animationUrls = { previewUrl, offlineUrl };
    elements.animationFrame.src = previewUrl;
    elements.animationDownload.href = offlineUrl;
    elements.animationDownload.download = `${(animation.title || 'code-animation').replace(/[\\/:*?"<>|]/g, '_')}.html`;
  } catch (error) {
    closeAnimation();
    showNotice(`动画加载失败：${error.message}`, { error: true });
  }
}