// 定义识别策略：从一行源码判断它是不是函数定义，并取出函数名与列号。
// 只做文本启发式（与语言无关的规则集中在此），C 系优先，其它语言按关键字补充。
const C_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'return', 'sizeof', 'do', 'else', 'case', 'goto',
  'typeof', 'defined', 'alignof', 'offsetof', 'catch', 'try', 'throw', 'new', 'delete',
  '__attribute__', '__asm__', 'asm', '__extension__', '_Static_assert', 'static_assert',
]);

// 汇编入口宏：SYM_FUNC_START(foo) / ENTRY(foo) 的真实函数名在括号里。
const ASM_MACROS = [
  'SYM_FUNC_START', 'SYM_FUNC_START_LOCAL', 'SYM_FUNC_START_WEAK',
  'SYM_FUNC_START_ALIAS', 'SYM_FUNC_START_LOCAL_NOALIGN', 'SYM_FUNC_START_NOALIGN',
  'SYM_FUNC_START_WEAK_PIC',
  'SYM_CODE_START', 'SYM_CODE_START_LOCAL', 'SYM_CODE_START_LOCAL_NOALIGN',
  'ENTRY', 'ENTRY_CFI', 'ENTRY_INTERRUPT', 'ENTRY_PARTIAL', 'WEAK', 'GLOBAL',
];
const ASM_CALL = new RegExp(`^[ \\t]*(?:${ASM_MACROS.join('|')})[ \\t]*\\([ \\t]*([A-Za-z_]\\w*)[ \\t]*\\)`);

const LANGUAGE_PATTERNS = [
  { language: 'python', pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
  { language: 'js', pattern: /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
  { language: 'js', pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
  { language: 'js', pattern: /^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/ },
  { language: 'go', pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
  { language: 'rust', pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*)/ },
  { language: 'shell', pattern: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{?/ },
  { language: 'ruby', pattern: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/ },
];

// C/C++/Java 风格：行首是"类型 名称("，且不是原型/调用/控制语句。
function cStyleInfo(text) {
  const indented = /^\s/.test(text);
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return null;
  if (trimmed.startsWith('#')) return null;
  // 以分号结尾的是原型或调用；宏/语句同样排除。
  if (/;\s*$/.test(trimmed)) return null;
  const keyword = trimmed.match(/^([A-Za-z_]\w*)/)?.[1];
  if (keyword && C_KEYWORDS.has(keyword)) return null;
  const offset = text.length - text.trimStart().length;
  // 类型前缀（至少一个词），再跟函数名与左括号。
  const typed = trimmed.match(/^((?:[A-Za-z_]\w*[\s*&]+)+)([A-Za-z_]\w*)\s*\(/);
  if (typed) {
    const name = typed[2];
    if (C_KEYWORDS.has(name)) return null;
    return { name, index: offset + typed[1].length };
  }
  // 顶格的 K&R 风格：函数名单独一行（返回类型在上一行）。
  if (indented) return null;
  const bare = trimmed.match(/^([A-Za-z_]\w*)\s*\(/);
  if (!bare || C_KEYWORDS.has(bare[1])) return null;
  // 全大写裸调用（EXPORT_SYMBOL(foo) 等）是宏，不是函数定义。
  if (/^[A-Z][A-Z0-9_]+$/.test(bare[1])) return null;
  // 排除宏调用与明显的表达式前缀（= . -> 等）。
  if (/[=.]/.test(trimmed.slice(0, bare.index))) return null;
  return { name: bare[1], index: offset + bare.index };
}

// 返回函数名与名称在行内的起始列；服务端用它给搜索结果定位。
export function definitionInfo(line) {
  const text = String(line ?? '');
  if (!text.trim()) return null;
  const asm = text.match(ASM_CALL);
  if (asm) return { name: asm[1], index: asm.index + asm[0].lastIndexOf(asm[1]) };
  // 控制语句先否决：否则 if/for/while (...) { 会被 JS 方法正则误判成函数。
  const head = text.match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (head && C_KEYWORDS.has(head)) return null;
  for (const { pattern } of LANGUAGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1];
      const relative = match[0].lastIndexOf(name);
      return { name, index: match.index + (relative >= 0 ? relative : 0) };
    }
  }
  return cStyleInfo(text);
}

export function definitionName(line) {
  return definitionInfo(line)?.name || null;
}

// Kconfig 符号定义行：config FOO / menuconfig FOO（缩进任意，行尾允许注释）。
const KCONFIG_SYMBOL_RE = /^[ \t]*(?:menu)?config[ \t]+([A-Za-z0-9_]+)[ \t]*(?:#.*)?$/;

// 与 definitionInfo 对应的 Kconfig 版本：返回符号名与名称在行内的起始列。
// 只对 Kconfig 命名的文件调用（由调用方按 basename 网关）。
export function kconfigSymbolInfo(line) {
  const text = String(line ?? '');
  const match = text.match(KCONFIG_SYMBOL_RE);
  if (!match) return null;
  return { name: match[1], index: text.indexOf(match[1]) };
}