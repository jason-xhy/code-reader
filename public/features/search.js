// 能力：工作区模糊搜索（函数定义 / 文件名）。
// 交互形态复用 gr 的引用窗口：左侧结果列表 + 右侧上下文预览，完全匹配排前。
import { elements } from '../core/dom.js';
import { state, editor, noteFocusIntent } from '../core/state.js';
import { api } from '../core/api.js';
import { SEARCH_DEBOUNCE_MS } from '../core/config.js';
import { debounce } from '../core/utils.js';
import { topLayerOpen } from '../core/policies.js';
import { loadContextPreview } from './navigation.js';

let deps = {};
let sessionCounter = 0;
// 同一会话内旧请求慢返回时不能覆盖新结果：每次请求取序号，回来时比对。
let requestSeq = 0;

export function initSearchFeature(dependencies) {
  deps = dependencies;
}

const MATCH_LABELS = { exact: '完全匹配', prefix: '前缀匹配', partial: '包含' };

function searchTitle(data) {
  const counts = data?.counts || {};
  const truncated = data?.truncated ? ' · 结果已截断' : '';
  const indexing = data?.index?.status === 'building' ? ' · 索引构建中' : '';
  return `${counts.functions || 0} 个符号（函数/配置） · ${counts.files || 0} 个文件${truncated}${indexing} · ↑/↓ 或 Ctrl+j/k 选择 · Enter 跳转 · Esc 取消`;
}

export function openWorkspaceSearch() {
  if (!state.repository) {
    elements.sourceStatus.textContent = '先打开一个仓库再搜索';
    return false;
  }
  // 对话框/提交详情/动画等顶层弹层在场时不要在其背后打开搜索窗。
  if (topLayerOpen()) return false;
  noteFocusIntent();
  const repositoryId = state.repository.id;
  const sessionId = `workspace-search-${++sessionCounter}`;
  requestSeq += 1;
  window.__crPanels?.hideAll();

  const run = debounce(async (value) => {
    const seq = ++requestSeq;
    const query = String(value || '').trim();
    if (!query) {
      editor.updateQuickpickItems([], {
        sessionId,
        title: '在工作区搜索函数/配置/文件名 · 支持 * ? 通配符与 /正则/ · 完全匹配优先',
        emptyText: '输入关键字开始搜索（函数名、Kconfig 配置名或文件名，支持 xhci*.c 这类通配符，或输入 /正则/）',
      });
      return;
    }
    editor.updateQuickpickItems([], { sessionId, title: `正在搜索“${query}”…`, emptyText: '正在搜索…' });
    try {
      const data = await api(`/api/repositories/${encodeURIComponent(repositoryId)}/search?q=${encodeURIComponent(query)}`);
      // 慢请求回来时已经有更新的输入（或已切仓）：丢弃，避免旧结果覆盖新结果。
      if (seq !== requestSeq) return;
      if (state.repository?.id !== repositoryId) {
        if (editor.isQuickpickOpen()) editor.closeQuickpick();
        return;
      }
      if (!editor.isQuickpickOpen()) return;
      const items = (data.results || []).map((result) => ({
        path: result.path,
        line: result.line,
        character: result.character || 0,
        label: result.name,
        kind: result.kind,
        detail: `${result.kind === 'function' ? '函数' : result.kind === 'kconfig' ? '配置' : '文件'} · ${MATCH_LABELS[result.match] || '包含'}`,
      }));
      editor.updateQuickpickItems(items, {
        sessionId,
        title: searchTitle(data),
        emptyText: data.warning || '没有匹配的函数、配置或文件名',
      });
    } catch (error) {
      if (seq !== requestSeq) return;
      editor.updateQuickpickItems([], {
        sessionId,
        title: `搜索失败：${error.message}`,
        emptyText: '搜索失败，可按 Esc 关闭',
      });
    }
  }, SEARCH_DEBOUNCE_MS);

  editor.showQuickpick([], (item) => {
    deps.jumpTo({ path: item.path, line: item.line, character: item.character || 0 });
  }, {
    sessionId,
    title: '在工作区搜索函数或文件名 · 支持 * ? 通配符与 /正则/ · ↑/↓ 或 Ctrl+j/k 选择',
    emptyText: '输入关键字开始搜索（函数名或文件名，支持 xhci*.c 这类通配符，或输入 /正则/）',
    input: {
      placeholder: '搜索函数/文件名，支持 * ? 通配符或 /正则/（默认忽略大小写）…',
      onChange: (value) => run(value),
    },
    preview: loadContextPreview,
  });
  return true;
}