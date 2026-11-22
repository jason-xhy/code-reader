// Node 20/22 fetch does not honor HTTPS_PROXY. Keep model traffic compatible
// with desktop proxy environments, while loopback requests stay local.
import { fetch, EnvHttpProxyAgent } from 'undici';
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY;
const dispatcher = proxy ? new EnvHttpProxyAgent({
  httpProxy: process.env.HTTP_PROXY || process.env.http_proxy || proxy,
  httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy || proxy,
  noProxy: ['localhost', '127.0.0.1', '::1', process.env.NO_PROXY || process.env.no_proxy || ''].join(','),
}) : undefined;
export function modelFetch(url, options = {}) {
  return fetch(url, { ...options, ...(dispatcher ? { dispatcher } : {}) });
}
