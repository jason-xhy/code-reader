// 请求参数策略：所有"用户输入是否合法"的判断集中在这里。
// 路由只负责把参数交给策略，策略只负责抛 AppError，不碰 HTTP 响应。
import { AppError } from '../errors.js';

export function integerParam(value, { name = '行号', code = 'INVALID_LINE' } = {}) {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) throw new AppError(`${name}必须是正整数`, 400, code);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new AppError(`${name}无效`, 400, code);
  return number;
}

export function characterParam(value, { name = '列号', code = 'INVALID_CHARACTER' } = {}) {
  const text = String(value ?? 0);
  if (!/^\d+$/.test(text)) throw new AppError(`${name}必须是非负整数`, 400, code);
  return Number(text);
}

export function pathParam(value) {
  const filePath = typeof value === 'string' ? value : '';
  if (!filePath || filePath.includes('\0')) throw new AppError('文件路径无效', 400, 'INVALID_PATH');
  return filePath;
}

export function requiredString(value, {
  message = '缺少参数',
  code = 'INVALID_ARGUMENT',
  maxLength = 4096,
} = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(message, 400, code);
  if (value.length > maxLength) throw new AppError(`${message}（长度超限）`, 400, code);
  if (value.includes('\0')) throw new AppError(message, 400, code);
  return value;
}

export function optionalInteger(value, { minimum = 1 } = {}) {
  return Number.isInteger(value) && value >= minimum ? value : undefined;
}