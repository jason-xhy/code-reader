# Round 2 键盘导航回归测试报告

- 时间：2026-11-20 16:40 CST
- 应用/地址：Code Reader 1.0.0，http://127.0.0.1:8766/（Node 服务未重启，仅浏览器 reload）
- 环境：Chromium 视口 1280×720；工作区 linux（active）+ klinux；当前文件 `drivers/usb/host/xhci-ring.c`
- 起始状态：页面 reload 后侧栏/解释栏均收起，编辑器焦点，光标 4461:1，NORMAL 模式
- 结束状态：`drivers/usb/host/xhci-ring.c` 4461:1，编辑器焦点，NORMAL；两侧栏收起；未保存设置、未提交 LLM、未执行 `:w`/`:!`/git fetch、未关闭用户仓库页签（`r2-90-final-state.png`）
- 截图目录：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-2/`

## 测试方式与环境说明（影响复现）

1. 被测操作全部用键盘完成。仅有两类“鼠标”动作，均只用于恢复宿主焦点、不用于执行被测功能：① 自动化通道丢失页面焦点时，在代码区空白处做一次 `cua.click` 把焦点还给页面；② 个别场景用元素定位后发键（Playwright `locator.press`，真实键盘事件，但会先把焦点放到该元素）。凡使用元素级按键的结论，正文逐条注明。
2. `cua.keypress` 对 Shift/Control 组合仍会间歇丢失或降级。涉及大写语义的结论改用元素级 `locator.press('Shift+N')` / `press('Shift+G')` 等；全局组合键用 cua 并逐步读 DOM，只有 DOM 确实变化才计入；连续不变化时最多重试 3 次并记录。
3. 本轮中段出现过一次“整页按键失效”窗口：`document.hasFocus() === true`、activeElement 正常，但 cua 与元素级 press 均无法再驱动任何快捷键或编辑器（j 不动、Esc 无效、B/I/K/F 全无反应），reload 后立即恢复。该现象未能通过可描述的操作序列复现（按 K 标签打开知识库→Esc 关闭 的路径单独重放 1 次未复现），无法排除自动化通道自身故障，**不计入应用 BUG**，仅在此备查。
4. 自动化误输入说明：一次失败的搜索注入使若干字符进入当时打开的 `generic-xhci.yaml` 缓冲区（内存），已用 `u` 完整撤销并核对首行内容，未保存；磁盘文件无改动（目标文件 git 状态干净）。随后已切回 `xhci-ring.c` 并恢复光标。
5. 所有结论以页面实际 DOM/焦点/滚动值 + 截图为准；源码仅用于定位交互入口（如 `topRoot()`、Esc 绑定位置），不用于推断“应该没问题”。截图按关键状态留存（对话框焦点圈、提问框 K 越界、解释栏项焦点、提交浮层 K、重载 B 失败、F 标签覆盖侧栏、最终状态），其余测试点以表格中的 DOM 序列为证据。

## 总结

- Round 1 回归：12 条中 **PASS 11 / FAIL 1**（R1-04 残留）。
- 新发现/仍存在 BUG：**6 条**（P0 0、P1 3、P2 3）。
- 修复风险点 5 条：4 条通过（含提交详情 Esc 恢复、BUG-11 完成态、其余对话框焦点圈），1 条失败（BUG-04 异步窗口）。
- 主要剩余问题集中在三处：重载恢复窗口的文件树聚焦时序、K 标签层在提问框/弹出菜单上的层级边界、解释栏项列表缺少 Esc 退出。

## Round 1 回归

| 编号 | 用例 | 结果 | 证据（截图/DOM） |
|---|---|---|---|
| R1-01 | 各对话框（open/llm/docs/editor-env/vim-help/nvim-keymap）Tab 焦点圈无 BODY | PASS | open-dialog 正向：`browse→open-submit→dialog-close→local-tab→remote-tab→local-path→browse`，无 BODY；反向 7 步同样闭环；Esc 关闭后焦点 `#open-menu`（r2-01-open-dialog-tab.png）。llm：8 项闭环；provider=glm 时 custom-model/protocol 隐藏，Tab 自动跳过，实际 6 项闭环，Esc→`#llm-status`。docs：7 项闭环，Esc→`#docs-settings`。editor-env：radio 组为单停靠点，共 6 项闭环，Esc→`#editor-env-settings`。vim-help/nvim-keymap：均只有关闭按钮，Tab/Shift+Tab 原地不动，Esc 分别回 `.cm-content` / `#nvim-keys` |
| R1-02 | 提问框 Tab 不逃逸到背景 | PASS | 提问框打开后连按 Tab 10 次全部在框内（input→animation→cancel→submit→5 个 preset→input），Shift+Tab 6 次亦全部在框内；全程 `activeElement.closest('#question-editor')` 为真；Esc 关闭后焦点回 `.cm-content` |
| R1-03 | Vim 帮助/本地快捷键 j/k/gg/G 滚动 + Esc 焦点 | PASS | Vim 帮助：j×5 `.vim-help-body.scrollTop` 0→105，G 保持 105（底），gg→0，k 在顶部不变；焦点始终 `#vim-help-close`；Esc→`.cm-content`。本地快捷键：j×4 `.nvim-keymap-body.scrollTop` 0→84，gg→0；Esc→`#nvim-keys` |
| R1-04 | 重载后第一次 Ctrl+Alt+B 是否一次聚焦 | **FAIL** | 重载后 0.9s 按 B（恢复窗口内，树行已就绪）：`#app` 出现 `sidebar-visible`，但 `activeElement` 始终 `.cm-content`（等 3.2s 复核仍如此）；第二次 B 才进 `#file-tree`。重载窗口内 3/3 次面板已打开但不聚焦（另有 1/4 次按键完全丢失、面板未开）。正常等待 4.6s 后 B 一次成功（多次验证）；日常路径另观测到 1 次“面板打开但焦点仍编辑器”。截图 r2-40-reload-immediate-B-focus.png |
| R1-05 | 从树内按 B 收起后焦点回编辑器 | PASS | 文件树聚焦 → B：`sidebar-visible` 移除，`activeElement=.cm-content`，`.sidebar[inert]`，无提示按钮停靠 |
| R1-06 | 过滤框 Esc 回树 | PASS | 输入 README 后一次 Esc：value 清空、`activeElement=#file-tree`、行数恢复 51；无需第二次 Esc/Tab |
| R1-07 | 侧栏打开时 K 含代码行 | PASS | 侧栏打开+编辑器焦点：`HINT · 44 个目标（代码 14 行）`，items 中 `editor-line` 14 项，代码区出现标签 |
| R1-08 | 隐藏解释栏不参与 Tab | PASS | 侧栏打开、解释栏关闭（`.insights[inert]`）：从 `#file-tree` Shift+Tab 7 次为 `#tree-filter→#history-menu-button→#open-menu→BODY→.cm-content…`，未出现 `#explanation-content` |
| R1-09 | `Shift+N` 反向（元素级） | PASS | 仅用 `locator('.cm-content').press('Shift+N')`：搜索 `xhci_queue` 后 `n`：4462→4471；Shift+N：4462→4454→4392（持续向文件头），再 `n`：4454（向文件尾）。方向符合 Vim，Round 1 的“同向”为注入降级误报 |
| R1-10 | 分析栏 `/` Enter 后 n/N | PASS | `/`→`正在`→Enter：`.vim-search` 从 DOM 移除、焦点回 `#explanation-content`；随后 n、N 均未生成 `.vim-search-input`，页面无“正在n/正在nN” |
| R1-11 | 深层演变 loading 焦点（含完成态） | PASS | Enter 后 1.6s：`activeElement=#history-content`（loading，非 BODY）；等待 28s 完成渲染（4 条提交按钮），焦点仍在 `#history-content`，非 BODY（本轮以 DOM 采样为证据，未另存截图） |
| R1-12 | 目录浏览器焦点/↑↓/roving/Esc | PASS | 打开即聚焦首行 `.dir-row.selected`（`.0qaxsafebait`），134 行 tabIndex 前 4 项 `[0,-1,-1,-1]`；↓↓ 依次 `.agents`→`.android`，roving 随动 `[-1,0,-1,-1]`；Tab 直接到 `#open-submit`；Esc 只收起子面板（`#dir-browser.hidden=true`，open-dialog 仍开）焦点回 `#browse-button`；再 Esc 才关闭整个对话框，焦点回 `#open-menu` |

## 修复风险点专项

| # | 风险点 | 结论 | 证据 |
|---|---|---|---|
| 1 | 提交详情 Esc 焦点恢复 | PASS | 分析栏打开 → Shift+Tab 到 `913a8a344f` 提交行 → Enter 打开浮层（焦点 `#commit-overlay-close`，`.insights[inert]`、`#app` 无 insights-visible）→ Esc：浮层隐藏、`#app=insights-visible`、`.insights` 移除 inert，`activeElement` 是同一个 `.commit-header`（文本 `913a8a344f`）。另一路径：重开浮层 → j 到 `SUMMARY`（Diff 4 个文件）→ Enter 展开 `details.open=true` → Esc 仍回同一 `.commit-header`。截图同轮表单可见焦点环 |
| 2 | BUG-11 完成态焦点 | PASS | 见 R1-11：loading 与完成（约 28s）后焦点均在 `#history-content`，非 BODY |
| 3 | BUG-04 异步恢复窗口 | **FAIL** | 重载后 <1s 按 B，3/3 次面板打开而焦点未进树（4s 内也未进）；第二次 B 才进树。详见 R1-04 与 BUG-R2-03 |
| 4 | 其余对话框焦点圈（docs/editor-env/llm/nvim-keymap，含隐藏字段） | PASS | 正反向完整一圈均闭环、无 BODY；llm 切换到 glm 后 `#llm-custom-model`/`#llm-protocol` `offsetParent=null`，Tab 6 项闭环完全跳过；Esc 均回到各自触发按钮 |
| 5 | 注入限制说明 | 已记录 | 元素级 press 用于：R1-09 的 `Shift+N`；解释栏项列表 `Shift+G/M/L/H`；`:e` 补全与命令行文本输入；部分 Esc/j/组合键。其余用 cua 并逐步读 DOM，仅“DOM 确实变化”的轮次计入 |

## 新发现 BUG

### BUG-R2-01 [P1] 提问框打开时 Ctrl+Alt+K 标签层越界，可在背景代码行执行跳转并夺走焦点

- 界面/入口：编辑器 `\c` 提问框（question-editor）+ 全局 Ctrl+Alt+K。
- 复现步骤：
  1. 编辑器 NORMAL（两次复测光标分别在 4454 / 4458）；`\c` 打开发问框（焦点 `#question-input`）。
  2. 按 `Ctrl+Alt+K`。
  3. 读取提示与目标：`HINT · 35 个目标（代码 11 行）`；标签出现在顶栏（打开/历史/分支/主题/工作区页签）、底部工具栏和**代码行**上，提问框自身只有 9 个标签。
  4. 输入背景代码行标签 `ap`（对应 4445 行）。
- 期望：提问框是顶层模态（其 Tab 焦点圈已按模态处理），标签层应只覆盖提问框，不能激活背景元素（README：标签层自动限定在当前顶层窗口，不会点到遮罩后面的元素）。
- 实际：背景顶栏/代码行均参与标签；输入背景标签后光标 4454→4445（另一次复测停在 4458，标签范围同图），`activeElement` 变为 `.cm-content`，提问框仍保持打开，用户可在背景编辑而模态未关闭。
- 证据：`r2-10-question-k-background.png`（背景标签清晰可见）；DOM：`question-editor.hidden=false` 时 items 35 个，其中 `editor-line` 11 个；激活后 `activeElement.className="cm-content cm-lineWrapping"`、`#cursor-pos=4445:1`。
- 源码定位（只读）：`public/keyboard-nav.js` 的 `topRoot()`（约 90-101 行）只认 dialog/3D/提交详情，不含 `#question-editor`；而 `modalRoot()`（约 104-113 行）包含提问框，导致 Tab 陷阱与 K 标签层范围不一致。
- 频率：必现，2/2。

### BUG-R2-02 [P1] 解释栏项列表模式 Esc 无效，无法按文档“先退回阅读模式”

- 界面/入口：分析与解释栏（insights）内的提交行 / 「深层演变」按钮。
- 复现步骤：
  1. `Ctrl+Alt+I` 打开解释栏，焦点 `#explanation-content`。
  2. `Shift+Tab` 进入历史列表，焦点落在 `.commit-header`（如 `3ffbba9511`）。
  3. 连按 `Esc` 4 次（3 次 cua + 1 次元素级 `press('Escape')`）。
- 期望：README「解释栏打开后默认是阅读模式，Tab 或点击链接进入项列表模式，Esc 先退回阅读模式再回编辑器」——第一次 Esc 应回到 `#explanation-content`，再按回编辑器。
- 实际：焦点与面板完全不变（`#app=insights-visible`、`activeElement=.commit-header`）；只能再用 `Ctrl+Alt+I` 关闭面板。
- 证据：`r2-20-insights-item-focus.png`（提交行焦点环、面板保持）；DOM：4 次 Esc 后 activeElement 仍为 `BUTTON.commit-header`。
- 源码定位（只读）：`public/app.js` 约 3758 行的 Escape 处理器绑定在 `elements.explanationContent` 上，只覆盖阅读容器；焦点在历史区的按钮上时事件不经过该处理器，document 级处理器也无解释栏分支。
- 频率：必现，4/4。

### BUG-R2-03 [P1] （R1-04 残留）重载恢复窗口内首次 Ctrl+Alt+B 只打开面板、不聚焦文件树

- 界面/入口：页面重载后 1s 内的 `Ctrl+Alt+B`。
- 复现步骤：
  1. `location.reload()`，约 0.9s 时按 `Ctrl+Alt+B`（此时树行已可用）。
  2. 等待 3-4s 读状态。
- 期望：第一次 B 同时打开面板并把焦点送入 `#file-tree`（README「去代码树」语义，Round 1 修复目标）。
- 实际：`#app` 含 `sidebar-visible`、树行 74/51，但 `activeElement` 仍是 `.cm-content`；等 3.2s 后仍未进入；第二次 B 才聚焦。另有 1/4 次按键完全未送达（面板未开）。
- 证据：`r2-40-reload-immediate-B-focus.png`（面板已展开、代码区无焦点环）；DOM：`app=sidebar-visible`、`ae=cm-content cm-lineWrapping`、`rows=74`。
- 频率：重载窗口内面板成功的 3/3 次均不聚焦；正常加载完成后 B 一次成功（多次验证），日常路径另观测到 1 次同类失败（面板开、焦点留编辑器）。修复说明中的重试（120ms/4s）未覆盖“恢复流程把焦点设回编辑器后重试被放弃”的时序。
- 备注：该条与 Round 1 BUG-R1-04 同源，属未彻底修复。

### BUG-R2-04 [P2] Ctrl+Alt+F 对侧栏遮挡下的代码匹配仍打标签，标签浮在侧栏上

- 界面/入口：侧栏（文件树）打开、编辑器焦点，`Ctrl+Alt+F` 两字符定位。
- 复现步骤：
  1. B 打开文件树，`q` 回编辑器；按 `Ctrl+Alt+F`，输入 `xh`。
  2. 读取提示：`SNEAK “xh” · 19 处`；观察标签位置。
  3. 截图：`b/c/e/j/q` 等标签落在左侧文件树面板的树行/过滤框上；它们对应的是被侧栏覆盖的代码行匹配。
- 期望：只给实际可见的匹配打标签（同 K 的多点可见性探测），标签不应画在覆盖层上；若保留标签，激活后应保证目标可见。
- 实际：覆盖层下的匹配仍生成标签，标签绘制在侧栏表面，位置与目标文本分离；输入标签会跳到被侧栏遮住的代码行（侧栏不收起，用户看不到跳转结果）。
- 证据：`r2-50-f-labels-under-sidebar.png`（侧栏列内可见 b/c/e/j/q 标签）；提示 18-19 处（随视口变化）。
- 源码定位（只读）：`collectSneakMatches()` 对编辑器匹配只用 `clipRect` 裁剪到编辑器矩形，未判断侧栏覆盖层遮挡；K 已在 444 行改为 5 点探测，F 未同步。
- 频率：必现，2/2（侧栏打开时）。

### BUG-R2-05 [P2] 弹出菜单打开时 K 标签层不限定菜单，覆盖整页并可激活背景

- 界面/入口：阅读历史菜单（`#history-menu`）、文件树右键菜单（`#tree-menu`）+ Ctrl+Alt+K。
- 复现步骤：
  1. 文件树聚焦，Shift+Tab 到「历史」按钮，Enter 打开历史菜单（5 项）。
  2. `Ctrl+Alt+K`：提示 `HINT · 43 个目标（代码 9 行）`，标签覆盖顶栏、文件树、代码行与菜单项本身。
  3. 文件树菜单同理：`HINT · 40 个目标（代码 10 行）`，包含「复制相对路径/绝对路径/刷新文件树」与整页背景。
- 期望：菜单作为当前顶层交互层时，标签只覆盖菜单项（README 的“顶层窗口”列举了对话框/提交详情/引用列表，未列菜单，但菜单已有独立的 ↑/↓/Enter/Esc 焦点语义，K 覆盖整页与之不一致）。
- 实际：背景元素全部参与标签；激活背景标签会关闭菜单并在背景执行操作，层级边界失效。
- 证据：DOM items 计数与文本清单（历史菜单 43 项含顶栏/树/代码；树菜单 40 项含 3 个菜单项）。
- 频率：必现，2/2 个菜单。

### BUG-R2-06 [P2] 编辑器内 Tab/Shift+Tab 完全被编辑器捕获，无法用 Tab 离开编辑器

- 界面/入口：CodeMirror 编辑器（NORMAL 模式）。
- 复现步骤：
  1. 编辑器聚焦，连按 `Tab` 10 次；再连按 `Shift+Tab` 8 次。
  2. 每次读取 `document.activeElement`。
- 期望：作为代码编辑器，Tab 可用于缩进是合理的；但应至少提供明确的键盘出口（本应用已有 Ctrl+Alt+B/I/K/F 等，故按“可绕过”计 P2，而非 P0 焦点陷阱）。
- 实际：18 次前后向 Tab 全部停留在 `.cm-content`；Shift+Tab 还会执行 Vim 的退格动作（光标列 33→25），Tab 无法把焦点移出编辑器。实际影响：`#editor-host → #splitter-right` 的正向 Tab 路径被截断，右分隔条只能直接聚焦（反向 Shift+Tab 路径本轮未闭环）。
- 证据：DOM activeElement 序列全部为 `DIV.cm-content.cm-lineWrapping`；光标列变化证明按键被编辑器消费而非丢失。
- 频率：必现，18/18。

## 通过项（证明覆盖）

| 编号 | 界面/场景 | 操作 | 结果 |
|---|---|---|---|
| P2-01 | 主页面 K | Ctrl+Alt+K（两侧栏收起） | `HINT · 36 个目标（代码 21 行）`，标签覆盖顶栏与代码行；Esc 退出并回编辑器 |
| P2-02 | 侧栏 K | 侧栏打开+编辑器焦点 | `44 个目标（代码 14 行）`，R1-07 修复保持 |
| P2-03 | 解释栏 K | 解释栏打开+焦点内容 | `43 个目标（代码 12 行）`，提交行有独立标签（af/ah/ak…） |
| P2-04 | 文件树 K 激活 | 输入 arch 行标签 `ah` | 目录展开（51→74 行），焦点保持 `#file-tree` |
| P2-05 | K 无效标签 | 输入 `z` | 提示 `HINT · 没有匹配的标签 · 重新输入 · Esc 取消`；Esc 清除 |
| P2-06 | 对话框内 K | llm / docs / editor-env / vim-help / nvim-keymap | 分别 8 / 7 / 9 / 1 / 1 个目标，全部位于对话框内；Esc 先退标签层、再关对话框 |
| P2-07 | 提交详情 K | 打开浮层后 K | `2 个目标`（关闭按钮 + 另一个浮层内目标；另一次浮层状态只报 1 个目标，未定性，未计入 BUG），标签不出浮层；Esc 先退标签层，浮层保持（r2-30-k-overlay.png） |
| P2-08 | 两字符定位 | 编辑器 Ctrl+Alt+F + `xh` | 18-19 处标签，输入 `a` 跳到匹配行（4438 附近），焦点回编辑器；`zz` 提示“没有匹配 · 重新输入”；Esc 清除 |
| P2-09 | 两字符定位边界 | open-dialog 内 Ctrl+Alt+F + `op` | `没有匹配`，未在背景代码生成标签（原生对话框层限制有效） |
| P2-10 | 解释栏项列表 | Tab/Shift+Tab 进入列表，j/k/5j/`$`/`0`/`o`/Enter | j 前进、k 后退、5j 生效；`$` 到「深层演变」、`0` 回首条；`o` 与 Enter 均打开对应提交浮层，Esc 回同一提交行 |
| P2-11 | 解释栏列表大写 | 元素级 `Shift+G/M/L/H` | G→末项（深层演变）、H→首条 82b70c7992、M→中部候选 a769154c7c、L→末项；方向正确（cua 大写会降级，未计入） |
| P2-12 | 提交详情 Tab 圈 | 浮层内 Tab/Shift+Tab 各 4 次 | 仅在 `#commit-overlay-close` 与 `SUMMARY` 间闭环，无 BODY；Esc 回同一 `.commit-header` |
| P2-13 | 历史菜单 | Enter 打开、↑/↓、Esc | 菜单打开焦点 `history-item`；↓↓ 使焦点在菜单项间移动（一次误触 Enter 触发了历史恢复）；Esc 关闭并回 `#history-menu-button` |
| P2-14 | 文件树菜单 | Shift+F10、Esc ×3 | 3/3 均关闭（`hidden=true`、`display:none`），焦点回 `#file-tree`；Round 1 的“Esc 悬留”未复现；菜单内 ↓↓ 与「刷新文件树」Enter 路径本轮未重测 |
| P2-15 | 目录浏览器 | 打开/↓/Tab/Esc | 见 R1-12，全部通过 |
| P2-16 | 工作区快捷键 | Ctrl+Alt+]、Ctrl+Alt+[（重试一次）、Ctrl+Alt+Shift+2/1 | 依次切到 klinux、回 linux、直达 klinux、回 linux，活动页签与光标位置正确恢复 |
| P2-17 | 页签快捷键 | Ctrl+Alt+2 / 1、Ctrl+Alt+N / E | 焦点依次 `xterm-helper-textarea` ↔ `.cm-content`，页签状态同步 |
| P2-18 | 切换后快捷键 | 切换工作区/页签后立即 B/I/K/F | 均一次生效：B 聚焦树、I 聚焦解释栏、K 显示标签、F 显示 SNEAK 提示 |
| P2-19 | 重载回归（等待 3.5s 后） | B/I/K/F 各一次 + 打开文件 | B→`#file-tree`；I→`#explanation-content`；K→45 目标（13 行）；F→SNEAK 提示；文件树过滤 `xhci-ring.c` 单候选 Enter 打开成功（阅读路径 `generic-xhci.yaml:3→xhci-ring.c:1`） |
| P2-20 | 文件树过滤 | `/` + 输入 + ↑/↓ + Enter | 输入 `xhci` 后 51 条候选；↓↓ 后 Enter 打开的是非首行候选（generic-xhci.yaml），推断方向键生效（选中高亮无法逐项读取）；`xhci-ring.c` 单候选 Enter 直接打开；Esc 清空并回树 |
| P2-21 | 隐藏面板 Tab | 两侧栏关闭 / 分别打开 | 关闭时 `.sidebar[inert]`、`.insights[inert]`，Tab 链无隐藏元素；打开后解释栏提交行可通过 Shift+Tab 到达，侧栏树/过滤/按钮可 Tab 到达 |
| P2-22 | 左分隔条 | 从 `#branch-select` Shift+Tab → `#splitter-left` → →×3 → Tab | 焦点进入分隔条，宽度 276→312px（aria-valuenow 同步），Tab 退出到 `#branch-select` |
| P2-23 | 右分隔条 | 聚焦 `#splitter-right` → ←×3 → Tab | 宽度 372→408px（aria-valuenow 同步），Tab 退出到 `#commit-header`；正向 Tab 可达性受 BUG-R2-06 影响（见未覆盖） |
| P2-24 | `\e` / `q` | 编辑器 → `\e` → `q` | 焦点进 `#file-tree`，q 回 `.cm-content` |
| P2-25 | `\c` / Esc | 编辑器 → `\c` → Esc | 焦点 `#question-input`，Esc 关闭并回 `.cm-content` |
| P2-26 | `:e` Tab 补全 | `:e drivers/usb/host/xhci-r` + Tab | 补全为 `drivers/usb/host/xhci-rcar-regs.h`；Esc 取消，文件与光标不变（4461:1） |
| P2-27 | 跳转栈 | Ctrl-o / Ctrl-i | Ctrl-o 跳到另一位置（1:1、阅读路径为空），Ctrl-i 返回 4461；往返可用，但 Ctrl-o 的目标未逐项核对（Round 1 已验证 xhci.h↔xhci-ring.c） |
| P2-28 | Esc 层级（K/浮层/对话框/提问框） | 逐层 Esc | 标签层 Esc 只退标签（浮层/提问框/对话框保持）；浮层 Esc 只关浮层；提问框 Esc 只关提问框；对话框 Esc 只关对话框并回触发元素 |

## 受阻/未覆盖

1. **3D 动画浮层的键盘操作**：当前函数解释为空、无 LLM 动画数据，`#animation-overlay` 始终 hidden，未能打开；其 K/F、Tab 圈、Esc 未测。
2. **解释栏阅读模式滚动键**（j/k/计数/Ctrl+d/u/f/b/Space/gg/G/H/M/L/0/$）：解释内容为占位文本，`#explanation-content` 的 `scrollHeight==clientHeight==53`，无滚动量，无法判定方向；项列表模式的同名键已验证。需要一次真实 LLM 长回答才能覆盖。
3. **编辑器 `gd` 复测**：LSP 状态显示 `clangd 21.1.0 就绪`，但本轮把光标落在注释/空白列（4461 注释、4463 行首缩进）时 `gd` 不产生跳转，未能用“符号上 gd”稳定复测；`gr` 未重跑。Round 1 已通过，本轮记为未覆盖，建议下一轮用 `w`/搜索把光标放到标识符后再测。
4. **右分隔条的正向 Tab 可达性**：`#nav-insights → #editor-host → .cm-content` 后 Tab 被编辑器捕获（BUG-R2-06），无法继续 Tab 到 `#splitter-right`；本轮以直接聚焦 + 反向邻接关系（`#editor-host → #splitter-right → 首个 .commit-header`）证明其可聚焦与可调整，正向 Tab 路径未闭环。
5. **工作区页签 × 关闭按钮**：Tab 顺序中可见两个 `×` 按钮，但按安全约束未激活关闭，避免关闭用户仓库。
6. **历史菜单 Enter 恢复**：为避免改变用户工作区/当前文件，本轮只测了 ↑/↓ 与 Esc；一次误操作（焦点在历史按钮时按 ↓↓+Enter）实际执行了历史恢复，把活动工作区切到 klinux；随后已用 `Ctrl+Alt+Shift+1` 切回 linux 并恢复 xhci-ring.c 4461，故未把该路径计入通过项。
7. **nvim 页签内的 K/F**：本轮未在 xterm 前台重复 K/F（Round 1 仅验证应用级 K），nvim 插件级映射仍不在应用层判定范围。
8. **自动化通道异常时段**：见“测试方式”第 3 条；该时段内所有按键（含元素级）无响应、reload 后恢复，未计入 BUG，但会影响个别频率统计的置信度。