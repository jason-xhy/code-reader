// 能力：跨平台快捷键表（默认键位、用户改绑、输入法/桌面占用时的备用键）。
// 背景：fcitx 默认把 Ctrl+Alt+P 绑给 SwitchPreedit、UKUI 把 Ctrl+Alt+L 当锁屏，
// 这类抢占页面完全看不到（按键根本不送达）。所以提供改绑与备用键，而不是假设
// 某个组合键一定可用。所有匹配走 KeyboardEvent.code（与键盘布局无关）。
import { showNotice } from './notice.js';

const STORAGE_KEY = 'code-reader-keymap-v1';
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// 可改绑动作：binding 是主键位；legacy 是只读兼容键（旧版本键位，不参与改绑）。
export const KEYMAP_ACTIONS = [
  { id: 'panel.tree', label: '代码树面板', binding: 'Ctrl+Alt+B' },
  { id: 'panel.insights', label: '分析与解释面板', binding: 'Ctrl+Alt+I' },
  { id: 'nav.hint', label: '全键盘跳转（标签）', binding: 'Ctrl+Alt+K' },
  { id: 'nav.sneak', label: '两字符定位', binding: 'Ctrl+Alt+F' },
  { id: 'search.workspace', label: '工作区搜索', binding: 'Ctrl+Alt+P' },
  { id: 'trail.open', label: '阅读路径列表', binding: 'Ctrl+Alt+R' },
  { id: 'workspace.prev', label: '上一个工作区仓库', binding: 'Ctrl+Alt+[' },
  { id: 'workspace.next', label: '下一个工作区仓库', binding: 'Ctrl+Alt+]' },
  { id: 'editor.mode', label: '切到内置编辑器', binding: 'Ctrl+Alt+1', legacy: ['Ctrl+Alt+E'] },
  { id: 'nvim.mode', label: '切到本地 Vim', binding: 'Ctrl+Alt+2', legacy: ['Ctrl+Alt+N'] },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `workspace.slot${index + 1}`,
    label: `工作区第 ${index + 1} 个页签`,
    binding: `Ctrl+Alt+Shift+${index + 1}`,
    digit: true,
  })),
  { id: 'goto.definition', label: '跳转到定义', binding: 'Alt+.' },
  { id: 'goto.references', label: '查找引用', binding: 'Alt+R' },
];

const ACTIONS = new Map(KEYMAP_ACTIONS.map((action) => [action.id, action]));

const KEY_CODES = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '.': 'Period',
  ',': 'Comma',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  ' ': 'Space',
};

const CODE_KEYS = Object.fromEntries(Object.entries(KEY_CODES).map(([key, code]) => [code, key]));

const NAMED_KEYS = new Set([
  'Escape', 'Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
]);

export function keyCodeFor(key) {
  if (!key) return null;
  const upper = key.length === 1 ? key.toUpperCase() : key;
  if (/^[A-Z]$/.test(upper)) return `Key${upper}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (KEY_CODES[key]) return KEY_CODES[key];
  if (/^F([1-9]|1[0-2])$/.test(upper)) return upper;
  if (NAMED_KEYS.has(upper)) return upper;
  return null;
}

export function keyForCode(code) {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (NAMED_KEYS.has(code)) return code;
  return CODE_KEYS[code] || null;
}

const parseCache = new Map();

export function parseBinding(spec) {
  if (typeof spec !== 'string' || !spec.trim()) return null;
  if (parseCache.has(spec)) return parseCache.get(spec);
  const parts = spec.split('+').map((part) => part.trim()).filter(Boolean);
  const parsed = { ctrl: false, alt: false, shift: false, meta: false, code: null, key: null };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') parsed.ctrl = true;
    else if (lower === 'alt' || lower === 'option' || lower === 'opt') parsed.alt = true;
    else if (lower === 'shift') parsed.shift = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'super') parsed.meta = true;
    else parsed.code = keyCodeFor(part);
  }
  const result = parsed.code ? parsed : null;
  parseCache.set(spec, result);
  return result;
}

export function bindingFromEvent(event) {
  if (!event) return null;
  const code = keyCodeFor(keyForCode(event.code) || event.key);
  if (!code) return null;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  const key = keyForCode(code);
  if (!key) return null;
  parts.push(key);
  return parts.join('+');
}

// 合法快捷键：必须带修饰键（否则会吞掉普通输入）。
export function validateBinding(spec) {
  const parsed = parseBinding(spec);
  if (!parsed) return { ok: false, error: '无法识别该组合键' };
  if (!parsed.ctrl && !parsed.alt && !parsed.meta) {
    return { ok: false, error: '快捷键必须包含 Ctrl / Alt / Meta 至少一个修饰键' };
  }
  return { ok: true };
}

let overrides = readOverrides();

function readOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const clean = {};
    for (const [id, spec] of Object.entries(parsed)) {
      if (!ACTIONS.has(id)) continue;
      const check = validateBinding(spec);
      if (check.ok) clean[id] = spec;
    }
    return clean;
  } catch {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch (error) {
    showNotice(`保存快捷键失败：${error.message}`, { error: true });
  }
}

export function getBinding(actionId) {
  return overrides[actionId] || ACTIONS.get(actionId)?.binding || '';
}

// 界面提示用：spaced 形态给 <kbd>（Ctrl + Alt + B），紧凑形态给状态栏文案。
export function bindingDisplay(actionId, { spaced = false } = {}) {
  const spec = getBinding(actionId);
  return spaced ? spec.replace(/\+/g, ' + ') : spec;
}

export function getAction(actionId) {
  return ACTIONS.get(actionId) || null;
}

export function isCustomized(actionId) {
  return Boolean(overrides[actionId]);
}

export function setBinding(actionId, spec) {
  const action = ACTIONS.get(actionId);
  if (!action) return { ok: false, error: '未知动作' };
  const check = validateBinding(spec);
  if (!check.ok) return check;
  const conflict = findConflict(spec, actionId);
  if (conflict) return { ok: false, error: `与「${conflict.label}」重复` };
  overrides = { ...overrides, [actionId]: spec };
  persist();
  return { ok: true };
}

export function resetBindings() {
  overrides = {};
  persist();
}

function bindingMatches(event, parsed) {
  if (event.code !== parsed.code) return false;
  if (event.ctrlKey !== parsed.ctrl) return false;
  if (event.altKey !== parsed.alt) return false;
  if (event.metaKey !== parsed.meta) return false;
  if (parsed.code.startsWith('Digit')) return event.shiftKey === parsed.shift;
  // 非数字键：Ctrl+Alt+X 同时接受 Shift 变体（输入法/桌面常只吞掉无 Shift 的形态）。
  if (parsed.shift) return event.shiftKey === true;
  return true;
}

function variantsFor(parsed) {
  const variants = [parsed];
  if (IS_MAC && parsed.ctrl && parsed.alt && !parsed.meta) {
    variants.push({ ...parsed, ctrl: false, meta: true });
  }
  return variants;
}

function specsFor(action) {
  const binding = getBinding(action.id);
  const specs = [binding, ...(action.legacy || [])];
  if (!binding) return [];
  return specs.filter(Boolean);
}

export function matchAction(event) {
  if (!event || event.isComposing || event.repeat) return null;
  // 无修饰键的按键不可能是全局快捷键：先短路，避免每次 j/k 都遍历整张表。
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
  for (const action of KEYMAP_ACTIONS) {
    for (const spec of specsFor(action)) {
      const parsed = parseBinding(spec);
      if (!parsed) continue;
      if (variantsFor(parsed).some((variant) => bindingMatches(event, variant))) return action.id;
    }
  }
  return null;
}

export function matchesAction(event, actionId) {
  const action = ACTIONS.get(actionId);
  if (!action) return false;
  return specsFor(action).some((spec) => {
    const parsed = parseBinding(spec);
    return parsed && variantsFor(parsed).some((variant) => bindingMatches(event, variant));
  });
}

export function findConflict(spec, excludeId = null) {
  const parsed = parseBinding(spec);
  if (!parsed) return null;
  for (const action of KEYMAP_ACTIONS) {
    if (action.id === excludeId) continue;
    for (const candidate of specsFor(action)) {
      const other = parseBinding(candidate);
      if (!other) continue;
      if (other.code !== parsed.code || other.ctrl !== parsed.ctrl
        || other.alt !== parsed.alt || other.meta !== parsed.meta) continue;
      // 数字键按 Shift 精确匹配（Ctrl+Alt+Shift+1 是工作区页签，不能与 Ctrl+Alt+1 混）；
      // 其它键在“无 Shift 绑定也接受 Shift 变体”的语义下会重叠。
      if (parsed.code.startsWith('Digit') && other.shift !== parsed.shift) continue;
      return action;
    }
  }
  return null;
}

// 供界面展示：主键位 + 自动备用键（Shift 变体 / macOS 的 ⌘+Option 变体）。
export function bindingVariants(actionId) {
  const action = ACTIONS.get(actionId);
  if (!action) return [];
  const parsed = parseBinding(getBinding(actionId));
  if (!parsed) return [];
  const variants = [];
  const base = [parsed.ctrl ? 'Ctrl' : '', parsed.alt ? 'Alt' : '', parsed.shift ? 'Shift' : '']
    .filter(Boolean).join('+');
  const key = keyForCode(parsed.code) || '';
  variants.push(`${base ? `${base}+` : ''}${key}`);
  if (!parsed.code.startsWith('Digit') && !parsed.shift) {
    const shifted = [parsed.ctrl ? 'Ctrl' : '', parsed.alt ? 'Alt' : '', 'Shift'].filter(Boolean).join('+');
    variants.push(`${shifted}+${key}`);
  }
  if (IS_MAC && parsed.ctrl && parsed.alt) {
    const mac = ['⌘', 'Option', parsed.shift ? 'Shift' : ''].filter(Boolean).join('+');
    variants.push(`${mac}+${key}`);
  }
  return variants;
}