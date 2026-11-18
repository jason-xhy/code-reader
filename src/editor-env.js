// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 本地 vim/neovim 环境探测与配置与 code-reader 编辑器面板强绑定
// grill: 成品检索=skill 库无 code-reader 编辑器环境探测成品; 输入固定=固定版本探测与固定配置路径; 步骤机械=探测二进制/config/插件目录→合并保存的偏好; 判读固定=进程退出码与目录条目数; 失效场景=构造不出（仅本应用）
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './errors.js';
import { dataPath } from './paths.js';

const execFileAsync = promisify(execFile);
const configPath = dataPath('editor-config.json');
const PROBE_TIMEOUT = 5_000;
const PROGRAM_RE = /^[A-Za-z0-9_./-]+$/;

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function directoryCount(target) {
  try {
    const entries = await readdir(target, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

// 统计 <base>/<group>/start 形态的包管理目录（vim 8 原生 pack、nvim site pack 同构）。
async function packageCount(base) {
  let groups = [];
  try {
    groups = await readdir(base, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    total += await directoryCount(path.join(base, group.name, 'start'));
  }
  return total;
}

async function probeProgram(command) {
  if (!PROGRAM_RE.test(command)) return { available: false, command, version: null };
  try {
    const { stdout } = await execFileAsync(command, ['--version'], { timeout: PROBE_TIMEOUT });
    const first = String(stdout || '').split('\n').find((line) => line.trim()) || '';
    return { available: true, command, version: first.trim() };
  } catch {
    return { available: false, command, version: null };
  }
}

async function nvimEnvironment(home) {
  const configDir = path.join(home, '.config', 'nvim');
  const dataDir = path.join(home, '.local', 'share', 'nvim');
  const managers = [];
  if (await exists(path.join(configDir, 'lazy-lock.json'))) managers.push('lazy.nvim');
  if (await exists(path.join(dataDir, 'site', 'autoload', 'plug.vim'))) managers.push('vim-plug');
  const pluginCount = (await directoryCount(path.join(dataDir, 'lazy')))
    + (await directoryCount(path.join(dataDir, 'plugged')))
    + (await packageCount(path.join(dataDir, 'site', 'pack')))
    + (await packageCount(path.join(configDir, 'pack')));
  const hasConfig = await exists(path.join(configDir, 'init.lua')) || await exists(path.join(configDir, 'init.vim'));
  return { configDir, hasConfig, pluginCount, managers };
}

async function vimEnvironment(home) {
  const configDir = path.join(home, '.vim');
  const managers = [];
  if (await exists(path.join(configDir, 'autoload', 'plug.vim'))) managers.push('vim-plug');
  const pluginCount = (await directoryCount(path.join(configDir, 'bundle')))
    + (await directoryCount(path.join(configDir, 'plugged')))
    + (await packageCount(path.join(configDir, 'pack')));
  const hasConfig = await exists(path.join(home, '.vimrc')) || await exists(path.join(home, '.vim', 'vimrc'));
  return { configDir, hasConfig, pluginCount, managers };
}

async function readSaved() {
  try {
    const data = JSON.parse(await readFile(configPath, 'utf8'));
    const program = ['auto', 'nvim', 'vim', 'custom', 'builtin'].includes(data.program) ? data.program : 'auto';
    return {
      program,
      command: typeof data.command === 'string' ? data.command : '',
      appName: typeof data.appName === 'string' ? data.appName : '',
    };
  } catch {
    return { program: 'auto', command: '', appName: '' };
  }
}

function pickActive(saved, nvim, vim) {
  if (saved.program === 'builtin') return { program: 'builtin', command: '', appName: '' };
  if (saved.program === 'custom') {
    return { program: 'custom', command: saved.command, appName: saved.appName };
  }
  if (saved.program === 'nvim') {
    return nvim.available
      ? { program: 'nvim', command: nvim.command, appName: saved.appName }
      : { program: 'builtin', command: '', appName: '', fallback: true };
  }
  if (saved.program === 'vim') {
    return vim.available
      ? { program: 'vim', command: vim.command, appName: '' }
      : { program: 'builtin', command: '', appName: '', fallback: true };
  }
  if (nvim.available) return { program: 'nvim', command: nvim.command, appName: saved.appName };
  if (vim.available) return { program: 'vim', command: vim.command, appName: '' };
  return { program: 'builtin', command: '', appName: '', fallback: true };
}

export async function editorStatus() {
  const home = os.homedir();
  const saved = await readSaved();
  const nvimCommand = process.env.CODE_READER_NVIM_ORIGINAL || 'nvim';
  const nvimBase = await probeProgram(nvimCommand);
  const vimBase = await probeProgram(process.env.CODE_READER_VIM || 'vim');
  const nvim = { ...nvimBase, ...(await nvimEnvironment(home)) };
  const vim = { ...vimBase, ...(await vimEnvironment(home)) };
  const active = pickActive(saved, nvim, vim);
  if (active.program === 'custom' && active.command) {
    const custom = await probeProgram(active.command);
    active.version = custom.version;
    active.fallback = !custom.available;
  }
  return {
    nvim,
    vim,
    saved,
    active,
    available: active.program !== 'builtin' && !active.fallback,
  };
}

export async function saveEditorConfig(body) {
  const program = String(body?.program || 'auto');
  if (!['auto', 'nvim', 'vim', 'custom', 'builtin'].includes(program)) {
    throw new AppError('未知的编辑器选择', 400, 'INVALID_EDITOR_PROGRAM');
  }
  const command = typeof body?.command === 'string' ? body.command.trim() : '';
  if (command && !PROGRAM_RE.test(command)) {
    throw new AppError('自定义命令只允许路径与命令名字符', 400, 'INVALID_EDITOR_COMMAND');
  }
  if (program === 'custom' && !command) {
    throw new AppError('自定义模式需要填写命令或绝对路径', 400, 'INVALID_EDITOR_COMMAND');
  }
  const appName = typeof body?.appName === 'string' ? body.appName.trim() : '';
  if (appName && !/^[A-Za-z0-9._-]+$/.test(appName)) {
    throw new AppError('配置名只允许字母、数字、点、下划线和连字符', 400, 'INVALID_EDITOR_APPNAME');
  }
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ program, command, appName }, null, 2)}\n`, { mode: 0o600 });
  applyEditorEnv({ program, command, appName });
  return editorStatus();
}

// 把配置投影到环境变量：nvim 面板（src/nvim.js）与子进程按此启动。
export function applyEditorEnv(saved) {
  if (saved.program === 'builtin') {
    process.env.CODE_READER_EDITOR_DISABLED = '1';
    return;
  }
  delete process.env.CODE_READER_EDITOR_DISABLED;
  const original = process.env.CODE_READER_NVIM_ORIGINAL;
  if (saved.program === 'custom' && saved.command) {
    process.env.CODE_READER_NVIM = saved.command;
  } else if (saved.program === 'vim') {
    process.env.CODE_READER_NVIM = process.env.CODE_READER_VIM || 'vim';
  } else if (saved.program === 'nvim') {
    process.env.CODE_READER_NVIM = original || 'nvim';
  } else if (saved.program === 'auto') {
    if (original) process.env.CODE_READER_NVIM = original;
    else delete process.env.CODE_READER_NVIM;
  }
  if (saved.appName) process.env.NVIM_APPNAME = saved.appName;
  else delete process.env.NVIM_APPNAME;
}

export async function initEditorEnv() {
  const saved = await readSaved();
  if (process.env.CODE_READER_NVIM && !process.env.CODE_READER_NVIM_ORIGINAL) {
    process.env.CODE_READER_NVIM_ORIGINAL = process.env.CODE_READER_NVIM;
  }
  applyEditorEnv(saved);
}