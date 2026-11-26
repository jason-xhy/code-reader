// 用途：白盒测试 —— kconfig/parser.js 续行处理（CRLF / 行尾注释）最小复现。
// 运行：node scripts/whitebox-kconfig-parser-test.mjs（fixture 自动写入 /tmp/whitebox，不碰产品数据）
// 预期：三种形态的 dirDep 均成功解析（续行剥离错位时会得到 null —— 依赖条件静默丢失）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseKconfigTree } from '../src/kconfig/parser.js';

function fixture(name, content) {
  const dir = `/tmp/whitebox/${name}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/Kconfig`, content);
  return dir;
}

// LF 对照：`X \` + `|| CONFIG_Y`
const LF = fixture('kcfg-ok', 'config LF_TEST\n\tbool "test"\n\tdepends on X \\\n\t|| CONFIG_Y\n');
// CRLF：`\` 后跟 \r\n（xxd 确认过 `5c 0d 0a` 字节序列）
const CRLF = fixture('kcfg-crlf', 'config CRLF_TEST\n\tbool "test"\n\tdepends on X \\\r\n\t|| CONFIG_Y\r\n\r\nconfig PLAIN\r\n\tbool "plain"\r\n');
// 反斜杠后行尾注释：`X \ # note`
const COMMENT = fixture('kcfg-comment', 'config COMMENT_TEST\n\tbool "test"\n\tdepends on X \\ # note\n\t&& CONFIG_Y\n');
// CRLF + 行尾注释组合
const MIXED = fixture('kcfg-mixed', 'config MIXED_TEST\n\tbool "test"\n\tdepends on X \\ # note\r\n\t|| CONFIG_Y\r\n');

const EXPECTED = {
  LF: { LF_TEST: { t: 'or', l: { t: 'sym', name: 'X' }, r: { t: 'sym', name: 'CONFIG_Y' } } },
  CRLF: { CRLF_TEST: { t: 'or', l: { t: 'sym', name: 'X' }, r: { t: 'sym', name: 'CONFIG_Y' } } },
  COMMENT: { COMMENT_TEST: { t: 'and', l: { t: 'sym', name: 'X' }, r: { t: 'sym', name: 'CONFIG_Y' } } },
  MIXED: { MIXED_TEST: { t: 'or', l: { t: 'sym', name: 'X' }, r: { t: 'sym', name: 'CONFIG_Y' } } },
};

let pass = 0;
let fail = 0;
async function check(label, root, symbols) {
  const model = await parseKconfigTree(root);
  const names = Object.keys(symbols);
  const entry = model.symbols.get(names[0]);
  const got = entry ? entry.dirDep : undefined;
  const want = symbols[names[0]];
  const gotJson = got ? JSON.stringify(got) : String(got);
  const wantJson = want ? JSON.stringify(want) : String(want);
  if (gotJson === wantJson) {
    pass += 1;
    console.log(`PASS ${label}: dirDep = ${gotJson}`);
  } else {
    fail += 1;
    console.log(`FAIL ${label}\n  want ${wantJson}\n  got  ${gotJson}`);
  }
  const warnings = model.warnings.filter((w) => !w.includes('未执行')).join(' | ');
  if (warnings) console.log(`  warnings: ${warnings}`);
}

await check('LF    （正常对照）', LF, EXPECTED.LF);
await check('CRLF  （回车结尾续行）', CRLF, EXPECTED.CRLF);
await check('COMMENT（反斜杠后行尾注释）', COMMENT, EXPECTED.COMMENT);
await check('MIXED （CRLF + 行尾注释）', MIXED, EXPECTED.MIXED);

console.log(`\nRESULT ${pass} pass / ${fail} fail`);
process.exitCode = fail ? 1 : 0;
