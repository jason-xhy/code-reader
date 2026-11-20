// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 工作区持久化与 code-reader 仓库会话强绑定
// grill: 成品检索=skill 库无 code-reader 工作区成品; 输入固定=.data/workspace.json 与固定仓库字段; 步骤机械=读取/去重/排序/原子写; 判读固定=仓库 key 与 activeKey; 失效场景=构造不出（仅本应用）
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from './paths.js';

const workspacePath = dataPath('workspace.json');
// 只保留最近打开的一批仓库；超出的从末尾（最久未激活）淘汰。
const MAX_ENTRIES = 12;
let cache = null;
let saveChain = Promise.resolve();

function keyFor(repository) {
  return repository.source === 'remote' && repository.remoteUrl
    ? `remote:${repository.remoteUrl}`
    : `local:${repository.root}`;
}

function nameFor(repository) {
  if (repository.source === 'remote' && repository.remoteUrl) {
    const tail = repository.remoteUrl.replace(/\/+$/, '').split(/[/:]/).pop() || 'repository';
    return tail.replace(/\.git$/i, '');
  }
  return path.basename(repository.root || '') || 'repository';
}

async function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(workspacePath, 'utf8'));
    const entries = Array.isArray(parsed?.entries)
      ? parsed.entries.filter((entry) => entry
        && typeof entry.key === 'string'
        && (entry.source === 'local' || entry.source === 'remote')
        && typeof entry.path === 'string')
        .map((entry) => ({
          key: entry.key,
          source: entry.source,
          path: entry.path,
          name: typeof entry.name === 'string' && entry.name ? entry.name : path.basename(entry.path) || 'repository',
          updatedAt: entry.updatedAt || null,
        }))
      : [];
    cache = {
      entries,
      activeKey: entries.some((entry) => entry.key === parsed?.activeKey) ? parsed.activeKey : null,
    };
  } catch {
    cache = { entries: [], activeKey: null };
  }
  return cache;
}

async function persist(data) {
  await mkdir(path.dirname(workspacePath), { recursive: true });
  const temporary = `${workspacePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, workspacePath);
}

function snapshot(data) {
  return {
    entries: data.entries.map((entry) => ({ ...entry })),
    activeKey: data.activeKey,
  };
}

export async function listWorkspace() {
  return snapshot(await load());
}

export async function activateRepository(repository) {
  const data = await load();
  const key = keyFor(repository);
  const entry = {
    key,
    source: repository.source,
    path: repository.source === 'remote' ? repository.remoteUrl : repository.root,
    name: nameFor(repository),
    updatedAt: new Date().toISOString(),
  };
  const index = data.entries.findIndex((candidate) => candidate.key === key);
  if (index === -1) data.entries.push(entry);
  else data.entries[index] = { ...data.entries[index], ...entry };
  data.activeKey = key;
  while (data.entries.length > MAX_ENTRIES) {
    let drop = -1;
    for (let cursor = data.entries.length - 1; cursor >= 0; cursor -= 1) {
      if (data.entries[cursor].key !== data.activeKey) {
        drop = cursor;
        break;
      }
    }
    if (drop === -1) break;
    data.entries.splice(drop, 1);
  }
  saveChain = saveChain.then(() => persist(data)).catch(() => {});
  await saveChain;
  return { ...snapshot(data), entryKey: key };
}

export async function activateWorkspaceKey(key) {
  const data = await load();
  if (typeof key === 'string' && key && data.entries.some((entry) => entry.key === key)) {
    data.activeKey = key;
    saveChain = saveChain.then(() => persist(data)).catch(() => {});
    await saveChain;
  }
  return snapshot(data);
}

export async function removeWorkspaceEntry(key) {
  const data = await load();
  const before = data.entries.length;
  data.entries = data.entries.filter((entry) => entry.key !== key);
  if (data.activeKey === key) data.activeKey = data.entries[0]?.key || null;
  const closed = data.entries.length !== before;
  if (closed) {
    saveChain = saveChain.then(() => persist(data)).catch(() => {});
    await saveChain;
  }
  return { ...snapshot(data), closed };
}