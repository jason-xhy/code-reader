// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 网络检索与 code-reader 解释链路强绑定
// grill: 成品检索=skill 库无 code-reader 网络检索成品; 输入固定=问题字符串; 步骤机械=Google 优先/Bing 回退/解析/抓页; 判读固定=结果块与正文文本; 失效场景=构造不出（仅本应用）
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SEARCH_TIMEOUT = 15_000;
const GOOGLE_TIMEOUT = 4_000;
const PAGE_TIMEOUT = 4_000;
const MAX_RESULTS = 10;
const MAX_PAGE_BYTES = 400 * 1024;
const MAX_PAGE_TEXT = 6000;
const GOOGLE_BLOCK_MS = 10 * 60 * 1000;

let googleBlockedUntil = 0;

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(text) {
  return decodeEntities(String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^0\./.test(host) || host === '0.0.0.0') return true;
  if (/^(fc|fd)/.test(host) || /^fe80/.test(host)) return true;
  return false;
}

function assertPublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isPrivateHost(url.hostname)) return null;
  return url;
}

function decodeGoogleRedirect(href) {
  const value = decodeEntities(href);
  try {
    const url = new URL(value, 'https://www.google.com');
    if (url.hostname.endsWith('google.com') && url.pathname === '/url') {
      const target = url.searchParams.get('q') || url.searchParams.get('url');
      if (target) return target;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function decodeBingRedirect(href) {
  let value = decodeEntities(href);
  try {
    const url = new URL(value, 'https://www.bing.com');
    if (url.hostname.endsWith('bing.com') && url.pathname.startsWith('/ck/a')) {
      const encoded = url.searchParams.get('u');
      if (encoded && encoded.startsWith('a1')) {
        const base64 = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
        const decoded = Buffer.from(padded, 'base64').toString('utf8');
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

async function fetchWithTimeout(url, timeout, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

function isGoogleHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'google.com' || host.endsWith('.google.com') || /(^|\.)google\.[a-z.]+$/.test(host);
  } catch {
    return false;
  }
}

export function parseGoogleResults(html) {
  const results = [];
  const seen = new Set();
  const pattern = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]{0,600}?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const url = decodeGoogleRedirect(match[1]);
    if (isGoogleHost(url) || !assertPublicUrl(url) || seen.has(url)) continue;
    const title = stripHtml(match[2]).slice(0, 200);
    if (!title) continue;
    const tail = String(html).slice(match.index || 0, (match.index || 0) + 1800);
    const snippetMatch = tail.match(/class="[^"]*(?:VwiC3b|IsZvec|KB4CU)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    seen.add(url);
    results.push({ title, url, snippet: snippetMatch ? stripHtml(snippetMatch[1]).slice(0, 400) : '', text: '' });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

function parseBingResults(html) {
  const results = [];
  const blocks = String(html || '').split(/<li class="b_algo"/i).slice(1);
  for (const block of blocks) {
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const href = decodeBingRedirect(titleMatch[1]);
    if (!assertPublicUrl(href)) continue;
    const title = stripHtml(titleMatch[2]).slice(0, 200);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    results.push({
      title,
      url: href,
      snippet: snippetMatch ? stripHtml(snippetMatch[1]).slice(0, 400) : '',
      text: '',
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

async function fetchPageText(url) {
  const parsed = assertPublicUrl(url);
  if (!parsed) return '';
  try {
    const response = await fetchWithTimeout(parsed.toString(), PAGE_TIMEOUT, {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    });
    if (!response.ok) return '';
    if (response.url && isPrivateHost(new URL(response.url).hostname)) return '';
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) return '';
    const body = (await response.text()).slice(0, MAX_PAGE_BYTES);
    return stripHtml(body).slice(0, MAX_PAGE_TEXT);
  } catch {
    return '';
  }
}

async function enrichWithPages(results) {
  // 摘要通常已足够；仅当首条结果没有摘要时才抓取正文，避免每个结果多等数秒。
  if (results[0] && !results[0].snippet) {
    results[0].text = await fetchPageText(results[0].url);
  }
  return results;
}

async function searchGoogle(query) {
  if (Date.now() < googleBlockedUntil) return null;
  let response;
  try {
    response = await fetchWithTimeout(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${MAX_RESULTS}&hl=zh-CN`,
      GOOGLE_TIMEOUT,
      {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    );
  } catch {
    googleBlockedUntil = Date.now() + GOOGLE_BLOCK_MS;
    return null;
  }
  if (!response.ok) {
    googleBlockedUntil = Date.now() + GOOGLE_BLOCK_MS;
    return null;
  }
  let html;
  try {
    html = await response.text();
  } catch {
    googleBlockedUntil = Date.now() + GOOGLE_BLOCK_MS;
    return null;
  }
  if (/consent\.google\.com|Before you continue|unusual traffic/i.test(html)) {
    googleBlockedUntil = Date.now() + GOOGLE_BLOCK_MS;
    return null;
  }
  const results = parseGoogleResults(html);
  if (!results.length) {
    googleBlockedUntil = Date.now() + GOOGLE_BLOCK_MS;
    return null;
  }
  googleBlockedUntil = 0;
  return { query, engine: 'google', results: await enrichWithPages(results) };
}

async function searchBing(query) {
  let response;
  try {
    response = await fetchWithTimeout(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`,
      SEARCH_TIMEOUT,
      {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    );
  } catch {
    return { query, engine: 'bing', results: [], error: '网络检索不可用' };
  }
  if (!response.ok) return { query, engine: 'bing', results: [], error: `搜索服务返回 HTTP ${response.status}` };
  let html;
  try {
    html = await response.text();
  } catch {
    return { query, engine: 'bing', results: [], error: '搜索响应读取失败' };
  }
  const results = parseBingResults(html);
  return { query, engine: 'bing', results: await enrichWithPages(results) };
}

export async function searchWeb(query) {
  const trimmed = String(query || '').trim().slice(0, 300);
  if (!trimmed) return { query: '', engine: 'none', results: [] };
  const google = await searchGoogle(trimmed);
  if (google) return google;
  return searchBing(trimmed);
}