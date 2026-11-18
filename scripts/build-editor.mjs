// one-shot: code-reader 应用构建脚本（本项目固定模块，非 agent 探索脚本）; no-generalize: 仅用于构建 code-reader 前端编辑器包
// grill: 成品检索=skill 库无 code-reader 构建脚本成品; 输入固定=web-src/editor.js 与固定 outfile; 步骤机械=esbuild 单入口打包; 判读固定=exit code 与产物大小; 失效场景=构造不出（仅本应用）
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