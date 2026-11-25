// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 编译数据库生成与 LSP 层强绑定
// grill: 成品检索=skill 库无 code-reader 编译数据库成品; 输入固定=仓库根+文件列表+仓库 id; 步骤机械=探测/生成/清理固定路径; 判读固定=文件存在性; 失效场景=构造不出（仅本应用）
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from './paths.js';

const lspDataRoot = dataPath('lsp');
const SOURCE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx']);
const CPP_EXTENSIONS = new Set(['.cc', '.cpp', '.cxx']);

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function clearCompilationDatabase(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/i.test(id)) return;
  await rm(path.join(lspDataRoot, id), { recursive: true, force: true });
}

export async function prepareCompilationDatabase(root, files, id, options = {}) {
  if (await exists(path.join(root, 'compile_commands.json')) || await exists(path.join(root, '.ccls'))) {
    return { directory: root, generated: false };
  }
  const directory = path.join(lspDataRoot, id);
  const target = path.join(directory, 'compile_commands.json');
  if (await exists(target)) {
    return { directory, generated: true };
  }
  await mkdir(directory, { recursive: true });

  // 架构优先级：kconfig 解析结果（用户设置）> 环境变量 > x86 默认。
  const arch = String(options.arch || process.env.KERNEL_ARCH || 'x86').replace(/[^a-z0-9_-]/gi, '');
  const includeDirs = [
    path.join(root, 'arch', arch, 'include'),
    path.join(root, 'arch', arch, 'include', 'generated'),
    path.join(root, 'arch', arch, 'include', 'uapi'),
    path.join(root, 'arch', arch, 'include', 'generated', 'uapi'),
    path.join(root, 'include'),
    path.join(root, 'include', 'generated'),
    path.join(root, 'include', 'uapi'),
    path.join(root, 'include', 'generated', 'uapi'),
  ];
  const includeFlags = includeDirs.map((dir) => `-I${dir}`);
  // 解析过配置的树注入 kconfig.h（内核真实编译的入口头，会包含 generated/autoconf.h
  // 并提供 CONFIG_FOO_MODULE / __enabled 等宏）：clangd 由此获得全部 CONFIG 取值。
  const forceIncludes = [];
  const kconfigHeader = path.join(root, 'include', 'linux', 'kconfig.h');
  if ((await exists(path.join(root, 'include', 'generated', 'autoconf.h'))) && (await exists(kconfigHeader))) {
    forceIncludes.push('-include', kconfigHeader);
  }

  const entries = [];
  for (const file of files) {
    const extension = path.extname(file);
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    const absolute = path.join(root, file);
    const std = CPP_EXTENSIONS.has(extension) ? '-std=gnu++17' : '-std=gnu11';
    entries.push({
      directory: root,
      file: absolute,
      arguments: ['cc', std, '-D__KERNEL__', ...forceIncludes, ...includeFlags, '-c', absolute],
    });
  }

  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(entries));
  await rename(temporary, target);
  return { directory, generated: true };
}
