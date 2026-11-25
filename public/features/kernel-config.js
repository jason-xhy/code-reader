// 内核 Kconfig 解析设置：架构 + defconfig 选择，触发服务端 make 解析。
// 交互与 llm-settings 相同：解析中禁用按钮与关闭、Esc 阻断、进度文案、错误进 .dialog-error。
import { api } from '../core/api.js';
import { elements } from '../core/dom.js';
import { state, noteFocusIntent } from '../core/state.js';

let resolving = false;
let defconfigMap = {};

function repositoryId() {
  return state.repository?.id || null;
}

function kconfigUrl(action = '') {
  const id = repositoryId();
  if (!id) return null;
  return `/api/repositories/${encodeURIComponent(id)}/kconfig${action}`;
}

function fillSelect(select, values, preferred) {
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  if (preferred && values.includes(preferred)) select.value = preferred;
  else if (values.length) select.value = values[0];
}

// defconfig 列表已随打开时一次拉回（GET /kconfig 的 defconfigs 按架构分组），
// 切架构本地联动即可，不重复请求。
function fillDefconfigs(arch, preferred) {
  const values = defconfigMap[arch] || [];
  fillSelect(elements.kernelDefconfig, values, preferred);
  elements.kernelDefconfig.disabled = !values.length;
}

export function updateSettingsKernelStatus(text) {
  elements.settingsKernelStatus.textContent = text;
}

// 仓库打开/切换后刷新设置菜单里的状态行；失败静默（状态行显示不可用）。
export async function refreshKernelStatus() {
  const url = kconfigUrl();
  if (!url) {
    updateSettingsKernelStatus('未打开仓库');
    return null;
  }
  const id = repositoryId();
  try {
    const data = await api(url);
    if (repositoryId() !== id) return data;
    defconfigMap = data.defconfigs || {};
    const current = data.current;
    updateSettingsKernelStatus(current
      ? `${current.arch}/${current.defconfig}${current.stale ? ' · 需重新解析' : ''} · ${current.valuesCount} 项`
      : '未解析（选择架构与 defconfig）');
    return data;
  } catch {
    if (repositoryId() === id) updateSettingsKernelStatus('内核配置不可用');
    return null;
  }
}

function render(data) {
  defconfigMap = data.defconfigs || {};
  const arches = data.arches || [];
  const current = data.current;
  fillSelect(elements.kernelArch, arches, current?.arch);
  elements.kernelArch.disabled = !arches.length;
  fillDefconfigs(elements.kernelArch.value, current?.defconfig);
  elements.kernelError.textContent = current?.stale ? '仓库 HEAD 已变化，建议重新解析。' : '';
  if (!arches.length) elements.kernelError.textContent = '当前仓库不是内核源码树（arch/ 下没有架构）。';
}

export async function openKernelConfigDialog() {
  const url = kconfigUrl();
  if (!url) return;
  const id = repositoryId();
  elements.kernelError.textContent = '';
  elements.kernelProgress.textContent = '';
  noteFocusIntent();
  if (!elements.kernelDialog.open) elements.kernelDialog.showModal();
  try {
    const data = await api(url);
    if (repositoryId() !== id) return;
    render(data);
  } catch (error) {
    elements.kernelError.textContent = error.message;
  }
}

async function resolve(event) {
  event.preventDefault();
  if (resolving) return;
  const id = repositoryId();
  const arch = elements.kernelArch.value;
  const defconfig = elements.kernelDefconfig.value;
  if (!id || !arch || !defconfig) {
    elements.kernelError.textContent = '请选择架构与 defconfig';
    return;
  }
  resolving = true;
  elements.kernelResolve.disabled = true;
  elements.kernelClose.disabled = true;
  elements.kernelError.textContent = '';
  elements.kernelProgress.textContent = '正在解析（首次会构建 Kconfig 工具，可能需要 10-30 秒）…';
  try {
    const data = await api(kconfigUrl('/resolve'), {
      method: 'POST',
      body: JSON.stringify({ arch, defconfig }),
    });
    if (repositoryId() !== id) return;
    const warnings = (data.warnings || []).join('；');
    elements.kernelProgress.textContent = `已解析 ${data.valuesCount} 项 · ${arch}/${defconfig}`
      + (warnings ? `（${warnings}）` : '');
    updateSettingsKernelStatus(`${arch}/${defconfig} · ${data.valuesCount} 项`);
  } catch (error) {
    elements.kernelError.textContent = error.message;
    elements.kernelProgress.textContent = '';
  } finally {
    resolving = false;
    elements.kernelResolve.disabled = false;
    elements.kernelClose.disabled = false;
  }
}

export function initKernelConfig() {
  elements.kernelArch.addEventListener('change', () => fillDefconfigs(elements.kernelArch.value, null));
  elements.kernelForm.addEventListener('submit', resolve);
  elements.kernelClose.addEventListener('click', () => {
    if (!resolving) elements.kernelDialog.close();
  });
  elements.kernelDialog.addEventListener('cancel', (event) => {
    if (resolving) event.preventDefault();
  });
}
