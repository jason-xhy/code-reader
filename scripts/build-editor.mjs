// one-shot: code-reader 应用构建脚本（本项目固定模块，非 agent 探索脚本）; no-generalize: 仅用于构建 code-reader 前端编辑器包
// grill: 成品检索=skill 库无 code-reader 构建脚本成品; 输入固定=web-src/editor.js、web-src/terminal.js 与固定 outfile; 步骤机械=esbuild 双入口打包+复制 xterm 样式; 判读固定=exit code 与产物大小; 失效场景=构造不出（仅本应用）
import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await build({
  entryPoints: ['web-src/editor.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  target: ['chrome100', 'firefox100', 'safari15'],
  outfile: 'public/vendor/cm6/editor.bundle.js',
});
console.log('editor bundle built: public/vendor/cm6/editor.bundle.js');

await build({
  entryPoints: ['web-src/terminal.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  target: ['chrome100', 'firefox100', 'safari15'],
  outfile: 'public/vendor/xterm/terminal.bundle.js',
});
await mkdir('public/vendor/xterm', { recursive: true });
await copyFile('node_modules/@xterm/xterm/css/xterm.css', 'public/vendor/xterm/xterm.css');
console.log('terminal bundle built: public/vendor/xterm/terminal.bundle.js');

await build({
  entryPoints: ['web-src/animation.js'],
  bundle: true,
  format: 'iife',
  globalName: 'CodeReaderAnimationBundle',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  target: ['chrome100', 'firefox100', 'safari15'],
  outfile: 'public/vendor/three/animation.bundle.js',
});
console.log('animation bundle built: public/vendor/three/animation.bundle.js');