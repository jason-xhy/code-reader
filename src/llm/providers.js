// Model/provider catalog is configuration data, without transport or secrets.
export const LLM_PROVIDERS = [
  { id: 'chatgpt', name: 'ChatGPT（本机 Codex 登录）', baseUrl: 'codex://chatgpt', models: [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  ] },
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
      { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' },
      { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra' },
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
      { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
      { id: 'gpt-6-sol', name: 'GPT-6 Sol' },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini' },
      { id: 'gpt-5.4-nano', name: 'GPT-5.4 nano' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
      { id: 'o3', name: 'o3' },
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
    id: 'custom', name: '自定义兼容服务', baseUrl: '', models: [],
  },
];
