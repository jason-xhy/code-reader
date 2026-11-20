// 语法检查：遍历应用源码目录，新增模块无需改 package.json。
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const roots = ['server.js', 'src', 'public', 'web-src', 'scripts'];
const skip = new Set(['node_modules', 'vendor', '.data', '.git', 'bug-reports']);

function collect(target, files = []) {
  const absolute = path.join(root, target);
  let info;
  try {
    info = statSync(absolute);
  } catch {
    return files;
  }
  if (info.isFile()) {
    if (/\.(?:m?js)$/.test(absolute)) files.push(absolute);
    return files;
  }
  for (const entry of readdirSync(absolute)) {
    if (skip.has(entry)) continue;
    collect(path.join(target, entry), files);
  }
  return files;
}

const files = roots.flatMap((target) => collect(target));
for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log(`check: ${files.length} 个 JS 文件语法通过`);