// one-shot: code-reader 前端页面源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 与 code-reader 的 DOM 结构强绑定
// grill: 成品检索=skill 库无该页面设置模块成品; 输入固定=固定表单元素与 /api/config 响应; 步骤机械=渲染厂商/协议字段并提交; 判读固定=按响应 llm 对象回填; 失效场景=构造不出（仅本应用）
import { noteFocusIntent } from './core/state.js';

export function createLlmSettings({ api, onStatus }) {
  const elements = {
    dialog: document.querySelector('#llm-dialog'),
    close: document.querySelector('#llm-dialog-close'),
    form: document.querySelector('#llm-form'),
    provider: document.querySelector('#llm-provider'),
    model: document.querySelector('#llm-model'),
    customModel: document.querySelector('#llm-custom-model'),
    baseUrl: document.querySelector('#llm-base-url'),
    apiKey: document.querySelector('#llm-api-key'),
    keyHelp: document.querySelector('#llm-key-help'),
    envWarning: document.querySelector('#llm-env-warning'),
    error: document.querySelector('#llm-error'),
    progress: document.querySelector('#llm-save-progress'),
    protocol: document.querySelector('#llm-protocol'),
    protocolField: document.querySelector('#llm-protocol-field'),
    save: document.querySelector('#llm-save'),
  };
  let config = null;
  let saving = false;

  function provider() {
    return config?.providers.find((item) => item.id === elements.provider.value);
  }

  function updateModelField() {
    const custom = elements.model.value === '__custom';
    elements.customModel.hidden = !custom;
    elements.customModel.required = custom;
    elements.model.hidden = false;
    if (custom) elements.customModel.focus();
  }

  function renderModels(preferredModel) {
    const currentProvider = provider();
    elements.model.replaceChildren();
    for (const model of currentProvider?.models || []) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      elements.model.append(option);
    }
    const custom = document.createElement('option');
    custom.value = '__custom';
    custom.textContent = '自定义模型 ID…';
    elements.model.append(custom);
    const preset = currentProvider?.models.some((model) => model.id === preferredModel);
    elements.model.value = preset ? preferredModel : currentProvider?.models.length && !preferredModel ? currentProvider.models[0].id : '__custom';
    elements.customModel.value = elements.model.value === '__custom' && preferredModel ? preferredModel : '';
    updateModelField();
  }

  function renderProvider(preferredModel) {
    const currentProvider = provider();
    const isCustom = currentProvider?.id === 'custom';
    elements.baseUrl.value = isCustom ? config.baseUrl : currentProvider?.baseUrl || '';
    elements.baseUrl.readOnly = !isCustom;
    elements.protocolField.hidden = !isCustom;
    elements.protocol.disabled = !isCustom;
    elements.protocol.value = isCustom ? (config.protocol === 'anthropic' ? 'anthropic' : 'openai') : 'openai';
    renderModels(preferredModel);
    elements.apiKey.value = '';
    elements.keyHelp.textContent = '保存前会用该 Key 请求模型服务验证连通性；留空则保留钥匙串中已有 Key。';
  }

  function render() {
    elements.provider.replaceChildren();
    for (const provider of config.providers) {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.name;
      elements.provider.append(option);
    }
    elements.provider.value = config.provider;
    renderProvider(config.model);
    elements.envWarning.hidden = !config.environmentOverride;
    if (config.keyStored) {
      elements.keyHelp.textContent = '当前厂商的 Key 已保存在钥匙串；留空保持不变，输入新 Key 则更新。';
    } else if (config.keySource === 'environment') {
      elements.keyHelp.textContent = '当前使用环境变量中的 API Key；在页面保存 Key 后仍由环境变量优先。';
    }
  }

  async function load() {
    try {
      const data = await api('/api/config');
      config = data.llm;
      onStatus(config);
      return config;
    } catch (error) {
      onStatus({ configured: false, model: '', error: error.message });
      throw error;
    }
  }

  async function open() {
    elements.error.textContent = '';
    try {
      await load();
      render();
      noteFocusIntent();
      if (!elements.dialog.open) elements.dialog.showModal();
    } catch (error) {
      elements.error.textContent = error.message;
      noteFocusIntent();
      if (!elements.dialog.open) elements.dialog.showModal();
    }
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const model = elements.model.value === '__custom' ? elements.customModel.value.trim() : elements.model.value;
    if (!model) {
      elements.error.textContent = '请选择或输入模型 ID';
      return;
    }
    saving = true;
    elements.save.disabled = true;
    elements.close.disabled = true;
    elements.error.textContent = '';
    elements.progress.textContent = '正在验证 Key 并保存到钥匙串…';
    try {
      const data = await api('/api/llm/config', {
        method: 'POST',
        body: JSON.stringify({
          provider: elements.provider.value,
          model,
          protocol: elements.protocol.value,
          baseUrl: elements.baseUrl.value.trim(),
          apiKey: elements.apiKey.value,
        }),
      });
      config = data.llm;
      onStatus(config);
      elements.apiKey.value = '';
      elements.dialog.close();
    } catch (error) {
      elements.error.textContent = error.message;
    } finally {
      saving = false;
      elements.save.disabled = false;
      elements.close.disabled = false;
      elements.progress.textContent = '';
    }
  }

  elements.provider.addEventListener('change', () => renderProvider(''));
  elements.model.addEventListener('change', updateModelField);
  elements.form.addEventListener('submit', save);
  elements.close.addEventListener('click', () => { if (!saving) elements.dialog.close(); });
  elements.dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });

  return { load, open };
}
