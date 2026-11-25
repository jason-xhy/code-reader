// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: Kconfig 取值评估与内核符号语义强绑定
// grill: 成品检索=skill 库无 Kconfig 评估成品; 输入固定=解析模型+defconfig 路径; 步骤机械=读用户值+不动点迭代+格式化输出; 判读固定=values 形态与 autoconf 行; 失效场景=构造不出（仅本应用）
// Kconfig 取值评估：语义对照 scripts/kconfig/symbol.c 的 sym_calc_value /
// sym_calc_visibility 与 conf.c 的 defconfig 模式（conf_set_all_new_symbols(def_default)）。
// 三值算术：n=0 < m=1 < y=2（min/max）。与 C 版的偏差在行内中文注释标注。
import { readFile } from 'node:fs/promises';

const TRI = { n: 0, m: 1, y: 2 };
const TRI_TEXT = ['n', 'm', 'y'];
const MAX_PASSES = 80;

// ---- defconfig 用户值 ----

// .config/defconfig 行 → 用户值（confdata.c conf_read 语义）：
// `# CONFIG_X is not set` → 'n'；CONFIG_X=y/m；CONFIG_X="str"（去引号去转义）；
// int/hex 校验数字合法性。未知符号按 conf 的 warning 处理（跳过）。
export async function readUserValues(defconfigPath, model, warnings = []) {
  let content;
  try {
    content = await readFile(defconfigPath, 'utf8');
  } catch {
    warnings.push(`defconfig 读取失败：${defconfigPath}`);
    return;
  }
  let unknown = 0;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    let match = /^#\s*CONFIG_([A-Za-z0-9_]+) is not set$/.exec(line);
    if (match) {
      const entry = model.symbols.get(match[1]);
      if (!entry) {
        unknown += 1;
        continue;
      }
      entry.user = 'n';
      continue;
    }
    match = /^CONFIG_([A-Za-z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    const entry = model.symbols.get(name);
    if (!entry) {
      unknown += 1;
      continue;
    }
    let value = rawValue;
    if (entry.type === 'bool' || entry.type === 'tristate') {
      if (value === 'y' || value === 'm' || value === 'n') entry.user = value;
      else warnings.push(`符号 ${name} 的用户值无效：${value}`);
      continue;
    }
    if (entry.type === 'string') {
      const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
      if (quoted) entry.user = quoted[1].replace(/\\(["\\])/g, '$1');
      else entry.user = value;
      continue;
    }
    if (entry.type === 'int' || entry.type === 'hex') {
      const valid = entry.type === 'int' ? /^-?\d+$/.test(value) : /^(0[xX])?[0-9a-fA-F]+$/.test(value);
      if (valid) entry.user = value;
      else warnings.push(`符号 ${name} 的数字用户值无效：${value}`);
      continue;
    }
    // unknown 类型（choice 名/未定义符号）：忽略。
  }
  if (unknown > 0) warnings.push(`defconfig 引用了 ${unknown} 个 Kconfig 未定义的符号（已忽略）`);
}

// ---- 评估器 ----

export class Evaluator {
  constructor(model) {
    this.model = model;
    this.tri = new Map();      // name → 0/1/2（string/int/hex 恒 0）
    this.text = new Map();     // name → 当前字符串值
    this.write = new Map();    // name → bool（SYMBOL_WRITE 近似）
    this.selected = new Map(); // choice → 成员名（choice = y 时的选中项）
    // 反向索引：select/imply 的目标视角。
    this.revSelects = new Map();
    this.revImplies = new Map();
    for (const name of model.order) {
      const entry = model.symbols.get(name);
      for (const item of entry.selects) {
        const list = this.revSelects.get(item.name) || [];
        list.push({ from: name, cond: item.cond });
        this.revSelects.set(item.name, list);
      }
      for (const item of entry.implies) {
        const list = this.revImplies.get(item.name) || [];
        list.push({ from: name, cond: item.cond });
        this.revImplies.set(item.name, list);
      }
    }
    // 常量符号：y/m/n。m 在表达式里按 AND(m, MODULES)（menu.c rewrite_m）。
    this.tri.set('y', 2);
    this.text.set('y', 'y');
    this.tri.set('n', 0);
    this.text.set('n', 'n');
    this.tri.set('m', 0); // 占位，evalSym 里按 MODULES 计算
    this.text.set('m', 'm');
  }

  modulesTri() {
    const modules = this.model.symbols.get('MODULES');
    return modules ? this.tri.get('MODULES') || 0 : 0;
  }

  evalSym(name) {
    if (name === 'y') return 2;
    if (name === 'n') return 0;
    if (name === 'm') return Math.min(1, this.modulesTri()); // rewrite_m：'m' → m && MODULES
    const entry = this.model.symbols.get(name);
    if (!entry) return 0; // 未定义符号（S_UNKNOWN）：tri = no
    return this.tri.get(name) || 0;
  }

  // 符号的字符串值（比较运算两侧用）：bool/tristate → n/m/y；string/int/hex →
  // 当前值；未定义符号 → 名字本身（S_UNKNOWN 的 curr.val = name）。
  stringOf(node) {
    if (node.t === 'str') return node.value;
    const name = node.name;
    if (name === 'y' || name === 'm' || name === 'n') return name;
    const entry = this.model.symbols.get(name);
    if (!entry) return name;
    if (entry.type === 'bool' || entry.type === 'tristate') return TRI_TEXT[this.tri.get(name) || 0];
    return this.text.get(name) ?? '';
  }

  evalExpr(expr) {
    if (!expr) return 2; // 空条件恒真（menu.c：NULL → yes）
    if (expr.t === 'sym') return this.evalSym(expr.name);
    if (expr.t === 'str') return 0;
    if (expr.t === 'not') {
      const value = this.evalExpr(expr.e);
      return value === 0 ? 2 : value === 2 ? 0 : 1;
    }
    if (expr.t === 'and') {
      const l = this.evalExpr(expr.l);
      const r = this.evalExpr(expr.r);
      return Math.min(l, r);
    }
    if (expr.t === 'or') {
      const l = this.evalExpr(expr.l);
      const r = this.evalExpr(expr.r);
      return Math.max(l, r);
    }
    if (expr.t === 'cmp') {
      const left = this.stringOf(expr.l);
      const right = this.stringOf(expr.r);
      const numeric = (string) => {
        if (/^-?\d+$/.test(string)) return Number(string);
        if (/^0[xX][0-9a-fA-F]+$/.test(string)) return Number(string);
        return null;
      };
      const l = numeric(left);
      const r = numeric(right);
      let result;
      if (l !== null && r !== null) result = l === r ? 0 : l < r ? -1 : 1;
      else result = left === right ? 0 : left < right ? -1 : 1;
      let truth;
      switch (expr.op) {
        case '==': truth = result === 0; break;
        case '!=': truth = result !== 0; break;
        case '<': truth = result < 0; break;
        case '<=': truth = result <= 0; break;
        case '>': truth = result > 0; break;
        default: truth = result >= 0; break;
      }
      return truth ? 2 : 0;
    }
    return 0;
  }

  // select/imply 反向依赖（symbol.c：rev_dep = OR(各 selecter ∧ 条件)）。
  revDep(name, reverse) {
    let value = 0;
    const entries = reverse === 'select' ? this.revSelects.get(name) : this.revImplies.get(name);
    for (const item of entries || []) {
      value = Math.max(value, Math.min(this.evalSym(item.from), this.evalExpr(item.cond)));
    }
    return value;
  }

  // prompt 可见性（sym_calc_visibility）：OR(各 prompt 条件)；tristate 成员的
  // prompt 值为 m 且 choice = y 时视为不可见；聚合值为 m 且（非 tristate 或
  // MODULES=n）时抬到 y。
  visibility(entry) {
    let value = 0;
    const choice = entry.choice;
    for (const prompt of entry.prompts) {
      let tri = this.evalExpr(prompt.cond);
      if (choice && entry.type === 'tristate' && tri === 1 && (this.tri.get(choice.name) || 0) === 2) tri = 0;
      value = Math.max(value, tri);
    }
    if (value === 1 && (entry.type !== 'tristate' || this.modulesTri() === 0)) value = 2;
    return value;
  }

  // choice 选中成员（sym_calc_choice）：用户选择可见则用之；否则 default 里
  // 首个可见成员；再否则首个可见成员；都没有 → choice 值归 n。
  choiceSelection(choice) {
    const visible = (name) => {
      const member = this.model.symbols.get(name);
      return member ? this.visibility(member) !== 0 : false;
    };
    if (choice.userMember && visible(choice.userMember)) return choice.userMember;
    for (const def of choice.choiceDefaults) {
      if (this.evalExpr(def.cond) === 0) continue;
      if (visible(def.name)) return def.name;
    }
    for (const member of choice.members || []) {
      if (this.visibility(member) !== 0) return member.name;
    }
    return null;
  }

  // 单符号重算（sym_calc_value 的 bool/tristate 主干）。
  calcTriSymbol(entry) {
    const type = entry.type === 'tristate' ? 'tristate' : 'bool';
    const visible = this.visibility(entry);
    let write = visible !== 0;
    const dirDep = entry.dirDep ? this.evalExpr(entry.dirDep) : 2;
    const revDep = this.revDep(entry.name, 'select');
    if (revDep !== 0) write = true;
    const implied = this.revDep(entry.name, 'imply');
    if (implied !== 0) write = true;
    const boolify = (value) => (type === 'bool' && value === 1 ? 2 : value);

    // choice 成员且可见性为 y：值由 choice 选中项决定。
    if (entry.isChoiceMember && visible === 2) {
      const choice = entry.choice;
      const chosen = this.selected.get(choice) || this.choiceSelection(choice);
      return { value: chosen === entry.name ? 2 : 0, write };
    }

    let value = 0;
    const hasUser = entry.user !== undefined && (entry.user === 'y' || entry.user === 'm' || entry.user === 'n');
    if (visible !== 0 && hasUser) {
      // 用户值被可见性截断（symbol.c：EXPR_AND(user, visible)）。
      value = Math.min(TRI[entry.user], visible);
    } else {
      if (!entry.isChoice) {
        for (const def of entry.defaults) {
          const cond = this.evalExpr(def.cond);
          if (cond === 0) continue;
          value = Math.min(this.evalExpr(def.expr), cond);
          if (value !== 0) write = true; // symbol.c：默认值非 n 即写
          break;
        }
        // imply 抬下限并受 dir_dep 截断（symbol.c：OR(implied) 后 AND(dir_dep)）。
        if (implied !== 0) value = Math.min(Math.max(value, implied), boolify(dirDep));
      }
    }
    // select 无条件 OR（含不可见符号；dir_dep 不足时 C 版会告警但仍然抬值）。
    value = Math.max(value, revDep);
    return { value: boolify(value), write };
  }

  // choice 符号自身：可见性（prompt）∧ 用户三值（成员在 defconfig 里选了谁）
  // 再 OR 非可选 choice 的 rev_dep（AND(prompt 可见, m)）。
  calcChoice(entry) {
    const visible = this.visibility(entry);
    let write = visible !== 0;
    let value = 0;
    // 用户三值：conf_read 把选中成员的 tri OR 进 choice 的 def.tri。
    const userTri = entry.userMember ? 2 : 0;
    if (visible !== 0 && userTri !== 0) {
      value = Math.min(userTri, visible);
    } else if (visible !== 0 && entry.user === 'n') {
      value = 0;
    }
    if (!entry.optional) {
      value = Math.max(value, Math.min(visible, 1));
    }
    if (entry.type === 'bool' && value === 1) value = 2;
    // 先把 choice 值落表再算选中成员：成员的可见性引用 choice 符号值
    //（鸡生蛋问题，sym_calc_value 里靠递归计算解决）。
    this.tri.set(entry.name, value);
    let selected = null;
    if (value === 2) {
      selected = this.choiceSelection(entry);
      if (!selected) {
        value = 0; // 无可选成员：choice 归 n（sym_calc_choice）
        this.tri.set(entry.name, 0);
      }
    }
    // tristate choice = m：成员各自走正常路径（多成员可为 m），无单一选中项。
    if (value === 2) this.selected.set(entry, selected);
    else this.selected.delete(entry);
    return { value, write, selected };
  }

  // string/hex/int：可见且有用户值用用户值；否则首个条件满足的 default 的
  // 符号/字面量字符串值（confdata.c：default 的 ds 取 curr.val）。
  calcStringSymbol(entry) {
    const visible = this.visibility(entry);
    let write = visible !== 0;
    if (visible !== 0 && entry.user !== undefined) {
      return { value: entry.user, write };
    }
    for (const def of entry.defaults) {
      if (this.evalExpr(def.cond) === 0) continue;
      const expr = def.expr;
      let value;
      if (expr.t === 'str') value = expr.value;
      else if (expr.t === 'sym') {
        const target = this.model.symbols.get(expr.name);
        if (target && (target.type === 'bool' || target.type === 'tristate')) {
          value = TRI_TEXT[this.tri.get(expr.name) || 0];
        } else if (target && target.type !== 'unknown') {
          value = this.text.get(expr.name) ?? '';
        } else {
          // 未定义符号：S_UNKNOWN 的 curr.val = 符号名（default 4096 → "4096"）。
          value = expr.name;
        }
      } else {
        value = '';
      }
      if (value !== '') write = true;
      // int/hex 的默认值不合法（如 $(shell) 失败展开成 'n'）时按 conf 的
      // sym_string_valid 语义跳过该 default，落到下一条件/default。
      if ((entry.type === 'int' || entry.type === 'hex')) {
        const valid = entry.type === 'int' ? /^-?\d+$/.test(value) : /^(0[xX])?[0-9a-fA-F]+$/.test(value);
        if (!valid) continue;
      }
      this.checkRange(entry, value);
      return { value, write };
    }
    return { value: '', write };
  }

  checkRange(entry, value) {
    if (!entry.ranges.length || value === '') return;
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return;
    for (const range of entry.ranges) {
      if (this.evalExpr(range.cond) === 0) continue;
      const min = Number(range.min);
      const max = Number(range.max);
      if (!Number.isNaN(min) && !Number.isNaN(max) && (numeric < min || numeric > max)) {
        this.model.warnings.push(`符号 ${entry.name} 的值 ${value} 超出 range ${range.min}..${range.max}（仅告警）`);
      }
      return;
    }
  }

  // 一次完整迭代：按解析顺序重算全部符号。
  pass() {
    let changed = false;
    for (const choice of this.model.choices) {
      const result = this.calcChoice(choice);
      if ((this.tri.get(choice.name) || 0) !== result.value) changed = true;
      this.tri.set(choice.name, result.value);
      this.write.set(choice.name, false); // choice 自身不写入 .config/autoconf
    }
    for (const name of this.model.order) {
      const entry = this.model.symbols.get(name);
      if (entry.isChoice) continue;
      if (entry.type === 'bool' || entry.type === 'tristate') {
        const result = this.calcTriSymbol(entry);
        if ((this.tri.get(name) || 0) !== result.value) changed = true;
        this.tri.set(name, result.value);
        this.text.set(name, TRI_TEXT[result.value]);
        this.write.set(name, result.write);
      } else if (entry.type === 'string' || entry.type === 'int' || entry.type === 'hex') {
        const result = this.calcStringSymbol(entry);
        if ((this.text.get(name) ?? '') !== result.value) changed = true;
        this.text.set(name, result.value);
        this.tri.set(name, 0);
        this.write.set(name, result.write);
      } else {
        this.tri.set(name, 0);
        this.write.set(name, false);
      }
    }
    return changed;
  }

  run() {
    for (let index = 0; index < MAX_PASSES; index += 1) {
      const changed = this.pass();
      if (!changed) break;
    }
  }

  // 输出取值（parseConfigContent 同形态：键不带 CONFIG_ 前缀；string 值带引号，
  // 与 make 生成的 .config 行右侧一致）。
  values() {
    const result = {};
    for (const name of this.model.order) {
      const entry = this.model.symbols.get(name);
      if (entry.isChoice || entry.type === 'unknown') continue;
      if (!this.write.get(name)) continue;
      if (entry.type === 'bool' || entry.type === 'tristate') {
        result[name] = TRI_TEXT[this.tri.get(name) || 0];
      } else if (entry.type === 'string') {
        result[name] = `"${escapeConfigString(this.text.get(name) ?? '')}"`;
      } else {
        result[name] = this.text.get(name) ?? '';
      }
    }
    return result;
  }
}

export function evaluateKconfig(model) {
  // conf_read 的 choice 用户选择：成员用户值为 y 的记为 choice.userMember。
  for (const choice of model.choices) {
    for (const member of choice.members || []) {
      if (member.user === 'y' || member.user === 'm') {
        choice.userMember = member.name;
        break;
      }
    }
  }
  const evaluator = new Evaluator(model);
  evaluator.run();
  return {
    values: evaluator.values(),
    warnings: model.warnings,
    mainmenu: model.mainmenu,
  };
}

// ---- 输出格式化 ----

function escapeConfigString(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}

function unquoteConfigString(value) {
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(String(value));
  return quoted ? quoted[1].replace(/\\(["\\])/g, '$1') : String(value);
}

// .config 内容（conf_write 形态：n 记 “# CONFIG_X is not set”；string 带引号）。
// values 为 parseConfigContent 同形态（string 值已带引号）。
export function formatConfigFile(mainmenu, values) {
  const lines = [
    '#',
    '# Automatically generated file; DO NOT EDIT.',
    `# ${mainmenu}`,
    '#',
  ];
  for (const [name, value] of Object.entries(values)) {
    if (value === 'n') lines.push(`# CONFIG_${name} is not set`);
    else lines.push(`CONFIG_${name}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

// include/generated/autoconf.h（print_symbol_for_c 形态）：
// bool/tristate：y → `#define CONFIG_X 1`，m → `#define CONFIG_X_MODULE 1`，n → 省略；
// string → 带引号转义；int → 原样；hex → 缺 0x 前缀时补。
export function formatAutoconfHeader(mainmenu, entries) {
  const lines = [
    '/*',
    ' * Automatically generated file; DO NOT EDIT.',
    ` * ${mainmenu}`,
    ' */',
  ];
  for (const entry of entries) {
    const { name, type, value } = entry;
    if (type === 'bool' || type === 'tristate') {
      if (value === 'y') lines.push(`#define CONFIG_${name} 1`);
      else if (value === 'm') lines.push(`#define CONFIG_${name}_MODULE 1`);
      continue;
    }
    if (type === 'string') {
      lines.push(`#define CONFIG_${name} "${escapeConfigString(value)}"`);
      continue;
    }
    if (type === 'hex') {
      lines.push(/^0[xX]/.test(value) ? `#define CONFIG_${name} ${value}` : `#define CONFIG_${name} 0x${value}`);
      continue;
    }
    if (type === 'int') {
      lines.push(`#define CONFIG_${name} ${value}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// 汇总 autoconf 条目（带类型），供 formatAutoconfHeader 使用；values 的 string
// 值带引号（.config 形态），这里去掉引号还原。
export function autoconfEntries(model, values) {
  const entries = [];
  for (const name of model.order) {
    const entry = model.symbols.get(name);
    if (entry.isChoice || entry.type === 'unknown') continue;
    const value = values[name];
    if (value === undefined || value === 'n') continue;
    const raw = entry.type === 'string' ? unquoteConfigString(value) : value;
    entries.push({ name, type: entry.type, value: raw });
  }
  return entries;
}
