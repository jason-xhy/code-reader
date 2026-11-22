import { modelFetch as fetch } from './http/model-fetch.js';
// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 与 code-reader 的配置字段与协议实现强绑定
// grill: 成品检索=skill 库无该应用 LLM 配置成品; 输入固定=固定表单字段与固定 API 路径; 步骤机械=按 openai/anthropic 协议分支; 判读固定=按 HTTP 状态与响应结构判定; 失效场景=构造不出（仅本应用）
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';
import { readApiKey, storeApiKey } from './keychain.js';
import { dataPath } from './paths.js';
import { chatgptStatus } from './chatgpt.js';

import { LLM_PROVIDERS } from './llm/providers.js';
export { LLM_PROVIDERS };

const configPath = dataPath('llm-config.json');

function normalizeProtocol(value) {
  return value === 'anthropic' ? 'anthropic' : 'openai';
}

export function anthropicMessagesUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/messages')) return trimmed;
  return trimmed.endsWith('/v1') ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
}

let selection = { provider: 'kimi', model: 'kimi-k3.1-pro', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai' };

try {
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  if (getProvider(saved.provider) && typeof saved.model === 'string' && typeof saved.baseUrl === 'string') {
    selection = {
      provider: saved.provider,
      model: saved.model,
      baseUrl: saved.baseUrl,
      protocol: saved.provider === 'custom' ? normalizeProtocol(saved.protocol) : 'openai',
    };
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

async function validateApiKey(baseUrl, apiKey, protocol, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = protocol === 'anthropic'
      ? await fetch(anthropicMessagesUrl(baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 16,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: controller.signal,
        })
      : await fetch(`${baseUrl}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
    if (response.status === 401 || response.status === 403) {
      throw new AppError(`API Key 验证失败（HTTP ${response.status}），请检查 Key 是否正确`, 400, 'API_KEY_INVALID');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AppError(
        `模型服务返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}，无法确认 Key 有效，配置未保存`,
        502,
        'API_VALIDATE_FAILED',
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error.name === 'AbortError') throw new AppError('验证 API Key 超时（20 秒），请检查网络后重试', 504, 'API_VALIDATE_TIMEOUT');
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
  if (provider.id === 'chatgpt') {
    const login = await chatgptStatus();
    return { provider: provider.id, providerName: provider.name, model: selection.model, baseUrl: provider.baseUrl,
      protocol: 'chatgpt', configured: login.available, keyStored: false, keySource: 'chatgpt', environmentOverride: false, loginMessage: login.message };
  }
  const environmentOverride = Boolean(process.env.LLM_API_KEY || process.env.LLM_MODEL || process.env.LLM_BASE_URL);
  const model = process.env.LLM_MODEL || selection.model;
  const baseUrl = process.env.LLM_BASE_URL || (process.env.LLM_MODEL ? 'https://api.openai.com/v1' : selection.baseUrl);
  const protocol = normalizeProtocol(process.env.LLM_PROTOCOL || (provider.id === 'custom' ? selection.protocol : 'openai'));
  const storedKey = process.env.LLM_API_KEY ? null : await readApiKey(selection.provider);
  const apiKey = process.env.LLM_API_KEY || storedKey;
  return {
    provider: provider.id,
    providerName: provider.name,
    model,
    baseUrl,
    protocol,
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
    protocol: config.protocol,
    keyStored: config.keyStored,
    keySource: config.keySource,
    environmentOverride: config.environmentOverride,
    loginMessage: config.loginMessage,
    providers: LLM_PROVIDERS,
  };
}

export async function saveLlmConfig(body) {
  const provider = getProvider(body.provider);
  if (!provider) throw new AppError('未知的模型厂商', 400, 'INVALID_PROVIDER');
  const model = validateModel(body.model);
  const baseUrl = provider.id === 'custom' ? validateBaseUrl(body.baseUrl) : provider.baseUrl;
  const protocol = provider.id === 'custom' ? normalizeProtocol(body.protocol) : 'openai';
  if (provider.id === 'chatgpt') {
    const login = await chatgptStatus();
    if (!login.available) throw new AppError(login.message, 400, 'CHATGPT_NOT_LOGGED_IN');
  } else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    const apiKey = body.apiKey.trim();
    await validateApiKey(baseUrl, apiKey, protocol, model);
    await storeApiKey(provider.id, apiKey);
  }
  if (provider.id !== 'chatgpt' && !body.apiKey?.trim() && !process.env.LLM_API_KEY && !await readApiKey(provider.id)) {
    throw new AppError('当前厂商尚未配置 API Key，请输入 Key 后保存；ChatGPT 登录可选择 ChatGPT 厂商', 400, 'LLM_NOT_CONFIGURED');
  }
  selection = { provider: provider.id, model, baseUrl, protocol };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(selection, null, 2)}\n`, { mode: 0o600 });
  return llmStatus();
}
