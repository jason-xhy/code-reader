import { AppError } from '../errors.js';
import { readApiKey } from '../keychain.js';
import { modelFetch as fetch } from '../http/model-fetch.js';
import { LLM_PROVIDERS } from './providers.js';
import { MODEL_LIST_TIMEOUT_MS, supportsOpenaiChatModel } from '../policies/llm.js';

// OpenAI's account-scoped list is the authority for models available to this key.
export async function availableOpenaiModels() {
  const apiKey = await readApiKey('openai');
  if (!apiKey) throw new AppError('请先保存 OpenAI API Key，再刷新可用模型', 400, 'LLM_NOT_CONFIGURED');
  let response;
  try { response = await fetch(`${LLM_PROVIDERS.find((provider) => provider.id === 'openai').baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
  }); } catch { throw new AppError('无法连接 OpenAI，请检查网络或代理后重试', 502, 'MODEL_LIST_FAILED'); }
  if (!response.ok) throw new AppError(`获取 OpenAI 模型失败（HTTP ${response.status}）`, 502, 'MODEL_LIST_FAILED');
  const body = await response.json();
  const models = (Array.isArray(body.data) ? body.data : [])
    .filter((item) => supportsOpenaiChatModel(item.id))
    .map((item) => ({ id: item.id, name: item.id }))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  return { models };
}
