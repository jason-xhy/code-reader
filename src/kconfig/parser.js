// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 纯 JS Kconfig 解析器与内核 Kconfig 语言强绑定
// grill: 成品检索=skill 库无纯 JS Kconfig 解析器成品; 输入固定=内核树根+架构; 步骤机械=source 递归+行解析+表达式 AST; 判读固定=符号/属性/条件模型; 失效场景=构造不出（仅本应用）
// 纯 JS Kconfig 解析器：替代树内 make（scripts/kconfig 的 host 工具首次构建需要
// flex/bison），让缺少 make/flex/bison 的宿主机（如 macOS）也能解析内核配置。
// 语言与评估语义对照 scripts/kconfig（parser.y / symbol.c / conf.c / confdata.c），
// 有偏差处以中文注释标注。
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// ---- 表达式 ----
// AST：{t:'sym',name} | {t:'str',value} | {t:'not',e} | {t:'and'|'or',l,r}
// | {t:'cmp',op:'=='|'!='|'<'|'<='|'>'|'>=',l,r}（比较操作数是 sym/str 叶子）。

export function tokenizeExpression(text) {
  const tokens = [];
  const input = String(text || '').trim();
  let position = 0;
  // 注意：多字符运算符（!=、<=、>=）必须排在单字符（!、<、>）之前，否则 `!=`
  // 会被拆成 `!` 与 `=`，整个表达式解析失败（条件被静默丢弃）。
  while (position < input.length) {
    const match = /^\s*(\(|\)|&&|\|\||==|!=|<=|>=|!|=|<|>|"[^"\n]*"|[^\s()!=&|"]+)/.exec(input.slice(position));
    if (!match || !match[1]) return null;
    tokens.push(match[1]);
    position += match[0].length;
  }
  return tokens.length ? tokens : null;
}

// Kconfig 表达式优先级（parser.y %left）：|| < && < 比较（仅 symbol OP symbol，不可链）< !。
// 语法不完整返回 null；调用方按保守语义处理（default/select 失效并告警）。
export function parseExpression(text) {
  const tokens = tokenizeExpression(text);
  if (!tokens) return null;
  let position = 0;
  const peek = () => tokens[position] || null;

  function parseOperand() {
    const token = peek();
    if (!token) return null;
    position += 1;
    if (token.startsWith('"')) return { t: 'str', value: token.slice(1, -1) };
    return { t: 'sym', name: token };
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return null;
    if (token === '(') {
      position += 1;
      const inner = parseOr();
      if (peek() !== ')') return null;
      position += 1;
      return inner;
    }
    if (token === '!') {
      position += 1;
      const inner = parsePrimary();
      return inner ? { t: 'not', e: inner } : null;
    }
    const left = parseOperand();
    if (!left) return null;
    const next = peek();
    if (next && ['==', '!=', '<', '<=', '>', '>=', '='].includes(next)) {
      position += 1;
      const right = parseOperand();
      if (!right) return null;
      const op = next === '=' ? '==' : next;
      return { t: 'cmp', op, l: left, r: right };
    }
    return left;
  }

  function parseAnd() {
    let left = parsePrimary();
    while (left && peek() === '&&') {
      position += 1;
      const right = parsePrimary();
      if (!right) return null;
      left = { t: 'and', l: left, r: right };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (left && peek() === '||') {
      position += 1;
      const right = parseAnd();
      if (!right) return null;
      left = { t: 'or', l: left, r: right };
    }
    return left;
  }

  const result = parseOr();
  if (!result || position !== tokens.length) return null;
  return result;
}

export function andExpr(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { t: 'and', l: a, r: b };
}

export function orExpr(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { t: 'or', l: a, r: b };
}

// ---- 预处理器：变量赋值 + $(...) 展开 ----

// 无法执行的探测函数（真实 kconfig 经 $(shell) 跑宿主编译器/脚本）：纯 JS 引擎
// 不执行，按“命令失败”返回 'n'（布尔语境＝未启用）。已知偏差：CC_IS_GCC/
// AS_IS_GNU/CC_CAN_LINK 等宿主环境符号得到 n（见 scripts/kconfig-js-check.mjs 统计）。
const UNRUNNABLE_FUNCTION_RE = /^(shell|success|failure|if-success|cc-option|ld-option|as-instr|as-instr64|cc-version|as-version|ld-version|clang-version|rustc-version|pahole-version|cc-name|cc-info|as-info|ld-info|m64-flag|m32-flag|test)\b/;

class Preprocessor {
  constructor(variables) {
    this.variables = new Map(Object.entries(variables));
    this.warnings = [];
    this.warned = new Set();
  }

  note(message) {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.warnings.push(message);
  }

  // 变量赋值行（NAME := / = / += value）。返回 true 表示该行已消费。
  assignment(line) {
    const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*(:=|\+=|=)\s*(.*)$/.exec(line);
    if (!match) return false;
    const [, name, operator, rawValue] = match;
    const value = this.expand(rawValue);
    if (operator === '+=') {
      this.variables.set(name, `${this.variables.get(name) || ''} ${value}`.trim());
    } else {
      this.variables.set(name, value);
    }
    return true;
  }

  // 展开 $(...)：嵌套括号配平；变量递归展开；未知函数 → 'n'。
  expand(text) {
    let output = '';
    let rest = String(text || '');
    for (;;) {
      const start = rest.indexOf('$(');
      if (start === -1) break;
      output += rest.slice(0, start);
      let depth = 1;
      let index = start + 2;
      while (index < rest.length && depth > 0) {
        if (rest[index] === '(') depth += 1;
        else if (rest[index] === ')') depth -= 1;
        index += 1;
      }
      if (depth !== 0) return output + rest;
      output += this.expandCall(rest.slice(start + 2, index - 1));
      rest = rest.slice(index);
    }
    return output + rest;
  }

  expandCall(inner) {
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    if (UNRUNNABLE_FUNCTION_RE.test(name)) {
      this.note(`内置解析器未执行 \`${name}\` 探测命令，按失败(n)处理`);
      return 'n';
    }
    if (name === 'error-if' || name === 'warning-if' || name === 'info' || name === 'filename' || name === 'lineno') {
      return '';
    }
    if (this.variables.has(name)) return this.expand(this.variables.get(name));
    this.note(`\`$(${name})\` 未定义，按空串展开`);
    return '';
  }
}

// ---- 符号模型 ----

function newSymbol(name) {
  return {
    name,
    type: 'unknown',
    prompts: [],        // {text, cond} —— cond 已并入该定义的 scope+depends+prompt if
    defaults: [],       // {expr, cond}
    selects: [],        // {name, cond}
    implies: [],        // {name, cond}
    ranges: [],         // {min, max, cond}
    dirDep: null,       // 多处定义的 OR(scope ∧ depends)
    isChoice: false,
    isChoiceMember: false,
    choice: null,       // 所属 choice 符号对象
    choiceDefaults: [], // choice 的 default 成员：{name, cond}
    optional: false,
    modulesOption: false,
    user: undefined,    // defconfig 用户值：'y'|'m'|'n'|字符串（string 已去引号）
    members: null,      // choice 成员列表
    file: '',
  };
}

export class KconfigModel {
  constructor() {
    this.symbols = new Map();
    this.order = [];
    this.choices = [];
    this.mainmenu = 'Linux Kernel Configuration';
    this.warnings = [];
  }

  symbol(name) {
    let entry = this.symbols.get(name);
    if (!entry) {
      entry = newSymbol(name);
      this.symbols.set(name, entry);
      this.order.push(name);
    }
    return entry;
  }
}

// ---- 文件解析 ----

const TYPE_KEYWORDS = new Set(['bool', 'tristate', 'string', 'hex', 'int']);
const STATEMENT_RE = /^\s*(config|menuconfig|choice|endchoice|menu|endmenu|if|endif|source|comment|mainmenu)\b/;
const MAX_LOADS_PER_FILE = 3;

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (!quote && (character === '"' || character === "'")) quote = character;
    else if (quote && character === quote) quote = null;
    if (character === '#' && !quote) return line.slice(0, index);
  }
  return line;
}

// help 块的缩进按列宽比较（tab 进 8 列，与 zconf.l 一致），字符数会因 tab 混用误判。
function indentColumns(line) {
  let column = 0;
  for (const character of line) {
    if (character === ' ') column += 1;
    else if (character === '\t') column += 8 - (column % 8);
    else break;
  }
  return column;
}

// Kconfig 字符串允许双引号或单引号（单引号内不处理转义，T_WORD_QUOTE 语义）。
function parseQuoted(rest) {
  const input = String(rest || '').trim();
  const double = /^"((?:[^"\\]|\\.)*)"/.exec(input);
  if (double) {
    return { text: double[1].replace(/\\(["\\])/g, '$1'), rest: input.slice(double[0].length) };
  }
  const single = /^'([^']*)'/.exec(input);
  if (single) {
    return { text: single[1], rest: input.slice(single[0].length) };
  }
  return null;
}

// 拆出属性行尾部的 `if <expr>`；值本身带引号时先跳过引号段再找 if。
function splitIfCondition(rest) {
  const trimmed = String(rest || '').trim();
  let searchable = trimmed;
  if (/^["']/.test(trimmed)) {
    const quoted = parseQuoted(trimmed);
    if (quoted) searchable = quoted.rest;
  }
  const match = /(?:^|\s)if\s+(.+)$/.exec(searchable);
  if (!match) return { value: trimmed, condition: null };
  const cut = trimmed.length - searchable.length + match.index;
  return { value: trimmed.slice(0, cut).trim(), condition: parseExpression(match[1]) };
}

// 解析整棵 Kconfig 树（根 Kconfig 起，source 原地递归，同文件最多重复载 3 次）。
export async function parseKconfigTree(root, { arch = '' } = {}) {
  const model = new KconfigModel();
  const preprocessor = new Preprocessor({
    srctree: '.',
    comma: ',',
    quote: '"',
    squote: "'",
    empty: '',
    space: ' ',
    dollar: '$',
    left_paren: '(',
    right_paren: ')',
    ARCH: arch,
    SRCARCH: arch,
    KERNELVERSION: await kernelVersion(root),
    KERNELRELEASE: '',
    CC: 'cc',
    LD: 'ld',
    NM: 'nm',
    AR: 'ar',
    OBJCOPY: 'objcopy',
    RUSTC: 'rustc',
    PAHOLE: 'pahole',
  });

  const loadCounts = new Map();
  let anonymousChoiceIndex = 0;
  // 帧栈：{kind:'if'|'menu'|'choice', condition} —— 条件并入子项 scope；
  // choice 帧的 condition 恒为 null（choice 自身 deps 已入其定义，成员只受
  // choice 符号值上界约束，menu.c 语义）。
  const stack = [];
  // 当前定义（config/menuconfig/choice 属性）：{ target, deps, props, scope }
  // 关闭时统一合成：cond = AND(scope, deps, 属性自己的 if)。
  let definition = null;
  // comment 语句后的属性行（如 `comment "..." + depends on ...`）只作用于注释
  // 节点，不影响任何符号取值；进入 comment 态后忽略属性直到下一条语句。
  let inComment = false;
  let inHelp = false;
  let helpIndent = -1;

  const scopeCondition = () => {
    let condition = null;
    for (const frame of stack) condition = andExpr(condition, frame.condition);
    return condition;
  };

  function closeDefinition() {
    if (!definition) return;
    const { target, deps, props, scope } = definition;
    const defDep = deps.reduce((acc, item) => andExpr(acc, item), scope);
    for (const prop of props) {
      const cond = andExpr(defDep, prop.condition);
      if (prop.kind === 'prompt') target.prompts.push({ text: prop.text, cond });
      else if (prop.kind === 'default') target.defaults.push({ expr: prop.expr, cond });
      else if (prop.kind === 'select') target.selects.push({ name: prop.name, cond });
      else if (prop.kind === 'imply') target.implies.push({ name: prop.name, cond });
      else if (prop.kind === 'range') target.ranges.push({ min: prop.min, max: prop.max, cond });
      else if (prop.kind === 'choice-default') target.choiceDefaults.push({ name: prop.name, cond });
    }
    if (!target.isChoice) target.dirDep = orExpr(target.dirDep, defDep);
    definition = null;
  }

  function openDefinition(target, scope) {
    closeDefinition();
    definition = { target, deps: [], props: [], scope };
  }

  async function loadFile(absolute) {
    const count = loadCounts.get(absolute) || 0;
    if (count >= MAX_LOADS_PER_FILE) return;
    loadCounts.set(absolute, count + 1);
    let content;
    try {
      content = await readFile(absolute, 'utf8');
    } catch {
      model.warnings.push(`Kconfig 文件不存在，已跳过：${path.relative(root, absolute)}`);
      return;
    }
    const relative = path.relative(root, absolute);
    const depth = stack.length;
    const lines = content.split('\n');
    let joined = null;
    let joinedStart = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index];
      if (joined === null) joinedStart = index;
      joined = joined === null ? raw : joined + raw;
      // 表达式支持反斜杠续行（zconf.l：`\<换行>` 被跳过）；help 块内不拼接。
      const stripped = stripComment(joined).replace(/\r$/, '');
      const trailing = /(\\+)\s*$/.exec(stripped);
      if (!inHelp && trailing && trailing[1].length % 2 === 1) {
        // 剥离必须在 stripped 上匹配并按 stripped 切片：原始 joined 尾部可能带
        // CRLF 的 \r 或 `X \ # 注释` 的注释文本，按原始长度切片会删错字符，
        // 反斜杠/注释残片留在拼接行里导致表达式解析失败（依赖条件静默丢失）。
        // processLine 入口本就会再做一次注释/\r 剥离，提前替换无副作用。
        joined = stripped.slice(0, stripped.length - trailing[0].length);
        continue;
      }
      await processLine(joined, `${relative}:${joinedStart + 1}`, absolute, relative);
      joined = null;
    }
    if (joined !== null) {
      await processLine(joined, `${relative}:${joinedStart + 1}`, absolute, relative);
    }
    // 文件内未闭合的 if/menu/choice 属语法异常：回到文件起始深度，避免污染后续文件。
    while (stack.length > depth) stack.pop();
  }

  async function processLine(rawLine, location, absoluteFile, relativeFile) {
    let line = stripComment(rawLine).replace(/\r$/, '');
    if (inHelp) {
      const indent = indentColumns(line);
      if (helpIndent === -1 && line.trim() !== '') {
        helpIndent = indent;
        return;
      }
      if (line.trim() === '' || indent >= helpIndent) return;
      inHelp = false;
      helpIndent = -1;
    }
    line = line.trim();
    if (!line) return;
    if (/^(---)?help(---)?$/.test(line)) {
      inHelp = true;
      helpIndent = -1;
      return;
    }
    if (preprocessor.assignment(line)) return;
    line = preprocessor.expand(line).trim();
    if (!line) return;

    const statement = STATEMENT_RE.exec(line);
    const keyword = statement?.[1];
    if (keyword) inComment = false;
    const rest = statement ? line.slice(statement.index + statement[0].length).trim() : line;

    if (keyword === 'config' || keyword === 'menuconfig') {
      const name = rest.split(/\s+/)[0];
      if (!name) return;
      const entry = model.symbol(name);
      entry.file = location;
      // choice 块内的 config 是成员：成员定义只受「choice 符号值 ∧ 定义内 deps」
      // 上界约束（menu.c：choice 自身作为子项的 parentdep；choice 的 depends 与
      // 外层 if 经 choice 符号值传递，不直接并入）。
      const choiceFrameIndex = stack.findLastIndex((frame) => frame.kind === 'choice');
      if (choiceFrameIndex !== -1) {
        const choice = stack[choiceFrameIndex].choice;
        // choice 帧之后的内层 if/menu 条件仍直接作用（menu.c 的 parentdep 链）。
        let inner = null;
        for (let index = choiceFrameIndex + 1; index < stack.length; index += 1) {
          inner = andExpr(inner, stack[index].condition);
        }
        openDefinition(entry, andExpr({ t: 'sym', name: choice.name }, inner));
        entry.isChoiceMember = true;
        entry.choice = choice;
        choice.members.push(entry);
      } else {
        openDefinition(entry, scopeCondition());
      }
      return;
    }
    if (keyword === 'choice') {
      const name = rest.split(/\s+/)[0];
      let entry;
      if (name) {
        entry = model.symbol(name);
        entry.file = location;
      } else {
        // 匿名 choice：以合成名入符号表（可被表达式引用），输出时按 choice 跳过。
        entry = model.symbol(`__choice_${anonymousChoiceIndex += 1}`);
        entry.anonymous = true;
      }
      entry.isChoice = true;
      entry.members = [];
      model.choices.push(entry);
      openDefinition(entry, scopeCondition());
      stack.push({ kind: 'choice', condition: null, choice: entry });
      return;
    }
    if (keyword === 'endchoice') {
      closeDefinition();
      if (stack.at(-1)?.kind === 'choice') stack.pop();
      return;
    }
    if (keyword === 'menu') {
      closeDefinition();
      stack.push({ kind: 'menu', condition: null, title: parseQuoted(rest)?.text || rest });
      return;
    }
    if (keyword === 'endmenu') {
      closeDefinition();
      if (stack.at(-1)?.kind === 'menu') stack.pop();
      return;
    }
    if (keyword === 'if') {
      closeDefinition();
      stack.push({ kind: 'if', condition: parseExpression(rest) });
      return;
    }
    if (keyword === 'endif') {
      closeDefinition();
      if (stack.at(-1)?.kind === 'if') stack.pop();
      return;
    }
    if (keyword === 'source') {
      closeDefinition();
      const sourcePath = (parseQuoted(rest)?.text ?? (rest.split(/\s+/)[0] || '')).replace(/^\.\//, '');
      if (!sourcePath) return;
      const absolute = path.resolve(root, sourcePath);
      if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
        model.warnings.push(`source 路径越界，已跳过：${sourcePath}`);
        return;
      }
      await loadFile(absolute);
      return;
    }
    if (keyword === 'mainmenu') {
      closeDefinition();
      model.mainmenu = parseQuoted(rest)?.text || 'Linux Kernel Configuration';
      return;
    }
    if (keyword === 'comment') {
      closeDefinition();
      inComment = true;
      return;
    }

    processAttribute(line, location);
  }

  function processAttribute(line, location) {
    if (inComment) return; // comment 的 depends on 等属性不影响符号取值
    if (line.startsWith('depends on')) {
      const expr = parseExpression(line.slice('depends on'.length));
      if (!expr) return;
      if (definition) {
        definition.deps.push(expr);
        return;
      }
      // 无当前定义：menu 的 depends on 并入菜单帧（作用于子项）。
      const frame = stack.at(-1);
      if (frame?.kind === 'menu') frame.condition = andExpr(frame.condition, expr);
      return;
    }
    if (!definition) return;
    const target = definition.target;
    const firstWord = line.split(/\s+/)[0];

    if (TYPE_KEYWORDS.has(firstWord)) {
      if (target.type === 'unknown' || target.type === firstWord) target.type = firstWord;
      const prompt = parseQuoted(line.slice(firstWord.length));
      if (prompt) {
        const { condition } = splitIfCondition(prompt.rest);
        definition.props.push({ kind: 'prompt', text: prompt.text, condition });
      }
      return;
    }
    if (firstWord === 'def_bool' || firstWord === 'def_tristate') {
      if (target.type === 'unknown') target.type = firstWord === 'def_bool' ? 'bool' : 'tristate';
      const { value, condition } = splitIfCondition(line.slice(firstWord.length));
      const expr = parseExpression(value);
      if (expr) definition.props.push({ kind: 'default', expr, condition });
      else model.warnings.push(`default 表达式无法解析（${location}）：${String(value).slice(0, 60)}`);
      return;
    }
    if (firstWord === 'default') {
      const { value, condition } = splitIfCondition(line.slice('default'.length));
      if (target.isChoice) {
        const member = String(value).split(/\s+/)[0];
        if (member) definition.props.push({ kind: 'choice-default', name: member, condition });
        return;
      }
      const expr = parseExpression(value);
      if (expr) definition.props.push({ kind: 'default', expr, condition });
      else model.warnings.push(`default 表达式无法解析（${location}）：${String(value).slice(0, 60)}`);
      return;
    }
    if (firstWord === 'prompt') {
      const prompt = parseQuoted(line.slice('prompt'.length));
      if (prompt) {
        const { condition } = splitIfCondition(prompt.rest);
        definition.props.push({ kind: 'prompt', text: prompt.text, condition });
      }
      return;
    }
    if (firstWord === 'select' || firstWord === 'imply') {
      const { value, condition } = splitIfCondition(line.slice(firstWord.length));
      const name = String(value).split(/\s+/)[0];
      if (name) {
        definition.props.push({ kind: firstWord === 'select' ? 'select' : 'imply', name, condition });
        // select/imply 目标即刻入符号表，保证评估阶段引用可解析。
        model.symbol(name);
      }
      return;
    }
    if (firstWord === 'range') {
      const { value, condition } = splitIfCondition(line.slice('range'.length));
      const parts = String(value).split(/\s+/);
      if (parts.length >= 2) {
        definition.props.push({ kind: 'range', min: parts[0], max: parts[1], condition });
      }
      return;
    }
    if (firstWord === 'optional') {
      target.optional = true;
      return;
    }
    if (firstWord === 'modules') {
      target.modulesOption = true;
      return;
    }
    if (firstWord === 'visible' || firstWord === 'option') {
      // menu 的 visible if 只影响菜单显示；option env=/defconfig_list：均不影响取值。
      return;
    }
    model.warnings.push(`无法识别的 Kconfig 行（${location}）：${line.slice(0, 80)}`);
  }

  await loadFile(path.resolve(root, 'Kconfig'));
  closeDefinition();

  // choice 类型取首个成员类型（menu.c 语义）；tristate choice 的非 tristate
  // 成员额外依赖 choice = y。
  for (const choice of model.choices) {
    if (choice.type === 'unknown') {
      const first = (choice.members || []).find((member) => member.type !== 'unknown');
      choice.type = first ? first.type : 'bool';
    }
    if (choice.type === 'tristate') {
      const choiceIsYes = { t: 'cmp', op: '==', l: { t: 'sym', name: choice.name }, r: { t: 'sym', name: 'y' } };
      for (const member of choice.members || []) {
        if (member.type === 'tristate') continue;
        for (const prompt of member.prompts) prompt.cond = andExpr(prompt.cond, choiceIsYes);
        for (const def of member.defaults) def.cond = andExpr(def.cond, choiceIsYes);
      }
    }
  }

  model.warnings.push(...preprocessor.warnings);
  return model;
}

// 根 Makefile 的 VERSION/PATCHLEVEL/SUBLEVEL → "6.6.103"（mainmenu/autoconf 头文案）。
async function kernelVersion(root) {
  try {
    const content = await readFile(path.join(root, 'Makefile'), 'utf8');
    const pick = (key) => new RegExp(`^${key}\\s*=\\s*(\\S+)`, 'm').exec(content)?.[1] || '';
    const version = pick('VERSION');
    const patchlevel = pick('PATCHLEVEL');
    const sublevel = pick('SUBLEVEL');
    const extraversion = pick('EXTRAVERSION');
    let text = version;
    if (patchlevel) {
      text += `.${patchlevel}`;
      if (sublevel) text += `.${sublevel}`;
    }
    return `${text}${extraversion}`;
  } catch {
    return '';
  }
}
