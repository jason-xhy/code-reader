// 能力：未生效 #if 分支按 kconfig 取值置灰（配置生效时被覆盖的代码正常显示，
// 未选中的分支半透明可见）。取值来自 GET /kconfig/values；未解析 / stale / 非
// 内核树 / 非 C 源文件时完全无行为（只清空装饰）。
// 语义：三值求值 true/false/unknown——含不在 kconfig values 里的符号（DEBUG、
// __KERNEL__ 等）的表达式一律 unknown，该分支不置灰（保守，避免误灰）。
import { state, editor } from '../core/state.js';

const SOURCE_EXTENSIONS = new Set(['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 's']);
const DIRECTIVE_RE = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const CONFIG_NAME_RE = /^CONFIG_[A-Z0-9_]+$/;

let deps = {};
// 请求纪元：切仓库后迟到的响应不得写进新仓库的状态。
let valuesEpoch = 0;

export function initConfigDimFeature(dependencies) {
  deps = dependencies;
}

// ---- 三值表达式求值（true / false / null = unknown）----

// 词法：标识符、数字（含 0x 与 UL 后缀）、字符串、运算符与括号。
// 出现无法识别的字符 → null（整条表达式 unknown）。
function tokenizeExpression(text) {
  const tokens = [];
  let rest = String(text || '');
  while (rest.length) {
    const leading = /^\s+/.exec(rest);
    if (leading) {
      rest = rest.slice(leading[0].length);
      continue;
    }
    const operator = /^(&&|\|\||==|!=|<=|>=|[=!<>()])/.exec(rest);
    if (operator) {
      tokens.push({ kind: 'op', value: operator[0] });
      rest = rest.slice(operator[0].length);
      continue;
    }
    const string = /^"[^"\n]*"|^'[^'\n]*'/.exec(rest);
    if (string) {
      tokens.push({ kind: 'string', value: string[0] });
      rest = rest.slice(string[0].length);
      continue;
    }
    const number = /^(?:0[xX][0-9a-fA-F]+|\d+)[uUlL]*/.exec(rest);
    if (number) {
      tokens.push({ kind: 'number', value: number[0] });
      rest = rest.slice(number[0].length);
      continue;
    }
    const identifier = IDENTIFIER_RE.exec(rest);
    if (identifier) {
      tokens.push({ kind: 'ident', value: identifier[0] });
      rest = rest.slice(identifier[0].length);
      continue;
    }
    return null;
  }
  return tokens;
}

// CONFIG 符号取值：'y' / 'm' / 'n' / 字符串与数字原值 / null（非 CONFIG 符号，
// 无法判定）。values 的键不带 CONFIG_ 前缀（服务端 kconfigStatus().values 形态）。
function configValue(values, name) {
  if (!CONFIG_NAME_RE.test(name)) return null;
  const symbol = name.slice('CONFIG_'.length);
  if (symbol.endsWith('_MODULE')) {
    // CONFIG_X_MODULE 宏定义 ⇔ X = m。
    const base = symbol.slice(0, -'_MODULE'.length);
    return base in values ? (values[base] === 'm' ? 'm' : 'n') : 'n';
  }
  return symbol in values ? values[symbol] : 'n';
}

// 内核 kconfig.h 宏语义：IS_ENABLED = y 或 m；IS_BUILTIN = defined(CONFIG_X)
// （m 时 CONFIG_X 未定义）；IS_MODULE = defined(CONFIG_X_MODULE)；IS_REACHABLE 与
// IS_ENABLED 同义（对 CONFIG_MODULES 的依赖保守忽略，宁可少灰）。
function macroTest(macro, name, values) {
  const value = configValue(values, name);
  if (value === null) return null;
  if (macro === 'IS_MODULE') return value === 'm';
  if (macro === 'IS_BUILTIN') return value === 'y' || (value !== 'm' && value !== 'n');
  return value !== 'n';
}

// defined(CONFIG_X)：y 或已设置（string/hex/int）即真；m/n 即假；非 CONFIG 符号 unknown。
function definedTest(name, values) {
  const value = configValue(values, name);
  if (value === null) return null;
  if (value === 'y') return true;
  if (value === 'm' || value === 'n') return false;
  return true;
}

// 字面量取值：数字直接转数值；裸 CONFIG_X 按 y→1、m/n→0、其余原值（数字或
// 带引号字符串）；y/n 字面量按 1/0；m 字面量 unknown。
function literalValue(token, values) {
  if (token.kind === 'number') return Number(token.value.replace(/[uUlL]+$/, ''));
  if (token.kind === 'string') return null;
  if (token.value === 'y') return 1;
  if (token.value === 'n') return 0;
  if (token.value === 'm') return null;
  const value = configValue(values, token.value);
  if (value === null) return null;
  if (value === 'y') return 1;
  if (value === 'm' || value === 'n') return 0;
  const raw = String(value).replace(/[uUlL]+$/, '');
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

// 三值逻辑：!、&&（任一假即假）、||（任一真即真）、比较（任一 unknown 即 unknown）。
// 字面量层会给 &&/|| 喂 0/1 数字（裸 CONFIG_X、y/n 字面量）：必须先归一成布尔，
// 否则 0 绕不过 `=== false`（`#if CONFIG_X && …`（X=n）误判为真 → 漏灰），而
// `||` 方向 1 绕不过 `=== true`（`#if CONFIG_X || …`（X=y）误判为假 → 误灰活分支）。
// 比较运算要保留数字原值（`CONFIG_NUM == 64`），归一只能放在逻辑运算入口。
function asLogicValue(value) {
  return value === null ? null : Boolean(value);
}

function notOf(value) {
  return value === null ? null : !value;
}

function andOf(left, right) {
  const l = asLogicValue(left);
  const r = asLogicValue(right);
  if (l === false || r === false) return false;
  if (l === null || r === null) return null;
  return true;
}

function orOf(left, right) {
  const l = asLogicValue(left);
  const r = asLogicValue(right);
  if (l === true || r === true) return true;
  if (l === null || r === null) return null;
  return false;
}

function compareOf(operator, left, right) {
  if (left === null || right === null) return null;
  switch (operator) {
    case '=':
    case '==': return left === right;
    case '!=': return left !== right;
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    default: return null;
  }
}

// 递归下降（优先级 || < && < ! < 比较 < 一元/括号/defined/宏/字面量），
// 语法不完整或残留 token 时返回 null。
function evaluateExpression(text, values) {
  const tokens = tokenizeExpression(text);
  if (!tokens || !tokens.length) return null;
  let position = 0;

  const peek = () => tokens[position] || null;
  const matchOp = (...ops) => {
    const token = peek();
    if (token && token.kind === 'op' && ops.includes(token.value)) {
      position += 1;
      return token.value;
    }
    return null;
  };

  const TEST_MACROS = new Set(['IS_ENABLED', 'IS_BUILTIN', 'IS_MODULE', 'IS_REACHABLE']);

  function parsePrimary() {
    const token = peek();
    if (!token) return null;
    if (token.kind === 'op' && token.value === '(') {
      position += 1;
      const inner = parseOr();
      if (!matchOp(')')) return null;
      return inner;
    }
    if (token.kind === 'ident' && (token.value === 'defined' || TEST_MACROS.has(token.value))) {
      position += 1;
      const macro = token.value;
      let name = null;
      if (matchOp('(')) {
        const inner = peek();
        if (inner && inner.kind === 'ident') {
          name = inner.value;
          position += 1;
        }
        if (!matchOp(')')) return null;
      } else {
        // `defined FOO` 无括号形态。
        const inner = peek();
        if (inner && inner.kind === 'ident') {
          name = inner.value;
          position += 1;
        }
      }
      if (!name) return null;
      return macro === 'defined' ? definedTest(name, values) : macroTest(macro, name, values);
    }
    position += 1;
    return literalValue(token, values);
  }

  function parseCmp() {
    const left = parsePrimary();
    const operator = matchOp('=', '==', '!=', '<', '>', '<=', '>=');
    if (!operator) return left;
    return compareOf(operator, left, parsePrimary());
  }

  function parseUnary() {
    if (matchOp('!')) return notOf(parseUnary());
    return parseCmp();
  }

  function parseAnd() {
    let left = parseUnary();
    while (matchOp('&&')) left = andOf(left, parseUnary());
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (matchOp('||')) left = orOf(left, parseAnd());
    return left;
  }

  const result = parseOr();
  if (position !== tokens.length) return null;
  // 裸 CONFIG_X / y / n 字面量得到数字：统一归一成布尔（0 → false）。
  if (typeof result === 'number') return result !== 0;
  return result;
}

// ---- 行区间计算 ----

// 扫描文本后的块注释开闭状态。字符串里的 /* 偶有误差：影响只是保守跳过后续
// 指令判定，不会产生误灰。
function scanComment(text, open) {
  let state = open;
  for (let index = 0; index < text.length; index += 1) {
    if (state) {
      if (text.startsWith('*/', index)) {
        state = false;
        index += 1;
      }
    } else if (text.startsWith('/*', index)) {
      state = true;
      index += 1;
    }
  }
  return state;
}

// 逻辑行：行尾奇数个反斜杠拼接下一行（行拼接先于注释处理）；start/end 为物理
// 行下标（0 基），inComment = 该逻辑行起点是否在块注释内。
function logicalLines(lines) {
  const merged = [];
  let buffer = null;
  let start = 0;
  let commentOpen = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (buffer === null) start = index;
    buffer = buffer === null ? raw : `${buffer} ${raw}`;
    const trailing = /(\\+)\s*$/.exec(raw);
    if (trailing && trailing[1].length % 2 === 1) {
      // 拼接前剥掉续行反斜杠与尾部空白（留在文本里会让表达式词法失败）。
      buffer = buffer.slice(0, buffer.length - trailing[0].length).trimEnd();
      continue;
    }
    const inComment = commentOpen;
    commentOpen = scanComment(buffer, commentOpen);
    merged.push({ text: buffer, start, end: index, inComment });
    buffer = null;
  }
  if (buffer !== null) {
    merged.push({ text: buffer, start, end: lines.length - 1, inComment: commentOpen });
  }
  return merged;
}

// 分支栈（只有能判定的分支才置灰，宁可漏灰不误灰）：
// - #if expr：值为假 → 本分支置灰到下一同级分支指令前；值 unknown 不置灰；
// - #elif expr：链上已有确定为真的分支（satisfied）或本分支值为假 → 置灰
//   （与 #else 对称：链上已满足后任何分支都必不编译）；值 unknown 且链上
//   未满足不置灰（printk.h 的 `#elif defined(DEBUG)`：DEBUG 非 kconfig 符号）；
// - #else：链上已有确定为真的分支（satisfied）→ 置灰；否则（含 #if unknown）不置灰；
// - 嵌套指令属于内层组：外层分支的置灰区间不被内层 #if/#endif 截断（分支
//   状态随栈帧保存，#endif 后外层继续），整个内层组都在外层区间内；外层
//   分支正在置灰时内层分支不再单独置灰（外层区间已覆盖）。
// 返回 [{ from, to }]（1 基行号、闭区间）。
export function computeInactiveRanges(content, values) {
  const lines = String(content || '').split('\n');
  const entries = logicalLines(lines);
  const ranges = [];
  // 栈帧：{ inactive: 整组处于已置灰的祖先分支, satisfied: 链上已有确定为真
  // 的分支, current: 本组当前分支的置灰区间 }。current 随帧保存——内层
  // 指令不再共用单一全局状态，外层假分支不会在第一个内层指令处被丢弃。
  const stack = [];

  // 结束指定帧的当前分支：endLine 为分支最后一行的行号（1 基）。
  const closeBranch = (frame, endLine) => {
    if (frame.current && frame.current.dim && endLine >= frame.current.start) {
      ranges.push({ from: frame.current.start, to: endLine });
    }
    frame.current = null;
  };

  for (const entry of entries) {
    const directive = DIRECTIVE_RE.exec(entry.text);
    if (!directive || entry.inComment) continue;
    const keyword = directive[1];
    const expression = entry.text.slice(directive.index + directive[0].length);
    // entry.start 是指令首行下标（0 基）＝上一分支最后一行的行号（1 基）。
    const previousBranchEnd = entry.start;
    if (keyword === 'if' || keyword === 'ifdef' || keyword === 'ifndef') {
      // 注意：这里不 close 父帧的 current——内层组整体落在父分支区间内，
      // 由父帧在下一个同级指令处统一收口。
      const parent = stack[stack.length - 1] || { inactive: false, current: null };
      let value = null;
      if (keyword === 'if') {
        value = evaluateExpression(expression, values);
      } else {
        const name = (IDENTIFIER_RE.exec(String(expression).trim()) || [])[0] || '';
        const defined = name ? definedTest(name, values) : null;
        value = keyword === 'ifndef' ? notOf(defined) : defined;
      }
      // 外层分支正在置灰（父帧 current.dim）→ 内层组整组并入外层区间。
      const covered = parent.inactive || Boolean(parent.current?.dim);
      stack.push({
        inactive: covered,
        satisfied: value === true,
        current: { start: entry.start + 1, dim: !covered && value === false },
      });
    } else if (keyword === 'elif') {
      const group = stack[stack.length - 1];
      if (!group) continue;
      closeBranch(group, previousBranchEnd);
      const value = evaluateExpression(expression, values);
      // 先用更新前的 satisfied 算 dim（本分支自身为真不算「链上已满足」），
      // 再把本分支的真空入 satisfied 供后续 #elif/#else 使用。
      const dim = !group.inactive && (group.satisfied || value === false);
      if (value === true) group.satisfied = true;
      group.current = { start: entry.start + 1, dim };
    } else if (keyword === 'else') {
      const group = stack[stack.length - 1];
      if (!group) continue;
      closeBranch(group, previousBranchEnd);
      group.current = { start: entry.start + 1, dim: !group.inactive && group.satisfied };
    } else if (keyword === 'endif') {
      const group = stack[stack.length - 1];
      if (!group) continue;
      closeBranch(group, previousBranchEnd);
      stack.pop();
    }
  }
  // 文件结尾未闭合的组（缺 #endif）：从内向外逐帧收口，外层区间覆盖到底。
  for (const frame of stack.slice().reverse()) closeBranch(frame, lines.length);
  return ranges;
}

// ---- 数据加载与应用 ----

function extensionOf(filePath) {
  const index = String(filePath || '').lastIndexOf('.');
  return index === -1 ? '' : filePath.slice(index + 1).toLowerCase();
}

// 仓库打开/切换后拉取取值；到达后对当前文件补一次置灰（文件可能已打开）。
export async function refreshConfigValues() {
  const epoch = ++valuesEpoch;
  const id = state.repository?.id || null;
  if (!id) {
    state.kconfigValues = null;
    applyConfigDim();
    return;
  }
  try {
    const data = await deps.api(`/api/repositories/${encodeURIComponent(id)}/kconfig/values`);
    if (epoch !== valuesEpoch || state.repository?.id !== id) return;
    state.kconfigValues = data;
  } catch {
    if (epoch === valuesEpoch) state.kconfigValues = null;
  }
  applyConfigDim();
}

// 在 renderSource / selectFile 之后调用：按当前文件与取值计算并下发区间；
// 未解析、stale、非 C 源文件、仓库不支持时清空（无行为）。
export function applyConfigDim() {
  if (!editor || !editor.setConfigInactiveRanges) return;
  const values = state.kconfigValues;
  const usable = Boolean(values && values.available && !values.stale && values.values);
  const extension = extensionOf(state.currentFile);
  if (!usable || !state.source || !SOURCE_EXTENSIONS.has(extension)) {
    editor.setConfigInactiveRanges([]);
    return;
  }
  editor.setConfigInactiveRanges(computeInactiveRanges(state.source.content, values.values));
}
