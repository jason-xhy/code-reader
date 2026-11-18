// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: Git 操作层与 code-reader API 强绑定
// grill: 成品检索=skill 库无 code-reader Git 操作成品; 输入固定=仓库路径+固定 git 参数; 步骤机械=按 API 组装 git 命令; 判读固定=解析 porcelain/for-each-ref 输出; 失效场景=构造不出（仅本应用）
import { spawn } from 'node:child_process';
import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { AppError } from './errors.js';
import { detectFunctionSegment, detectSegment } from './faq.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_GIT_OUTPUT = 32 * 1024 * 1024;
const NETWORK_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  GIT_ASKPASS: 'true',
  SSH_ASKPASS: 'true',
};
const BRANCH_FORMAT = '%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)';
const CODE_READER_STASH_PREFIX = 'code-reader:';
const FUNCTION_HISTORY_CACHE_LIMIT = 500;
const functionHistoryCache = new Map();

function isCodeReaderStash(subject) {
  return String(subject || '').includes(CODE_READER_STASH_PREFIX);
}

function stashMessage(subject) {
  const text = String(subject || '');
  const index = text.indexOf(CODE_READER_STASH_PREFIX);
  return index === -1 ? text : text.slice(index + CODE_READER_STASH_PREFIX.length).trim();
}

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

// 引用预览：目标行前后 N 行 + 所在函数（Caller）范围，供 gr 弹窗的另一窗口显示。
export async function sourceContext(root, filePath, line, radius = 10) {
  validateRelativePath(filePath);
  if (!Number.isInteger(line) || line < 1) {
    throw new AppError('行号必须是正整数', 400, 'INVALID_LINE');
  }
  const windowRadius = Math.min(Math.max(Number.isInteger(radius) ? radius : 10, 1), 200);
  const source = await readSource(root, filePath);
  if (line > source.lines) throw new AppError('行号超出文件范围', 400, 'INVALID_LINE');
  const lineStart = Math.max(1, line - windowRadius);
  const lineEnd = Math.min(source.lines, line + windowRadius);
  const segment = detectFunctionSegment(source.content, line);
  const rows = source.content.split('\n').slice(lineStart - 1, lineEnd);
  return {
    path: filePath,
    line,
    lineStart,
    lineEnd,
    caller: segment?.symbol || null,
    callerStart: segment?.lineStart || null,
    callerEnd: segment?.lineEnd || null,
    lines: rows.map((text, index) => ({ number: lineStart + index, text })),
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
  // git log -L 在 kernel 等大仓上需要分钟级时间（实测 linux-next 单行 >120s），
  // 改用 blame：只回答“这一行最后一次由哪个提交引入”，内核仓约 2-3 秒返回。
  const output = await runGit([
    'blame',
    '--line-porcelain',
    '-L', `${line},${line}`,
    '--', filePath,
  ], { cwd: root, timeout: 45_000 });
  const lines = output.split('\n');
  const header = /^([0-9a-f]{40}) \d+ \d+/.exec(lines[0] || '');
  if (!header) return [];
  if (/^0+$/.test(header[1])) {
    return [{ hash: '0000000', subject: '未提交的工作区修改' }];
  }
  const summary = lines.find((entry) => entry.startsWith('summary '));
  return [{
    hash: header[1].slice(0, 10),
    subject: summary ? summary.slice('summary '.length) : '',
  }];
}

// 函数级历史：blame 当前函数行区间，按提交时间取最近 5 条；按 (仓库,文件,区间,HEAD) 缓存。
export async function functionHistory(root, filePath, line) {
  validateRelativePath(filePath);
  if (!Number.isInteger(line) || line < 1) {
    throw new AppError('行号必须是正整数', 400, 'INVALID_LINE');
  }
  const source = await readSource(root, filePath);
  if (line > source.lines) throw new AppError('行号超出文件范围', 400, 'INVALID_LINE');
  const segment = detectFunctionSegment(source.content, line) || detectSegment(source.content, line);
  const lineStart = segment?.lineStart || line;
  const lineEnd = segment?.lineEnd || line;
  let head = '';
  try {
    head = (await runGit(['rev-parse', 'HEAD'], { cwd: root })).trim();
  } catch {
    head = 'unborn';
  }
  const key = [root, filePath, lineStart, lineEnd, head].join('\0');
  const cached = functionHistoryCache.get(key);
  if (cached) return { ...cached, cached: true };
  try {
    await runGit(['ls-files', '--error-unmatch', '--', filePath], { cwd: root });
  } catch {
    throw new AppError('未跟踪文件没有提交历史', 400, 'UNTRACKED_FILE');
  }
  const output = await runGit([
    'blame',
    '--line-porcelain',
    '-L', `${lineStart},${lineEnd}`,
    '--', filePath,
  ], { cwd: root, timeout: 60_000 });
  const hashes = [];
  const seen = new Set();
  for (const entry of output.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ \d+/.exec(entry);
    if (!header) continue;
    const hash = header[1];
    if (!seen.has(hash)) {
      seen.add(hash);
      hashes.push(hash);
    }
    if (hashes.length >= 500) break;
  }
  const real = hashes.filter((hash) => !/^0+$/.test(hash));
  const commits = [];
  if (real.length) {
    try {
      const meta = await runGit([
        'log',
        '--no-walk=unsorted',
        '--format=%H%x00%an%x00%aI%x00%s',
        ...real,
      ], { cwd: root, timeout: 30_000 });
      for (const row of meta.split('\n')) {
        if (!row) continue;
        const [hash, author, date, subject] = row.split('\0');
        if (!hash) continue;
        commits.push({ hash: hash.slice(0, 10), author: author || '', date: date || '', subject: subject || '' });
      }
      commits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    } catch {
      // 元数据失败时保留 blame 顺序，至少返回提交号
      for (const hash of real) commits.push({ hash: hash.slice(0, 10), author: '', date: '', subject: '' });
    }
  }
  if (hashes.some((hash) => /^0+$/.test(hash))) {
    commits.unshift({ hash: '0000000', author: '', date: '', subject: '未提交的工作区修改' });
  }
  const result = {
    path: filePath,
    line,
    lineStart,
    lineEnd,
    symbol: segment?.symbol || null,
    head,
    commits: commits.slice(0, 5),
  };
  functionHistoryCache.set(key, result);
  if (functionHistoryCache.size > FUNCTION_HISTORY_CACHE_LIMIT) {
    functionHistoryCache.delete(functionHistoryCache.keys().next().value);
  }
  return result;
}

async function stashEntries(root) {
  const output = await runGit(['stash', 'list', '--format=%gd%x00%H%x00%gs'], { cwd: root });
  return output.split('\n').filter(Boolean).map((line) => {
    const [ref, sha, subject] = line.split('\0');
    return { ref, sha, subject: subject || '' };
  });
}

async function createStash(root, message, files, includeUntracked = false) {
  const args = ['stash', 'push', '-m', message];
  if (includeUntracked) args.push('--include-untracked');
  await runGit(args, { cwd: root, timeout: 180_000 });
  const sha = (await runGit(['rev-parse', '--verify', 'stash@{0}'], { cwd: root })).trim();
  return { sha, files, message };
}

async function popStashEntry(root, entry) {
  await runGit(['stash', 'pop', entry.ref], { cwd: root, timeout: 120_000 });
}

async function restoreStashes(root, stashes) {
  for (const stash of [...stashes].reverse()) {
    const entries = await stashEntries(root);
    const entry = entries.find((candidate) => candidate.sha === stash.sha);
    if (!entry) continue;
    try {
      await popStashEntry(root, entry);
    } catch {
      // 恢复失败的暂存保留在 stash 列表中，由界面继续提示
    }
  }
}

export async function listCodeReaderStashes(root) {
  const entries = await stashEntries(root);
  return entries
    .filter((entry) => isCodeReaderStash(entry.subject))
    .map((entry) => ({
      sha: entry.sha,
      ref: entry.ref,
      message: stashMessage(entry.subject),
    }));
}

export async function popCodeReaderStash(root, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new AppError('暂存标识无效', 400, 'INVALID_STASH');
  }
  const entries = await stashEntries(root);
  const entry = entries.find((candidate) => candidate.sha === sha);
  if (!entry || !isCodeReaderStash(entry.subject)) {
    throw new AppError('暂存不存在或不属于本应用', 404, 'STASH_NOT_FOUND');
  }
  await popStashEntry(root, entry);
  return { sha, message: stashMessage(entry.subject) };
}

export async function listBranches(root) {
  const [localRaw, remoteRaw] = await Promise.all([
    runGit(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads'], { cwd: root }),
    runGit(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/remotes'], { cwd: root }),
  ]);
  const parse = (raw, type) => raw.split('\n').filter(Boolean).map((line) => {
    const [refname, name, head, upstream] = line.split('\0');
    return {
      refname,
      name,
      type,
      current: head === '*',
      upstream: upstream || '',
      ahead: 0,
      behind: 0,
    };
  }).filter((branch) => branch.name && !branch.name.endsWith('/HEAD'));

  const locals = parse(localRaw, 'local');
  const localNames = new Set(locals.map((branch) => branch.name));
  const remotes = parse(remoteRaw, 'remote').map((branch) => {
    const localName = branch.name.split('/').slice(1).join('/');
    return { ...branch, localName, hasLocal: Boolean(localName) && localNames.has(localName) };
  });
  // %(upstream:track) 会为每个分支做一次 revision walk，kernel 仓 150 分支实测 19s；
  // 只对当前分支算一次 ahead/behind（rev-list 走 commit-graph，通常 <0.2s）。
  const current = locals.find((branch) => branch.current) || null;
  if (current && current.upstream) {
    try {
      const counts = (await runGit(['rev-list', '--left-right', '--count', `${current.upstream}...HEAD`], { cwd: root }))
        .trim().split(/\s+/).map(Number);
      current.behind = counts[0] || 0;
      current.ahead = counts[1] || 0;
    } catch {
      // 上游引用可能已失效，保留 0
    }
  }
  locals.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  remotes.sort((a, b) => a.name.localeCompare(b.name));
  return {
    current: current?.name || null,
    branches: [...locals, ...remotes],
  };
}

export async function checkoutBranch(root, target) {
  if (typeof target !== 'string' || !target.trim() || target.length > 255 || target.startsWith('-') || /[\s\0]/.test(target)) {
    throw new AppError('分支名无效', 400, 'INVALID_BRANCH');
  }
  const { branches } = await listBranches(root);
  const local = branches.find((branch) => branch.type === 'local' && branch.name === target);
  const remote = local ? null : branches.find((branch) => branch.type === 'remote' && branch.name === target);
  if (!local && !remote) throw new AppError('分支不存在', 400, 'BRANCH_NOT_FOUND');
  if (!local && !remote.hasLocal && remote.localName.startsWith('-')) {
    throw new AppError('无法为该远程分支创建本地分支', 400, 'INVALID_BRANCH');
  }

  const checkoutTarget = local
    ? local.name
    : (remote.hasLocal ? remote.localName : remote.name);
  const args = local || remote.hasLocal
    ? ['checkout', checkoutTarget]
    : ['checkout', '-b', remote.localName, '--track', remote.name];

  const status = await runGit(['status', '--porcelain', '--untracked-files=no'], { cwd: root });
  const dirtyFiles = status.split('\n').filter(Boolean).length;
  const stashes = [];
  if (dirtyFiles > 0) {
    stashes.push(await createStash(root, `${CODE_READER_STASH_PREFIX} 切换分支前自动暂存（${dirtyFiles} 个文件）`, dirtyFiles));
  }

  try {
    await runGit(args, { cwd: root, timeout: 120_000 });
    return { branch: checkoutTarget, stashes };
  } catch (firstError) {
    let untracked = [];
    try {
      untracked = (await runGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }))
        .split('\0').filter(Boolean);
    } catch {
      untracked = [];
    }
    if (untracked.length > 0 && untracked.length <= 200) {
      try {
        stashes.push(await createStash(root, `${CODE_READER_STASH_PREFIX} 切换分支前自动暂存未跟踪文件（${untracked.length} 个）`, untracked.length, true));
        await runGit(args, { cwd: root, timeout: 120_000 });
        return { branch: checkoutTarget, stashes };
      } catch (retryError) {
        await restoreStashes(root, stashes);
        throw retryError;
      }
    }
    await restoreStashes(root, stashes);
    throw firstError;
  }
}

export async function syncRepository(root) {
  await runGit(['fetch', '--all', '--prune'], { cwd: root, timeout: 300_000, env: NETWORK_ENV });
  let upstream;
  try {
    upstream = (await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd: root })).trim();
  } catch {
    return { action: 'no-upstream', ahead: 0, behind: 0, upstream: '' };
  }
  if (!upstream) return { action: 'no-upstream', ahead: 0, behind: 0, upstream: '' };
  const counts = (await runGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd: root }))
    .trim().split(/\s+/).map(Number);
  const behind = counts[0] || 0;
  const ahead = counts[1] || 0;
  const headBefore = (await runGit(['rev-parse', 'HEAD'], { cwd: root })).trim();
  if (behind === 0) return { action: 'up-to-date', ahead, behind, upstream, headChanged: false };
  if (ahead > 0) return { action: 'diverged', ahead, behind, upstream, headChanged: false };
  const dirty = (await runGit(['status', '--porcelain', '--untracked-files=no'], { cwd: root })).trim();
  if (dirty) return { action: 'dirty', ahead, behind, upstream, headChanged: false };
  try {
    await runGit(['merge', '--ff-only', '@{upstream}'], { cwd: root, timeout: 120_000 });
  } catch (error) {
    return { action: 'error', ahead, behind, upstream, headChanged: false, message: error.message };
  }
  const headAfter = (await runGit(['rev-parse', 'HEAD'], { cwd: root })).trim();
  return { action: 'fast-forwarded', ahead, behind, upstream, headChanged: headBefore !== headAfter };
}

export async function repositoryStatus(root) {
  try {
    const output = await runGit(['status', '--porcelain', '-z', '--untracked-files=normal'], {
      cwd: root,
      timeout: 15_000,
      maxOutput: 8 * 1024 * 1024,
    });
    const tokens = output.split('\0');
    const status = {};
    for (let index = 0; index < tokens.length; index += 1) {
      const entry = tokens[index];
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      const filePath = entry.slice(3);
      if (code[0] === 'R' || code[0] === 'C') index += 1;
      status[filePath] = code.trim() || '?';
    }
    return status;
  } catch {
    return {};
  }
}

export async function commitDetails(root, hash) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(hash)) {
    throw new AppError('提交号无效', 400, 'INVALID_COMMIT');
  }
  const metaOutput = await runGit([
    'show',
    '-s',
    '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%B',
    hash,
    '--',
  ], { cwd: root, timeout: 30_000 });
  const parts = metaOutput.split('\0');
  if (parts.length < 6) throw new AppError('无法读取提交信息', 400, 'INVALID_COMMIT');
  const [fullHash, shortHash, author, email, date] = parts;
  const message = parts.slice(5).join('\0').trim();
  const numstat = await runGit(['show', '--numstat', '--format=', '--no-renames', hash, '--'], {
    cwd: root,
    timeout: 60_000,
  });
  const files = numstat.split('\n').filter(Boolean).map((line) => {
    const [added, deleted, filePath] = line.split('\t');
    return {
      path: filePath || '',
      added: Number(added) || 0,
      deleted: Number(deleted) || 0,
    };
  }).filter((entry) => entry.path);
  const patch = await runGit(['show', '--format=', '--no-color', '--patch', hash, '--'], {
    cwd: root,
    timeout: 60_000,
    maxOutput: 8 * 1024 * 1024,
  });
  const limit = 200 * 1024;
  return {
    hash: fullHash,
    short: shortHash,
    author,
    email,
    date,
    message,
    files,
    diff: patch.length > limit ? patch.slice(0, limit) : patch,
    truncated: patch.length > limit,
  };
}

export async function cloneRepository(url, destination) {
  await runGit(['clone', '--', url, destination], {
    cwd: path.dirname(destination),
    timeout: 10 * 60_000,
    env: { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' },
  });
}
