// 搜索查询策略：只负责"什么样的字符串可以被搜索"，不碰 git 与排序。
import { AppError } from '../errors.js';
import { searchConfig } from './config.js';

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