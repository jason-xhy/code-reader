# code-reader 白盒测试报告（2026-11-26）

> 只记录不修复。全部结论均有可复现证据；推测性内容已剔除（两例假设被证伪后未列入，见 §4）。
> 验证脚本：`scripts/whitebox-*.mjs`（用途见 §5，均为只读/临时 fixture，不碰产品数据与 klinux）。

## 0. 给修复代理的摘要表（按严重级排序）

| 编号 | 严重级 | 文件:行 | 现象与根因 | 复现证据（命令 + 输出） | 建议修法（一句话） |
|---|---|---|---|---|---|
| W-01 | 中 | `src/kconfig/parser.js:377` | 续行反斜杠剥离错位：`trailing` 按「去注释后的 stripped」匹配，`slice` 却按「原始 joined」的长度切——CRLF 文件把 `\r` 当反斜杠删（反斜杠残留）、`X \ # 注释` 把注释尾部当反斜杠删；拼接行混入 `\`/注释残片 → `parseExpression` 返回 null → `depends on`/`default` 条件**静默丢弃**（无告警），JS Kconfig 引擎取值错误 | `node scripts/whitebox-kconfig-parser-test.mjs` → `LF: dirDep={"t":"or",...}`；`CRLF: dirDep=null`；`COMMENT: dirDep=null`（三个 fixture 见 /tmp/whitebox/kcfg-*，CRLF 为 xxd 确认的 `\ \r\n` 字节序列） | 先对 `joined` 做与 `stripped` 相同的注释/`\r` 剥离再匹配切片，或用 `stripped.length` 定位切点 |
| W-02 | 中 | `public/features/config-dim.js:285-340` | 嵌套条件编译置灰区间被截断：`current` 是单一模块级变量，嵌套指令的 `closeBranch()` 会把外层（含 `#elif`）分支的置灰状态永久丢弃、嵌套组结束后不恢复；内层组 `inactive` 只继承「祖先组标志」，不知道外层分支正在置灰。外层假分支只灰到第一个内层指令为止，其余部分漏灰（与文件头注释「外层区间已覆盖」的意图相悖） | ① `node scripts/whitebox-config-dim-nested.mjs` → 外层假/内层真 `ranges=[{2,3}]`（期望 2-7）；外层假/内层假 `[2-3,4-5]`（第 7 行漏灰）② 浏览器实证：打开 `drivers/gpu/drm/amd/amdgpu/amdgpu_object.c`（klinux），504-514 行置灰、**515-523 行未灰**（`#elif` 假分支在嵌套 `#ifndef CONFIG_COMPILE_TEST` 之后全部漏灰，正确应灰到 523），524-531（#else 活分支）不灰（正确） | 分支状态随栈保存（每层一个 current），push 嵌套组时把外层 `current.dim` 并入 `group.inactive`，`#endif` 后恢复外层 current |
| W-03 | 中 | `public/vim-nav.js:336` | `event.keyCode === 229` 早退：fcitx 透传英文（keydown 带 229 而 key 仍是真实字母，见 tree.js 未提交改动的注释）时，j/k/gg/G 在解释栏/历史列表/树菜单/提交详情/阅读路径等全部 vim-nav 容器内失效。树侧同类问题已在未提交改动中修复，vim-nav 未同步 | 浏览器（IAB）合成事件：`#history-content` 聚焦后 `keydown{j,keyCode:74}` → 焦点移到列表首项；`keydown{j,keyCode:229}`（isComposing=false）→ 焦点不动 | 与 tree.js 同款：删掉 `event.keyCode === 229` 早退，仅保留 `isComposing` 防护 |
| W-04 | 低 | `src/lsp.js:577,584` | gr 合并去重键 `${path}:${line}` 丢列：同一行两处引用只保留先出现者（LSP 顺序优先），跳转永远落在该行第一处 | `curl -X POST .../lsp/references -d '{"path":"drivers/nvme/host/fc.c","line":2866,"character":16}'` → 本行仅 1 条 `character:16`；改查 `character:20`（行内第二个 `min`）→ 仍只返回 `character:16`（源行 2866 `min(min(...))` 有两处 `min`，LSP 已就绪 clangd 17.0.6） | LSP 结果内部去重键改 `path:line:character`，文本兜底仍按行去重补差 |
| W-05 | 低 | `src/policies/request.js:19-24`（经 `src/routes/lsp.js:12`） | `characterParam` 只查 `/^\d+$/` 无安全整数上限：超大列号穿透到 clangd，返回 502 而非 400 | `curl -X POST .../lsp/references -d '{"path":"...","line":2866,"character":99999999999999999999}'` → `502 LSP_ERROR "failed to decode ...: expected integer"`（负数/小数/非数字均正常 400） | `characterParam` 加 `Number.isSafeInteger` 校验（与 `integerParam` 对齐） |
| W-06 | 低 | `public/features/shortcuts.js:54-105` + `public/core/policies.js:37-40` | 全局组合键捕获层不检查 `topLayerOpen()`；`shortcutAllowed()`（注释明言「顶层弹层在场时后台快捷键不应抢焦点」）定义后**从未被使用**（死代码）。模态帮助对话框打开时 Ctrl+Alt+B 仍把侧栏滑出（焦点被 showModal 圈住，但面板状态在背后改变） | 浏览器：`vim-help-dialog.showModal()` 后派发 `keydown{key:'b',code:'KeyB',ctrl,alt}` → `sidebar-visible=true` 且焦点仍在对话框；`grep -rn shortcutAllowed public/` 仅定义处 1 条 | 捕获层统一改走 `shortcutAllowed()`（补上 topLayerOpen 判断），或删除死函数 |
| W-07 | 低 | `public/features/config-dim.js:321-328` | `#elif` 置灰不考虑链上已满足分支：`#if A(y)…#elif B(y)` 的 B 分支实际不编译却不灰；`#else` 有 `group.satisfied` 逻辑而 elif 没有，不对称（属「宁可漏灰」哲学内的漏灰） | `node scripts/whitebox-config-dim-test.mjs` 中 `elif-after-satisfied-true` → 无置灰（对照 `else-after-true` → 有置灰） | elif 的 dim 条件改为 `!group.inactive && (group.satisfied \|\| value === false)` |

## 1. 各问题详情与根因

### W-01 Kconfig 续行剥离错位（parser.js:373-379）

```js
const stripped = stripComment(joined).replace(/\r$/, '');
const trailing = /(\\+)\s*$/.exec(stripped);
if (!inHelp && trailing && trailing[1].length % 2 === 1) {
  joined = joined.slice(0, joined.length - trailing[0].length);   // ← 377 行
```

`trailing[0]` 在 `stripped`（已去注释、去 `\r`）上匹配，长度却用于从**原始 `joined`** 的尾部切片。两种真实失败形态：

- **CRLF 文件**：`joined = "depends on X \\\r"`（len N+1），`stripped = "depends on X \\"`，`trailing[0]="\\"`（len 1）→ `slice(0,N)` 删掉的是 `\r`，反斜杠留在拼接行里 → 下一轮续行判断失配 → 整行以 `X \	|| CONFIG_Y` 形态进入 `parseExpression`，`\` 被当符号 token → `position !== tokens.length` → null → `if (!expr) return;` **依赖条件静默丢失**。CRLF 的 Kconfig 树（autocrlf 检出/源码包解压）每条带续行的 `depends on`/`default`/`if` 都会中招，`.config`/autoconf.h 取值随之错误且无任何告警。
- **反斜杠后行尾注释**：`depends on X \ # note` → `stripped` 尾部是 `\ `（len 2），`joined` 尾部是注释文本 → `slice` 删掉注释末两字符，注释与续行内容拼成畸形行，同样以表达式解析失败告终（静默）。

对照：前端 `public/features/config-dim.js` 的 `logicalLines`（trailing 按 raw 匹配、`\r` 属 `\s`）不受此问题影响，可用作修复参考。

### W-02 嵌套条件编译置灰区间截断（config-dim.js）

`computeInactiveRanges` 用单一 `current` 变量表示「当前分支的置灰区间」：

- 内层 `#if`/`#ifndef`/`#endif` 触发 `closeBranch()` 后 `current = null`，**外层（或 #elif）分支的 dim 状态没有随栈保存**，嵌套组结束后不恢复 → 外层假分支只灰到第一个内层指令行为止。
- 内层组 `stack.push({ inactive: parent.inactive, ... })` 的 `inactive` 只继承「祖先**组**的 inactive」（即祖先分支的祖先维度的假），不知道**外层分支本身**正在置灰 → 外层假 + 内层真时内层区域不灰。

真实文件实证（klinux `drivers/gpu/drm/amd/amdgpu/amdgpu_object.c` 504-532，`#ifdef CONFIG_X86_32`/`#elif defined(CONFIG_X86)…` 均为假、`#else` 为活分支）：

```
504-514: DIM   （X86_32 假分支 + #elif 假分支开头——灰到嵌套 #ifndef 为止）
515-523: 未灰  ← 缺陷：仍在假 #elif 分支内（含嵌套 #ifndef CONFIG_COMPILE_TEST 区与其后代码）
524-531: 未灰  （#else 活分支，正确）
```

内核树里「外层架构宏假 + 内层再嵌 #if」是普遍形态，该功能的常见场景大半漏灰。

### W-03 vim-nav 的 229 早退（vim-nav.js:336）

`if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;`

fcitx 透传英文时 keydown 携带 keyCode 229 而 `key` 仍是真实字母（这是项目自己在 `public/features/tree.js` 未提交改动注释里记录的怪癖，且已为树键修掉）。vim-nav 覆盖 `.insight-content`（解释/FAQ/历史）、`#history-menu`、`#tree-menu`、`.question-editor`、`.reading-trail` 及各覆盖层滚动区——输入法开启时这些窗口的 j/k/gg/G/Ctrl+d 等全部无响应。修复零风险：`key === 'Process'` 不命中任何命令分支（与树侧同一论证）。

### W-04 gr 同行引用去重丢列（lsp.js:574-588）

合并去重键 `path:line` 对 LSP 自身结果也生效：clangd 对同行两处引用各返回一个 Location，合并时第二个被丢。上轮 2026-11-25 引入「文本检索合并去重」时把 LSP 内部也按行折叠了。实测 `fc.c:2866` 的 `min(min(...))`：站在第二个 `min`（character 20）上查 gr，返回的本行条目却指向第一个 `min`（character 16）——用户无法通过引用列表访问第二个引用，跳转落点与查询点不符。

### W-05 characterParam 无上限（policies/request.js:19-24）

`/^\d+$/` + `Number(text)`：20 位数字变成 1e20（超过 SafeInteger），直接进 LSP `position.character`，clangd 拒绝解码 → 502 `LSP_ERROR`。应在校验层 400。`integerParam`（行号）已有同款检查，`characterParam` 漏了。

### W-06 全局组合键缺少顶层弹层门禁 + shortcutAllowed 死代码

`shortcuts.js` 捕获层只查 `defaultPrevented/isComposing/repeat`；`policies.js` 的 `shortcutAllowed()`（含 `topLayerOpen()`）全库无人调用（grep 仅定义处）。结果：模态 `<dialog>` / 提交详情 / 3D 动画浮层在场时，Ctrl+Alt+B/I/K/F/R/P/S、工作区切仓、页签切换全部照常执行（树路径的 `requestTreeFocus` 自带 dialog 检查只是部分补救；insights 路径完全没有）。实测模态帮助对话框打开时按 Ctrl+Alt+B，侧栏在对话框背后滑出。

### W-07 #elif 不考虑链上已满足分支（config-dim.js:321-328）

`#else` 的置灰条件是 `group.satisfied`（链上已有真分支 → 灰），`#elif` 只看自身 `value === false`。`#if A(y)…#elif B(y)…#else` 中 B 分支实际被排除却不灰。方向上是「漏灰」（保守哲学可辩护），但与 else 的不对称说明是遗漏而非设计——一行即可对齐。

## 2. 验证为正常（负面结果，避免修复代理误查）

- **路径校验**：`/api/repositories/{id}/file?path=` 对 `../README.md`、`..`、`.`、`/etc/passwd`、`a/../../b`、`src/../README.md` 分别返回 400 INVALID_PATH / 403 PATH_OUTSIDE_REPOSITORY（API 实测）。符号链接逃逸：文件 symlink 与目录 symlink 均 403（`scripts/whitebox-symlink-test.mjs`）。
- **git status -z 重命名解析**：staged rename 正确跳过 orig 路径（`scripts/whitebox-status-test.mjs`）。
- **树 IME 未提交改动（§2 三项）全部按预期**：`keydown{j,keyCode:229}` 焦点移动（229 早退已去除）；`beforeinput '、'`/全角 `'／'` → 聚焦过滤框；半角 `beforeinput 'a'` 不派发（无双触发）；2 字符提交不崩溃；过滤框 Ctrl+j/k、Tab 保留过滤回树、Esc 清空退出均正常。
- **编辑器 textInputGuard**：`execCommand('insertText','、')` → 映射 `/` 打开 vim 搜索面板；全角 `ｊ`→`j` 光标下移、`￥`→`$` 行尾（vim 列语义正确）；多字符 `'hello'` → 丢弃并闪「已忽略文字输入」。组字 350ms 窗口、`expectLiteralNext` 逻辑与代码一致。
- **XSS 面**：前端全量 `textContent`；仅有的两处 `innerHTML`（`web-src/animation.js:48`、`web-src/xhci-scene.js:52`）均为静态模板，插值处是计算出的数字；动画 iframe `sandbox="allow-scripts"`（无同源）；`animation-html.js` 有 escapeScriptContent/escapeAttribute/escapeHtml。CSP 覆盖 script-src 'self'。
- **LspClient stdin EPIPE 假设被证伪**：当前 Node（v20+）子进程退出即销毁 stdio，对已销毁流 write 不会产生未捕获 'error'（`/tmp/whitebox/epipe-test*.mjs`），不构成崩溃向量，未列入。
- **Kconfig 变量递归展开假设被证伪**：赋值期立即展开，无环可能（`scripts/whitebox-kconfig-recurse-test.mjs` → OK）。
- **配置置灰基础语义**：单层 if/ifdef/ifndef/else、块注释内指令、续行拼接、未知符号不灰、IS_ENABLED/IS_MODULE、EOF 未闭合、区间边界（指令行含入灰区、#endif 行不灰）共 15 项单测通过（`scripts/whitebox-config-dim-test.mjs`，5 项 FAIL 中 3 项为 W-02 相关、2 项为测试自身预期行号笔误已修正认知）。

## 3. 基线回归（测试前后）

- `npm run check`：106 个 JS 文件语法通过
- `npm run e2e`：185/185 PASS
- `CHROME_BIN=/usr/bin/google-chrome npm run test:keyboard`：20/20 PASS

## 4. 环境说明（每条结论的复现载体）

| 结论 | 载体 |
|---|---|
| W-01 | node（临时 fixture /tmp/whitebox/kcfg-*，`scripts/whitebox-kconfig-parser-test.mjs`） |
| W-02 | node（`scripts/whitebox-config-dim-nested.mjs`、`scripts/whitebox-config-dim-test.mjs`）+ 浏览器（klinux 真实文件 amdgpu_object.c，读 DOM `.cm-config-inactive`） |
| W-03 | 浏览器（IAB，页面内合成 KeyboardEvent：keyCode 74 对照 229） |
| W-04 | API（curl 本机 8766，POST /lsp/references，klinux 仓 id local-7d7bce7e3ad7dbe4，clangd 17.0.6 已就绪） |
| W-05 | API（curl 本机 8766） |
| W-06 | 浏览器（showModal + 合成 Ctrl+Alt+B）+ 静态（grep 死代码） |
| W-07 | node（纯逻辑单测） |
| §2 负面结果 | node / API / 浏览器 / 静态，逐项见上文标注 |

浏览器验证使用 IAB + 页面内合成事件（KeyboardEvent 带 key/code/keyCode；编辑器输入管线用 `document.execCommand('insertText', …)` 走真实 beforeinput + DOM 变更路径，纯合成 InputEvent 不经过 CM 的 MutationObserver 观察链，不能用于验证 inputHandler——这是本轮实测确认的方法论）。

## 5. 临时脚本清单（scripts/whitebox-*.mjs，可留作修复后复跑）

| 脚本 | 用途 |
|---|---|
| `scripts/whitebox-kconfig-parser-test.mjs` | W-01：LF/CRLF/行尾注释三种续行 fixture 的 dirDep 对照 |
| `scripts/whitebox-config-dim-test.mjs` | computeInactiveRanges 15 项语义单测 |
| `scripts/whitebox-config-dim-nested.mjs` | W-02：嵌套 #if 截断的精确用例 |
| `scripts/whitebox-symlink-test.mjs` | readSource 符号链接逃逸防护（/tmp fixture） |
| `scripts/whitebox-status-test.mjs` | porcelain -z 重命名解析（/tmp fixture） |
| `scripts/whitebox-kconfig-recurse-test.mjs` | 递归变量假设证伪记录 |

fixture 位于 `/tmp/whitebox/`（kcfg-crlf、kcfg-comment、kcfg-ok、symrepo、strepo、kcfg-recurse），均为测试自建目录。

## 6. 运行环境备注（供修复代理知晓）

- 测试开始时发现 8766 服务实际**不在运行**：在跑的 `node server.js`（PID 469426）是上轮 keyboard 回归遗留的**夹具服务器**（PORT=8877、`CODE_READER_DATA_DIR=/tmp/cr-keys-6q3UkZ/data`，非真实 .data）。已停止该遗留进程并按铁律以 `PORT=8766` 重启正式服务（当前 PID 528633，`/tmp/whitebox-server.log`）。测试期间所有 API 验证均打在 8766。
- 测试中曾 POST `/api/repositories/open-local`（klinux）与 `/api/workspace/activate`（与页面刷新恢复路径等价，只读仓库、无 checkout/fetch/resolve），kconfig 取值沿用既有 store（arch=arm64，10310 项，未触发重新解析）。
- 未修改任何产品代码；`git status` 中 `README.md`/`public/features/tree.js`/`public/index.html` 三个未提交文件是交接文档所述既有改动，原样保留。
