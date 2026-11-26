// 用途：白盒测试 —— kconfig/parser.js 预处理器 $(VAR) 递归展开无环检测。
import { parseKconfigTree } from '../src/kconfig/parser.js';
try {
  const model = await parseKconfigTree('/tmp/whitebox/kcfg-recurse');
  console.log('OK: symbols =', [...model.symbols.keys()].join(','));
} catch (error) {
  console.log(`异常: ${error.constructor.name}: ${String(error.message).slice(0, 80)}`);
}
