import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { cloneRepository, listSourceFiles, repositoryMeta, repositoryRoot, runGit } from './git.js';

const repositories = new Map();
const cloneRoot = fileURLToPath(new URL('../.data/repositories/', import.meta.url));

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

async function payload(repository) {
  const [meta, files] = await Promise.all([
    repositoryMeta(repository.root),
    listSourceFiles(repository.root),
  ]);
  return { repository: { id: repository.id, source: repository.source, ...meta }, files };
}

export async function openLocal(localPath) {
  const root = await repositoryRoot(localPath);
  const id = `local-${digest(root)}`;
  const repository = { id, root, source: 'local' };
  repositories.set(id, repository);
  return payload(repository);
}

export async function openRemote(remoteUrl) {
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
  return payload(repository);
}

export function getRepository(id) {
  const repository = repositories.get(id);
  if (!repository) throw new AppError('仓库未打开或会话已过期', 404, 'REPOSITORY_NOT_FOUND');
  return repository;
}

export { payload as repositoryPayload };
