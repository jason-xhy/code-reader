// node-pty's published macOS spawn-helper may arrive without its executable bit.
import { createRequire } from 'node:module';
import { chmod, stat } from 'node:fs/promises';
import path from 'node:path';
if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('node-pty/package.json'));
  const candidates = [path.join(root, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper'), path.join(root, 'build', 'Release', 'spawn-helper')];
  for (const helper of candidates) {
    try {
      const info = await stat(helper);
      if (!(info.mode & 0o100)) await chmod(helper, info.mode | 0o111);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
