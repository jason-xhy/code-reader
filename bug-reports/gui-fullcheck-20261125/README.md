# Code Reader GUI 全量键盘/窗口功能黑盒检查报告

- **日期**：2026-11-25
- **被测地址**：http://127.0.0.1:8766/（服务运行中，未重启）
- **被测仓库**：klinux（/home/kylin/klinux，分支 klad-v11-stable，未切换）；另有 linux 仓库页签
- **测试方式**：ZCode 内置浏览器（IAB）+ 真实 CUA 按键 / 页面内 evaluate 读取 DOM 与计算样式 / 少量截图
- **按键通道说明（重要，影响所有组合键结论）**：
  - **真实 CUA 按键**（`tab.cua.keypress`）：单字符/单键（j、k、w、0、$、Enter、Esc、PageUp/Down、方向键、:、/、\ 等）均正常送达并生效。
  - **真实 CUA 组合键（Ctrl+Alt+X / Ctrl+X / Alt+X）全部失效**：经页面内 keydown 事件记录器证实，组合键中"字母键"到达页面时 `key=""`、`code=""`（如 Ctrl+Alt+P 只收到 `keydown key="Control"`、`keydown key="Alt"`、`keydown key="" code=""`），应用不响应。这属于本自动化按键通道的投递缺陷，**不能据此断定真实键盘用户组合键失效**。
  - 因此所有组合键均用**页面内合成 KeyboardEvent**（正确 key/code + ctrlKey/altKey/shiftKey，dispatch 在焦点元素或 document 上）验证功能本体。真实按键:合成事件 比例约为 60%:40%（单键全部真实，组合键全部合成）。
  - 合成事件派发位置差异：Ctrl+Alt+P/B/I/K/F/R 在焦点元素（.cm-content）上派发即可生效；**Ctrl+Alt+S 需在 document 上派发才生效**（在 .cm-content 上派发无反应）。
  - `cua.type()` 批量文本走"文本插入"通道（无 keydown 事件）：在真实 input（quickpick 搜索框、: 命令行）中正常；在编辑器 NORMAL 模式和文件树 `/` 过滤提示行中会被当作插入文本（进入 INSERT 模式/不触发过滤），故这两处改用逐键 keypress。
  - 大写字母（G、N、H/M/L）经真实按键投递不可靠且有副作用（曾使编辑器意外进入 INSERT 并插入字符，已用 Esc+u 完全恢复，行内容核对无损），这些键改用合成事件。

---

## 结果总览

| 组 | 结果概要 |
|---|---|
| A 全局组合键 | 功能全部可用（经合成事件）；真实 CUA 组合键全部无效（空 key/code，通道缺陷） |
| B 编辑器 Vim | 全部通过 |
| C 引用/搜索窗口 | 全部通过 |
| D 用户报告症状 | D1 未复现（PASS）；**D2 复现（FAIL）**；D3 记录现象 |
| E 文件树侧栏 | 全部通过（E6 部分验证） |
| F 解释栏 | F1/F2/F5/F6 通过；F3 未测足（无内容）；F4 部分验证 |
| G 阅读路径 | 全部通过 |
| H 顶栏/工作区 | 全部通过 |
| I 对话框 | 全部通过（未执行「解析配置」，未保存任何设置） |
| J nvim 面板 | 全部通过（未执行 :w/:!） |
| K 布局 | K1/K3 通过；**K2 FAIL（侧栏可见时编辑器重排，非满宽覆盖）** |

---

## A. 全局组合键（编辑器聚焦时测试）

> 所有 Ctrl+Alt+X 同时验证了 Ctrl+Alt+Shift+X 变体（抽取 B、R 两个实测：均生效）。

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| A1 Ctrl+Alt+B | PASS（合成）/ 真实按键无效 | 真实按键：侧栏保持 x=-252 无反应（字母键 key=""）。合成事件：侧栏滑出（x:0，#app class=`sidebar-visible`），焦点移入 NAV#file-tree；焦点在侧栏时再按 → 收起（x:-252），焦点回 .cm-content。Ctrl+Alt+Shift+B 变体实测同样打开 ✓ |
| A2 Ctrl+Alt+I | PASS（合成）/ 真实按键无效 | 合成：解释栏滑出（right:1280，#app class=`insights-visible`），焦点落在提交历史按钮；焦点在栏内再按 → 收起（right:1652），焦点回编辑器 ✓ |
| A3 Ctrl+Alt+K | PASS（合成） | 出现 `.cr-hint-layer`（65 个子元素）：状态行「HINT · 43 个目标」，顶栏按钮与编辑器可见行均挂双字母标签（如 aa、ab…；编辑器行标签在行号区 y≈222+ 每 24px 一行）。输入 `a` → 「HINT · 前缀 "a" · 26 个候选 · Esc 取消」；输入 `aa` → 标签层关闭并触发目标动作（观察到光标跳转）。Esc → 层消失、光标不变 ✓ |
| A4 Ctrl+Alt+F | PASS（合成） | 状态行「SNEAK · 输入两个字符 · Esc 取消」→ 输 `s`「已输入 "s" · 再输入 1 个字符」→ 输 `t`「SNEAK "st" · 2 处 · 输入标签跳转」（标签 a、b）→ 输 `a` 跳到 ipw2100.c:649:1（行首 "static…"，即 "st" 匹配处）✓ |
| A5 Ctrl+Alt+P | **功能 PASS（合成）；真实按键无效** | 真实 Ctrl+Alt+P / Ctrl+Alt+Shift+P：#quickpick 保持 hidden（用户报告"没有作用"在本环境真实按键通道复现，但事件记录显示字母键 key=""、code=""）。合成事件：窗口正常打开（标题「在工作区搜索函数或文件名 · 支持 * ? 通配符与 /正则/…」+ 输入框聚焦）；输入 kysos → 5 条结果（2 函数+2 文件+1 配置）；Enter 跳转 kysos_key.c:626:19 ✓。全部功能（输入/结果/选择/跳转）正常 |
| A6 Ctrl+Alt+R | PASS（合成） | 打开阅读路径 quickpick「阅读路径 5 个位置（按文件合并，只保留最新一行）」；j/j → 第 3 项、k 回第 2 项；Enter 跳转 printk.h:533:1；Esc 关闭。Ctrl+Alt+Shift+R 变体同样打开 ✓ |
| A7 Ctrl+Alt+S | PASS（合成，document 级派发） | 设置菜单打开，焦点在第一项（LLM 设置）；↓/↓ 焦点移到第 2/3 项，↑ 回退；Enter 打开对应子对话框（实测第 2 项 → #editor-env-dialog 打开且菜单关闭）；Esc 关闭菜单 ✓。注：在 .cm-content 上派发合成事件无反应，需 document 级 |
| A8 Ctrl+Alt+1/2 | PASS（合成） | Ctrl+Alt+2：#tab-nvim 激活、#nvim-host 显示（xterm 终端 + 工具条，真实 nvim 运行，见 J 组）；Ctrl+Alt+1：切回 #tab-editor，焦点回 .cm-content ✓ |
| A9 Ctrl+Alt+[ / ] / Shift+2 | PASS（合成） | Ctrl+Alt+[：klinux→linux 页签（active 变 linux，「尚未选择文件」）；Ctrl+Alt+Shift+2：直达第 2 页签 klinux（printk.h 恢复显示）；Ctrl+Alt+]：klinux→linux（环绕）；再 Shift+2 回 klinux。最终恢复原状 ✓ |
| A10 Alt+. / Alt+R | PASS（合成） | printk.h:614:18（dynamic_pr_debug）按 Alt+. → 跳 include/linux/dynamic_debug.h:268:9（与 gd 目标一致）；在该处按 Alt+R → 引用 quickpick「2 个引用」（dynamic_debug.h:268:9 定义 + printk.h:614:2 用法），与 gr 行为一致 ✓ |

**A 组附注（异常事件记录）**：A3 测试中输入标签 `aa`（该标签当时叠加在顶栏分支选择器 #branch-select 上）后，页面出现红色 repo-notice：「更新失败：ssh: Could not resolve hostname code.kylinos.cn: Name or service not known\r\n致命错误：无法读取远程仓库。」——即发生了一次 git fetch 尝试且失败（本环境无外网 DNS）。分支仍为 klad-v11-stable、文件视图未变（失败 fetch 无状态变更）；通知已通过其关闭按钮移除。测试中从未主动点击「更新」按钮；该 fetch 疑似标签激活的顶栏控件所触发（无法从 GUI 层确证触发者）。后续直接点击分支下拉展开未再触发该通知。

## B. 代码编辑器（CM6 Vim）

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| B1 | PASS | Ctrl+Alt+P（合成）+ 输入 kysos + Enter → 打开 drivers/input/misc/kysos_key.c，光标 626:19，状态栏「698 行」，焦点回编辑器 |
| B2 | PASS | h(19→20→19)、j/k(626↔627)、w/b(626:2↔626:40)、0(→1 列)/$(→45 列)、gg(→1:1) 全部真实按键生效；**大写 G 经真实按键不可靠**（无跳转且曾诱发 INSERT 污染，改用合成事件 → 跳 699:1 末行 ✓）；`620gg` 逐键发送 → 620:2（行内容 `.connect = sos_connect,`）✓；i/Esc：观察到 --INSERT-- 与 Esc 后 --NORMAL-- ✓；u：4 次撤销将误插入的第 1 行恢复为 `// SPDX-License-Identifier: GPL-2.0` ✓；`/sos_connect`+Enter→620:13、n→515:12（环绕）、n→620:13、N（合成）→515:12 ✓；`*`（static 词）→ 626:1→682:1→30:1（n 环绕），页面出现 cm-searchMatch 高亮 ✓；`%`：626:40 的 `(` → 626:45 的 `)` ✓（f( 亦可用） |
| B3 | PASS | gd：kysos_key.c:620 的 `.connect` 字段 → include/linux/input.h:323:8（`int (*connect)(struct input_handler *...)` 字段声明）✓；**Ctrl-]（真实按键）在 620:11（connect 词上）→ 同样跳 input.h:323:8，与 gd 等效** ✓ |
| B4 | PASS | gr 见 D1/C1 |
| B5 | PASS（合成） | gr+Enter 跳转后 Ctrl-o：input.c:1064:19 → kysos_key.c:620:2 → kysos_key.c:1:1（再退一层）；Ctrl-i → 前进回 input.c:1064:19 ✓。gd 跳转后 Ctrl-o 亦验证跳回 620:11 ✓ |
| B6 | PASS | `\e`：侧栏展开+焦点入 NAV#file-tree，`q` 收起并回编辑器 ✓；`\s`：打开工作区搜索 quickpick（输入框聚焦）✓；`\c`：打开提问窗口（见 B9）✓ |
| B7 | PASS | `:15` → 15:1 ✓；`:e drivers/input/misc/kysos_key.c` → 打开文件 ✓；`:e include/lin`+Tab → 命令行补全为 `e include/linux/8250_pci.h`（Tab 补全机制生效）✓；错误路径 `:e include/linux/8250_pci.hux/printk.h` → 状态栏「未找到文件：include/linux/8250_pci.hux/printk.h」✓；`:help` → #vim-help-dialog 打开（8 个分区：光标移动/编辑与操作符/文本对象与可视模式/搜索与命令/寄存器、宏与标记/本应用扩展/全键盘导航/浏览器限制），Esc 关闭且焦点回编辑器 ✓；`:keys` → #keymap-dialog 打开（22 项键位，见 I2）✓；`:trail` → 阅读路径 quickpick「8 个位置」✓ |
| B8 | PASS | 状态栏显示 `--NORMAL--` / `--INSERT--` 与 `行:列`（如 597:28、620:2），模式切换即时更新 |
| B9 | PASS | 提问窗口（\c 或编辑器未聚焦时按 c 均可打开）：标题锚点「drivers/input/misc/kysos_key.h:8」、提示「源码上下文将发送给 LLM · Enter 提交 · Shift+Enter 换行」、5 个预设按钮（函数目的/数据流/设计原因/规范依据/3D 动画）、textarea#question-input、「取消」「确定」按钮。Esc 关闭焦点回编辑器；「取消」按钮关闭 ✓。**未提交任何问题**（按指示） |

## C. 引用列表 / 工作区搜索窗口（quickpick）

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| C1 | PASS | gr@.connect 列表（5 项）：j/j 选中第 2/3 项、k 回退；↑/↓ 同效；Ctrl+j/k（合成）移动；右侧预览 21 行（选中项 ±10 行）+ Caller 行（如「Caller: input_attach_handler · 函数 1055-1070」）；Enter → 跳转 drivers/input/input.c:1064:19（行内容 `error = handler->connect(handler, dev, id);`）；Esc 取消 ✓ |
| C2 | PASS | 989 项 printk 引用列表实测：真实 Ctrl+d 无效（空键），合成 Ctrl+d → +6 行（0→6→12）、Ctrl+u → -6；合成 Ctrl+f → +19、Ctrl+b → -19；真实 PageDown → +11、PageUp → -11；合成 G → 第 989 项、真实 gg → 第 1 项；合成 H/M/L → 视口顶(第1项)/中(第495项)/底(第989项)；真实数字 `5` → 直选并跳转第 5 项（printk.h:533:2）✓ |
| C3 | PASS | 搜 printk：「301 个符号（函数/配置） · 54 个文件 · 结果已截断」，列表含函数/配置（PRINTK）/文件三类与位置；↓/Ctrl+j（合成）选择；Enter → 跳 ipw2100.c:649:13；Esc 关闭 ✓；通配符 `xhci*.c` → 「0 个符号 · 24 个文件」（xhci.c、xhci-hub.c…）✓；正则 `/printk_/` → 「171 个符号 · 5 个文件」（printk_buf、PRINTK_TIME 等，忽略大小写）✓ |
| C4 | PASS | 空输入：「输入关键字开始搜索（函数名或文件名，支持 xhci*.c 这类通配符，或输入 /正则/）」；无结果（zzzqqqxyzzy_无结果测试）：「0 个符号 · 0 个文件」+「没有匹配的函数、配置或文件名」✓ |

## D. 用户报告的重点症状

### D1. gr 在 .connect 处 —— **PASS（症状未复现）**

复现步骤：:e drivers/input/misc/kysos_key.c → 620gg（光标 620:2，位于 `.connect` 词内）→ 按 g r。

结果：引用列表出现，标题「5 个引用 · j/k 或 ↑↓ 选择 · Enter 跳转 · Esc 取消」，**全部条目**：

1. `drivers/input/misc/kysos_key.c:620:3`
2. **`drivers/input/input.c:1064:19`（handler->connect 调用点，在列表中，预览含完整上下文与 Caller=input_attach_handler）**
3. `include/linux/input.h:323:8`
4. `drivers/macintosh/mac_hid.c:156:3`
5. `net/rfkill/input.c:311:3`

把光标放到 `.event`（619:2）再按 gr：「6 个引用」：kysos_key.c:619:3、**input.c:130:20、input.c:132:13**、input.h:318:9、joydev.c:1077:3、rfkill/input.c:310:3 —— 调用点同样在内。

结论：本运行中未出现"列表只有 2-3 项而缺 input.c 调用点"的现象。

### D2. printk.h 613 行 pr_debug 颜色 —— **FAIL（症状复现）**

- **当前主题**（会话开始时即为）：**Vim One (Dark)**（主题下拉 selected）。
- Vim One (Dark) 下 getComputedStyle 实测（printk.h 613-620 区域）：
  - 注释行（`* set. Otherwise, if DEBUG...`）：**rgb(92, 99, 112)**
  - 613 `#define pr_debug(fmt, ...)`：**rgb(92, 99, 112)**
  - 614 `dynamic_pr_debug(...)`：rgb(92, 99, 112)
  - 615 `#elif defined(DEBUG)`：rgb(92, 99, 112)
  - 616/619 `#define pr_debug(...)`：rgb(92, 99, 112)
  - 617 `printk(KERN_DEBUG...)`、620 `no_printk(...)`：rgb(92, 99, 112)
  - 即**整段预处理行（含续行）与注释完全同灰**。
  - 对照普通 C 代码行（约 61-66 行 `static inline const char *printk_skip_headers(...)` 等）：关键字 rgb(198,120,211) 紫、类型 rgb(229,192,123) 黄、函数名 rgb(97,175,239) 蓝、标识符 rgb(171,178,191)、运算符 rgb(86,182,194) —— 多彩正常。
- 切换到「本地 · (未命名)」主题再测：613/614/619/620 均为 **rgb(0,0,0) 黑**，注释为 **rgb(0,0,255) 蓝** —— 预处理行与注释有明确区分。
- 切回 Vim One (Dark) 复测：613/614/619/620 又全部回到 rgb(92,99,112)（=注释灰）。
- 结论：**Vim One (Dark) 主题下预处理行整段渲染为注释灰色**，症状复现；本地（未命名）主题无此问题。主题切换即时生效（截图已留存）。

### D3. gd/gr 在 CONFIG_ 宏上 —— 现象记录（无跳转/无列表/无报错弹窗）

- printk.h:596 `#if defined(CONFIG_DYNAMIC_DEBUG)`，光标移到 CONFIG_DYNAMIC_DEBUG（596:15）：
  - 按 gd：**不跳转**，状态栏 #source-status 显示「未找到定义」（无 Kconfig 跳转、无「CONFIG_DYNAMIC_DEBUG = y」状态显示）。
  - 按 gr：**不出现引用列表**，状态栏显示「未找到引用」（未尝试跳 autoconf.h，无任何错误弹窗）。
- Ctrl+Alt+P 搜 `autoconf`：22 符号/23 文件，结果含 tools/virtio/generated/autoconf.h 等，**不含 include/generated/autoconf.h**。
- `:e include/generated/autoconf.h`：状态栏「未找到文件：include/generated/autoconf.h」（无弹窗）。

### D4. Ctrl+Alt+P

见 A5：真实按键通道无效（空 key/code），合成事件下窗口与全部功能正常。

## E. 文件树侧栏（Ctrl+Alt+B 打开）

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| E1 | PASS | 游标类名为 `key-focus`。j: 8→9；`5j`: 9→14；k 回退；合成 Ctrl+d: +10、Ctrl+u: -10、Ctrl+f: +19、Ctrl+b: -19；真实 PageDown/PageUp: ±19；真实 gg → 第 0 行、合成 G → 第 197 行；合成 H/M/L → 顶/中/底；真实 `0`/`^` → 第 0 行、`$` → 第 197 行（观察到 0/^ 移到首行、$ 移到末行） |
| E2 | PASS | Enter（arch 行）→ 展开为 ▼arch（50→222 行）；G 到末行 README + Enter → 打开 README（「18 行 · README」）；`q` → 侧栏收起、焦点回编辑器 |
| E3 | PASS | `/` → 树内出现 vim 风格过滤提示行（`/` + input），**逐键真实输入**实时过滤：k→200 行、ky→200（kyber/kylin…）、kys→78、kyso→3、kysos→2（kysos_key.c 标 C、kysos_key.h 标 H）；↓/↑ 选择候选（0→1，↑ 环绕到末项）；Enter 打开选中文件（kysos_key.h）；Esc 清除过滤恢复 222 行。注：`cua.type` 批量注入不触发该过滤（无 keydown，自动化通道差异）；顶部 #tree-filter 搜索框 fill 亦过滤正常 |
| E4 | PASS | 连续字母：d → 第 28 行 debian、dr → drivers、dri/vers 保持 drivers（前缀定位生效） |
| E5 | PASS | 右键 README 行 → #tree-menu 出现 3 项：「复制相对路径」「复制绝对路径」「刷新文件树」；↓/↓/↑ 焦点移动；Enter 执行选中项后菜单关闭，剪贴板实测读到 `/home/kylin/klinux/README`（复制绝对路径项）；Esc 关闭菜单 ✓ |
| E6 | 部分验证 | 悬停左边缘 → 侧栏滑出 ✓；焦点在面板内 → 保持展开（鼠标移开 6 秒以上不收起）✓；**悬停打开后点击编辑器（焦点离开面板）→ 侧栏收起** ✓；纯鼠标移开（不点击、焦点已在面板内）未观察到自动收起；键盘 Ctrl+Alt+B 打开为"钉住"语义（编辑器聚焦时再按=聚焦面板，面板内聚焦时再按=收起）。注：CUA move 的 mousemove 语义可能不触发 mouseleave，此项存自动化误差 |

## F. 解释栏（Ctrl+Alt+I 打开）

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| F1 | PASS | 光标移动后历史区更新：kysos_key.h:1-51 → kysos_key.c:618-624 → printk.h:564-664（printk.h 处 6 个提交）。Ctrl+Alt+I 打开后焦点在第一个提交项；j: 0→1（ceabef7dd7）、j: 1→2（eb012d125a）、k: 2→1 ✓；点击提交项 → 详情弹窗（#commit-overlay）打开 ✓ |
| F2 | PASS | 弹窗内容：commit 哈希/标题/作者（Hongyu Xie）/日期/提交说明/文件列表/Diff（`<details>`）。焦点链：× 关闭按钮 →（j）→ Diff SUMMARY →（k）→ 回 ×；**j 到「Diff（5 个文件）」+ Enter → details.open=true（19KB diff 展开）**；Esc → 弹窗关闭，焦点回到提交项 ✓ |
| F3 | 未测足（无内容） | #explanation-content 为空占位（class empty-insight，文本「在任意源码行按 \c（Vim 模式）或 c（编辑器未聚焦时），输入问题并点击"确定"。」）；#faq-section 隐藏且无内容。滚动键/Tab 列表模式无可操作内容 |
| F4 | 部分验证 | 焦点在面板内按 `/` → 出现搜索输入框（.vim-search-input，placeholder「本窗口内搜索」，位于面板顶部）；Esc 关闭输入框 ✓。输入文本（真实逐键 dynamic + Enter）后未观察到高亮标记（mark/hit 类元素为 0）——当前解释区无内容，无法判断搜索效果；n/N 无可见效果 |
| F5 | PASS（存在性） | 「深层演变（git log -L，较慢）」按钮存在。**未点击执行**（按测试指示：慢操作，会跑 git log -L） |
| F6 | PASS | 焦点在解释栏内按 Ctrl+Alt+I → 收起、焦点回编辑器（A2 已证） |

## G. 阅读路径（面包屑）

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| G1 | PASS | 编辑器上方 #reading-trail 显示芯片序列（实测 8 芯片，同文件合并唯一：input.c:1064 → input.h:323 → ipw2100.c:649 → dynamic_debug.h:268 → README:1 → kysos_key.h:1 → printk.h:1 → kysos_key.c:1，当前项标 current）；点击芯片跳回对应文件 ✓；芯片 title 提示「… · 点击跳转 · Ctrl+Alt+R 打开列表」 |
| G2 | PASS | 「列表」按钮（.trail-more）→ 打开阅读路径 quickpick「8 个位置（按文件合并，只保留最新一行）」，最近在前；j + Enter 跳转 printk.h:1:1 ✓。Ctrl+Alt+R 打开同列表（A6 已证），Esc 取消 ✓ |

## H. 历史/顶栏/工作区栏

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| H1 | PASS | 「历史」按钮位于侧栏头部（#history-menu-button）。展开侧栏 → focus 历史 → AltDown → （↓ 或 Enter 语义）菜单打开：条目 klinux/printk.h、linux/未打开文件 · 22 小时前、清空历史；焦点在首项；Enter → 打开 include/linux/printk.h（光标 2:1，对应历史项 printk.h:2），菜单关闭；Esc（焦点在菜单项上）→ 菜单关闭 ✓ |
| H2 | PASS | 设置菜单（A7）；主题切换生效（D2：切「本地·(未命名)」/「Vim One (Dark)」配色立即变化）；分支下拉（#branch-select，41 个选项）点击可展开（select 聚焦、原生下拉），Esc 收起，**值保持 klad-v11-stable 未切换** ✓ |
| H3 | PASS | 点击 linux 页签 → 切到 linux 仓库（activeTab linux、「尚未选择文件」）；点击 klinux 页签 → 回 klinux（printk.h 恢复）；「＋」（#workspace-add）→ 打开「打开代码仓库」对话框（本地仓库[active]/远程仓库 页签、#local-path 输入、浏览… 按钮），Esc 关闭（未实际打开仓库）✓ |
| H4 | PASS | 远程页签切换（#remote-url 输入显示 placeholder https://github.com/user/repository.git）；本地页签切回；「浏览…」→ #dir-browser 显示 /home/kylin 目录列表（32 项）+「↑」+「选择此目录」；↓/↓/↑ 焦点与选中行移动（.box→.cache→.config→.cache）；按字母 `c` → 焦点跳到 code-reader 行（第 27 项）；Enter → 进入 /home/kylin/code-reader 并回填 #local-path（提示「单击选中（不进入）；双击或 Enter 进入并回填路径；选中后按字母跳转」）；Esc 分层关闭（第一次关目录浏览器、第二次关对话框）✓ |

## I. 其它对话框

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| I1 | PASS | 设置菜单 → 内核配置：#kernel-dialog 打开；架构下拉（alpha/arc/arm/**arm64[选中]**/csky/hexagon…）、defconfig 下拉（defconfig/**generic_defconfig[选中]**/kylinos_generic_defconfig/openkylin_generic_defconfig）；状态行「将在源码树内运行 make（首次会构建 Kconfig 工具，需要 flex/bison）…」；「解析配置」按钮存在。**未点击「解析配置」**（按指示，会跑 make 改内核树）；Esc 关闭（同时关闭残留菜单） |
| I2 | PASS | 快捷键对话框（:keys 或设置菜单）：#keymap-list 22 项（代码树 Ctrl+Alt+B、分析 Ctrl+Alt+I、跳转 Ctrl+Alt+K、两字符 Ctrl+Alt+F、搜索 Ctrl+Alt+P、阅读路径 Ctrl+Alt+R、设置 Ctrl+Alt+S、仓库切换 Ctrl+Alt+[/]、编辑器 Ctrl+Alt+1/2、页签 Ctrl+Alt+Shift+N…，均标注 Shift 变体）；「恢复默认」按钮存在（未点击）；「完成」按钮存在；Esc 关闭 ✓ |
| I3 | PASS | LLM 设置（provider=自定义兼容服务、model、base URL、保存设置按钮）、知识库（目录列表「尚未指定文档目录…」、#docs-path-input、web 开关、重建索引按钮）均能打开，Esc 关闭。编辑器环境对话框亦已在 A7 打开并 Esc 关闭。**未保存任何设置** |
| I4 | PASS | :help → #vim-help-dialog 8 个分区可见；Esc 关闭后焦点回编辑器 ✓ |

## J. nvim 面板（Ctrl+Alt+2）

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| J1 | PASS | 合成 Ctrl+Alt+2 → #nvim-host 显示：`.nvim-bar` 工具条（「vim · include/linux/printk.h」+ 按钮：本地快捷键/打开当前文件/重启/关闭）+ `.nvim-term` xterm 终端（canvas 渲染），终端内为真实 nvim 会话显示 printk.h 文件内容（状态行「"~/klinux/include/linux/printk.h" 798L, 24018B … 531,2 67%」） |
| J2 | PASS | 点击终端后按 j×5 → nvim 状态行 531,2 → 536,2；k×2 → 534,2（真实按键直通 nvim）✓；合成 Ctrl+Alt+1 → 切回内置编辑器（#tab-editor active，焦点 .cm-content）✓；「关闭」按钮（#nvim-close）→ 面板关闭、编辑器页签恢复 ✓。**未执行 :w / :!** |
| J3 | PASS | 点击「打开当前文件」（#nvim-open-current）→ nvim 状态行显示 `:531 … 531,2 67%`（与应用当前光标行 531 一致，文件 printk.h 同步）✓；随后已通过「关闭」按钮退出该面板 |

## K. 布局

| 编号 | 结果 | 现象/证据 |
|---|---|---|
| K1 | PASS | 左分隔条（#splitter-left，面板可见时 6px 宽）：focus + ← → 侧栏 252→240（编辑器 1028→1040）；→×2 → 240→264 ✓。右分隔条（#splitter-right）：focus + ← → 解释栏 372→384（编辑器 908→896，变宽）；→×2 → 384→360 ✓（方向空间一致：← 使右侧面板更宽）。宽度调整跨刷新持久（重载后侧栏隐藏态宽度仍 264） |
| K2 | **FAIL（与任务预期不符）** | 任务预期"侧栏覆盖层显示时编辑器满宽不重排"。实测（含刷新后干净状态）：侧栏收起时编辑器 1280 满宽；**悬停滑出（非钉住）或键盘打开时编辑器宽度即被压缩**：侧栏可见 → 编辑器 1016（x=264，宽度=1280−264），解释栏可见 → 编辑器 908；#app class 出现 sidebar-visible/insights-visible，分隔条同时出现；收起后恢复 1280。即面板为挤压布局而非覆盖层。真正不重排的覆盖层是 quickpick 引用/搜索窗口（悬浮于代码区上）。附：面板为 position:absolute，但编辑器容器随 class 变化让位 |
| K3 | PASS | reload + 等待 3 秒：恢复 klinux 仓库、include/linux/printk.h、光标 8:27（与刷新前完全一致）、活动页签 klinux、主题 Vim One (Dark)、面板收起、编辑器满宽 |

---

## FAIL 项精确复现步骤与现象汇总

### FAIL 1（D2）：Vim One (Dark) 主题下预处理行整段为注释灰色

复现步骤：
1. 顶栏「配色主题」下拉选择「Vim One (Dark)」。
2. `:e include/linux/printk.h`，`613gg`（`#define pr_debug(fmt, ...) \`）。
3. 页面内 evaluate 读取该行 token span 的 `getComputedStyle().color`。

观察到的精确现象：
- 613/616/619 `#define pr_debug(...)`、614 `dynamic_pr_debug(...)`、615 `#elif defined(DEBUG)`、617 `printk(KERN_DEBUG ...)`、620 `no_printk(...)` 全部 `rgb(92, 99, 112)`。
- 同屏注释行（`* set. Otherwise...`）同为 `rgb(92, 99, 112)`。
- 对照普通 C 语句（约 61-66 行）：关键字 rgb(198,120,211)、类型 rgb(229,192,123)、函数名 rgb(97,175,239) 等多色正常。
- 切「本地 · (未命名)」主题：预处理行变 rgb(0,0,0)（黑），注释 rgb(0,0,255)（蓝），有区分；切回 Vim One (Dark) 又全部同灰。

### FAIL 2（K2）：侧栏/解释栏可见时编辑器被挤压重排（非满宽覆盖）

复现步骤：
1. 刷新页面（面板收起，编辑器 host 宽 1280）。
2. 鼠标悬停左边缘触发器（x≈6）或合成 Ctrl+Alt+B。
3. evaluate 读取 `#editor-host` 的 getBoundingClientRect。

观察到的精确现象：
- 侧栏可见（悬停或钉住均同）：编辑器宽 1016、x=264（=1280−侧栏宽 264）；#app class 含 `sidebar-visible`，#splitter-left 出现。
- 解释栏可见：编辑器宽 908（=1280−372）。
- 收起后编辑器恢复 1280 满宽。未观察到"面板显示但编辑器保持满宽"的覆盖模式。

### 未按任务预期复现的症状

- **D1（gr@.connect 缺 input.c:1064 调用点）**：未复现。gr 结果 5 项中明确包含 `drivers/input/input.c:1064:19`（含预览与 Caller 信息）；`.event` 的 gr 同样包含 input.c 两处调用点。
- **A5/D4（Ctrl+Alt+P 无作用）**：在"真实 CUA 按键"通道下确实无效，但页面事件记录显示组合键字母键以 key=""、code="" 到达（自动化投递缺陷）；用正确形态的合成事件时窗口打开、输入、结果列表、Enter 跳转全部正常。真实键盘用户是否复现无法在本环境判定。

## 测试副作用与状态说明

- 测试过程曾出现一次「更新失败：ssh: Could not resolve hostname code.kylinos.cn」通知（git fetch 失败，无状态变更），已关闭；分支全程 klad-v11-stable 未变。
- 编辑器曾因大写字母真实按键副作用短暂进入 INSERT 并在第 1 行插入字符（内存态），已用 Esc+u 完全恢复（行内容核对无损）。
- 未点击：「解析配置」（make）、「更新」（git fetch，除上述疑似间接触发外从未主动点击）、「深层演变」（git log -L）；未切换分支；nvim 面板未执行 :w/:!；LLM 提问窗口未提交问题；未保存任何设置。
- 最终页面状态：klinux / klad-v11-stable / include/linux/input.h:323:8 / 面板收起 / 无弹窗 / 无通知 / 内置编辑器激活。
