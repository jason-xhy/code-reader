import { spawn } from 'node:child_process';
import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { AppError } from './errors.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_GIT_OUTPUT = 32 * 1024 * 1024;

function cleanMessage(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://<credentials>@')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trim();
}

export function runGit(args, options = {}) {
  const {
    cwd,
    timeout = 30_000,
    env = {},
    maxOutput = MAX_GIT_OUTPUT,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(reject, new AppError('Git 操作超时', 504, 'GIT_TIMEOUT'));
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize > maxOutput) {
        child.kill('SIGTERM');
        finish(reject, new AppError('Git 输出过大', 413, 'GIT_OUTPUT_TOO_LARGE'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize <= 1024 * 1024) stderr.push(chunk);
    });
    child.on('error', (error) => {
      finish(reject, new AppError(`无法执行 Git：${error.message}`, 500, 'GIT_UNAVAILABLE'));
    });
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = cleanMessage(Buffer.concat(stderr).toString('utf8'));
      if (code === 0) {
        finish(resolve, out);
      } else {
        finish(reject, new AppError(err || `Git 退出码 ${code}`, 400, 'GIT_ERROR'));
      }
    });
  });
}

function validateRelativePath(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0') || filePath.includes('\n')) {
    throw new AppError('文件路径无效', 400, 'INVALID_PATH');
  }
  if (path.isAbsolute(filePath) || path.normalize(filePath) !== filePath || filePath === '..' || filePath.startsWith(`..${path.sep}`)) {
    throw new AppError('文件路径必须位于仓库内', 400, 'INVALID_PATH');
  }
  return filePath;
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AppError('目标不在仓库内', 403, 'PATH_OUTSIDE_REPOSITORY');
  }
}

export async function repositoryRoot(inputPath) {
  if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath)) {
    throw new AppError('请输入本地仓库的绝对路径', 400, 'INVALID_REPOSITORY_PATH');
  }
  let resolved;
  try {
    resolved = await realpath(inputPath);
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new AppError('仓库路径不存在或不是目录', 400, 'INVALID_REPOSITORY_PATH');
  }
  const root = (await runGit(['rev-parse', '--show-toplevel'], { cwd: resolved })).trim();
  if (!root) throw new AppError('无法定位 Git 仓库根目录', 400, 'INVALID_REPOSITORY');
  return realpath(root);
}

export async function repositoryMeta(root) {
  const [head, branch, tags] = await Promise.all([
    runGit(['rev-parse', '--short', 'HEAD'], { cwd: root }),
    runGit(['branch', '--show-current'], { cwd: root }),
    runGit(['tag', '--points-at', 'HEAD', '--sort=-creatordate'], { cwd: root }),
  ]);
  const shortHead = head.trim();
  const currentBranch = branch.trim();
  return {
    name: path.basename(root),
    root,
    head: shortHead,
    branch: currentBranch || `detached@${shortHead}`,
    tags: tags.split('\n').map((tag) => tag.trim()).filter(Boolean),
  };
}

export async function listSourceFiles(root) {
  const output = await runGit(['ls-files', '-coz', '--exclude-standard'], { cwd: root });
  return output.split('\0').filter(Boolean);
}

export async function readSource(root, filePath) {
  validateRelativePath(filePath);
  const listing = await runGit(['ls-files', '-coz', '--exclude-standard', '--', filePath], { cwd: root });
  if (!listing.split('\0').filter(Boolean).includes(filePath)) {
    throw new AppError('文件不在仓库代码树中', 404, 'FILE_NOT_FOUND');
  }
  const candidate = path.resolve(root, filePath);
  assertInside(root, candidate);
  const resolved = await realpath(candidate);
  assertInside(root, resolved);
  const info = await stat(resolved);
  if (!info.isFile()) throw new AppError('目标不是普通文件', 400, 'NOT_A_FILE');
  if (info.size > MAX_FILE_BYTES) {
    throw new AppError('文件超过 2 MiB，暂不支持在线阅读', 413, 'FILE_TOO_LARGE');
  }
  const buffer = await readFile(resolved);
  if (buffer.includes(0)) throw new AppError('二进制文件不支持源码阅读', 415, 'BINARY_FILE');
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new AppError('文件不是有效 UTF-8 文本', 415, 'UNSUPPORTED_ENCODING');
  }
  const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
  return {
    path: filePath,
    content,
    lines: content ? Math.max(lineCount, 1) : 0,
    truncated: false,
  };
}

export async function lineHistory(root, filePath, line) {
  validateRelativePath(filePath);
  if (!Number.isInteger(line) || line < 1) {
    throw new AppError('行号必须是正整数', 400, 'INVALID_LINE');
  }
  const source = await readSource(root, filePath);
  if (line > source.lines) throw new AppError('行号超出文件范围', 400, 'INVALID_LINE');
  try {
    await runGit(['ls-files', '--error-unmatch', '--', filePath], { cwd: root });
  } catch {
    throw new AppError('未跟踪文件没有提交历史', 400, 'UNTRACKED_FILE');
  }
  const output = await runGit([
    'log',
    '--no-patch',
    '--pretty=format:%h%x20%s',
    '-n', '5',
    '-L', `${line},${line}:${filePath}`,
  ], { cwd: root, timeout: 45_000 });
  return output.split('\n').filter(Boolean).map((entry) => {
    const separator = entry.indexOf(' ');
    return {
      hash: separator === -1 ? entry : entry.slice(0, separator),
      subject: separator === -1 ? '' : entry.slice(separator + 1),
    };
  });
}

export async function cloneRepository(url, destination) {
  await runGit(['clone', '--', url, destination], {
    cwd: path.dirname(destination),
    timeout: 10 * 60_000,
    env: { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' },
  });
}
