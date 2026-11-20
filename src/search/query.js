// 搜索查询策略：只负责"什么样的字符串可以被搜索"，不碰 git 与排序。
// 支持两种模式：
//   普通关键字       —— 大小写不敏感的包含匹配（函数名 / 文件路径）
//   /正则/ 或 /正则/i —— JavaScript 正则；默认忽略大小写，可显式带 i 标志
import { AppError } from '../errors.js';
import { searchConfig } from './config.js';

const REGEX_QUERY = /^\/(.+)\/([a-z]*)$/s;

export function normalizeQuery(value) {
  const query = String(value ?? '').trim();
  if (!query) throw new AppError('搜索关键字不能为空', 400, 'INVALID_QUERY');
  if (query.length > searchConfig.maxQueryLength) {
    throw new AppError(`搜索关键字不能超过 ${searchConfig.maxQueryLength} 个字符`, 400, 'INVALID_QUERY');
  }
  if (/[\0\r\n]/.test(query)) throw new AppError('搜索关键字包含非法字符', 400, 'INVALID_QUERY');
  return query;
}

export function canSearchFunctions(query) {
  return query.length >= searchConfig.minFunctionQueryLength && /[A-Za-z0-9_$]/.test(query);
}

// 解析搜索词。正则模式返回编译好的 RegExp，普通模式返回 null。
// 允许的标志只有 i（忽略大小写）/ m（多行）/ s（点号匹配换行）；g/y 会破坏
// test() 的状态，直接拒绝而不静默改写，避免用户以为 /x/g 有全局语义。
export function parseQuery(value) {
  const query = normalizeQuery(value);
  const match = query.match(REGEX_QUERY);
  if (!match) {
    return { query, regex: null, mode: 'fuzzy', text: query, lower: query.toLowerCase() };
  }
  const [, source, rawFlags] = match;
  const unsupported = [...rawFlags].filter((flag) => !'imsu'.includes(flag));
  if (unsupported.length) {
    throw new AppError(`正则标志不支持：${unsupported.join('')}（可用 i/m/s）`, 400, 'INVALID_QUERY');
  }
  const flags = rawFlags.includes('i') ? rawFlags : `${rawFlags}i`;
  let regex;
  try {
    regex = new RegExp(source, flags);
  } catch (error) {
    throw new AppError(`正则表达式无效：${error.message}`, 400, 'INVALID_QUERY');
  }
  return {
    query,
    regex,
    mode: 'regex',
    text: source,
    flags,
    lower: source.toLowerCase(),
  };
}

// 正则模式不能做前缀/完全匹配的字符串判断，按命中位置给出排序档位。
export function regexRank(name, regex) {
  const match = name.match(regex);
  if (!match) return null;
  if (match.index === 0 && match[0] === name) return 0;
  if (match.index === 0) return 2;
  return 4;
}