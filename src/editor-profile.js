// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 本地 vim/neovim 配置探测与 code-reader 强绑定
// grill: 成品检索=skill 库无 editor profile 成品; 输入固定=editor-env active 命令与固定 profile 脚本; 步骤机械=headless 启动→读 JSON→规整→缓存; 判读固定=profile JSON 字段; 失效场景=构造不出（仅本应用）
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { editorStatus } from './editor-env.js';

const execFileAsync = promisify(execFile);
const NVIM_SCRIPT = fileURLToPath(new URL('./nvim-profile.lua', import.meta.url));
const VIM_SCRIPT = fileURLToPath(new URL('./vim-profile.vim', import.meta.url));
const PROFILE_TIMEOUT = 20_000;
const CACHE_TTL = 60_000;
const MAX_KEYMAPS = 600;

const OPTION_KEYS = [
  'tabstop', 'shiftwidth', 'softtabstop', 'expandtab', 'number', 'relativenumber',
  'cursorline', 'wrap', 'scrolloff', 'list', 'listchars', 'colorcolumn',
  'signcolumn', 'foldenable', 'foldmethod', 'foldlevel', 'showbreak', 'conceallevel',
];
const BOOLEAN_OPTIONS = new Set(['expandtab', 'number', 'relativenumber', 'cursorline', 'wrap', 'list', 'foldenable']);

let cache = { key: '', at: 0, value: null };

function editorEnv(active) {
  const env = { ...process.env };
  if (active.appName) env.NVIM_APPNAME = active.appName;
  else delete env.NVIM_APPNAME;
  // 服务可能从 nvim :terminal 内启动：剔除父实例变量，避免 headless 探测变成客户端。
  delete env.NVIM;
  delete env.NVIM_LISTEN_ADDRESS;
  delete env.NVIM_LOG_FILE;
  return env;
}

function text(value, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function hexColor(value) {
  const match = /^#[0-9a-fA-F]{6}$/.exec(String(value || ''));
  return match ? match[0].toLowerCase() : null;
}

// ---- 字体探测：本地 nvim 跑在终端里，字体来自终端/桌面设置而不是 nvim 自身。
// 依次尝试 nvim guifont（GUI 用户显式设置）→ 终端模拟器配置 → 桌面等宽字体 →
// fc-match。全部失败时返回 null，前端保持默认字体栈。

function cleanFamily(value) {
  const family = String(value || '')
    .replace(/["']/g, ' ')
    .replace(/[<>{};]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return family.slice(0, 80);
}

// 支持 GTK/桌面格式 "DejaVu Sans Mono 12" 与 nvim guifont 格式 "Family:h14"。
export function parseFontSpec(spec) {
  const raw = String(spec || '').trim();
  if (!raw) return null;
  const first = raw.split(',')[0].trim();
  let family = first;
  let points = null;
  const gui = /^(.*?):h([0-9]+(?:\.[0-9]+)?)/i.exec(first);
  if (gui) {
    family = gui[1];
    points = Number(gui[2]);
  } else {
    const desktop = /^(.*\S)\s+([0-9]+(?:\.[0-9]+)?)$/.exec(first);
    if (desktop) {
      family = desktop[1];
      points = Number(desktop[2]);
    }
  }
  family = cleanFamily(family);
  if (!family) return null;
  return { family, points: Number.isFinite(points) && points > 0 ? points : null };
}

// 终端字号单位是 pt（GTK/konsole 亦然），按 96dpi 折算成浏览器 CSS px。
function fontEntry(family, points, source) {
  const clean = cleanFamily(family);
  if (!clean) return null;
  const size = points ? Math.min(22, Math.max(11, Math.round((points * 96) / 72))) : null;
  return { family: clean, points: points || null, sizePx: size, source };
}

function unquote(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length > 1) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function runCommand(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 2500, maxBuffer: 256 * 1024 });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

async function readTextFile(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function detectTerminalFont() {
  const home = os.homedir();

  const kitty = await readTextFile(path.join(home, '.config/kitty/kitty.conf'));
  if (kitty) {
    const family = /^\s*font_family\s+(.+)$/m.exec(kitty)?.[1];
    const size = Number(/^\s*font_size\s+([0-9.]+)/m.exec(kitty)?.[1]);
    if (family) return fontEntry(unquote(family), size || null, 'kitty');
  }

  for (const file of ['.config/alacritty/alacritty.toml', '.alacritty.toml', '.config/alacritty/alacritty.yml']) {
    const text = await readTextFile(path.join(home, file));
    if (!text) continue;
    const family = /^\s*family\s*[:=]\s*["']?([^"'\n]+)["']?\s*$/m.exec(text)?.[1];
    const size = Number(/^\s*size\s*[:=]\s*([0-9.]+)/m.exec(text)?.[1]);
    if (family) return fontEntry(unquote(family), size || null, 'alacritty');
  }

  for (const file of ['.config/wezterm/wezterm.lua', '.wezterm.lua']) {
    const text = await readTextFile(path.join(home, file));
    if (!text) continue;
    const family = /font\s*=\s*wezterm\.font\(\s*['"]([^'"]+)['"]/.exec(text)?.[1];
    const size = Number(/font_size\s*=\s*([0-9.]+)/.exec(text)?.[1]);
    if (family) return fontEntry(unquote(family), size || null, 'wezterm');
  }

  const konsoleDir = path.join(home, '.local/share/konsole');
  try {
    for (const name of await readdir(konsoleDir)) {
      if (!name.endsWith('.profile')) continue;
      const text = await readTextFile(path.join(konsoleDir, name));
      const match = /^Font=(.+?),([0-9.]+),/m.exec(text);
      if (match) return fontEntry(unquote(match[1]), Number(match[2]) || null, 'konsole');
    }
  } catch {
    // 未安装 konsole
  }

  // mate-terminal 只有显式关闭“使用系统字体”时才算终端自有配置。
  const useSystem = unquote(await runCommand('dconf', ['read', '/org/mate/terminal/profiles/default/use-system-font']));
  if (useSystem === 'false') {
    const mateFont = await runCommand('dconf', ['read', '/org/mate/terminal/profiles/default/font']);
    const parsed = parseFontSpec(unquote(mateFont));
    if (parsed) return fontEntry(parsed.family, parsed.points, 'mate-terminal');
  }
  return null;
}

async function detectDesktopFont() {
  if (process.platform === 'darwin') {
    const family = unquote(await runCommand('defaults', ['read', '-g', 'NSFixedPitchFont']));
    const size = Number(unquote(await runCommand('defaults', ['read', '-g', 'NSFixedPitchFontSize'])));
    if (family) return fontEntry(family, size || null, 'macOS 等宽字体');
    return null;
  }

  for (const [command, args, source] of [
    ['dconf', ['read', '/org/mate/desktop/interface/monospace-font-name'], '桌面等宽字体'],
    ['gsettings', ['get', 'org.gnome.desktop.interface', 'monospace-font-name'], '桌面等宽字体'],
  ]) {
    const parsed = parseFontSpec(unquote(await runCommand(command, args)));
    if (parsed) return fontEntry(parsed.family, parsed.points, source);
  }

  // KDE：kdeglobals 的 fixed=Family,10,-1,5,...
  const kdeglobals = await readTextFile(path.join(os.homedir(), '.config/kdeglobals'));
  const kde = /^fixed=(.+?),([0-9.]+),/m.exec(kdeglobals);
  if (kde) return fontEntry(unquote(kde[1]), Number(kde[2]) || null, 'KDE 等宽字体');
  return null;
}

async function detectEditorFont(guifont) {
  const fromGui = parseFontSpec(guifont);
  if (fromGui) return fontEntry(fromGui.family, fromGui.points, 'nvim guifont');
  const terminal = await detectTerminalFont();
  if (terminal) return terminal;
  const desktop = await detectDesktopFont();
  if (desktop) return desktop;
  const fallback = parseFontSpec(await runCommand('fc-match', ['-f', '%{family[0]}', 'monospace']));
  if (fallback) return fontEntry(fallback.family, null, 'fc-match');
  return null;
}

function normalizeFont(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const family = cleanFamily(raw.family);
  if (!family) return null;
  const points = Number(raw.points);
  const sizePx = Number(raw.sizePx);
  return {
    family,
    points: Number.isFinite(points) && points > 0 ? points : null,
    sizePx: Number.isFinite(sizePx) && sizePx >= 9 && sizePx <= 28
      ? Math.round(sizePx)
      : (Number.isFinite(points) && points > 0 ? Math.min(22, Math.max(11, Math.round((points * 96) / 72))) : null),
    source: text(raw.source, 40) || 'detected',
  };
}

function normalizeColors(raw) {
  const colors = {};
  for (const [name, entry] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!/^@?[A-Za-z0-9_.]+$/.test(name) || !entry || typeof entry !== 'object') continue;
    const color = {};
    for (const key of ['fg', 'bg', 'sp']) {
      const value = hexColor(entry[key]);
      if (value) color[key] = value;
    }
    for (const key of ['bold', 'italic', 'underline', 'strikethrough', 'reverse']) {
      if (entry[key]) color[key] = true;
    }
    if (Object.keys(color).length) colors[name] = color;
  }
  return colors;
}

function normalizeKeymaps(raw) {
  const keymaps = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== 'object') continue;
    const mode = text(entry.mode, 4);
    const lhs = text(entry.lhs, 80);
    if (!['n', 'v', 'x', 'i', 'o', 't', 'c'].includes(mode) || !lhs) continue;
    if (lhs.startsWith('<Plug>') || lhs.startsWith('<SNR>')) continue;
    if (Number.isInteger(entry.sid) && entry.sid < 0) continue;
    const desc = text(entry.desc, 160);
    if (/^:help\s/.test(desc)) continue;
    const key = `${mode}\0${lhs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keymaps.push({
      mode,
      lhs,
      rhs: text(entry.rhs, 200),
      desc,
      silent: Boolean(entry.silent),
    });
    if (keymaps.length >= MAX_KEYMAPS) break;
  }
  return keymaps;
}

function normalizeProfile(raw, active, font = null) {
  const options = {};
  for (const key of OPTION_KEYS) {
    const value = raw?.options?.[key];
    if (BOOLEAN_OPTIONS.has(key) && (typeof value === 'boolean' || typeof value === 'number')) {
      options[key] = Boolean(value);
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      options[key] = typeof value === 'string' ? value.slice(0, 200) : value;
    }
  }
  return {
    available: true,
    editor: {
      program: active.program,
      command: active.command,
      version: active.version || null,
      appName: active.appName || '',
    },
    colorscheme: text(raw?.colorscheme, 80) || '(未命名)',
    background: raw?.background === 'light' ? 'light' : 'dark',
    termguicolors: Boolean(raw?.termguicolors),
    leader: text(raw?.leader, 20),
    localleader: text(raw?.localleader, 20),
    font: font || null,
    options,
    colors: normalizeColors(raw?.colors),
    keymaps: normalizeKeymaps(raw?.keymaps),
    generatedAt: new Date().toISOString(),
  };
}

// vim 的 :map 输出按列对齐：mode lhs rhs（lhs 内空格显示为 <Space>）。
function parseVimMapDump(dump) {
  const keymaps = [];
  const seen = new Set();
  for (const line of Array.isArray(dump) ? dump : []) {
    const match = /^([nvxioctl ]{1,2})\s+(\S+)\s+(.*)$/.exec(String(line || ''));
    if (!match) continue;
    const mode = match[1].trim();
    const lhs = match[2];
    const rhs = match[3];
    if (!mode || !lhs || lhs.startsWith('<Plug>') || lhs.startsWith('<SNR>')) continue;
    if (/^:?help\s/.test(rhs)) continue;
    const key = `${mode}\0${lhs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keymaps.push({ mode, lhs, rhs, desc: '', silent: false });
    if (keymaps.length >= MAX_KEYMAPS) break;
  }
  return keymaps;
}

function looksLikeNvim(active) {
  return active.program === 'nvim' || /nvim/i.test(String(active.version || ''));
}

async function extractProfile(active) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'code-reader-profile-'));
  const outFile = path.join(directory, 'profile.json');
  try {
    const nvim = looksLikeNvim(active);
    const script = nvim ? NVIM_SCRIPT : VIM_SCRIPT;
    const args = nvim
      ? ['--headless', '-c', 'lua dofile(vim.env.CR_PROFILE_SCRIPT)']
      : ['--not-a-term', '-es', '-c', `source ${script}`];
    await execFileAsync(active.command, args, {
      env: {
        ...editorEnv(active),
        CR_PROFILE_SCRIPT: script,
        CR_PROFILE_OUT: outFile,
      },
      timeout: PROFILE_TIMEOUT,
      maxBuffer: 8 * 1024 * 1024,
    });
    const raw = JSON.parse(await readFile(outFile, 'utf8'));
    if (!raw?.colors || typeof raw.colors !== 'object') {
      throw new Error('编辑器未返回可用配色信息');
    }
    if (!nvim && Array.isArray(raw.mapdump)) raw.keymaps = parseVimMapDump(raw.mapdump);
    delete raw.mapdump;
    // 字体优先取 fixture/profile 的显式字段，否则按 guifont/终端/桌面设置探测。
    const font = normalizeFont(raw.font) || (await detectEditorFont(raw.guifont));
    return normalizeProfile(raw, active, font);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function editorProfile({ force = false } = {}) {
  // 测试隔离：e2e 用固定 profile 文件替代真实编辑器的 headless 启动。
  const fixture = process.env.CODE_READER_PROFILE_JSON;
  if (fixture) {
    try {
      const raw = JSON.parse(await readFile(fixture, 'utf8'));
      return { ...normalizeProfile(raw, { program: 'stub', command: fixture, version: 'stub' }, normalizeFont(raw.font)), fixture: true };
    } catch (error) {
      return { available: false, editor: { program: 'stub' }, error: error.message };
    }
  }
  const status = await editorStatus();
  const active = status.active;
  if (!status.available || active.program === 'builtin') {
    return {
      available: false,
      editor: { program: 'builtin' },
      reason: '未关联本地 vim/neovim，使用内置编辑器',
    };
  }
  const key = [active.program, active.command, active.appName, active.version, process.env.HOME].join('\0');
  if (!force && cache.value && cache.key === key && Date.now() - cache.at < CACHE_TTL) {
    return { ...cache.value, cached: true };
  }
  try {
    const value = await extractProfile(active);
    cache = { key, at: Date.now(), value };
    return value;
  } catch (error) {
    console.error('[editor-profile] 探测失败：', error?.message || error);
    return {
      available: false,
      editor: { program: active.program, command: active.command, version: active.version || null },
      error: `读取本地编辑器配置失败：${error.message}`,
    };
  }
}