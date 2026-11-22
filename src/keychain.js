// one-shot: code-reader 项目源码的系统密钥环适配（本项目内固定模块，非 agent 探索脚本）; no-generalize: 与 code-reader 的 keychain.js 接口和 service 名强绑定，抽取为通用工具只会引入无用抽象
// grill: 成品检索=已查 skill 库无 code-reader 密钥环相关成品; 输入固定=providerId 与不超过 4096 字符的 API Key; 步骤机械=macOS 走 security、Linux 走 python keyring 固定两条路径; 判读固定=退出码 0 成功/1 未找到/3 后端错误; 失效场景=构造不出（该模块只服务本应用，不存在跨任务复用后失效的场景）
import { spawn } from 'node:child_process';
import { AppError } from './errors.js';

const SERVICE = 'com.codereader.llm';
const USE_MACOS_SECURITY = process.platform === 'darwin';
const PYTHON_CANDIDATES = [
  process.env.CODE_READER_PYTHON,
  'python3',
  'python3.13',
  'python3.12',
  'python3.11',
  'python3.10',
  'python3.9',
  'python3.8',
  '/usr/bin/python3.8',
].filter(Boolean);

// Linux 上强制使用 Secret Service 后端：keyring 默认的 ChainerBackend 会串联
// kwallet，只有 gnome-keyring 的桌面上查询不存在的条目会被 kwallet 的 InitError 打断。
const KEYRING_PROGRAM = `
import sys
import keyring
from keyring.backends.SecretService import Keyring

keyring.set_keyring(Keyring())
action, service, username = sys.argv[1:4]
try:
    if action == "get":
        value = keyring.get_password(service, username)
        if value is None:
            sys.exit(1)
        sys.stdout.write(value)
    elif action == "set":
        keyring.set_password(service, username, sys.stdin.read())
    else:
        sys.exit(2)
except Exception as error:
    sys.stderr.write(type(error).__name__ + ": " + str(error) + "\\n")
    sys.exit(3)
`;

function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new AppError('密钥环操作超时', 504, 'KEYCHAIN_TIMEOUT'));
    }, 10_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new AppError(`无法访问系统密钥环：${error.message}`, 500, 'KEYCHAIN_UNAVAILABLE'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function readMacosKey(providerId) {
  const result = await runProcess('security', ['find-generic-password', '-s', SERVICE, '-a', providerId, '-w']);
  if (result.code === 0) return result.stdout.trim() || null;
  if (/could not be found/i.test(result.stderr)) return null;
  throw new AppError(result.stderr.trim() || `钥匙串命令退出码 ${result.code}`, 500, 'KEYCHAIN_ERROR');
}

// The password prompt truncates at 128 bytes. Interactive command mode accepts
// the full -w value over stdin without exposing secrets in process arguments.
function securityQuote(value) {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

async function storeMacosKey(providerId, apiKey) {
  const command = ['add-generic-password', '-U', '-s', securityQuote(SERVICE), '-a', securityQuote(providerId), '-w', securityQuote(apiKey)].join(' ');
  const result = await runProcess('security', ['-i'], `${command}\n`);
  if (result.code !== 0) {
    // Do not relay interactive output: some security versions echo the command.
    throw new AppError('钥匙串写入失败', 500, 'KEYCHAIN_ERROR');
  }
  if (await readMacosKey(providerId) !== apiKey) {
    throw new AppError('钥匙串写入后验证失败，Key 未完整保存', 500, 'KEYCHAIN_VERIFY_FAILED');
  }
}

let pythonPromise = null;

function findPython() {
  if (!pythonPromise) {
    pythonPromise = (async () => {
      for (const candidate of PYTHON_CANDIDATES) {
        try {
          const result = await runProcess(candidate, ['-c', 'import keyring']);
          if (result.code === 0) return candidate;
        } catch {
          // 解释器不存在或不可执行，继续尝试下一个。
        }
      }
      throw new AppError(
        '系统密钥环不可用：未找到带 keyring 模块的 Python（请安装 python3-keyring）',
        500,
        'KEYCHAIN_UNAVAILABLE',
      );
    })();
    pythonPromise.catch(() => { pythonPromise = null; });
  }
  return pythonPromise;
}

async function runKeyring(args, input) {
  const python = await findPython();
  return runProcess(python, ['-c', KEYRING_PROGRAM, ...args], input);
}

async function readKeyringKey(providerId) {
  const result = await runKeyring(['get', SERVICE, providerId]);
  if (result.code === 0) return result.stdout || null;
  if (result.code === 1) return null;
  throw new AppError(result.stderr.trim() || `密钥环读取失败（退出码 ${result.code}）`, 500, 'KEYCHAIN_ERROR');
}

async function storeKeyringKey(providerId, apiKey) {
  const result = await runKeyring(['set', SERVICE, providerId], apiKey);
  if (result.code !== 0) {
    throw new AppError(result.stderr.trim() || `密钥环写入失败（退出码 ${result.code}）`, 500, 'KEYCHAIN_ERROR');
  }
}

export async function readApiKey(providerId) {
  return USE_MACOS_SECURITY ? readMacosKey(providerId) : readKeyringKey(providerId);
}

export async function storeApiKey(providerId, apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /[\r\n\0]/.test(apiKey)) {
    throw new AppError('API Key 不能为空、不能包含换行且不能超过 4096 字符', 400, 'INVALID_API_KEY');
  }
  if (USE_MACOS_SECURITY) {
    await storeMacosKey(providerId, apiKey.trim());
    return;
  }
  await storeKeyringKey(providerId, apiKey.trim());
}