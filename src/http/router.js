// 路由表：把"能力"注册成 {method, pattern, handler}，server.js 只负责组装。
// 每个 handler 拿到的 params 已经解码，写操作统一走 readJson。
import { AppError } from '../errors.js';

export function createRouter(groups) {
  const routes = groups.flat();

  return async function dispatch(request, response, url) {
    let pathMatched = false;
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== request.method) continue;
      const params = match.slice(1).map((value) => decodeURIComponent(value));
      return route.handler({ request, response, url, params });
    }
    throw pathMatched
      ? new AppError('该 API 不支持此请求方法', 405, 'METHOD_NOT_ALLOWED')
      : new AppError('API 不存在', 404, 'NOT_FOUND');
  };
}