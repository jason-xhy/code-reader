// 用途：白盒测试 —— public/features/config-dim.js computeInactiveRanges 纯逻辑单测。
// 运行：node scripts/whitebox-config-dim-test.mjs（无 DOM 依赖，只调 computeInactiveRanges）
import { computeInactiveRanges } from '../public/features/config-dim.js';

const V = { FOO: 'y', BAR: 'n', MOD: 'm', NUM: '64' };
let pass = 0, fail = 0;
function check(name, content, values, expected) {
  const got = computeInactiveRanges(content, values).map((r) => `${r.from}-${r.to}`).join(',');
  const want = expected.join(',');
  if (got === want) { pass += 1; console.log(`PASS ${name} -> [${got || '∅'}]`); }
  else { fail += 1; console.log(`FAIL ${name}\n  want [${want || '∅'}]\n  got  [${got || '∅'}]\n  content=${JSON.stringify(content)}`); }
}

// 1. 基础：#if 假 → 后续分支置灰，指令行本身不灰
check('if-false', 'a\n#if 0\nb\nc\n#endif\nd', V, ['2-4']);
check('if-true', 'a\n#if 1\nb\n#endif\nc', V, []);
// 2. #ifdef/#ifndef
check('ifdef-n', 'a\n#ifdef CONFIG_BAR\nb\n#endif\nc', V, ['2-3']);
check('ifdef-y', 'a\n#ifdef CONFIG_FOO\nb\n#endif\nc', V, []);
check('ifndef-y', 'a\n#ifndef CONFIG_FOO\nb\n#endif\nc', V, ['2-3']);
// 3. #else：链上已真 → 灰
check('else-after-true', 'a\n#if CONFIG_FOO\nb\n#else\nc\n#endif\nd', V, ['4-5']);
check('else-after-false', 'a\n#if CONFIG_BAR\nb\n#else\nc\n#endif\nd', V, ['2-3']);
// 4. #elif 链：前一分支真，后续 elif 值也真 → 该分支必不编译 → 灰（W-07 修复后与 #else 对称）
check('elif-after-satisfied-true', 'a\n#if CONFIG_FOO\nb\n#elif CONFIG_FOO\nc\n#endif\nd', V, ['4-5']);
// 5. #elif 值假 → 灰
check('elif-false', 'a\n#if CONFIG_FOO\nb\n#elif CONFIG_BAR\nc\n#endif\nd', V, ['4-5']);
// 6. 嵌套：外层假 → 外层区间贯通整个内层组（含内层指令行），到外层 #endif 前
check('nested-outer-false', 'a\n#if CONFIG_BAR\nb\n#if CONFIG_FOO\nc\n#endif\nd\n#endif\ne', V, ['2-7']);
// 7. 内层假外层真：只灰内层假分支（指令行 4 含入，#endif 行 6 不灰）
check('nested-inner-false', 'a\n#if CONFIG_FOO\nb\n#if CONFIG_BAR\nc\n#endif\nd\n#endif\ne', V, ['4-5']);
// 8. 块注释内的指令不生效
check('directive-in-block-comment', 'a\n/*\n#if CONFIG_BAR\nb\n#endif\n*/\nc', V, []);
// 9. 续行（奇数反斜杠）：拼接后的 #if 行（2）含入灰区；BAR=n 使 && 为假
check('continuation', 'a\n#if CONFIG_BAR \\\n&& CONFIG_FOO\nb\n#endif\nc', V, ['2-4']);
// 10. 未知符号不灰（非 CONFIG 符号）
check('unknown-symbol', 'a\n#if DEBUG\nb\n#endif\nc', V, []);
// 11. CONFIG 宏
check('is-enabled-m', 'a\n#if !IS_ENABLED(CONFIG_MOD)\nb\n#endif\nc', V, ['2-3']);
check('is-module-n', 'a\n#if IS_MODULE(CONFIG_FOO)\nb\n#endif\nc', V, ['2-3']);
// 12. 行号边界：文件结尾无 #endif（c 行在未闭合假分支内，也灰）
check('unterminated', 'a\n#if 0\nb\nc', V, ['2-4']);
// 13. elif 之后 else：satisfied 后 else 灰（c 行 5 在真 elif 分支，不灰；else 行 6 起灰）
check('elif-true-then-else', 'a\n#if CONFIG_BAR\nb\n#elif CONFIG_FOO\nc\n#else\nd\n#endif\ne', V, ['2-3', '6-7']);
// 14. defined() 与比较
check('defined-and-cmp', 'a\n#if defined(CONFIG_BAR) || CONFIG_NUM == 64\nb\n#endif\nc', V, []);
// 15. elif 未知值：链上已满足 → 该分支必不编译 → 灰（W-07 与 #else 对称）
check('elif-unknown', 'a\n#if CONFIG_FOO\nb\n#elif defined(DEBUG)\nc\n#endif\nd', V, ['4-5']);
// 16. elif 未知值且链上未满足 → 保守不灰（printk.h 的 #elif defined(DEBUG) 场景）
check('elif-unknown-unsatisfied', 'a\n#if CONFIG_BAR\nb\n#elif defined(DEBUG)\nc\n#endif\nd', V, ['2-3']);

console.log(`\nRESULT ${pass} pass / ${fail} fail`);
