// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 内核 Kconfig 解析与 code-reader 仓库模型强绑定
// grill: 成品检索=skill 库无 code-reader Kconfig 成品; 输入固定=仓库根/架构/defconfig 名; 步骤机械=列表探测+树内 make+解析 .config+落盘; 判读固定=.config 行形态; 失效场景=构造不出（仅本应用）
// 内核配置解析：选定架构与 defconfig，用内核自身的 Kconfig 引擎（make）在源码树内
// 解析出全部符号取值，供跳转定义显示当前值、编译数据库注入 autoconf.h。
// 产物（.config、include/generated/、scripts/kconfig 等）全在内核 .gitignore 内，
// git 状态不受影响；已有 .config 会在解析前备份到 .data。
// O= 外部目录不可用：随源码包发布的树常带 arch/<arch>/include/generated/，会被
// 内核 Makefile 的 outputmakefile "source tree is not clean" 检查挡住。
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import path from 'node:path';
import { AppError } from './errors.js';
import { dataPath } from './paths.js';
import { runGit } from './git.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const STORE_VERSION = 1;
const MAKE_TIMEOUT_MS = 300_000;
const SYNCCONFIG_TIMEOUT_MS = 120_000;
// 架构/defconfig 同时是 make 目标与路径片段：白名单字符集，spawn 本就 shell:false。
const NAME_RE = /^[A-Za-z0-9._-]+$/;
// .config 取值行 / 未设置行。
const VALUE_RE = /^CONFIG_([A-Z0-9_]+)=(.*)$/;
const NOT_SET_RE = /^#\s*CONFIG_([A-Z0-9_]+) is not set$/;
const STORE_TTL_MS = 10 * 60_000;

const stores = new Map();
const resolving = new Map();

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function storePaths(id) {
  return { file: dataPath('kconfig', `${id}.json.gz`), dir: dataPath('kconfig', id) };
}

// arch/ 下含 Kconfig 或 configs 的目录即 make ARCH=... 合法取值（um 也在内）。
export async function listArches(root) {
  try {
    const entries = await readdir(path.join(root, 'arch'), { withFileTypes: true });
    const arches = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, 'arch', entry.name);
      if (await exists(path.join(candidate, 'Kconfig')) || await exists(path.join(candidate, 'configs'))) {
        arches.push(entry.name);
      }
    }
    return arches.sort();
  } catch {
    return [];
  }
}

// defconfig 名即 make 目标；.config 片段（如 virt.config）不是独立目标，不列。
export async function listDefconfigs(root, arch) {
  if (!NAME_RE.test(arch)) return [];
  try {
    const entries = await readdir(path.join(root, 'arch', arch, 'configs'), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /defconfig$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function cleanMakeOutput(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .trim();
}

// 与 runGit 同款的一次性子进程封装：固定参数数组、shell:false、超时 SIGTERM、stderr 截断。
function runMake(root, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('make', args, {
      cwd: root,
      shell: false,
      // LANG=C：make 及其子进程的错误信息保持英文，方便下方按关键字分类。
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new AppError(`make ${args.join(' ')} 超时`, 504, 'KCONFIG_TIMEOUT'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 4 * 1024 * 1024) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 1024 * 1024) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AppError(`无法启动 make：${error.message}`, 503, 'KCONFIG_MAKE_UNAVAILABLE'));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const output = cleanMakeOutput(`${stderr}\n${stdout}`);
      // git 树首次构建 kconfig host 工具需要 flex/bison（发行版 tarball 才带预生成文件）。
      const missingTool = /(flex|bison|lex|yacc)/i.exec(output)?.[1] || null;
      if (missingTool && /(not found|No such file|找不到)/i.test(output)) {
        const line = output.split('\n').find((text) => /flex|bison|lex|yacc/i.test(text)) || '';
        reject(new AppError(
          `构建 Kconfig 工具缺少 ${missingTool}（${line.trim()}）。请先安装：sudo apt install flex bison（或对应发行版命令），然后重试解析。`,
          503,
          'KCONFIG_TOOLS_MISSING',
        ));
        return;
      }
      reject(new AppError(
        `make ${args.join(' ')} 失败：${output.slice(-1600) || `退出码 ${code}`}`,
        400,
        'KCONFIG_MAKE_ERROR',
      ));
    });
  });
}

// .config → { SYMBOL: 取值 }；bool/tristate 未设置记为 'n'，字符串/数字保留原文。
export function parseConfigContent(content) {
  const values = {};
  for (const raw of String(content || '').split('\n')) {
    const line = raw.trim();
    const notSet = NOT_SET_RE.exec(line);
    if (notSet) {
      values[notSet[1]] = 'n';
      continue;
    }
    const set = VALUE_RE.exec(line);
    if (set) values[set[1]] = set[2];
  }
  return values;
}

async function readStore(repository) {
  const cached = stores.get(repository.id);
  if (cached && Date.now() - cached.at < STORE_TTL_MS) return cached.data;
  try {
    const compressed = await readFile(storePaths(repository.id).file);
    const raw = JSON.parse((await gunzipAsync(compressed)).toString('utf8'));
    if (raw?.version === STORE_VERSION && raw.root === repository.root) {
      stores.set(repository.id, { at: Date.now(), data: raw });
      return raw;
    }
  } catch {
    // 无缓存或缓存损坏：视为未解析。
  }
  return null;
}

// 当前解析状态：HEAD 或 .config 失配时只返回元数据并标记 stale，不再提供取值。
export async function kconfigStatus(repository) {
  const store = await readStore(repository);
  if (!store) return null;
  let head = null;
  try {
    head = (await runGit(['rev-parse', '--short', 'HEAD'], { cwd: repository.root, timeout: 10_000 })).trim();
  } catch {
    // 非常规仓库：跳过 head 校验，仅按 .config 存在性判断。
  }
  const stale = (head && store.head && head !== store.head)
    || !(await exists(path.join(repository.root, '.config')));
  const base = {
    arch: store.arch,
    defconfig: store.defconfig,
    head: store.head,
    resolvedAt: store.resolvedAt,
    autoconf: Boolean(store.autoconf),
    warnings: store.warnings || [],
    valuesCount: Object.keys(store.values || {}).length,
  };
  if (stale) return { ...base, stale: true };
  return { ...base, stale: false, values: store.values || {} };
}

// 轻量入口：compile-db 只需要 arch（stale 也用——比 x86 猜测更接近事实）。
export async function kconfigCurrent(repository) {
  const store = await readStore(repository);
  if (!store) return null;
  return { arch: store.arch, defconfig: store.defconfig, resolvedAt: store.resolvedAt };
}

// 取值：CONFIG_FOO → 查 FOO；CONFIG_FOO_MODULE → FOO 为 m 才算 m，否则 n。
export async function kconfigValue(repository, symbol) {
  const status = await kconfigStatus(repository);
  if (!status || status.stale) return null;
  const name = symbol.replace(/^CONFIG_/, '');
  const values = status.values;
  if (!values) return null;
  if (name.endsWith('_MODULE')) {
    const base = name.slice(0, -'_MODULE'.length);
    return { symbol: name, value: values[base] === 'm' ? 'm' : 'n', arch: status.arch, defconfig: status.defconfig };
  }
  return {
    symbol: name,
    value: name in values ? values[name] : 'n',
    arch: status.arch,
    defconfig: status.defconfig,
  };
}

async function pruneBackups(dir) {
  const entries = (await readdir(dir)).filter((name) => /^backup-.*\.config$/.test(name)).sort();
  for (const name of entries.slice(0, -3)) {
    await rm(path.join(dir, name), { force: true });
  }
}

async function resolveOnce(repository, { arch, defconfig }) {
  if (!NAME_RE.test(arch)) throw new AppError('架构名无效', 400, 'INVALID_KCONFIG_NAME');
  if (!NAME_RE.test(defconfig)) throw new AppError('defconfig 名无效', 400, 'INVALID_KCONFIG_NAME');
  const root = repository.root;
  const arches = await listArches(root);
  if (!arches.includes(arch)) {
    throw new AppError(`架构 ${arch} 不存在（arch/ 下未找到）`, 400, 'INVALID_KCONFIG_ARCH');
  }
  const defconfigs = await listDefconfigs(root, arch);
  if (!defconfigs.includes(defconfig)) {
    throw new AppError(`arch/${arch}/configs 下没有 ${defconfig}`, 400, 'INVALID_KCONFIG_DEFCONFIG');
  }

  // 树内 make 会覆盖 .config：先备份到 .data（保留最近 3 份）。
  const { file, dir } = storePaths(repository.id);
  const configPath = path.join(root, '.config');
  if (await exists(configPath)) {
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(configPath, path.join(dir, `backup-${stamp}.config`)).catch(() => {});
    await pruneBackups(dir).catch(() => {});
  }

  await runMake(root, [`ARCH=${arch}`, defconfig], MAKE_TIMEOUT_MS);

  // syncconfig 生成 include/generated/autoconf.h（编译视角的取值头，clangd 注入用）；
  // 失败不影响取值解析，降级为警告。
  let autoconf = false;
  const warnings = [];
  try {
    await runMake(root, [`ARCH=${arch}`, 'syncconfig'], SYNCCONFIG_TIMEOUT_MS);
    autoconf = await exists(path.join(root, 'include', 'generated', 'autoconf.h'));
  } catch (error) {
    warnings.push(`syncconfig 未完成：${error.message}`);
  }
  if (!autoconf && !warnings.length) {
    warnings.push('未生成 include/generated/autoconf.h（clangd 仍按无配置解析）');
  }

  let content;
  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new AppError(`解析后读取 .config 失败：${error.message}`, 500, 'KCONFIG_CONFIG_MISSING');
  }
  const values = parseConfigContent(content);
  if (!Object.keys(values).length) throw new AppError('.config 解析结果为空', 500, 'KCONFIG_EMPTY');
  const head = (await runGit(['rev-parse', '--short', 'HEAD'], { cwd: root, timeout: 15_000 })).trim();
  const store = {
    version: STORE_VERSION,
    root,
    head,
    arch,
    defconfig,
    resolvedAt: Date.now(),
    autoconf,
    warnings,
    values,
  };
  stores.set(repository.id, { at: Date.now(), data: store });
  // 落盘失败不影响本次结果（缓存失败下次需重新解析，值照常可用）。
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, await gzipAsync(Buffer.from(JSON.stringify(store)), { level: 6 }));
    await rename(temporary, file);
  } catch {
    // 忽略缓存写失败。
  }
  return {
    arch,
    defconfig,
    head,
    valuesCount: Object.keys(values).length,
    autoconf,
    warnings,
  };
}

export function resolveKernelConfig(repository, { arch, defconfig }) {
  // 同仓并发解析只跑一次：make 会改写树内 .config，串行最稳。
  const inFlight = resolving.get(repository.id);
  if (inFlight) return inFlight;
  const task = resolveOnce(repository, { arch, defconfig })
    .finally(() => resolving.delete(repository.id));
  resolving.set(repository.id, task);
  return task;
}
