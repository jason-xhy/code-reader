// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 仓库会话管理与 code-reader API 强绑定
// grill: 成品检索=skill 库无 code-reader 仓库会话成品; 输入固定=本地路径/远程 URL/仓库 id; 步骤机械=定位根/克隆/组装 payload; 判读固定=Git 输出与文件列表; 失效场景=构造不出（仅本应用）
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';
import { cloneRepository, listSourceFiles, repositoryMeta, repositoryRoot, repositoryStatus, runGit } from './git.js';
import { getResume, touchRepository } from './history.js';
import { activateRepository } from './workspace.js';
import { dataPath } from './paths.js';

const repositories = new Map();
const cloneRoot = dataPath('repositories');

function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function validateRemote(url) {
  if (typeof url !== 'string' || !url.trim() || url.length > 2048 || /[\s\0]/.test(url)) {
    throw new AppError('远程仓库地址无效', 400, 'INVALID_REMOTE_URL');
  }
  const value = url.trim();
  const supported = /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/)/.test(value) || /^[^/\s:]+@[^:\s]+:.+/.test(value);
  if (!supported || value.startsWith('-')) {
    throw new AppError('仅支持 HTTPS、SSH、Git、file:// 或 scp 风格仓库地址', 400, 'INVALID_REMOTE_URL');
  }
  return value;
}

function remoteDirectoryName(url) {
  const withoutSlash = url.replace(/\/+$/, '');
  const tail = withoutSlash.split(/[/:]/).pop() || 'repository';
  const name = tail.replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48) || 'repository';
  return `${name}-${digest(url)}`;
}

// 仓库 payload（文件列表 + Git 状态）在 kernel 级大仓约 1s；工作区预载/切仓/IPC 重开
// 常在同一秒内重复请求同一仓库，短 TTL 缓存可把重复打开降到毫秒级。显式刷新、
// 切分支、同步必须走 fresh，避免把旧 HEAD/文件列表带进页面。
const payloadCache = new Map();
const payloadInFlight = new Map();
const PAYLOAD_TTL_MS = 10_000;

async function buildPayload(repository) {
  const [meta, files, status] = await Promise.all([
    repositoryMeta(repository.root),
    listSourceFiles(repository.root),
    repositoryStatus(repository.root),
  ]);
  return {
    repository: { id: repository.id, source: repository.source, remoteUrl: repository.remoteUrl, ...meta },
    files,
    status,
  };
}

async function payload(repository, { fresh = false } = {}) {
  const key = repository.root;
  if (!fresh) {
    const cached = payloadCache.get(key);
    if (cached && Date.now() - cached.at < PAYLOAD_TTL_MS) return cached.data;
    const inFlight = payloadInFlight.get(key);
    if (inFlight) return inFlight;
  }
  const pending = buildPayload(repository).then((data) => {
    payloadCache.set(key, { at: Date.now(), data });
    return data;
  });
  payloadInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (payloadInFlight.get(key) === pending) payloadInFlight.delete(key);
  }
}

export async function openLocal(localPath, { resume = false, activate = true } = {}) {
  const root = await repositoryRoot(localPath);
  const id = `local-${digest(root)}`;
  const repository = { id, root, source: 'local' };
  repositories.set(id, repository);
  let workspace = null;
  if (activate) {
    await touchRepository(repository, { opened: true });
    workspace = await activateRepository(repository);
  }
  const data = await payload(repository);
  return {
    ...data,
    ...(workspace ? { workspace } : {}),
    ...(resume ? { resume: await getResume(repository) } : {}),
  };
}

export async function openRemote(remoteUrl, { resume = false, activate = true } = {}) {
  const url = validateRemote(remoteUrl);
  const id = `remote-${digest(url)}`;
  const destination = path.join(cloneRoot, remoteDirectoryName(url));
  await mkdir(cloneRoot, { recursive: true });

  let root;
  try {
    root = await repositoryRoot(destination);
    const origin = (await runGit(['config', '--get', 'remote.origin.url'], { cwd: root })).trim();
    if (origin !== url) {
      throw new AppError('克隆目录已存在但来源不同', 409, 'REMOTE_ORIGIN_MISMATCH');
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'REMOTE_ORIGIN_MISMATCH') throw error;
    try {
      await cloneRepository(url, destination);
    } catch (cloneError) {
      await rm(destination, { recursive: true, force: true });
      throw cloneError;
    }
    root = await repositoryRoot(destination);
  }

  const repository = { id, root, source: 'remote', remoteUrl: url };
  repositories.set(id, repository);
  let workspace = null;
  if (activate) {
    await touchRepository(repository, { opened: true });
    workspace = await activateRepository(repository);
  }
  const data = await payload(repository);
  return {
    ...data,
    ...(workspace ? { workspace } : {}),
    ...(resume ? { resume: await getResume(repository) } : {}),
  };
}

export function getRepository(id) {
  const repository = repositories.get(id);
  if (!repository) throw new AppError('仓库未打开或会话已过期', 404, 'REPOSITORY_NOT_FOUND');
  return repository;
}

export { payload as repositoryPayload };
