import { spawn } from 'node:child_process';
import { AppError } from './errors.js';

const SERVICE = 'com.codereader.llm';

function runSecurity(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('security', args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new AppError('钥匙串操作超时', 504, 'KEYCHAIN_TIMEOUT'));
    }, 10_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new AppError(`无法访问 macOS 钥匙串：${error.message}`, 500, 'KEYCHAIN_UNAVAILABLE'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new AppError(stderr.trim() || `钥匙串命令退出码 ${code}`, 500, 'KEYCHAIN_ERROR'));
    });
    child.stdin.end(input === undefined ? undefined : `${input}\n${input}\n`);
  });
}

export async function readApiKey(providerId) {
  try {
    const value = await runSecurity(['find-generic-password', '-s', SERVICE, '-a', providerId, '-w']);
    return value || null;
  } catch (error) {
    if (/could not be found/i.test(error.message)) return null;
    throw error;
  }
}

export async function storeApiKey(providerId, apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /[\r\n\0]/.test(apiKey)) {
    throw new AppError('API Key 不能为空、不能包含换行且不能超过 4096 字符', 400, 'INVALID_API_KEY');
  }
  await runSecurity([
    'add-generic-password', '-U', '-s', SERVICE, '-a', providerId, '-w',
  ], apiKey.trim());
}
