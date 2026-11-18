// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 阅读历史持久化与 code-reader 仓库模型强绑定
// grill: 成品检索=skill 库无 code-reader 阅读历史成品; 输入固定=.data/history.json 与固定仓库字段; 步骤机械=读取/合并/原子写; 判读固定=路径与位置字段; 失效场景=构造不出（仅本应用）
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from './paths.js';

const historyPath = dataPath('history.json');
const MAX_REPOSITORIES = 30;
let cache = null;
let saveChain = Promise.resolve();

function repositoryName(repository) {
  if (repository.source === 'remote' && repository.remoteUrl) {
    const tail = repository.remoteUrl.replace(/\/+$/, '').split(/[/:]/).pop() || 'repository';
    return tail.replace(/\.git$/i, '');
  }
  return path.basename(repository.root || '') || 'repository';
}

function keyFor(repository) {
  return repository.source === 'remote' && repository.remoteUrl
    ? `remote:${repository.remoteUrl}`
    : `local:${repository.root}`;
}

async function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(historyPath, 'utf8'));
    cache = {
      repositories: parsed && typeof parsed.repositories === 'object' && parsed.repositories ? parsed.repositories : {},
      recent: Array.isArray(parsed?.recent) ? parsed.recent : [],
    };
  } catch {
    cache = { repositories: {}, recent: [] };
  }
  return cache;
}

async function persist(data) {
  await mkdir(path.dirname(historyPath), { recursive: true });
  const temporary = `${historyPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, historyPath);
}

export async function touchRepository(repository, updates = {}) {
  const data = await load();
  const key = keyFor(repository);
  const existing = data.repositories[key] || {};
  const now = new Date().toISOString();
  const entry = {
    key,
    source: repository.source,
    name: repositoryName(repository),
    path: repository.source === 'remote' ? repository.remoteUrl : repository.root,
    root: repository.root,
    lastFile: existing.lastFile || null,
    lastLine: existing.lastLine || 1,
    lastCharacter: existing.lastCharacter || 0,
    openedAt: updates.opened ? now : (existing.openedAt || now),
    updatedAt: now,
  };
  if (typeof updates.file === 'string' && updates.file) entry.lastFile = updates.file;
  if (Number.isInteger(updates.line) && updates.line > 0) entry.lastLine = updates.line;
  if (Number.isInteger(updates.character) && updates.character >= 0) entry.lastCharacter = updates.character;
  data.repositories[key] = entry;
  data.recent = [key, ...data.recent.filter((candidate) => candidate !== key)].slice(0, MAX_REPOSITORIES);
  for (const stale of Object.keys(data.repositories)) {
    if (!data.recent.includes(stale)) delete data.repositories[stale];
  }
  saveChain = saveChain.then(() => persist(data)).catch(() => {});
  await saveChain;
  return entry;
}

export async function listHistory() {
  const data = await load();
  const repositories = data.recent
    .map((key) => data.repositories[key])
    .filter(Boolean)
    .map((entry) => ({
      key: entry.key,
      source: entry.source,
      name: entry.name,
      path: entry.path,
      lastFile: entry.lastFile,
      lastLine: entry.lastLine,
      lastCharacter: entry.lastCharacter,
      openedAt: entry.openedAt,
      updatedAt: entry.updatedAt,
    }));
  return { repositories };
}

export async function getResume(repository) {
  const data = await load();
  const entry = data.repositories[keyFor(repository)];
  if (!entry || !entry.lastFile) return null;
  return { file: entry.lastFile, line: entry.lastLine || 1, character: entry.lastCharacter || 0 };
}

export async function removeHistory(key) {
  if (typeof key !== 'string' || !key) return { removed: false };
  const data = await load();
  const removed = Boolean(data.repositories[key]);
  delete data.repositories[key];
  data.recent = data.recent.filter((candidate) => candidate !== key);
  saveChain = saveChain.then(() => persist(data)).catch(() => {});
  await saveChain;
  return { removed };
}

export async function clearHistory() {
  const data = await load();
  data.repositories = {};
  data.recent = [];
  saveChain = saveChain.then(() => persist(data)).catch(() => {});
  await saveChain;
  return { cleared: true };
}