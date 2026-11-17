import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const lspDataRoot = fileURLToPath(new URL('../.data/lsp/', import.meta.url));
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

export async function prepareCompilationDatabase(root, files, id) {
  if (await exists(path.join(root, 'compile_commands.json')) || await exists(path.join(root, '.ccls'))) {
    return { directory: root, generated: false };
  }
  const directory = path.join(lspDataRoot, id);
  const target = path.join(directory, 'compile_commands.json');
  if (await exists(target)) {
    return { directory, generated: true };
  }
  await mkdir(directory, { recursive: true });

  const arch = (process.env.KERNEL_ARCH || 'x86').replace(/[^a-z0-9_-]/gi, '');
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

  const entries = [];
  for (const file of files) {
    const extension = path.extname(file);
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    const absolute = path.join(root, file);
    const std = CPP_EXTENSIONS.has(extension) ? '-std=gnu++17' : '-std=gnu11';
    entries.push({
      directory: root,
      file: absolute,
      arguments: ['cc', std, '-D__KERNEL__', ...includeFlags, '-c', absolute],
    });
  }

  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(entries));
  await rename(temporary, target);
  return { directory, generated: true };
}
