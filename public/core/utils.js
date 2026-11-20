// 通用工具：与业务无关的纯函数/调度辅助。
export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function relativeTime(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function menuButtons(menu) {
  return [...menu.querySelectorAll('button:not(:disabled)')];
}

export function focusFirstMenuItem(menu) {
  menuButtons(menu)[0]?.focus();
}

export const scheduleIdle = typeof window.requestIdleCallback === 'function'
  ? (callback) => window.requestIdleCallback(callback, { timeout: 1500 })
  : (callback) => setTimeout(callback, 120);

export function debounce(callback, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}