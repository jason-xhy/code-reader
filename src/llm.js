import { AppError } from './errors.js';
import { resolveLlmConfig } from './llm-config.js';

export { llmStatus, saveLlmConfig } from './llm-config.js';

const MAX_QUESTION_LENGTH = 4000;
const CONTEXT_RADIUS = 70;
const MAX_CONTEXT_CHARS = 32_000;

const SYSTEM_PROMPT = `你是一名严谨的代码分析助手。根据用户给出的源码、行号和问题，用中文解释代码。
输出必须且只能是一个 JSON 对象，不要使用 Markdown 代码围栏，结构如下：
{
  "overview": "先概括这段代码的目的以及当前行的作用",
  "details": ["逐点分析，每点解释一个关键机制、数据流或约束"],
  "summary": "最后总结读者应记住的核心结论",
  "specifications": [
    {"name": "规范名称", "version": "能确认的版本，否则空字符串", "section": "章节或条款，无法确认则写未核实", "relevance": "规范与代码行为的对应关系", "verified": false}
  ]
}
必须遵循总—分—总结构，details 至少两项。只依据给定源码作事实判断，不确定之处明确说明。
若涉及硬件协议、总线、寄存器或时序，必须结合相应官方规范解释，并在 specifications 中列出规范名称、可确认版本/章节以及与代码的对应关系。严禁编造规范号、版本、章节或原文；无法核实时将 section 写为“未核实”并将 verified 设为 false。非硬件协议问题返回空 specifications 数组。`;

function contextFor(source, line) {
  const lines = source.content.split('\n');
  const start = Math.max(1, line - CONTEXT_RADIUS);
  const end = Math.min(lines.length, line + CONTEXT_RADIUS);
  let selected = lines.slice(start - 1, end)
    .map((text, index) => `${String(start + index).padStart(6, ' ')} | ${text}`)
    .join('\n');
  if (selected.length > MAX_CONTEXT_CHARS) {
    const half = Math.floor(MAX_CONTEXT_CHARS / 2);
    const current = lines[line - 1] || '';
    selected = `${selected.slice(0, half)}\n...\n${String(line).padStart(6, ' ')} | ${current}\n...\n${selected.slice(-half)}`;
  }
  return { start, end, text: selected };
}

function parseExplanation(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new AppError('LLM 返回的内容不是有效 JSON，请重试', 502, 'INVALID_LLM_RESPONSE');
  }
  if (!value || typeof value.overview !== 'string' || !Array.isArray(value.details) || typeof value.summary !== 'string' || !Array.isArray(value.specifications)) {
    throw new AppError('LLM 返回结构不完整，请重试', 502, 'INVALID_LLM_RESPONSE');
  }
  const details = value.details.filter((item) => typeof item === 'string' && item.trim()).slice(0, 12);
  if (details.length < 2) throw new AppError('LLM 未按总—分—总结构回答，请重试', 502, 'INVALID_LLM_RESPONSE');
  const specifications = value.specifications.slice(0, 8).map((spec) => ({
    name: typeof spec?.name === 'string' ? spec.name : '未命名规范',
    version: typeof spec?.version === 'string' ? spec.version : '',
    section: typeof spec?.section === 'string' && spec.section ? spec.section : '未核实',
    relevance: typeof spec?.relevance === 'string' ? spec.relevance : '',
    verified: spec?.verified === true,
  }));
  return {
    overview: value.overview,
    details,
    summary: value.summary,
    specifications,
  };
}

export async function explainSource(source, filePath, line, question) {
  if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_LENGTH) {
    throw new AppError(`问题不能为空且不能超过 ${MAX_QUESTION_LENGTH} 字`, 400, 'INVALID_QUESTION');
  }
  const config = await resolveLlmConfig();
  if (!config.configured) {
    throw new AppError('LLM 未配置，请点击左下角“LLM 设置”选择模型并保存 API Key', 503, 'LLM_NOT_CONFIGURED');
  }
  const context = contextFor(source, line);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              file: filePath,
              currentLine: line,
              question: question.trim(),
              sourceContext: context.text,
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'LLM 请求超时' : `无法连接 LLM：${error.message}`;
    throw new AppError(message, 502, 'LLM_NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new AppError(`LLM 服务返回 HTTP ${response.status}：${body.slice(0, 500)}`, 502, 'LLM_HTTP_ERROR');
  }
  let completion;
  try {
    completion = JSON.parse(body);
  } catch {
    throw new AppError('LLM 服务响应不是有效 JSON', 502, 'INVALID_LLM_RESPONSE');
  }
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new AppError('LLM 服务响应缺少 choices[0].message.content', 502, 'INVALID_LLM_RESPONSE');
  }
  return {
    explanation: parseExplanation(content),
    context: { start: context.start, end: context.end },
    model: config.model,
  };
}
