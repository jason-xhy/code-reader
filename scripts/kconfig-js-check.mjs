// one-shot: code-reader 验证脚本（本项目固定脚本）; no-generalize: 对照数据固定为 .data/kconfig 存储
// grill: 成品检索=无同类对照脚本; 输入固定=仓库根+已解析 kconfig 存储; 步骤机械=JS 解析→评估→diff; 判读固定=一致率计数; 失效场景=存储缺失
// 纯 JS Kconfig 解析器对照验证：以 make 解析的存储真值（.data/kconfig/*.json.gz）
// 为基准，对比 JS 解析器对同一 (arch, defconfig) 的取值结果。
// 运行：node scripts/kconfig-js-check.mjs [仓库根]（默认 /home/kylin/klinux）
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import process from 'node:process';

const dataDir = new URL('../.data/kconfig/', import.meta.url).pathname;
const defaultRoot = process.env.CODE_READER_KERNEL_ROOT || '/home/kylin/klinux';

const root = process.argv[2] || defaultRoot;

// 取最新的存储真值（root 匹配）。
const files = await readdir(dataDir).catch(() => []);
const stores = [];
for (const name of files.filter((file) => file.endsWith('.json.gz'))) {
  try {
    const raw = JSON.parse(gunzipSync(await readFile(path.join(dataDir, name))).toString('utf8'));
    if (raw.root === path.resolve(root)) stores.push(raw);
  } catch {
    // 损坏的存储跳过
  }
}
if (!stores.length) {
  console.error(`未找到 ${root} 的 kconfig 存储真值（.data/kconfig/）；先在界面里解析一次。`);
  process.exit(1);
}
const store = stores.sort((a, b) => b.resolvedAt - a.resolvedAt)[0];
console.log(`基准：${path.basename(store.root)} ${store.arch}/${store.defconfig}（make 解析，${Object.keys(store.values).length} 项）`);

const { parseKconfigTree } = await import('../src/kconfig/parser.js');
const { readUserValues, evaluateKconfig } = await import('../src/kconfig/evaluate.js');

const started = Date.now();
const model = await parseKconfigTree(root, { arch: store.arch });
await readUserValues(path.join(root, 'arch', store.arch, 'configs', store.defconfig), model, model.warnings);
const { values, warnings } = evaluateKconfig(model);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const truth = store.values;
const truthKeys = new Set(Object.keys(truth));
const jsKeys = new Set(Object.keys(values));

let consistent = 0;
const missing = []; // 真值有、JS 无
const extra = []; // JS 有、真值无
const mismatched = []; // 都有但值不同
for (const key of truthKeys) {
  if (!(key in values)) {
    missing.push([key, truth[key]]);
    continue;
  }
  if (values[key] === truth[key]) consistent += 1;
  else mismatched.push([key, truth[key], values[key]]);
}
for (const key of jsKeys) {
  if (!truthKeys.has(key)) extra.push([key, values[key]]);
}

const total = Object.keys(truth).length;
const rate = ((consistent / total) * 100).toFixed(2);
console.log(`JS 解析：${Object.keys(values).length} 项，耗时 ${elapsed}s`);
console.log(`一致 ${consistent}/${total}（一致率 ${rate}%）· 缺失 ${missing.length} · 多出 ${extra.length} · 不一致 ${mismatched.length}`);

const LIMIT = 30;
if (missing.length) {
  console.log(`\n-- 缺失（真值有 / JS 无）前 ${Math.min(LIMIT, missing.length)} 条 --`);
  for (const [key, value] of missing.slice(0, LIMIT)) console.log(`  ${key} = ${value}`);
}
if (extra.length) {
  console.log(`\n-- 多出（JS 有 / 真值无）前 ${Math.min(LIMIT, extra.length)} 条 --`);
  for (const [key, value] of extra.slice(0, LIMIT)) console.log(`  ${key} = ${value}`);
}
if (mismatched.length) {
  console.log(`\n-- 不一致（真值 / JS）前 ${Math.min(LIMIT, mismatched.length)} 条 --`);
  for (const [key, truthValue, jsValue] of mismatched.slice(0, LIMIT)) {
    console.log(`  ${key}: 真值 ${truthValue} → JS ${jsValue}`);
  }
}
if (warnings.length) {
  console.log(`\n-- 解析警告（前 10 条 / 共 ${warnings.length} 条）--`);
  for (const warning of warnings.slice(0, 10)) console.log(`  ${warning}`);
}
const passed = consistent / total >= 0.99;
console.log(`\n结论：一致率 ${rate}% ${passed ? '≥' : '<'} 99% 目标 ${passed ? '（通过）' : '（未达标）'}`);
process.exit(passed ? 0 : 2);
