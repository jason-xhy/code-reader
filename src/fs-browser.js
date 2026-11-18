// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 目录浏览 API 与本地文件系统强绑定
// grill: 成品检索=skill 库无 code-reader 目录浏览成品; 输入固定=绝对路径或空; 步骤机械=realpath/stat/readdir; 判读固定=Dirent 类型与 .git 存在性; 失效场景=构造不出（仅本应用）
import { realpath, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { AppError } from './errors.js';

export async function listDirectories(inputPath) {
  const requested = typeof inputPath === 'string' && inputPath.trim() ? inputPath.trim() : homedir();
  if (requested.includes('\0')) throw new AppError('目录路径无效', 400, 'INVALID_DIRECTORY');
  let target;
  try {
    target = await realpath(requested);
  } catch {
    throw new AppError('目录不存在或不可访问', 400, 'INVALID_DIRECTORY');
  }
  let info;
  try {
    info = await stat(target);
  } catch {
    throw new AppError('目录不可访问', 400, 'INVALID_DIRECTORY');
  }
  if (!info.isDirectory()) throw new AppError('目标不是目录', 400, 'INVALID_DIRECTORY');

  let dirents;
  try {
    dirents = await readdir(target, { withFileTypes: true });
  } catch {
    throw new AppError('没有权限读取该目录', 403, 'DIRECTORY_FORBIDDEN');
  }
  const entries = [];
  for (const dirent of dirents) {
    if (dirent.name === '.git') continue;
    let directory = dirent.isDirectory();
    if (!directory && dirent.isSymbolicLink()) {
      try {
        directory = (await stat(path.join(target, dirent.name))).isDirectory();
      } catch {
        directory = false;
      }
    }
    if (!directory) continue;
    const entryPath = path.join(target, dirent.name);
    let git = false;
    try {
      git = (await stat(path.join(entryPath, '.git'))).isDirectory();
    } catch {
      git = false;
    }
    entries.push({ name: dirent.name, path: entryPath, directory: true, git });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: target,
    parent: path.dirname(target) === target ? null : path.dirname(target),
    home: homedir(),
    entries: entries.slice(0, 2000),
  };
}