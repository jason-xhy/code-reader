// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 与 code-reader 的 LLM 调用实现强绑定
// grill: 成品检索=skill 库无该应用 LLM 调用成品; 输入固定=固化的源码上下文与问题 JSON; 步骤机械=按 protocol 组装请求并解析; 判读固定=按 choices/content 结构解析; 失效场景=构造不出（仅本应用）
import { AppError } from './errors.js';
import { anthropicMessagesUrl, resolveLlmConfig } from './llm-config.js';
import { searchDocumentation } from './docs.js';
import { searchWeb } from './websearch.js';
import { buildUnderstandingContext } from './understanding.js';
import { parseAnimation, wantsAnimation } from './animation.js';

export { llmStatus, saveLlmConfig } from './llm-config.js';

const MAX_QUESTION_LENGTH = 4000;
const MAX_CONTEXT_CHARS = 42_000;
const MAX_DIAGNOSTIC_BYTES = 200 * 1024;
const ANTHROPIC_MAX_TOKENS = 8192;
const SPEC_HINT_RE = /规范|协议|手册|文档|章节|寄存器|时序|spec|specification|register|protocol|manual|datasheet|errata/i;

function truncateDiagnostic(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= MAX_DIAGNOSTIC_BYTES) return text;
  return `${text.slice(0, MAX_DIAGNOSTIC_BYTES)}\n…（已截断，共 ${text.length} 字符）`;
}

const SYSTEM_PROMPT = `你是一名严谨的代码分析助手。根据用户给出的源码、行号、相关定义和问题，用中文解释代码。
输出必须且只能是一个 JSON 对象，不要使用 Markdown 代码围栏，结构如下：
{
  "overview": "先概括当前函数或代码段的目的以及当前行的作用",
  "details": ["逐点分析，每点解释一个关键机制、数据流或约束"],
  "summary": "最后总结读者应记住的核心结论",
  "evidence": [
    {"claim": "需要证据支持的结论", "kind": "code|documentation|inference", "file": "代码仓库相对路径，非代码证据留空", "lineStart": 1, "lineEnd": 1, "source": "文档来源，代码证据留空", "section": "文档章节或空字符串", "page": 0, "excerpt": "文档原文片段或空字符串"}
  ],
  "nextSteps": [{"file": "仓库相对路径", "line": 1, "reason": "为什么建议接着读这里"}],
  "specifications": [
    {"name": "规范名称", "version": "能确认的版本，否则空字符串", "section": "章节或条款，无法确认则写未核实", "source": "实际检索到的来源文件，否则空字符串", "relevance": "规范与代码行为的对应关系", "verified": false}
  ],
  "animation": null
}
必须遵循总—分—总结构，details 至少两项。只依据给定源码作事实判断，不确定之处明确说明。evidence 中的代码位置必须来自输入实际提供的文件和行号；推断必须使用 kind=inference，不能伪装成事实。nextSteps 最多三项，只能推荐输入中实际出现的代码位置。
如果输入提供了 localDocumentation，它来自用户指定的本地文档/规范目录，应优先依据其内容回答，并在 evidence 或 specifications 中标注来源文件、章节和页码（若有）；不得把片段内容改写成未提供的官方原文。
如果输入提供了 webSearch，它是网络检索结果，可能不准确或过时，必须在正文中标注“网络检索未核验”，禁止把未核验内容当作官方规范原文。
若涉及硬件协议、总线、寄存器或时序，必须结合相应官方规范解释，并在 specifications 中列出规范名称、可确认版本/章节以及与代码的对应关系。严禁编造规范号、版本、章节或原文；无法核实时将 section 写为“未核实”并将 verified 设为 false。非硬件协议问题返回空 specifications 数组。
只有当用户明确要求动画、三维或 3D 演示时，才把 animation 从 null 替换为以下结构；否则必须保持 null：
{
  "title": "演示标题", "summary": "演示范围与限制",
  "nodes": [{"id": "简短英文标识", "label": "节点名称", "kind": "code|data|spec|decision|output", "description": "节点职责"}],
  "steps": [{"title": "步骤名称", "detail": "代码如何执行以及对应规范约束", "node": "当前节点 id", "from": "可选起点节点 id", "to": "可选终点节点 id", "file": "仓库相对路径", "lineStart": 1, "lineEnd": 1, "spec": "对应规范章节或空字符串"}]
}
动画用于解释真实执行顺序，nodes 最多 8 个，steps 2 至 16 个；每个步骤必须能由输入代码或文档支持，不得生成 HTML、JavaScript、任意场景代码或虚构执行步骤。`;

function contextFor(understanding) {
  if (understanding.text.length <= MAX_CONTEXT_CHARS) return understanding;
  return {
    ...understanding,
    text: `${understanding.text.slice(0, MAX_CONTEXT_CHARS)}\n... 总上下文达到长度限制 ...`,
  };
}

function extractJsonObject(raw) {
  let text = String(raw || '').replace(/^\uFEFF/, '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          try {
            return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function optionalLine(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((item) => ({
    claim: typeof item?.claim === 'string' ? item.claim.trim().slice(0, 1200) : '',
    kind: ['code', 'documentation', 'inference'].includes(item?.kind) ? item.kind : 'inference',
    file: typeof item?.file === 'string' ? item.file.trim().slice(0, 300) : '',
    lineStart: optionalLine(item?.lineStart),
    lineEnd: optionalLine(item?.lineEnd),
    source: typeof item?.source === 'string' ? item.source.trim().slice(0, 500) : '',
    section: typeof item?.section === 'string' ? item.section.trim().slice(0, 300) : '',
    page: optionalLine(item?.page),
    excerpt: typeof item?.excerpt === 'string' ? item.excerpt.trim().slice(0, 1600) : '',
  })).filter((item) => item.claim);
}

function parseNextSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((item) => ({
    file: typeof item?.file === 'string' ? item.file.trim().slice(0, 300) : '',
    line: optionalLine(item?.line),
    reason: typeof item?.reason === 'string' ? item.reason.trim().slice(0, 500) : '',
  })).filter((item) => item.file && item.line && item.reason);
}

function parseExplanation(raw, animationRequested = false) {
  const value = extractJsonObject(raw);
  if (!value) {
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
    source: typeof spec?.source === 'string' ? spec.source.trim().slice(0, 500) : '',
    relevance: typeof spec?.relevance === 'string' ? spec.relevance : '',
    verified: false,
  }));
  return {
    overview: value.overview,
    details,
    summary: value.summary,
    evidence: parseEvidence(value.evidence),
    nextSteps: parseNextSteps(value.nextSteps),
    specifications,
animation: animationRequested ? parseAnimation(value.animation) : null,
  };
}

function anthropicText(completion) {
  const parts = Array.isArray(completion?.content) ? completion.content : [];
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function anthropicResponseInfo(completion) {
  const parts = Array.isArray(completion?.content) ? completion.content : [];
  return {
    stopReason: typeof completion?.stop_reason === 'string' ? completion.stop_reason : null,
    blockTypes: [...new Set(parts.map((part) => (typeof part?.type === 'string' ? part.type : 'unknown')))],
    thinkingChars: parts.reduce((total, part) => (
      part?.type === 'thinking' && typeof part.thinking === 'string' ? total + part.thinking.length : total
    ), 0),
  };
}

async function requestCompletion(config, messages, systemPrompt = SYSTEM_PROMPT) {
  const anthropic = config.protocol === 'anthropic';
  const url = anthropic ? anthropicMessagesUrl(config.baseUrl) : `${config.baseUrl}/chat/completions`;
  const requestBody = anthropic
    ? {
        model: config.model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        // 推理模型的 thinking token 也计入 max_tokens；复杂源码会让模型在思考阶段
        // 耗尽预算而完全不产生 text 内容块。结构化 JSON 输出不需要对外暴露思考过程。
        thinking: { type: 'disabled' },
        system: systemPrompt,
        messages,
      }
    : {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      };
  const request = {
    url,
    protocol: anthropic ? 'anthropic' : 'openai',
    model: config.model,
    body: truncateDiagnostic(requestBody),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: anthropic
        ? {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          }
        : {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error.name === 'AbortError' ? 'LLM 请求超时' : `无法连接 LLM：${error.message}`;
    throw new AppError(message, 502, 'LLM_NETWORK_ERROR', { request, error: message });
  } finally {
    clearTimeout(timer);
  }

  const rawBody = await response.text();
  const responseInfo = { status: response.status, body: truncateDiagnostic(rawBody) };
  if (!response.ok) {
    throw new AppError(`LLM 服务返回 HTTP ${response.status}：${rawBody.slice(0, 500)}`, 502, 'LLM_HTTP_ERROR', { request, response: responseInfo });
  }
  let completion;
  try {
    completion = JSON.parse(rawBody);
  } catch {
    throw new AppError('LLM 服务响应不是有效 JSON', 502, 'INVALID_LLM_RESPONSE', { request, response: responseInfo });
  }
  const content = anthropic
    ? anthropicText(completion) || completion?.choices?.[0]?.message?.content
    : completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || (anthropic && !content.trim())) {
    let message = anthropic ? 'LLM 服务响应缺少 content[].text' : 'LLM 服务响应缺少 choices[0].message.content';
    if (anthropic) {
      const info = anthropicResponseInfo(completion);
      if (info.stopReason === 'max_tokens') {
        message = `LLM 输出达到 max_tokens=${ANTHROPIC_MAX_TOKENS}，回答在 thinking 阶段被截断，未生成最终文本；请重试或换用非推理模型`;
      } else if (info.thinkingChars > 0) {
        message = `LLM 只返回了 thinking 内容块（${info.thinkingChars} 字符），没有最终 text 内容块；请关闭 thinking 或换用非推理模型`;
      } else if (info.blockTypes.length) {
        message = `LLM 服务响应没有 text 内容块（实际内容块：${info.blockTypes.join(', ')}）`;
      }
      throw new AppError(message, 502, 'INVALID_LLM_RESPONSE', {
        request,
        response: responseInfo,
        stopReason: info.stopReason,
        blockTypes: info.blockTypes,
      });
    }
    throw new AppError(message, 502, 'INVALID_LLM_RESPONSE', { request, response: responseInfo });
  }
  return { content, diagnostics: { request, response: responseInfo } };
}

export async function explainSource(source, filePath, line, question, options = {}) {
  if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_LENGTH) {
    throw new AppError(`问题不能为空且不能超过 ${MAX_QUESTION_LENGTH} 字`, 400, 'INVALID_QUESTION');
  }
  const config = await resolveLlmConfig();
  if (!config.configured) {
    throw new AppError('LLM 未配置，请点击左下角“LLM 设置”选择模型并保存 API Key', 503, 'LLM_NOT_CONFIGURED');
  }
const animationRequested = options.animate === true || wantsAnimation(question);
  const systemPrompt = SYSTEM_PROMPT;
  const context = contextFor(await buildUnderstandingContext({
    repositoryRoot: options.repositoryRoot,
    filePath,
    source,
    line,
  }));
  const currentLine = (source.content.split('\n')[line - 1] || '').slice(0, 400);
  let documentation = { hits: [], config: { webEnabled: false }, stats: { files: 0, chunks: 0 } };
  try {
    documentation = await searchDocumentation({
      repositoryRoot: options.repositoryRoot,
      query: [question, filePath, context.scope.symbol, context.queryText, currentLine, currentLine.replace(/_+/g, ' ')].join(' '),
    });
  } catch (error) {
    console.error('[llm] 本地文档检索失败：', error?.message || error);
  }
  let webSearch = null;
  const specRelated = SPEC_HINT_RE.test(question) || SPEC_HINT_RE.test(filePath);
  if (!documentation.hits.length && documentation.config?.webEnabled && specRelated) {
    try {
      webSearch = await searchWeb(question);
    } catch (error) {
      webSearch = { query: question, results: [], error: error?.message || '网络检索失败' };
    }
  }
  const localDocumentation = documentation.hits.map((hit) => ({
    source: hit.source,
    section: hit.section || '',
    page: hit.page || null,
    excerpt: hit.text,
  }));
  const webResults = webSearch && Array.isArray(webSearch.results)
    ? webSearch.results.slice(0, 5).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        text: result.text ? result.text.slice(0, 3000) : '',
      }))
    : [];
  const userContent = JSON.stringify({
    file: filePath,
    currentLine: line,
    question: question.trim(),
    animationRequested,
    sourceContext: context.text,
    relatedDefinitions: context.relatedDefinitions,
    ...(localDocumentation.length ? { localDocumentation } : {}),
    ...(webResults.length ? { webSearch: webResults } : {}),
  });
  const messages = [{ role: 'user', content: userContent }];
  const first = await requestCompletion(config, messages, systemPrompt);
  let explanation;
  try {
    explanation = parseExplanation(first.content, animationRequested);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'INVALID_LLM_RESPONSE' || !first.content.trim()) {
      if (error instanceof AppError && !error.details) {
        error.details = { ...first.diagnostics, output: truncateDiagnostic(first.content) };
      }
      throw error;
    }
    console.error('[llm] 首次响应无法解析为 JSON，重试一次：', first.content.slice(0, 500));
    const retry = await requestCompletion(config, [
      ...messages,
      { role: 'assistant', content: first.content },
      { role: 'user', content: '上面的回答不符合要求。请严格按系统提示的结构重新回答，只输出一个 JSON 对象，不要输出 Markdown 代码围栏或任何额外说明。' },
    ], systemPrompt);
    try {
      explanation = parseExplanation(retry.content, animationRequested);
    } catch (retryError) {
      if (retryError instanceof AppError) {
        retryError.details = {
          ...first.diagnostics,
          retry: retry.diagnostics,
          output: truncateDiagnostic(retry.content),
        };
      }
      throw retryError;
    }
  }
const documentedSources = new Set(documentation.hits.map((hit) => hit.source));
  explanation.specifications = explanation.specifications.map((spec) => ({
    ...spec,
    verified: Boolean(spec.source && documentedSources.has(spec.source) && spec.section && spec.section !== '未核实'),
  }));
  return {
    explanation,
    context: { start: context.start, end: context.end },
    scope: context.scope,
    relatedDefinitions: context.relatedDefinitions,
    model: config.model,
    sources: {
      local: documentation.hits.map((hit) => ({
        source: hit.source,
        file: hit.file,
        section: hit.section || '',
        page: hit.page || null,
        excerpt: hit.text.slice(0, 1600),
        score: Math.round(hit.score * 100) / 100,
      })),
      web: (webSearch?.results || []).slice(0, 5).map((result) => ({
        title: result.title,
        url: result.url,
        engine: webSearch?.engine || null,
      })),
      webError: webSearch?.error || null,
      searchedFiles: documentation.stats?.files || 0,
    },
  };
}
