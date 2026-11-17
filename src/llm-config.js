import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { readApiKey, storeApiKey } from './keychain.js';

export const LLM_PROVIDERS = [
  {
    id: 'kimi', name: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro' },
      { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro Highspeed' },
      { id: 'kimi-k3', name: 'Kimi K3' },
    ],
  },
  {
    id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini' },
    ],
  },
  {
    id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    ],
  },
  {
    id: 'google', name: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
    ],
  },
  {
    id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
    ],
  },
  {
    id: 'qwen', name: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen4-max', name: 'Qwen4 Max' },
      { id: 'qwen3.8-max', name: 'Qwen3.8 Max' },
      { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash' },
    ],
  },
  {
    id: 'glm', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'glm-5.1', name: 'GLM-5.1' },
    ],
  },
  {
    id: 'custom', name: '自定义 OpenAI 兼容服务', baseUrl: '', models: [],
  },
];

const configPath = fileURLToPath(new URL('../.data/llm-config.json', import.meta.url));
let selection = { provider: 'kimi', model: 'kimi-k3.1-pro', baseUrl: LLM_PROVIDERS[0].baseUrl };

try {
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  if (getProvider(saved.provider) && typeof saved.model === 'string' && typeof saved.baseUrl === 'string') {
    selection = { provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl };
  }
} catch {
}

function getProvider(id) {
  return LLM_PROVIDERS.find((provider) => provider.id === id);
}

function validateModel(model) {
  if (typeof model !== 'string' || !model.trim() || model.length > 200 || /[\s\0]/.test(model)) {
    throw new AppError('模型 ID 不能为空、不能包含空白且不能超过 200 字符', 400, 'INVALID_MODEL');
  }
  return model.trim();
}

async function validateApiKey(baseUrl, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new AppError(`API Key 验证失败（HTTP ${response.status}），请检查 Key 是否正确`, 400, 'API_KEY_INVALID');
    }
    if (!response.ok) {
      throw new AppError(`模型服务返回 HTTP ${response.status}，无法确认 Key 有效，配置未保存`, 502, 'API_VALIDATE_FAILED');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error.name === 'AbortError') throw new AppError('验证 API Key 超时（12 秒），请检查网络后重试', 504, 'API_VALIDATE_TIMEOUT');
    throw new AppError(`无法连接模型服务：${error.message}`, 502, 'API_VALIDATE_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

function validateBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError('API 地址无效', 400, 'INVALID_BASE_URL');
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppError('API 地址仅允许 HTTPS，或本机回环地址的 HTTP', 400, 'INVALID_BASE_URL');
  }
  return value.replace(/\/+$/, '');
}

export async function resolveLlmConfig() {
  const provider = getProvider(selection.provider) || LLM_PROVIDERS[0];
  const environmentOverride = Boolean(process.env.LLM_API_KEY || process.env.LLM_MODEL || process.env.LLM_BASE_URL);
  const model = process.env.LLM_MODEL || selection.model;
  const baseUrl = process.env.LLM_BASE_URL || (process.env.LLM_MODEL ? 'https://api.openai.com/v1' : selection.baseUrl);
  const storedKey = process.env.LLM_API_KEY ? null : await readApiKey(selection.provider);
  const apiKey = process.env.LLM_API_KEY || storedKey;
  return {
    provider: provider.id,
    providerName: provider.name,
    model,
    baseUrl,
    apiKey,
    configured: Boolean(apiKey && model && baseUrl),
    keyStored: Boolean(storedKey),
    keySource: process.env.LLM_API_KEY ? 'environment' : storedKey ? 'keychain' : 'none',
    environmentOverride,
  };
}

export async function llmStatus() {
  const config = await resolveLlmConfig();
  return {
    configured: config.configured,
    provider: config.provider,
    providerName: config.providerName,
    model: config.model,
    baseUrl: config.baseUrl,
    keyStored: config.keyStored,
    keySource: config.keySource,
    environmentOverride: config.environmentOverride,
    providers: LLM_PROVIDERS,
  };
}

export async function saveLlmConfig(body) {
  const provider = getProvider(body.provider);
  if (!provider) throw new AppError('未知的模型厂商', 400, 'INVALID_PROVIDER');
  const model = validateModel(body.model);
  const baseUrl = provider.id === 'custom' ? validateBaseUrl(body.baseUrl) : provider.baseUrl;
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    const apiKey = body.apiKey.trim();
    await validateApiKey(baseUrl, apiKey);
    await storeApiKey(provider.id, apiKey);
  }
  selection = { provider: provider.id, model, baseUrl };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(selection, null, 2)}\n`, { mode: 0o600 });
  return llmStatus();
}
