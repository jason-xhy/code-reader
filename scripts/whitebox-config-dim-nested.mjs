// 用途：白盒测试 —— config-dim 嵌套 #if 分支栈缺陷的精确复现。
import { computeInactiveRanges } from '../public/features/config-dim.js';

function show(name, content) {
  const ranges = computeInactiveRanges(content, {});
  console.log(`${name}: ranges = ${JSON.stringify(ranges)}`);
}

// 外层假 + 内层任意：外层区间应在内层指令之后继续（设计注释：「外层区间已覆盖」）
show('外层假/内层真', [
  'code_a',
  '#if 0',
  'code_b',
  '#if 1',
  'code_c',
  '#endif',
  'code_d',
  '#endif',
  'code_e',
].join('\n'));
// 期望（按设计意图）: 2-7；实际？
show('外层假/内层假', [
  'code_a',
  '#if 0',
  'code_b',
  '#if 0',
  'code_c',
  '#endif',
  'code_d',
  '#endif',
  'code_e',
].join('\n'));
// 对照：无嵌套
show('单层假', ['code_a', '#if 0', 'code_b', 'code_c', '#endif', 'code_d'].join('\n'));
