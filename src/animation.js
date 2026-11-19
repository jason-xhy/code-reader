const ANIMATION_HINT_RE = /动画|三维|3\s*D|动态演示|可视化演示|animation|animate|visuali[sz]e.*3\s*d/i;
const ANIMATION_NEGATIVE_RE = /(?:不需要|不用|不要|无需|别用|不提供)[^\n。！？]{0,12}(?:动画|三维|3\s*D|动态演示|可视化演示)|without\s+(?:an?\s+)?(?:3\s*d\s+)?animation/i;

export function wantsAnimation(question) {
  const text = String(question || '');
  return ANIMATION_HINT_RE.test(text) && !ANIMATION_NEGATIVE_RE.test(text);
}

function text(value, fallback = '', limit = 1200) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback;
}

function line(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function parseAnimation(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.nodes) || !Array.isArray(value.steps)) return null;
  const ids = new Set();
  const nodes = [];
  for (const item of value.nodes.slice(0, 8)) {
    const id = text(item?.id, '', 40).replace(/[^A-Za-z0-9_-]/g, '-');
    const label = text(item?.label, '', 100);
    if (!id || !label || ids.has(id)) continue;
    ids.add(id);
    nodes.push({
      id,
      label,
      kind: ['code', 'data', 'spec', 'decision', 'output'].includes(item?.kind) ? item.kind : 'code',
      description: text(item?.description, '', 300),
    });
  }
  if (!nodes.length) return null;
  const steps = [];
  for (const item of value.steps.slice(0, 16)) {
    const title = text(item?.title, '', 160);
    const detail = text(item?.detail, '', 1200);
    const node = text(item?.node, '', 40);
    if (!title || !detail || !ids.has(node)) continue;
    const from = ids.has(item?.from) ? item.from : null;
    const to = ids.has(item?.to) ? item.to : null;
    const lineStart = line(item?.lineStart);
    const lineEnd = line(item?.lineEnd) || lineStart;
    steps.push({
      title,
      detail,
      node,
      from,
      to,
      file: text(item?.file, '', 300),
      lineStart,
      lineEnd,
      spec: text(item?.spec, '', 500),
    });
  }
  if (!steps.length) return null;
  return {
    title: text(value.title, '代码执行演示', 160),
    summary: text(value.summary, '', 600),
    nodes,
    steps,
  };
}
