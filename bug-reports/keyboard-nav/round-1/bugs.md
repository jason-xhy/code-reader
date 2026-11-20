# Round 1 键盘导航测试报告

- 时间：2026-11-20 15:03 CST
- 应用版本/地址：Code Reader 1.0.0（git 2fb1911），http://127.0.0.1:8766/
- 起始状态：工作区 linux（active）与 klinux 两个页签；文件 `drivers/usb/host/xhci-ring.c`；光标 4463 行；测试开始时侧栏处于收起状态，页面重载后焦点在编辑器。
- 结束状态：已恢复到 `drivers/usb/host/xhci-ring.c` 4463 行（4463:64），编辑器焦点、NORMAL 模式；文件树/解释栏均收起，分隔条宽度已恢复 372。未保存任何设置、未提交 LLM、未关闭用户仓库页签、未执行 git fetch。

## 测试方式与环境说明（影响复现）

1. 被测操作全部使用键盘完成，未使用鼠标点击执行任何功能。仅在浏览器标签页丢失文档焦点时，用一次编辑器空白处点击恢复页面焦点（不用于打开/选择/提交任何被测功能），随后用键盘完成测试。
2. `tab.cua.keypress` 在本环境对 Shift/Control 组合键存在间歇性丢失或降级：同一按键序列多次执行结果不稳定；大写 `G` 在过滤框中能得到 `G`，但文件树处理器有时收不到 `G`，元素级键盘 `press` 则稳定成功。因此，涉及文件树 Vim 导航键时改用 Playwright 元素级 `press`（仍是真实键盘事件，无鼠标点击、无 evaluate 触发），全局快捷键仍用 `cua.keypress` 并逐次读取 DOM 状态；只有状态已确认变化（例如 `sidebar-visible` class）才计入应用行为。
3. 每次页面重载后等待约 3.5 秒再操作；所有结论以页面 DOM/焦点状态和截图为证据，源码仅用于定位交互入口，不用于推断“应该没问题”。
4. 页面重载会丢失文档焦点，重载后先做一次编辑器聚焦再测试；这属于浏览器宿主行为，未计入应用 BUG。

## 总结

- 覆盖界面：全局快捷键与主页面、文件树、CodeMirror 编辑器、分析与解释栏、提交详情浮层、打开仓库对话框与目录浏览器、LLM 设置、知识库、编辑器环境、本地快捷键、Vim 快捷键、阅读历史菜单、提问框、工作区/编辑器/nvim 页签、快速导航标签层（K/F）、页面重载回归。
- 用例：通过 40 / 失败 12 / 受阻 8（按测试点计；另有 1 条待复现观察不计入）。
- BUG 级别：P0 1 条，P1 11 条，P2 0 条（待复现观察单独列出）。
- 最高频问题集中在三类：模态/浮层焦点未闭环、隐藏面板仍进入 Tab 顺序、Vim 导航键在对话框与搜索场景下不按文档工作。

## BUG 列表

### BUG-R1-01 [P1] 多个模态对话框 Tab 焦点逃逸到 BODY，模态焦点圈不闭环

- 界面/入口：打开仓库（open-dialog）、LLM 设置（llm-dialog）、知识库（docs-dialog）、编辑器环境（editor-env-dialog）、Vim 快捷键（vim-help-dialog）。
- 复现步骤（以打开仓库为例，其余对话框同理）：
  1. 页面重载并聚焦编辑器。
  2. `Ctrl+Alt+B` 聚焦文件树，`Shift+Tab` 3 次到「打开」按钮，`Enter` 打开对话框；焦点在 `#local-path`。
  3. 连续按 `Tab`：`浏览…` → `打开` → **BODY** → `×` → `本地仓库` → `远程仓库` → `#local-path`。
- 期望：焦点在对话框内循环，最后一项之后回到 `×` 或第一个字段，不出现不可见焦点。
- 实际：每轮都出现一步 `document.activeElement === BODY`，焦点环消失；再按一次 Tab 才进入关闭按钮。各对话框实测位置：
  - open-dialog：第 3 次 Tab 到 BODY；
  - llm-dialog：第 8 次 Tab 到 BODY；
  - docs-dialog：第 7 次 Tab 到 BODY；
  - editor-env-dialog：第 5 次 Tab 到 BODY；
  - vim-help-dialog：第 2 次 Tab 到 BODY。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/e02-open-dialog-tab.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/f04-llm-tab.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/f07-docs-dialog.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/f01-editor-env-radio.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/c03-vim-help-tab-scroll.png`
  - DOM 证据：上述每一步 `activeElement` 均为 `BODY`，下一步均为 `#dialog-close` 或 `#…-close`。
- 频率：必现，5/5 个对话框。

### BUG-R1-02 [P0] 提问框 Tab 焦点逃逸到背景分析栏，并在背景元素上触发操作

- 界面/入口：编辑器 `\c` 提问框（question-editor）。
- 复现步骤（纯键盘）：
  1. 编辑器聚焦，`Ctrl+Alt+I` 打开「分析与解释」栏（焦点在解释内容）。
  2. 回到编辑器焦点（例如点击编辑器空白处仅作聚焦），按 `\`、`c` 打开发问框；焦点在 `#question-input`。
  3. 按 `Tab`：`同时生成 3D 动画` → `取消` → `确定` → **背景分析栏的 commit-header**。
  4. 此时提问框仍可见；输入文字不会进入 textarea；在背景 commit 按钮上按 `Shift+Enter` 会打开提交详情浮层。
- 期望：Tab 在提问框内部循环（预设问题、动画复选框、取消、确定），不进入背景面板；焦点不应触发背景操作。
- 实际：第 4 次 Tab 将焦点送到 `#history-content` 的提交按钮，提问框没有关闭，也没有焦点陷阱；背景操作可被触发。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/g04-question-focus-escape.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/g02-question-esc.png`
  - DOM 证据：`question-editor.hidden === false` 时 `activeElement.className === "commit-header"`。
- 频率：必现，2/2（分析栏打开状态下）。

### BUG-R1-03 [P1] Vim 快捷键/本地快捷键对话框初始 j/k/gg/G 不滚动；Vim 帮助关闭后焦点回到 BODY

- 界面/入口：编辑器 `:help`（vim-help-dialog）、nvim 工具条「本地快捷键」（nvim-keymap-dialog）。
- 复现步骤（Vim 帮助）：
  1. 编辑器 NORMAL 模式输入 `:help` 并回车；焦点在 `#vim-help-close`。
  2. 依次按 `j`×5、`G`、`g` `g`。
  3. 读取 `.vim-help-body.scrollTop`，始终为 `0`。
  4. 按 `Tab` 两次：焦点依次到 `.vim-help-body`、BODY；此时再按 `j`×5，`scrollTop` 变为 105。
  5. 按 `Esc` 关闭；`document.activeElement` 为 BODY，不是编辑器。
- 复现步骤（本地快捷键）：
  1. `Ctrl+Alt+2` 切到 nvim 页签，聚焦工具条「本地快捷键」按钮并 `Enter` 打开。
  2. 焦点在 `#nvim-keymap-close`；按 `j`×4，`.nvim-keymap-body.scrollTop` 始终为 `0`（内容明显超出可视高度，存在滚动条）。
- 期望：打开对话框后焦点在对话框内，`j/k/gg/G` 能滚动可滚动容器；`Esc` 关闭后焦点回到编辑器或触发按钮。
- 实际：初始焦点在关闭按钮时 Vim 导航完全不生效；只有把焦点 Tab 到 BODY（对话框外）才滚动。Vim 帮助 `Esc` 后焦点落在 BODY。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/c01-vim-help.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/c02-vim-help-scroll.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/c03-vim-help-tab-scroll.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/f10-nvim-keymap.png`
- 频率：必现，2/2 个对话框；Vim 帮助 Esc 焦点错误 1/1。

### BUG-R1-04 [P1] Ctrl+Alt+B 打开文件树偶现不聚焦，第一次按键只打开面板，需再按一次

- 界面/入口：全局 `Ctrl+Alt+B`，文件树侧栏。
- 复现步骤：
  1. 页面重载，等待约 3.5 秒，聚焦编辑器。
  2. 按一次 `Ctrl+Alt+B`。
  3. 读取状态：`#app.className` 已包含 `sidebar-visible`，侧栏可见；但 `document.activeElement` 仍是 `.cm-content`（编辑器），文件树没有焦点。
  4. 再按一次 `Ctrl+Alt+B`：焦点才进入 `#file-tree`，且面板不关闭。
- 期望：第一次 `Ctrl+Alt+B` 就同时打开面板并把焦点送入文件树（README 的「去代码树」语义）。
- 实际：面板打开了，但焦点被留在编辑器；需要第二次按键。该现象在重载后、关闭解释栏后等情况出现过。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/a06-tree-open-editor-start.png`（侧栏已打开，光标仍在编辑器）
  - DOM 证据：`sidebar-visible` 已置位，`activeElement.className === "cm-content cm-lineWrapping"`；再按一次后变为 `file-tree`。
- 频率：偶现，约 3/10 次；后续同一序列重试有时一次成功。不是按键丢失（面板 class 已变化），而是面板打开后的聚焦时序问题。

### BUG-R1-05 [P1] 从文件树内再按 Ctrl+Alt+B 收起后，焦点落在“打开代码树”提示按钮而不是编辑器

- 界面/入口：文件树侧栏，`Ctrl+Alt+B`。
- 复现步骤：
  1. 编辑器聚焦，`Ctrl+Alt+B` 打开并聚焦文件树。
  2. 再按一次 `Ctrl+Alt+B`。
  3. 侧栏收起；读取 `document.activeElement`。
- 期望：焦点回到编辑器，可立即继续 Vim 编辑。
- 实际：焦点落在 `#nav-tree` 的 `code-nav-hint` 按钮上（“← Ctrl+Alt+B 打开代码树”），不是编辑器。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/a22-tree-close-from-tree.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/a21-tree-close-focus.png`
  - DOM 证据：关闭后 `activeElement.id === "nav-tree"`、`className === "code-nav-hint code-nav-hint-left"`。
- 频率：必现，2/2。

### BUG-R1-06 [P1] 文件树过滤框按 Esc 只清空内容，不退出过滤/不返回文件树

- 界面/入口：文件树过滤框 `#tree-filter`。
- 复现步骤：
  1. `Ctrl+Alt+B` 聚焦文件树，按 `/` 跳到过滤框。
  2. 输入 `README`。
  3. 按 `Esc`：过滤文本被清空，但焦点仍在 `#tree-filter`。
  4. 再按一次 `Esc`：焦点仍在过滤框；只有按 `Tab` 才回到 `#file-tree`。
- 期望：过滤框内 `Esc` 退出过滤并返回文件树（README 的键盘导航语义）。
- 实际：两次 Esc 都不返回树，过滤框保持焦点。
- 证据：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/b09-filter-esc-stuck.png`；DOM 证据：`activeElement.id === "tree-filter"`、`filter.value === ""`，`Tab` 后变为 `file-tree`。
- 频率：必现，3/3。

### BUG-R1-07 [P1] 文件树侧栏打开时 Ctrl+Alt+K 遗漏全部代码行标签

- 界面/入口：主页面 + 文件树侧栏，`Ctrl+Alt+K`。
- 复现步骤：
  1. 页面重载并聚焦编辑器。
  2. `Ctrl+Alt+B` 打开文件树并聚焦文件树；点击编辑器空白处仅恢复编辑器焦点（侧栏保持打开）。
  3. 按 `Ctrl+Alt+K`。
  4. 读取提示与标签：`HINT · 30 个目标 · 输入标签跳转 · Esc 取消`，没有“代码 N 行”，代码区域没有任何标签。
  5. 关闭侧栏后再按 `Ctrl+Alt+K`：提示变成 `36/39 个目标（代码 21 行）`，代码行出现标签。
- 期望：在编辑器焦点的主窗口内，代码行应参与标签，即使侧栏覆盖层打开；README 明确“给所有可操作元素与代码行打字母标签”。
- 实际：侧栏打开时标签层只覆盖侧栏与顶栏，代码行全部缺失，无法用 K 跳转到代码行。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/h13-K-sidebar-no-code.png`
  - 对照（侧栏关闭/解释栏打开时代码行有标签）：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/h14-K-insights.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/h02-ctrl-alt-k-editor.png`（同类现象）
- 频率：必现，3/3（侧栏打开 + 编辑器焦点）。

### BUG-R1-08 [P1] 隐藏的解释栏内容仍参与 Tab 顺序，焦点落到屏幕外

- 界面/入口：主页面 Tab/Shift+Tab；`analytics` 侧栏关闭状态。
- 复现步骤：
  1. `Ctrl+Alt+B` 聚焦文件树（侧栏打开，解释栏关闭）。
  2. 连续按 `Shift+Tab` 5 次。
  3. 第 5 次后 `document.activeElement` 为 `#explanation-content`，但 `#app.className` 只有 `sidebar-visible`，解释栏仍在屏幕外（`.insights` transform 为 -/1280 位置）。
- 期望：隐藏面板内的元素不应成为 Tab 停靠点；若聚焦应自动展开面板并给出可见焦点。
- 实际：焦点进入不可见元素，焦点环消失；用户不知道焦点在哪。
- 证据：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/a17-shifttab-from-tree.png`；DOM 证据：`activeElement.id === "explanation-content"`、`app.className === "sidebar-visible"`。
- 频率：必现，2/2 次相同的 Shift+Tab 序列。

### BUG-R1-09 [P1] 编辑器 Vim 搜索 N 与 n 同向，不能回到上一个匹配

- 界面/入口：编辑器 CodeMirror Vim 模式，`/` 搜索。
- 复现步骤：
  1. 打开 `drivers/usb/host/xhci-ring.c`，NORMAL 模式。
  2. 输入 `/xhci_queue` 回车，光标到 4454。
  3. 按 `n`：到 4462。
  4. 按 `N`：到 4471（本应回到上一个匹配 4454）。
  5. 再按 `N`：4478；再按 `N`：4487；继续按 `n`：4498、4509。N 始终向文件尾部移动。
- 期望：`n` 下一个匹配，`N` 上一个匹配。
- 实际：`N` 与 `n` 同向（前进），没有返回上一处搜索命中。
- 证据：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/c08-editor-search.png`；DOM 证据：`#cursor-pos` 序列 4454 → 4462 → 4471 → 4478 → 4487。
- 频率：必现。

### BUG-R1-10 [P1] 分析栏 `/` 搜索回车后 n/N 被当作查询字符，无法跳转匹配

- 界面/入口：分析与解释栏（insights）内 `/` 搜索。
- 复现步骤：
  1. `Ctrl+Alt+I` 打开解释栏，焦点在解释内容。
  2. 按 `/`，出现 `vim-search-input`。
  3. 输入查询（例如 `正在`），按 `Enter`。
  4. 输入框仍保持焦点；按 `n`，输入框值变成 `正在n`；按 `N`，变成 `正在nN`。
  5. 搜索框显示“无匹配”，但 n/N 没有执行上/下一个匹配。
  6. `Esc` 清空并回到解释内容。
- 期望：`Enter` 定位命中后，`n/N` 在当前窗口内跳到下一个/上一个匹配；至少不能把导航键追加到查询字符串。
- 实际：搜索输入框不退出，全局 Vim 处理器也忽略 `.vim-search` 内的按键，n/N 永久不可用。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/d07-insights-search-enter.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/d08-insights-search-esc.png`
  - DOM 证据：`vim-search-input.value` 从 `正在` 变为 `正在n`、`正在nN`。
- 频率：必现，1/1。

### BUG-R1-11 [P1] 「深层演变」按钮激活后焦点掉到 BODY，面板键盘操作中断

- 界面/入口：分析与解释栏「深层演变（git log -L，较慢）」按钮。
- 复现步骤：
  1. `Ctrl+Alt+I` 打开解释栏，焦点在解释内容。
  2. `Shift+Tab` 到「深层演变」按钮。
  3. `Enter` 激活，等待约 1.5 秒。
  4. 读取焦点：`document.activeElement === BODY`；面板显示“正在执行 git log -L…”。
- 期望：焦点留在面板内（按钮或进度区域），可继续 `j/k` 或 `Esc`。
- 实际：焦点离开面板到 BODY，后续 Vim 导航无法作用到面板。
- 证据：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/d05-deep-evolution.png`；DOM 证据：激活后 `activeElement.tagName === "BODY"`。
- 频率：必现，1/1。

### BUG-R1-12 [P1] 目录浏览器打开后焦点不进入列表，↑/↓ 选择失效，且列表行形成超长 Tab 链

- 界面/入口：打开仓库对话框 → 本地仓库 → 浏览…（dir-browser）。
- 复现步骤：
  1. 打开 open-dialog，确保「本地仓库」页签，焦点 `#local-path`。
  2. `Tab` 到「浏览…」，`Enter` 打开目录浏览器。
  3. 焦点仍停在 `#browse-button`；按 `ArrowDown` 两次，列表没有任何选中/高亮变化。
  4. `Tab`：`↑`（dir-up）→ `选择此目录`（dir-pick）→ 第 1 个目录行 → 第 2 个目录行 → 第 3 个目录行……每个目录行都是独立 Tab 停靠点。
  5. 在第 4 行 `.box` 上按 `ArrowDown`：焦点/选中跳到第 1 行 `.0qaxsafebait`，不是下一行 `.cache`。
  6. 输入字母 `d` 可跳到 `da244-build`；`Enter` 会进入目录并回填路径；`Esc` 关闭整个打开对话框（不是只关闭目录浏览器）。
- 期望：打开目录浏览器后焦点进入目录列表；↑/↓ 从当前行选择相邻项；目录列表使用单个 roving tabindex，Tab 不应经过几十个目录行。
- 实际：焦点留在“浏览…”按钮，方向键不生效；需要 Tab 3 次才进入第一行；每行都是 Tab 停靠点；从某行按 ↓ 会重置到第一项。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/e08-dir-browser.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/e09-dir-tab-order.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/e10-dir-letter-enter.png`
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/e11-dir-esc-result.png`
- 频率：必现；目录行数量随目录内容增长，Tab 链会非常长。

## 待复现/未定性观察（不计入 BUG 总数）

### 观察-01 文件树右键菜单 Esc 曾无法关闭，菜单悬留

- 界面/入口：文件树 `Shift+F10` 菜单。
- 步骤：文件树聚焦 → `Shift+F10` 打开菜单 → `ArrowDown` 两次到「刷新文件树」→ `Enter` 执行刷新 → 再次 `Shift+F10` 打开 → `Esc`。
- 观察：有一次菜单没有隐藏（`#tree-menu.hidden === false`、`display:block`），焦点却回到 `#file-tree`；再按 `Esc` 也不关闭。截图为 `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/b07-tree-menu-stuck.png`。
- 后续复测：刷新后焦点回到编辑器（未落在隐藏菜单项），再次 `Shift+F10`+`Esc` 能正常关闭；因此未稳定复现，暂列观察项。
- 备注：同一菜单在正常打开时，`Shift+F10` → ↑/↓ → `Enter`、`Esc` 路径工作正常，见 `b06-tree-menu.png`、`b10-tree-menu-hidden-focus.png`。

## 通过项（证明覆盖）

截图根目录：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-1/`

| 编号 | 界面 | 操作/按键 | 结果 | 截图 |
|---|---|---|---|---|
| P-01 | 全局 | Ctrl+Alt+B 打开并聚焦文件树（正常时序） | 焦点进入 `#file-tree`，`sidebar-visible` | j02-reload-regression.png |
| P-02 | 全局 | Ctrl+Alt+Shift+B 备用键 | 打开侧栏并聚焦文件树 | a08-shiftB-open.png |
| P-03 | 全局 | Ctrl+Alt+I 打开解释栏 | 面板可见，焦点 `#explanation-content` | d01-insights.png |
| P-04 | 全局 | Ctrl+Alt+I 再按关闭 | 面板收起，焦点回编辑器 | a20-insights-close-focus.png |
| P-05 | 全局 | Ctrl+Alt+Shift+I 备用键 | 打开解释栏并聚焦内容 | a15-shift-i-open.png |
| P-06 | 页签 | Ctrl+Alt+2 / 1、Ctrl+Alt+N / E | nvim 页签焦点进 xterm；回到编辑器焦点 | i01-nvim-tab.png、i02-editor-tab.png |
| P-07 | 工作区 | Ctrl+Alt+] / [ 循环切换 | linux↔klinux，焦点保持编辑器 | w01-workspace-klinux.png、w02-workspace-back.png |
| P-08 | 工作区 | Ctrl+Alt+Shift+2 / 1 直达 | 切到 klinux / linux，状态恢复 | w02-workspace-back.png、w03-after-switch-back-wait.png |
| P-09 | 主界面 | Tab / Shift+Tab 顶栏焦点顺序 | 依次经过同步、主题、工作区页签、编辑器页签、阅读路径等 | a16-shift-tab-to-open.png、a17-shifttab-from-tree.png |
| P-10 | 主界面 | 左分隔条 Tab 聚焦 + ←/→ | 宽度 252→312→276，Tab 退出到分支 select | a18-splitter-left.png |
| P-11 | 主界面 | 右分隔条聚焦 + ←/→ | 宽度 372→396→384，可调整 | a23-splitter-right.png |
| P-12 | 主界面 | 阅读路径 Tab + Enter | 跳到 `xhci.h:1923`，焦点回编辑器 | a19-breadcrumb-enter.png |
| P-13 | 文件树 | j/k/5j/gg/G/H/M/L/0/$ | 选中位置按预期移动（配合元素级键盘） | b02-tree-G.png、b04-tree-M.png |
| P-14 | 文件树 | Ctrl+d/u/f/b、PageDown/PageUp | 半屏/整屏移动，PageUp/Down 正常 | b01-tree-vim-nav.png、b04-tree-M.png |
| P-15 | 文件树 | Enter 打开文件、q 返回编辑器 | 打开 README，q 回到编辑器 | b05-tree-filter-open.png |
| P-16 | 文件树 | 目录 Enter 展开/收起 | arch 展开 51→74 行，再收起 | b03-tree-expand.png |
| P-17 | 文件树 | `/` 过滤 + ↑/↓ + Enter | 过滤 README，Enter 打开候选 | b05-tree-filter-open.png |
| P-18 | 文件树 | Shift+F10 / ↑/↓ / Enter | 菜单打开、选择、刷新执行 | b06-tree-menu.png、b10-tree-menu-hidden-focus.png |
| P-19 | 编辑器 | gd 跳定义 + Ctrl-o / Ctrl-i | xhci-ring.c:4463→xhci.h:1004，可来回 | c04-gd.png、c05-ctrl-o.png |
| P-20 | 编辑器 | gr 引用列表 j/k + Enter + Esc | 4 个引用，选中项预览，Enter 跳转，Esc 关闭回编辑器 | c06-gr-list.png、c07-gr-j.png、c11-gr-esc.png |
| P-21 | 编辑器 | `\e` 聚焦文件树 + q 返回 | 焦点进树，q 回编辑器 | c08-editor-search.png |
| P-22 | 编辑器 | `\c` 提问框焦点、Shift+Enter、Esc | 焦点在 textarea，Shift+Enter 换行，Esc 取消回编辑器 | g01-question-box.png |
| P-23 | 编辑器 | `:help` 打开 Vim 快捷键 | 对话框打开，焦点在关闭按钮 | c01-vim-help.png |
| P-24 | 编辑器 | `:e` 路径 + Tab 补全 | 补全为 `xhci-rcar-regs.h`，Esc 取消不打开 | c10-e-tab-completion.png |
| P-25 | 编辑器 | `/` 搜索 + n | 4454→4462→4471 前进；N 另见 BUG-R1-09 | c08-editor-search.png |
| P-26 | 编辑器 | Ctrl+Alt+K / F 基本流程 | 标签出现、跳转、无效标签提示、无匹配提示、Esc 取消 | h01-ctrl-alt-k-global.png、h04-ctrl-alt-f.png、h05-sneak-jump.png、h06-sneak-esc.png、h07-sneak-nomatch.png |
| P-27 | 打开仓库 | Tab 顺序、远程页签、Esc | 本地/远程切换，Esc 关闭焦点回「打开」 | e01-open-dialog.png、e03-open-dialog-remote.png、e04-open-dialog-esc-focus.png |
| P-28 | LLM 设置 | Tab、select 方向键、Esc | provider 可切换，Esc 关闭焦点回 llm-status | f03-llm-dialog.png、f04-llm-tab.png、f09-llm-select.png |
| P-29 | 知识库 | Tab、Esc | 输入/按钮/复选/保存顺序可达，Esc 关回「知识库」 | f07-docs-dialog.png、f08-docs-esc.png |
| P-30 | 编辑器环境 | radio 方向键、Esc | 方向键切换 auto/nvim/vim，Esc 关闭回触发按钮 | f01-editor-env-radio.png、f02-editor-env-esc.png |
| P-31 | 本地快捷键 | 打开、Esc | 对话框打开；Esc 关闭回 nvim 工具条 | f10-nvim-keymap.png |
| P-32 | 提交详情 | j 到 Diff、Enter 展开、Esc | 焦点 close→summary，details.open=true，Esc 回 commit-header | d02-commit-overlay.png、d03-commit-diff.png、d04-commit-esc-focus.png |
| P-33 | 历史菜单 | Ctrl+Alt+K 标签打开、↑/↓、Esc | 菜单项焦点移动，Esc 回「历史」 | f05-history-menu.png、f06-history-esc.png |
| P-34 | 分析栏 | Shift+Tab 进入项列表、Enter 打开提交 | 深层演变→提交按钮→提交详情 | d02-commit-overlay.png |
| P-35 | nvim | Ctrl+Alt+2 焦点进终端、Ctrl+Alt+1 回编辑器 | xterm-helper-textarea ↔ cm-content | i01-nvim-tab.png、i02-editor-tab.png |
| P-36 | 全局 | 重载后 Ctrl+Alt+B/I/K/F 回归 | B 聚焦树、I 聚焦解释、K/F 标签可用 | j02-reload-regression.png |
| P-37 | 全局 | 连续两次 Ctrl+Alt+B | 无崩溃/状态机错乱；最终面板打开、树聚焦 | j01-double-B.png |
| P-38 | 对话框标签 | 打开仓库对话框内 Ctrl+Alt+K | 6 个目标全部在对话框内；输入标签激活远程页签；无效标签提示重输 | h10-K-open-dialog.png、h11-K-dialog-remote.png、h12-K-dialog-invalid.png |
| P-39 | 两字符定位 | F 无匹配与 Esc | `zz` 提示无匹配可重输；Esc 清除 | h06-sneak-esc.png、h07-sneak-nomatch.png |
| P-40 | Esc 层级 | 标签层 Esc 先于对话框 | 第一次 Esc 只取消标签，对话框保持；第二次才关闭 | h10-K-open-dialog.png |

## 受阻/未覆盖

- **仓库提示条 repo-notice 关闭按钮**：当前界面未出现 repo-notice（无可见提示条），无法验证其关闭按钮的键盘可达性。
- **FAQ 展开/收起与解释内容链接**：当前函数没有 FAQ 条目，解释内容为空（未发起 LLM 提问），无法验证 FAQ 条目和解释链接的 Tab/Enter 激活。
- **历史菜单 Enter 恢复与空状态**：为避免改变用户工作区/当前文件，只验证了打开、↑/↓ 和 Esc；未执行 Enter 恢复。历史列表非空，未制造空列表（清空历史会破坏用户状态）。
- **工作区页签 × 关闭按钮**：Tab 已验证可聚焦到两个 `×` 按钮，但按安全约束未激活关闭，避免关闭用户仓库。
- **nvim 插件级 K/F 映射**：只验证了应用级 `Ctrl+Alt+K` 在 nvim 页签可产生 20 个标签、`Ctrl+Alt+1/2` 页签焦点正常；未验证 nvim 配置内 `K`/`F` 的自定义映射（依赖用户本地插件，且不在应用层可判定）。
- **`:tree` / `:ask` 命令变体**：曾尝试通过 ex 命令行验证，但命令行的焦点/回车执行在自动化注入下不稳定，可能误输入；相同的文件树聚焦与提问框已通过 `\e`、`\c` 验证，未将 ex 变体计入失败。
- **分支 select、主题 select、更新（git fetch）**：按约束未改变选择、未执行更新；仅验证了 Tab 可达。主题/分支下拉的原生键盘行为未做实际切换。
- **工作区切换回 linux 后编辑区短暂空白**：`Ctrl+Alt+Shift+1` 切回后约 2-4 秒内编辑区空白，随后恢复（`w02-workspace-back.png` → `w03-after-switch-back-wait.png`）。该现象更像加载时序而非键盘导航缺陷，未列为 BUG，供后续性能/状态恢复测试参考。