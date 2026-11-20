// one-shot: code-reader 键盘导航层（应用固定模块，非 agent 探索脚本）; no-generalize: 依赖 code-reader 的 DOM 结构与 editor API
// grill: 成品检索=skill 库无 easymotion/sneak 前端成品; 输入固定=页面可见目标与 editor.visibleMatches; 步骤机械=收集目标→字母标签→按键命中→click/focus; 判读固定=元素 rect 与标签前缀; 失效场景=构造不出（仅本应用）
//
// 参考 easymotion / sneak：
//   Ctrl+Alt+K  给当前顶层窗口里的可操作元素与代码行打字母标签，输入标签即点击/聚焦/跳行（easymotion）
//   Ctrl+Alt+F  输入两个字符，给视口内所有匹配文本打标签，输入标签即跳转（sneak）
// 只处理当前可命中的顶层（原生 dialog / 提交详情 / 3D 动画 / 普通页面），避免点到遮罩后面的元素。
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const MAX_HINT_TARGETS = 676;
const MAX_SNEAK_MATCHES = 80;

const TARGET_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
  '.tree-row',
  '.history-item',
  '.quickpick-row',
  '.commit-header',
  '.faq-toggle',
  '[data-nav]',
].join(',');

function area(rect) {
  return rect.width * rect.height;
}

function clipRect(raw) {
  const left = Math.max(0, raw.left);
  const top = Math.max(0, raw.top);
  const right = Math.min(window.innerWidth, raw.right);
  const bottom = Math.min(window.innerHeight, raw.bottom);
  if (right - left < 4 || bottom - top < 4) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function rangeRect(editor, from, to) {
  const start = editor?.coordsAtPosition?.(from);
  const end = editor?.coordsAtPosition?.(to);
  if (!start || !end) return null;
  const left = Math.min(start.left, end.left);
  return clipRect({
    left,
    top: Math.min(start.top, end.top),
    // coordsAtPos 是光标矩形，宽度可能为 0；至少给标签留 4px 命中区。
    right: Math.max(start.right, end.right, left + 4),
    bottom: Math.max(start.bottom, end.bottom),
  });
}

// 代码行标签的矩形：只取行首到前 160 个字符，超长行不整行铺开。
function lineRect(editor, match) {
  if (!match || typeof match.from !== 'number') return null;
  const start = editor?.coordsAtPosition?.(match.from);
  if (!start) return null;
  const end = editor?.coordsAtPosition?.(Math.min(match.to ?? match.from, match.from + 160)) || start;
  const left = Math.min(start.left, end.left);
  return clipRect({
    left,
    top: Math.min(start.top, end.top),
    right: Math.max(start.right, end.right, left + 6),
    bottom: Math.max(start.bottom, end.bottom),
  });
}

function visibleRect(element) {
  if (!element.isConnected) return null;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
  if (element.closest('[hidden], [inert]')) return null;
  return clipRect(element.getBoundingClientRect());
}

function isHit(element, rect) {
  // 取靠左上角的内点：既避开元素自身的中心子节点遮挡，也能识别被弹层盖住的元素。
  const x = rect.left + Math.min(rect.width / 2, 30);
  const y = rect.top + Math.min(rect.height / 2, 14);
  const hit = document.elementFromPoint(x, y);
  if (!hit) return false;
  return element === hit || element.contains(hit) || hit.contains(element);
}

// 当前最上层的交互层：顶层判定与 modalRoot 必须一致，否则 Tab 焦点圈和
// K/F 标签层会各认一套层级（例如提问框已按模态圈住 Tab，标签却还能点到背景）。
function openMenu() {
  // 菜单是页面内的临时浮层，z-index 高于侧栏/代码区；打开时它就是当前终点。
  // tree-menu 的 z-index 高于 history-menu，两者同时在场时优先树菜单。
  for (const id of ['tree-menu', 'history-menu']) {
    const menu = document.getElementById(id);
    if (!menu || menu.hidden) continue;
    const rect = menu.getBoundingClientRect();
    // 侧栏整体滑出屏幕时菜单可能仍标记为打开（transform 移出视口），
    // 只有菜单矩形与视口相交才算当前顶层。
    if (rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
      && rect.left < window.innerWidth && rect.top < window.innerHeight) return menu;
  }
  return null;
}

function topRoot() {
  const modal = modalRoot();
  if (modal) return modal;
  return openMenu() || document.body;
}

// 标签层必须挂在顶层窗口：原生 <dialog> 在 top layer，普通 body 覆盖层会被压住；
// 其余情况统一挂 body，避免菜单/侧栏的 transform 把 position:fixed 的坐标系改掉。
function layerMount() {
  return document.querySelector('dialog[open]') || document.body;
}

// 模态焦点圈：原生 dialog 与自绘模态（3D 动画/提交详情/提问框）共用。
// 浏览器原生 dialog 在 Tab 越过最后一个元素时会把焦点交给 body，焦点环消失；
// 这里统一接管边界处的 Tab/Shift+Tab，让焦点在模态内部循环。
function modalRoot() {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) return dialog;
  const animation = document.getElementById('animation-overlay');
  if (animation && !animation.hidden) return animation;
  const commit = document.getElementById('commit-overlay');
  if (commit && !commit.hidden) return commit.querySelector('.commit-overlay-card') || commit;
  const question = document.getElementById('question-editor');
  if (question && !question.hidden) return question;
  return null;
}

function focusableWithin(root) {
  const selector = 'button:not([disabled]), a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  return [...root.querySelectorAll(selector)].filter((element) => {
    if (element.disabled) return false;
    if (element.closest('[hidden], [inert]')) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return element.getClientRects().length > 0;
  });
}

function trapModalTab(event) {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return false;
  const root = modalRoot();
  if (!root) return false;
  const items = focusableWithin(root);
  if (!items.length) {
    event.preventDefault();
    root.focus?.({ preventScroll: true });
    return true;
  }
  const index = items.indexOf(document.activeElement);
  if (index < 0) {
    // 焦点已在模态之外（例如浏览器把焦点交给 body）：直接送回边界。
    event.preventDefault();
    (event.shiftKey ? items[items.length - 1] : items[0]).focus({ preventScroll: true });
    return true;
  }
  if (!event.shiftKey && index === items.length - 1) {
    event.preventDefault();
    items[0].focus({ preventScroll: true });
    return true;
  }
  if (event.shiftKey && index === 0) {
    event.preventDefault();
    items[items.length - 1].focus({ preventScroll: true });
    return true;
  }
  return false;
}

function firstFocusable(root) {
  const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex="0"], [contenteditable="true"]';
  for (const element of root.querySelectorAll(selector)) {
    if (element.disabled) continue;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (!element.getClientRects().length) continue;
    return element;
  }
  return null;
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function interactiveAncestor(node) {
  return node?.parentElement?.closest(
    'button, a[href], [role="button"], .tree-row, .history-item, .quickpick-row, .faq-toggle, .commit-header, .workspace-tab, .editor-tab, [data-nav]',
  ) || null;
}

function textMatches(root, query) {
  const matches = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.includes(query)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.cr-hint-layer, #editor-host, script, style, noscript, textarea, input, select')) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest('[hidden], [inert]')) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node && matches.length < MAX_SNEAK_MATCHES) {
    const text = node.nodeValue;
    let index = text.indexOf(query);
    while (index >= 0 && matches.length < MAX_SNEAK_MATCHES) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + query.length);
      const raw = range.getClientRects()[0];
      const rect = raw ? clipRect(raw) : null;
      if (rect && isHit(node.parentElement, rect)) {
        matches.push({
          kind: 'dom',
          node,
          range,
          rect,
          interactive: interactiveAncestor(node),
        });
      }
      index = text.indexOf(query, index + Math.max(1, query.length));
    }
    node = walker.nextNode();
  }
  return matches;
}

export function createKeyboardNav({ getEditor, toggleSidebar, toggleInsights, cancelTreeFocus } = {}) {
  let layer = null;
  let status = null;
  let mode = null; // hint | sneak
  let phase = 'hint'; // hint | query | pick
  let buffer = '';
  let query = '';
  let hintTargets = [];
  let sneakMatches = [];
  let refreshTimer = null;

  function notify() {
    globalThis.__crKeyboardNavState = snapshot();
  }

  function snapshot() {
    const items = mode === 'hint' ? hintTargets : sneakMatches;
    return {
      mode,
      phase,
      buffer,
      query,
      targets: hintTargets.length,
      matches: sneakMatches.length,
      labels: items.map((item) => item.label).filter(Boolean),
      items: items.map((item) => ({
        label: item.label,
        kind: item.kind || 'hint',
        id: item.element?.id || '',
        tag: item.element?.tagName || '',
        text: (item.element?.textContent || item.node?.nodeValue || '').trim().slice(0, 40),
        line: item.match?.line || null,
        from: item.match?.from ?? null,
      })),
    };
  }

  function ensureLayer() {
    if (layer?.isConnected) return;
    layer = document.createElement('div');
    layer.className = 'cr-hint-layer';
    layer.setAttribute('aria-hidden', 'true');
    status = document.createElement('div');
    status.className = 'cr-hint-status';
    status.setAttribute('role', 'status');
    layer.append(status);
    // 原生 <dialog> 位于 top layer，普通 body 覆盖层会被它压住，必须挂进 dialog；
    // 提问框/菜单不是 top layer，挂 body 可保持 fixed 坐标相对视口。
    layerMount().append(layer);
  }

  function setStatus(text, tone = '') {
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function clearBadges() {
    if (!layer) return;
    for (const node of layer.querySelectorAll('.cr-hint-badge, .cr-hint-outline')) node.remove();
  }

  function labelFor(index, total) {
    return total > ALPHABET.length
      ? ALPHABET[Math.floor(index / ALPHABET.length)] + ALPHABET[index % ALPHABET.length]
      : ALPHABET[index];
  }

  function badgeText(label) {
    if (label.length < 2) return label;
    return `${label[0]}\u200a${label.slice(1)}`;
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // 元素里文字的实际范围（不含标签层）。标签不能压在这块文字上，否则
  // 用户看不到要跳转的目标内容。
  function textBoundsOf(element) {
    if (!element || element.nodeType !== 1) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest('.cr-hint-layer, script, style, noscript')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const range = document.createRange();
    let bounds = null;
    let node = walker.nextNode();
    while (node) {
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        if (!bounds) {
          bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        } else {
          bounds.left = Math.min(bounds.left, rect.left);
          bounds.top = Math.min(bounds.top, rect.top);
          bounds.right = Math.max(bounds.right, rect.right);
          bounds.bottom = Math.max(bounds.bottom, rect.bottom);
        }
      }
      node = walker.nextNode();
    }
    return bounds;
  }

  // 标签候选位置：代码行放行号槽（不碰源码），其它目标放文字左侧/右侧/
  // 上方/下方，最后才退回元素外侧。
  function badgeCandidates(item, size, gutterRight, text) {
    const rect = item.rect;
    const centerY = rect.top + (rect.height - size.height) / 2;
    const list = [];
    if (item.kind === 'editor-line') {
      const right = Number.isFinite(gutterRight) ? gutterRight : rect.left;
      const gutterLeft = right - size.width - 3;
      // 行号槽被侧栏等覆盖层盖住时，槽位标签会画在覆盖层（树行）表面；
      // 改用行内第一个真正露在编辑器上的探测点，标签贴行且落在可见代码区。
      const anchor = visibleAnchorX(rect);
      const gutterVisible = editorVisibleAt(gutterLeft + size.width / 2, centerY + size.height / 2);
      if (gutterVisible || anchor === null) {
        list.push({ left: gutterLeft, top: centerY });
      } else {
        list.push({ left: anchor + 3, top: centerY });
      }
      return list;
    }
    if (item.kind === 'editor') {
      // 匹配文本左侧可能被侧栏/解释栏压住（匹配本身还有一小段露在编辑器上），
      // 标签优先放到匹配右侧，避免落在覆盖层表面。
      list.push({ left: rect.right + 3, top: centerY });
      list.push({ left: rect.left + 2, top: rect.top - size.height - 2 });
      list.push({ left: rect.left + 2, top: rect.bottom + 2 });
    }
    if (text) {
      const textCenterY = text.top + (text.bottom - text.top - size.height) / 2;
      list.push({ left: text.left - size.width - 4, top: textCenterY });
      list.push({ left: text.right + 4, top: textCenterY });
      list.push({ left: text.left, top: text.top - size.height - 2 });
      list.push({ left: text.left, top: text.bottom + 2 });
    }
    list.push({ left: rect.left - size.width - 3, top: centerY });
    list.push({ left: rect.right + 3, top: centerY });
    list.push({ left: rect.left + 2, top: rect.top - size.height - 2 });
    list.push({ left: rect.left + 2, top: rect.bottom + 2 });
    return list;
  }

  function placeItems(items) {
    clearBadges();
    const placed = [];
    const gutter = document.querySelector('#editor-host .cm-gutters');
    const gutterRight = gutter ? gutter.getBoundingClientRect().right : null;
    // 一次收集所有目标的文字范围：先保证不盖自己，再尽量不盖其它目标。
    const textBounds = new Map();
    for (const item of items) {
      if (!item.rect) continue;
      if (item.kind === 'editor-line') continue;
      const bounds = item.element ? textBoundsOf(item.element) : (item.kind === 'dom' ? item.rect : null);
      if (bounds) textBounds.set(item, bounds);
    }
    const allTexts = [...textBounds.values()];
    for (const item of items) {
      if (!item.rect) {
        item.badge?.remove();
        item.outline?.remove();
        item.badge = null;
        item.outline = null;
        continue;
      }
      if (item.noOutline) {
        // 代码行只放标签，不整行描边（几十行同时描边会盖住源码）。
        item.outline?.remove();
        item.outline = null;
      } else if (!item.outline?.isConnected) {
        item.outline = document.createElement('div');
        item.outline.className = 'cr-hint-outline';
        layer.append(item.outline);
      }
      if (!item.badge?.isConnected) {
        item.badge = document.createElement('div');
        item.badge.className = 'cr-hint-badge';
        item.badge.textContent = badgeText(item.label);
        layer.append(item.badge);
      }
      if (item.outline) {
        item.outline.style.left = `${item.rect.left}px`;
        item.outline.style.top = `${item.rect.top}px`;
        item.outline.style.width = `${item.rect.width}px`;
        item.outline.style.height = `${item.rect.height}px`;
      }
      // offsetWidth 是取整值，实际字宽有小数（letter-spacing/字体度量），
      // 用取整值做不相交检查会漏掉半像素的压字。
      const badgeRect = item.badge.getBoundingClientRect();
      const size = {
        width: badgeRect.width || 18,
        height: badgeRect.height || 18,
      };
      const text = textBounds.get(item) || null;
      const candidates = badgeCandidates(item, size, gutterRight, text);
      const clampX = (value) => Math.max(2, Math.min(window.innerWidth - size.width - 2, value));
      const clampY = (value) => Math.max(2, Math.min(window.innerHeight - size.height - 2, value));
      const pick = (strict) => {
        for (const candidate of candidates) {
          let left = clampX(candidate.left);
          let top = clampY(candidate.top);
          // 同一位置常有容器 + 内部按钮两个目标：标签错开，保证都能读。
          let guard = 0;
          while (placed.some((point) => Math.abs(point.left - left) < 8 && Math.abs(point.top - top) < 8) && guard < 8) {
            top += 17;
            guard += 1;
            if (top > window.innerHeight - size.height - 2) {
              top = clampY(candidate.top);
              left = clampX(left + size.width + 8);
            }
          }
          const area = { left, top, right: left + size.width, bottom: top + size.height };
          if (text && overlaps(area, text)) continue;
          if (strict && allTexts.some((bounds) => bounds !== text && overlaps(area, bounds))) continue;
          return { left, top };
        }
        return null;
      };
      // 第一轮避开所有目标文字；挤不下时放宽为只避开被标注元素自己的文字。
      const position = pick(true) || pick(false) || {
        left: clampX(candidates[0]?.left ?? item.rect.left + 2),
        top: clampY(candidates[0]?.top ?? item.rect.top + 2),
      };
      placed.push(position);
      item.badge.style.left = `${position.left}px`;
      item.badge.style.top = `${position.top}px`;
    }
  }

  // 沿矩形宽度取的探测点：侧栏/解释栏/弹层都是覆盖层，行首一个探测点
  // 会被它们误导，需要多点判断“这一行是否真露在编辑器上”。
  function probeXs(rect) {
    return [
      rect.left + 12,
      rect.left + rect.width * 0.25,
      rect.left + rect.width * 0.5,
      rect.left + rect.width * 0.75,
      rect.right - 6,
    ].map((value) => Math.max(rect.left + 2, Math.min(rect.right - 2, value)));
  }

  function editorVisibleAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit?.closest?.('#editor-host'));
  }

  // 矩形内第一个真正露在编辑器上的探测点（最靠左的可见点）；侧栏打开时
  // 行首/行号槽被盖住，标签应改用这个点作为锚点。
  function visibleAnchorX(rect) {
    const y = rect.top + rect.height / 2;
    return probeXs(rect).find((x) => editorVisibleAt(x, y)) ?? null;
  }

  function visibleInEditor(rect) {
    return visibleAnchorX(rect) !== null;
  }

  // 代码区行标签：编辑器可见时才收集，一行一个目标；激活后光标落到该行。
  function collectEditorLines(root) {
    if (root !== document.body) return [];
    const editor = getEditor();
    const host = document.getElementById('editor-host');
    if (!editor?.visibleLines || !host || host.hidden) return [];
    if (!host.getClientRects().length) return [];
    const items = [];
    for (const match of editor.visibleLines(MAX_HINT_TARGETS)) {
      const rect = clipRect(match);
      if (!rect) continue;
      // 被提问框/引用列表/侧栏完全盖住的行不打标签（标签层在最上层，会盖到弹层上面）。
      // 侧栏是覆盖层，会盖住行首；只要行内还有任意一处真正露在编辑器上，
      // 这行就仍可跳转——所以沿行宽取多个探测点，而不是只看行首。
      if (!visibleInEditor(rect)) continue;
      items.push({ kind: 'editor-line', match, rect, noOutline: true, label: '' });
    }
    return items;
  }

  function collectHintTargets() {
    const root = topRoot();
    const nodes = Array.from(root.querySelectorAll(TARGET_SELECTOR));
    if (root !== document.body && root.matches?.(TARGET_SELECTOR)) nodes.unshift(root);
    const seen = new Set();
    const items = collectEditorLines(root);
    for (const element of nodes) {
      if (seen.has(element)) continue;
      seen.add(element);
      if (element.closest('.cr-hint-layer')) continue;
      // CodeMirror 的 contenteditable 覆盖整个代码区：用逐行标签替代整块标签。
      if (element.closest('#editor-host') && element.matches('[contenteditable="true"]')) continue;
      if (element.disabled) continue;
      if (element.getAttribute('aria-hidden') === 'true' && !element.matches('button, a, input, select, textarea, [role]')) continue;
      const rect = visibleRect(element);
      if (!rect) continue;
      if (!isHit(element, rect)) continue;
      items.push({ element, rect });
    }
    items.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left || area(a.rect) - area(b.rect));
    const visible = items.slice(0, MAX_HINT_TARGETS);
    visible.forEach((item, index) => {
      item.label = labelFor(index, visible.length);
    });
    return visible;
  }

  // 激活后焦点跟随：点击可能打开原生对话框/提交详情/3D 弹层，也可能重渲染
  // 掉被点的节点（文件树）。焦点若还在旧按钮或掉到 body，就把它送进新顶层。
  function followFocus(element, beforeRoot) {
    const attempt = () => {
      const active = document.activeElement;
      const root = topRoot();
      if (root !== document.body && root !== beforeRoot) {
        if (!root.contains(active)) {
          (firstFocusable(root) || root).focus?.({ preventScroll: true });
        }
        return true;
      }
      if (active && active !== document.body && active !== document.documentElement) return true;
      const replacement = element?.isConnected
        ? element
        : (element?.dataset?.path && document.querySelector(`[data-path="${cssEscape(element.dataset.path)}"]`))
          || (element?.id && document.getElementById(element.id))
          || null;
      if (!replacement) return false;
      replacement.focus?.({ preventScroll: true });
      return true;
    };
    if (attempt()) return;
    // 对话框内容异步渲染（如知识库配置先 fetch 再 showModal）时再补一次。
    setTimeout(attempt, 260);
  }

  function activateHint(item) {
    if (!item) return;
    if (item.kind === 'editor-line') {
      const editor = getEditor();
      // 标签层可从文件树/菜单等任意焦点触发：跳转后焦点要落在编辑器，并取消
      // 文件树请求仍在跑的重试（否则其观察窗会在随后一帧把焦点抢回树）。
      const fromEditor = Boolean(document.activeElement?.closest?.('#editor-host'));
      cancelTreeFocus?.();
      close();
      editor?.jumpToLine?.(item.match?.line);
      if (!fromEditor && !document.activeElement?.closest?.('#editor-host')) {
        editor?.focus?.();
      }
      return;
    }
    const element = item.element;
    const beforeRoot = topRoot();
    close();
    element.focus?.({ preventScroll: true });
    if (element.matches('input, textarea, select, [contenteditable="true"]')) {
      if (typeof element.select === 'function' && element.matches('input[type="text"], input[type="search"], textarea')) {
        element.select();
      }
      return;
    }
    if (element.matches('button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="link"], .tree-row, .history-item, .quickpick-row, .commit-header, .faq-toggle, [data-nav]')) {
      element.click();
      followFocus(element, beforeRoot);
    }
  }

  function updateHintBadges() {
    const prefix = buffer;
    for (const item of hintTargets) {
      item.badge?.classList.toggle('dim', Boolean(prefix) && !item.label.startsWith(prefix));
    }
  }

  function openHint() {
    close();
    mode = 'hint';
    phase = 'hint';
    buffer = '';
    ensureLayer();
    hintTargets = collectHintTargets();
    placeItems(hintTargets);
    const lineCount = hintTargets.filter((item) => item.kind === 'editor-line').length;
    setStatus(hintTargets.length
      ? `HINT · ${hintTargets.length} 个目标${lineCount ? `（代码 ${lineCount} 行）` : ''} · 输入标签跳转 · Esc 取消`
      : 'HINT · 当前窗口没有可跳转的目标 · Esc 取消');
    scheduleRefresh();
    notify();
  }

  function openSneak() {
    close();
    mode = 'sneak';
    phase = 'query';
    buffer = '';
    query = '';
    ensureLayer();
    setStatus('SNEAK · 输入两个字符 · Esc 取消');
    scheduleRefresh();
    notify();
  }

  function collectSneakMatches(value) {
    const items = [];
    const editor = getEditor();
    const root = topRoot();
    const editorHost = document.getElementById('editor-host');
    const editorVisible = Boolean(editorHost && editorHost.offsetParent !== null);
    // 原生 dialog / 提交详情盖住代码区、或 nvim 页签在前台时，不去编辑器里取匹配。
    if (root === document.body && editorVisible && editor?.visibleMatches) {
      for (const match of editor.visibleMatches(value, MAX_SNEAK_MATCHES)) {
        const rect = clipRect(match);
        if (!rect) continue;
        // 与 K 的代码行一致：被侧栏/解释栏/提问框完全盖住的匹配不生成标签，
        // 否则标签会画在覆盖层表面，跳转后目标仍在遮挡下面。
        if (!visibleInEditor(rect)) continue;
        items.push({ kind: 'editor', match, rect, label: '' });
      }
    }
    for (const match of textMatches(root, value)) {
      items.push({ ...match, label: '' });
    }
    items.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const visible = items.slice(0, MAX_SNEAK_MATCHES);
    visible.forEach((item, index) => {
      item.label = labelFor(index, visible.length);
    });
    return visible;
  }

  function activateSneak(item) {
    if (!item) return;
    if (item.kind === 'editor') {
      const editor = getEditor();
      close();
      editor?.jumpToMatch?.(item.match);
      return;
    }
    const selection = window.getSelection();
    if (selection && item.range) {
      selection.removeAllRanges();
      selection.addRange(item.range);
    }
    item.node?.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const target = item.interactive || item.node?.parentElement?.closest('[tabindex="0"], [contenteditable="true"]');
    close();
    target?.focus?.({ preventScroll: true });
  }

  function startSneakPick() {
    const value = buffer;
    query = value;
    buffer = '';
    sneakMatches = collectSneakMatches(value);
    if (!sneakMatches.length) {
      phase = 'query';
      query = '';
      setStatus(`SNEAK · “${value}” 没有匹配 · 重新输入两个字符 · Esc 取消`, 'warn');
      notify();
      return;
    }
    phase = 'pick';
    placeItems(sneakMatches);
    setStatus(`SNEAK “${query}” · ${sneakMatches.length} 处 · 输入标签跳转 · Backspace 重输 · Esc 取消`);
    notify();
  }

  function resetSneakQuery() {
    phase = 'query';
    query = '';
    buffer = '';
    sneakMatches = [];
    clearBadges();
    setStatus('SNEAK · 输入两个字符 · Esc 取消');
    notify();
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function handleHintKey(event) {
    if (event.key === 'Escape') {
      consume(event);
      close();
      return true;
    }
    if (event.key === 'Backspace') {
      consume(event);
      buffer = buffer.slice(0, -1);
      updateHintBadges();
      setStatus(buffer
        ? `HINT · 前缀 “${buffer}” · ${hintTargets.filter((item) => item.label.startsWith(buffer)).length} 个候选`
        : `HINT · ${hintTargets.length} 个目标 · 输入标签跳转 · Esc 取消`);
      notify();
      return true;
    }
    if (event.key === 'Enter') {
      consume(event);
      if (hintTargets.length === 1) activateHint(hintTargets[0]);
      return true;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      consume(event);
      const next = `${buffer}${event.key.toLowerCase()}`;
      const matches = hintTargets.filter((item) => item.label.startsWith(next));
      if (!matches.length) {
        buffer = '';
        updateHintBadges();
        setStatus('HINT · 没有匹配的标签 · 重新输入 · Esc 取消', 'warn');
        notify();
        return true;
      }
      buffer = next;
      updateHintBadges();
      const exact = matches.find((item) => item.label === buffer);
      if (exact) {
        activateHint(exact);
      } else {
        setStatus(`HINT · 前缀 “${buffer}” · ${matches.length} 个候选 · Esc 取消`);
        notify();
      }
      return true;
    }
    consume(event);
    return true;
  }

  function handleSneakKey(event) {
    if (event.key === 'Escape') {
      consume(event);
      close();
      return true;
    }
    if (event.key === 'Backspace') {
      consume(event);
      if (phase === 'pick') resetSneakQuery();
      else {
        buffer = buffer.slice(0, -1);
        setStatus(`SNEAK · 已输入 “${buffer}” · 再输入 ${2 - buffer.length} 个字符 · Esc 取消`);
        notify();
      }
      return true;
    }
    if (phase === 'query') {
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        consume(event);
        buffer += event.key;
        if (buffer.length >= 2) startSneakPick();
        else {
          setStatus(`SNEAK · 已输入 “${buffer}” · 再输入 1 个字符 · Esc 取消`);
          notify();
        }
        return true;
      }
      consume(event);
      return true;
    }
    if (phase === 'pick') {
      if (event.key === 'Enter') {
        consume(event);
        if (sneakMatches.length === 1) activateSneak(sneakMatches[0]);
        return true;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        consume(event);
        const next = `${buffer}${event.key.toLowerCase()}`;
        const matches = sneakMatches.filter((item) => item.label.startsWith(next));
        if (!matches.length) {
          buffer = '';
          setStatus(`SNEAK “${query}” · 没有匹配的标签 · 重新输入 · Esc 取消`, 'warn');
          notify();
          return true;
        }
        buffer = next;
        const exact = matches.find((item) => item.label === buffer);
        if (exact) activateSneak(exact);
        else {
          setStatus(`SNEAK “${query}” · 前缀 “${buffer}” · ${matches.length} 个候选 · Esc 取消`);
          notify();
        }
        return true;
      }
      consume(event);
      return true;
    }
    consume(event);
    return true;
  }

  function handleKeydown(event) {
    if (!mode) return trapModalTab(event);
    if (event.isComposing) {
      consume(event);
      return true;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
      // 再按一次本模式的快捷键：关闭；其它组合键让给应用（先退出导航模式）。
      if (event.ctrlKey && event.altKey && !event.metaKey && (event.code === 'KeyK' || event.code === 'KeyF')) {
        consume(event);
        close();
        return true;
      }
      close();
      return false;
    }
    return mode === 'hint' ? handleHintKey(event) : handleSneakKey(event);
  }

  function reposition() {
    if (!mode) return;
    if (mode === 'hint') {
      const editor = getEditor();
      for (const item of hintTargets) {
        item.rect = item.kind === 'editor-line'
          ? lineRect(editor, item.match)
          : visibleRect(item.element);
      }
      placeItems(hintTargets);
      return;
    }
    const editor = getEditor();
    for (const item of sneakMatches) {
      if (item.kind === 'editor') {
        item.rect = rangeRect(editor, item.match.from, item.match.to);
      } else {
        const raw = item.range.getClientRects()[0];
        item.rect = raw ? clipRect(raw) : null;
      }
    }
    placeItems(sneakMatches);
  }

  function scheduleRefresh() {
    if (!mode) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(reposition, 60);
  }

  function close() {
    clearTimeout(refreshTimer);
    if (layer) layer.remove();
    layer = null;
    status = null;
    mode = null;
    phase = 'hint';
    buffer = '';
    query = '';
    hintTargets = [];
    sneakMatches = [];
    notify();
  }

  window.addEventListener('resize', scheduleRefresh);
  document.addEventListener('scroll', scheduleRefresh, true);

  const api = {
    openHint,
    openSneak,
    close,
    handleKeydown,
    isActive: () => Boolean(mode),
    snapshot,
    toggle(kind) {
      if (mode === kind) close();
      else if (kind === 'hint') openHint();
      else openSneak();
    },
    toggleSidebar: () => toggleSidebar?.(),
    toggleInsights: () => toggleInsights?.(),
  };
  globalThis.__crKeyboardNav = api;
  notify();
  return api;
}