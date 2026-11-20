# Round 4 键盘导航最终验收回归报告

- 时间：2026-11-20 18:00–18:20 CST
- 应用/地址：Code Reader 1.0.0，http://127.0.0.1:8766/（Node 服务未重启，未修改任何应用源码）
- 工作区：linux（active）+ klinux；当前文件 `drivers/usb/host/xhci-ring.c`
- 视口：1280×720；侧栏宽 252（收起时 x=-252），解释栏宽 372（打开时 x=908）
- 起始状态：`xhci-ring.c`，NORMAL，编辑器焦点，两侧栏收起
- 结束状态：`drivers/usb/host/xhci-ring.c` 4462:1，NORMAL，编辑器焦点，两侧栏收起，无对话框/浮层/提问框/标签层；重新打开页面复核仍为 4462:1（截图 `r4-99-final-state.png`）
- 截图目录：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-4/`

## 测试方式与环境说明（影响复现）

1. 被测操作全部由键盘完成；未用鼠标点击执行任何被测功能，未用 `evaluate` 触发功能或修改状态（`evaluate` 仅用于只读读取焦点、DOM、矩形坐标、滚动值与内部目标清单）。
2. **本轮遇到与 Round 2/3 同型的输入通道故障**：系统锁屏（`ukui-screensaver-dialog` 持有前台焦点）期间，`mcp__node_repl__js` 的 `cua.keypress` 与 `tab.press` 均收不到任何 `keydown`（页面内临时监听器记录为空）；解锁后，会话内 IAB 页签仍不是 Chrome 的前台页签（其 `outerWidth=0`，不可被 OS 输入定向），`cuaKeypress` 只作用于前台页签，故通道依旧不可用。**该故障属测试工具/环境层，不计应用 BUG。**
3. 为保证真实键盘事件，本轮改用 **Playwright 驱动的独立 Chrome（同一 URL、1280×720、headless）** 执行全部用例：`page.keyboard.press`/`type` 产生真实按键事件；大写 Shift 语义用元素级 `locator('.cm-content').press('Shift+N')`（真实键盘事件，正文注明）。截图由同一浏览器写出到 `round-4/`。
4. 处置副作用披露：切换前台页签过程中，一次 `xdotool` 单键 `j` 曾发到用户 Chrome 的 Code Reader 页签（未保存、未写盘、未执行任何写操作）；用户 Chrome 前台页签曾被切到 Code Reader 且未能自动切回 GitHub（未关闭任何页签）。测试用的 IAB 页签已 reload/清理，缓冲区首行恢复为 `int xhci_queue_address_device(...)`，光标 4462:1。
5. 未保存任何设置、未提交 LLM、未执行 `:w`/`:!`、未 git fetch、未关闭用户仓库页签、未执行历史菜单 Enter 恢复。INSERT 模式缩进测试已用 Esc+`u` 撤销并核对行文本。

## 总表

| 轮次 | 用例数 | PASS | FAIL | PARTIAL |
|---|---|---|---|---|
| Round 1 | 12 | 12 | 0 | 0 |
| Round 2 | 6 | 6 | 0 | 0 |
| Round 3 | 2 | 2 | 0 | 0 |
| **合计** | **20** | **20** | **0** | **0** |

## 20 条最终回归

### R1-01 [PASS] 六个对话框 Tab 正反向闭环无 BODY

- 重放：分别用键盘打开 open-dialog（侧栏 → 文件树 → Shift+Tab×3 → 打开）、llm-dialog（K 标签 `bn`）、docs-dialog（K 标签 `bq`）、editor-env-dialog（K 标签 `bp`）、vim-help（`:help` + Enter）、nvim-keymap（`Ctrl+Alt+2` → K 标签 `s`）；每个对话框连续 Tab 走完一圈，再 Shift+Tab 反向一圈。
- 实测（正向/反向步数，均为 0 次 BODY）：
  - open-dialog：6/6。`#local-path → #browse-button → #open-submit → #dialog-close → #local-tab → #remote-tab → #local-path`，反向序列完全镜像。
  - llm-dialog：8/8。`#llm-dialog-close → #llm-provider → #llm-model → #llm-custom-model → #llm-base-url → #llm-protocol → #llm-api-key → #llm-save → close`（自定义兼容服务下 custom-model/protocol 可见，均参与循环）。
  - docs-dialog：7/7。`#docs-close → #docs-path-input → #docs-add → .faq-delete → #docs-web-enabled → #docs-reindex → #docs-save → close`。
  - editor-env-dialog：5/5。`#editor-env-close → INPUT(radio 组单停靠) → #editor-env-appname → #editor-env-refresh → #editor-env-save → close`。
  - vim-help-dialog：1/1。只有 `#vim-help-close`，Tab/Shift+Tab 均原地，无 BODY。
  - nvim-keymap-dialog：1/1。只有 `#nvim-keymap-close`，Tab/Shift+Tab 均原地，无 BODY。
- Esc 焦点：open→`#open-menu`；llm→`#llm-status`；docs→`#docs-settings`；env→`#editor-env-settings`；vim-help→`.cm-content`；nvim-keymap→`#nvim-keys`。
- 证据：`r4-01a-open-dialog.png`、`r4-01b-llm-dialog.png`、`r4-01c-docs-dialog.png`、`r4-01d-env-dialog.png`、`r4-01e-vim-help.png`、`r4-01f-nvim-keymap.png`。

### R1-02 [PASS] 提问框 Tab 全程在框内

- 重放：编辑器 NORMAL 下 `\c` 打开发问框（焦点 `#question-input`），连按 Tab 12 次，再 Shift+Tab 6 次。
- 实测正向：`animation → cancel → submit → preset×5 → input → animation → cancel → submit`（第 9 次回到输入框，形成闭环）；12 次全部 `closest('#question-editor')` 为真。反向 6 次：`cancel → animation → input → preset×3`，全部在框内。
- Esc 关闭后焦点 `.cm-content`，提问框 `hidden=true`。
- 证据：`r4-02-question-tab.png`。

### R1-03 [PASS] Vim 帮助/本地快捷键 j/k/gg/G 滚动 + Esc 焦点

- Vim 帮助（`:help`）：`.vim-help-body.scrollTop` 序列 `0 → 105（j×5） → 443（G） → 0（gg） → 0（k 在顶部）`；全程焦点 `#vim-help-close`；Tab/Shift+Tab 原地。
- Esc 关闭后焦点 `.cm-content`（不是 BODY）。
- 本地快捷键（nvim 页签 → K 标签 `s`）：`.nvim-keymap-body.scrollTop` 序列 `0 → 84（j×4） → 1509（G） → 0（gg）`；Esc 关闭后焦点 `#nvim-keys`；`Ctrl+Alt+1` 回编辑器。
- 证据：`r4-03-vim-help-scrolled.png`（已滚到内容中部）、`r4-03b-nvim-keymap-scrolled.png`（已滚到底部附近）。

### R1-04 [PASS] 重载后 0.5s/1s/3.5s 首次 Ctrl+Alt+B 一次聚焦树

- 重放：`page.reload()` 后在 0.5s/1s/3.5s 各按一次 B（每次只按一次），随后 100ms 采样约 7 秒，观察焦点轨迹与树行数。
- 0.5s：按键 505ms；809ms 进 `#file-tree`（rows=51）；1072ms 短暂回 `.cm-content`；1193ms 起稳定在树至 8.5s。
- 1s：按键 1003ms；1499ms 进树；1812ms 短暂回编辑器；1945ms 起稳定至 9.6s。
- 3.5s：按键 3504ms；3596ms 进树并稳定至 11s。
- 三次均未按第二次 B，最终 `activeElement=NAV#file-tree`、`sidebar-visible` 保持。
- 证据：`r4-04a-reload-05s-B.png`、`r4-04b-reload-1s-B.png`、`r4-04c-reload-35s-B.png`。

### R1-05 [PASS] 树内按 B 收起后焦点回编辑器

- 重放：`Ctrl+Alt+B` 打开树（焦点 `#file-tree`），再按一次 B。
- 实测：`sidebar-visible` 移除；`activeElement=DIV.cm-content.cm-lineWrapping`；`.sidebar.inert=true`；焦点未落到 `#nav-tree` 提示按钮。
- 证据：`r4-05-tree-collapse.png`。

### R1-06 [PASS] 过滤框 Esc 回文件树

- 重放：树焦点按 `/` → 输入 `README`（value=`README`，rows 93）→ 按一次 Esc。
- 实测：`#tree-filter.value=""`；`activeElement=NAV#file-tree`；rows 恢复 51；无需第二次 Esc 或 Tab。
- 证据：`r4-06-filter-esc.png`。

### R1-07 [PASS] 侧栏打开时 K 含代码行（含 R3-01 落点）

- 重放：侧栏打开、编辑器焦点，`Ctrl+Alt+K`；读取提示、目标种类与代码行标签坐标，并激活一个代码行标签。
- 实测：`HINT · 44 个目标（代码 14 行）`；items 中 `editor-line` 14 项；14 个代码行标签 x=264–442（侧栏右边界 252），全部位于 `#editor-host` 内且与对应行同 y；激活 `al`（4454 行）后光标 `4454:1`、焦点 `.cm-content`。
- 与历史区间对比：仅侧栏 44/14 落在历史 42–44/12–14 区间内；双栏 45/14 多出的 1 个目标是解释栏内的可见控件，代码行数同为 14；全收起 36/21 为无侧栏布局的既有值。
- 证据：`r4-07a-sidebar-only-K.png`。

### R1-08 [PASS] 隐藏解释栏不参与 Tab

- 重放：侧栏打开（树焦点），解释栏收起；连续 Shift+Tab 8 次。
- 实测序列：`#tree-filter → #history-menu-button → #open-menu → BODY → .cm-content → #editor-host → #nav-insights → #nav-tree`；全程未出现 `#explanation-content`；`.insights.inert=true`。
- 说明：其中一次 BODY 为浏览器文档首尾的正常换行停靠，下一步即可继续移动；不是隐藏元素焦点。
- 证据：`r4-08-hidden-insights-tab.png`。

### R1-09 [PASS] 元素级 Shift+N 反向

- 重放：`xhci-ring.c` 中 `4462G`，`/xhci_queue` 回车，然后用元素级 `locator('.cm-content').press('Shift+N')`。
- 实测：搜索结果 `4462:5`；`n → 4471:5`（向文件尾）；`Shift+N → 4462:5`；再 `Shift+N → 4454:5`（持续向文件头）；再 `n → 4462:5`（向文件尾）。方向符合 Vim 语义。
- 说明：未使用 `cua` 大写单键判定（本环境会降级为小写，属注入限制）；Round 1 的“N 同向”确认为注入误报。
- 证据：`r4-09-shiftN.png`。

### R1-10 [PASS] 分析栏 `/` 回车后 n/N

- 重放：`Ctrl+Alt+I` 打开解释栏（焦点 `#explanation-content`）→ `/` → 输入 `git` → Enter → 按 n、N。
- 实测：Enter 后 `.vim-search` 数量 0、`activeElement=DIV#explanation-content`；随后 n/N 均未重新生成搜索框，也未把字符写入查询；Esc 回编辑器，面板保持。
- 证据：`r4-10-insights-search.png`。

### R1-11 [PASS] 深层演变 loading + 完成态焦点（≤60s）

- 重放：解释栏焦点 → Shift+Tab 到「深层演变（git log -L，较慢）」→ Enter。
- 实测：1.6s 时 `activeElement=DIV#history-content`，class 含 `loading`，文本“正在执行 git log -L 追踪函数演变…”，非 BODY；31.2s 完成，渲染 5 个 `.commit-header`，焦点仍为 `#history-content`，非 BODY。
- 证据：`r4-11a-deep-loading.png`、`r4-11b-deep-done.png`。

### R1-12 [PASS] 目录浏览器聚焦/↑↓/roving/Esc 两层

- 重放：侧栏 → Shift+Tab×3 → `#open-menu` Enter → 打开对话框 → Tab 到「浏览…」Enter。
- 实测：打开即 `BUTTON.dir-row.selected`（`.0qaxsafebait`）；共 134 行，前 4 行 tabIndex `[0,-1,-1,-1]`；↓ 两次 `.0qaxsafebait → .agents → .android`，roving 变为 `[-1,-1,0,-1]`；Tab 直接到 `#open-submit`（不经过其余 133 行）；Esc1：`#dir-browser.hidden=true`、open-dialog 仍开、焦点回 `#browse-button`；Esc2：对话框关闭、焦点回 `#open-menu`。
- 证据：`r4-12-dir-browser.png`。

### R2-01 [PASS] 提问框 K/F 只覆盖提问框

- 重放：`\c` 打开发问框后 `Ctrl+Alt+K`，读取目标；Esc 后 `Ctrl+Alt+F` 输入 `th`。
- 实测：K 为 `HINT · 9 个目标`，全部为 `hint` 类：5 个预设（函数目的/数据流/设计原因/规范依据/3D 动画）+ `#question-input` + `#question-animation` + `#question-cancel` + `#question-submit`；无 `editor-line`，背景顶栏/代码行无标签。F：`SNEAK “th” · 1 处`，唯一匹配为提问框内「同时生成 3D 动画解释（three.js）」。
- 证据：`r4-21-question-K.png`、`r4-22-question-F.png`。

### R2-02 [PASS] 解释栏项列表 Esc 两段

- 重放：解释栏打开 → Shift+Tab 两次进入提交项（焦点 `BUTTON.commit-header`）→ 连按 Esc。
- 实测：Esc1 → `#explanation-content`，面板仍 `insights-visible`；Esc2 → `.cm-content`，面板保持；Esc3 无变化（面板不因 Esc 收起）。
- 证据：`r4-22-insights-esc.png`。

### R2-03 [PASS] 重载窗口首次 B（与 R1-04 同组，三时机）

- 与 R1-04 同一组重放：0.5s/1s/3.5s 三次均只需一次 B，最终聚焦 `#file-tree`，无需第二次；详细时间线见上。
- 证据：`r4-04a/04b/04c`。

### R2-04 [PASS] 侧栏遮挡下 F 不越界

- 重放：侧栏打开（右边界 252）、编辑器焦点，`Ctrl+Alt+F` 输入 `xh`。
- 实测：`SNEAK “xh” · 12 处`；12 个标签 x 最小 307（全部 ≥252），逐点 `elementFromPoint` 均属于 `#editor-host`，无标签落在树行/过滤框上。
- 证据：`r4-24-sidebar-F.png`。

### R2-05 [PASS] 菜单打开时 K 只覆盖菜单，关闭恢复

- 历史菜单：`#history-menu-button` Enter 打开 → K：`HINT · 5 个目标`，5 项均为菜单项（linux/klinux/code-reader/wt-90329-kfnext/清空历史）；Esc 只退标签层（菜单仍开，焦点仍在菜单项）；再 Esc 关闭，焦点回 `#history-menu-button`。
- 文件树菜单：树焦点 `Shift+F10` → K：`HINT · 3 个目标`，均为「复制相对路径/复制绝对路径/刷新文件树」；Esc×2 后菜单 `hidden=true`、焦点回 `#file-tree`。
- 菜单关闭后再 K：恢复整页 `HINT · 36 个目标（代码 21 行）`（15 hint + 21 editor-line）。
- 证据：`r4-25-history-menu-K.png`、`r4-25b-tree-menu-K.png`。

### R2-06 [PASS] 编辑器 Tab 新行为

- NORMAL（两侧栏收起）：`Tab → BODY → #branch-select → #sync-button`；焦点成功离开编辑器；第一次 BODY 为浏览器文档边界的一次空档（见观察项），下一次即落到顶栏控件。
- INSERT：`i` 后 `--INSERT--`；Tab：焦点保持 `.cm-content`，光标列 1→2、行首缩进增加；Shift+Tab：列 2→1、缩进减少；Esc+`u` 后行文本恢复 `int xhci_queue_address_device(...)`。
- VISUAL：`v` 后 `--VISUAL--`；Tab → BODY（焦点离开）；`Ctrl+Alt+1` 回编辑器仍为 `--VISUAL--`，Esc 回 `--NORMAL--`。
- `:e` 补全：输入 `:e drivers/usb/host/xhci-r` → Tab：输入框变为 `e drivers/usb/host/xhci-rcar-regs.h`；Esc 取消后文件/光标保持 `xhci-ring.c 4462:2`。
- 证据：`r4-26-e-completion.png`。

### R3-01 [PASS] 侧栏开 K 的 editor-line badge 不落在遮挡层（三种布局）

- 仅侧栏：14 个 editor-line badge，x=264–442（侧栏右边界 252），14/14 `elementFromPoint` 命中 `#editor-host`，与对应行同 y（如 al/4454/(423,197)、an/4455/(264,223)）。
- 双栏：14 个 badge，x=264–442，14/14 在编辑器内且全部 < 解释栏左边界 908；提示 45 目标（14 行）。
- 全收起：21 个 badge，x=19（行号槽），21/21 命中编辑器（gutter 行为保持）；提示 36 目标（21 行）。
- 证据：`r4-07a-sidebar-only-K.png`、`r4-07b-both-panels-K.png`、`r4-07c-no-panels-K.png`。

### R3-02 [PASS] 树焦点 → K 跳代码行后的焦点

- 重放：`Ctrl+Alt+B`（焦点 `#file-tree`）→ 立即 `Ctrl+Alt+K` → 动态取首个 `editor-line` 标签（am/4446）→ 输入标签。
- 焦点采样：100ms、500ms、1600ms 均为 `DIV.cm-content.cm-lineWrapping`，光标 `4446:2`；随后 `j` → `4447:1`（光标确实移动）。
- 编辑器触发路径：等待 5s（超过 4s 重试窗口）后 K → 标签 ap/4448 → 光标 `4448:2`，焦点保持编辑器。
- 树行标签：树焦点下 K → 激活 `▶arch`（ah）→ 树行 51→74，焦点仍 `#file-tree`（未跳走）。
- 证据：`r4-32-tree-jump-focus.png`、`r4-32b-editor-trigger-jump.png`、`r4-32c-tree-row-label.png`。

## 最近修复专项

### 1. R3-01 标签落点（三种布局，badge 坐标 vs 遮挡边界）

| 布局 | 侧栏右边界 | 解释栏左边界 | 目标/代码行 | editor-line badge x | 命中编辑器 | 结论 |
|---|---|---|---|---|---|---|
| 仅侧栏 | 252 | —（收起 1280） | 44 / 14 | 264–442 | 14/14 | 全部在可见代码区，贴行 |
| 双栏 | 252 | 908 | 45 / 14 | 264–442 | 14/14 且全部 <908 | 未被任一遮挡层覆盖 |
| 全收起 | 0（x=-252） | —（x=1280） | 36 / 21 | 19（统一 gutter） | 21/21 | 保持原 gutter 行为 |

- 三种布局均取所有 badge 的 min/max x 与遮挡边界比较；仅侧栏/双栏 min x 均大于侧栏右边界，max x 均小于解释栏左边界。
- 标签与行对应：badge 中心点 `elementFromPoint` 返回的 `.cm-line` 文本与 item.line 对应（仅侧栏/双栏），全收起时命中行号槽（预期）。
- 截图：`r4-07a-sidebar-only-K.png`、`r4-07b-both-panels-K.png`、`r4-07c-no-panels-K.png`。

### 2. R3-02 树焦点跳转后的焦点（动态标签 + 时间采样）

| 采样点 | activeElement | 光标 |
|---|---|---|
| 100ms | `.cm-content.cm-lineWrapping` | 4446:2 |
| 500ms | `.cm-content.cm-lineWrapping` | 4446:2 |
| 1600ms | `.cm-content.cm-lineWrapping` | 4446:2 |
| 之后按 j | `.cm-content.cm-lineWrapping` | 4447:1 |

- 编辑器触发路径（5s 后）：标签 ap/4448 → 焦点保持编辑器、光标 4448:2，无回退。
- 树行标签路径：`▶arch` 激活后 rows 51→74，焦点保持 `#file-tree`。
- 截图：`r4-32-tree-jump-focus.png`、`r4-32b-editor-trigger-jump.png`、`r4-32c-tree-row-label.png`。

### 3. R1-07 侧栏打开时 K 的收集数

| 布局 | 提示 | 代码行数 | 对照历史 42–44 / 12–14 |
|---|---|---|---|
| 仅侧栏 | 44 个目标 | 14 | 在范围内 |
| 双栏 | 45 个目标 | 14 | 总数多 1（解释栏内可见控件），代码行数仍在范围内 |
| 全收起 | 36 个目标 | 21 | 非侧栏布局，符合历史无侧栏值 |

- 本次仅侧栏/双栏的代码行数稳定 14；随滚动位置会变化（历史允许 12–14）。

### 4. R2-03 重载后 0.5s/1s/3.5s 首次 B

| 时机 | 按键时刻 | 首次进树 | 期间短暂回编辑器 | 最终 |
|---|---|---|---|---|
| 0.5s | 505ms | 809ms | 1072ms（1193ms 回树） | `#file-tree` 稳定至 8.5s+ |
| 1s | 1003ms | 1499ms | 1812ms（1945ms 回树） | `#file-tree` 稳定至 9.6s+ |
| 3.5s | 3504ms | 3596ms | 无 | `#file-tree` 稳定至 11s+ |

- 三次均只按一次 B，无“面板已开但一直不聚焦、必须再按一次”的旧问题；短暂回编辑器均在 120ms 左右被观察窗拉回。

## 回归抽查（最近修复未引入新问题）

| 场景 | 实测 |
|---|---|
| 主页面 K（两侧栏收起） | `HINT · 36 个目标（代码 21 行）`；激活 ap（1 行）→ 光标 1:1、焦点编辑器；Esc 退出 |
| 主页面 F | `SNEAK “xh” · 18 处`（截图；随滚动 12–19 处），标签全部在可见代码区 |
| 对话框 K | open-dialog：6 目标（×/本地/远程/路径/浏览/打开），6 个 badge 全在 dialog 矩形内；激活「远程仓库」→ active tab 切到远程，对话框保持 |
| 菜单 K | 历史 5/5、树菜单 3/3，均只覆盖菜单项；Esc 层级正确 |
| 提问框 K | 9 目标全部在提问框内，无背景目标 |
| 解释栏 Esc | 项列表 Esc→阅读容器→编辑器，面板保持（R2-02 同） |
| 提交详情 | Enter 打开浮层（焦点 `#commit-overlay-close`）；j→SUMMARY；Enter→`details.open=true`；Esc→同一 `.commit-header`、`insights-visible` 恢复 |
| 目录浏览器 | 打开聚焦首行、↓ 逐项、Tab 单停靠、Esc 只关子面板（R1-12 同） |
| 工作区快捷键 | `Ctrl+Alt+]` linux→klinux、`Ctrl+Alt+[` 回 linux；`Ctrl+Alt+Shift+2/1` 直达；文件/光标按页签恢复 |
| 页签快捷键 | `Ctrl+Alt+2` → `xterm-helper-textarea`；`Ctrl+Alt+1` → `.cm-content` |
| gd / Ctrl-o | 4462:5 标识符 gd → `xhci.h:1926:5`；Ctrl-o → 回 `xhci-ring.c 4462:5` |
| gr 引用列表 | 列表 8 项，j/k 选中移动；Enter → `xhci.h:1926:5`；焦点回编辑器 |
| `:e` 补全 | `xhci-r` → Tab 补全 `xhci-rcar-regs.h`；Esc 取消不改变文件/光标 |

## 新发现 BUG

**无新增 BUG。**

观察项（不计 BUG，供后续样式打磨）：

1. **NORMAL 下编辑器第一次 Tab 落到 BODY**：再按一次即到 `#branch-select`，Shift+Tab 可返回；属浏览器文档首尾的默认换行，无焦点陷阱（Round 3 已判定，本轮复现一致）。
2. **左缘 badge 有 2–7px 溢出**：树菜单 K badge x=6 vs 菜单 x=13（溢出 7px）；提问框输入框/动画复选框 badge x=10/14 vs 提问框 x=16（溢出 6/2px）。标签仍完整可读、与对应行/项对齐正确，不影响激活与目标范围，属样式一致性问题。
3. **测试工具通道故障**（非应用）：锁屏后 `cuaKeypress`/`press` 无 keydown；已按“测试方式”第 2–3 条切换独立 Playwright Chrome 完成，不计应用 BUG。

## 最终结论

- **20/20 PASS**：R1-01～R1-12 全部 PASS，R2-01～R2-06 全部 PASS，R3-01/R3-02 全部 PASS；无 FAIL、无 PARTIAL。
- **已知 BUG**：无 P0、无 P1、无 P2。Round 3 的两条（R3-01 标签落点、R3-02 树焦点跳转）本轮均独立重放并确认修复；Round 1/2 的 18 条亦逐条重放通过。
- **键盘可达性**：成立。侧栏、解释栏、全部对话框、历史/树菜单、提交详情、提问框、目录浏览器、标签层（K/F）均有完整键盘进入/退出路径；Esc 层级一致（标签层→菜单/对话框/浮层/提问框→面板）；无死路、无焦点陷阱、无“必须鼠标才能继续”的场景。
- **能否判定“键盘导航无已知 BUG”**：**可以（限定在已覆盖范围）**。依据为 20/20 重放通过、最近两项修复专项通过、回归抽查无新问题；两项观察项（BODY 单步、badge 左缘溢出）不影响导航正确性与可达性，不作为 BUG 计数。
- **剩余未覆盖项**：
  1. 3D 动画浮层（无 LLM 动画数据/入口，按约束未提交 LLM）：其 Tab 圈、K/F、播放键、Esc 未测。
  2. 真实 LLM 长解释下的阅读模式滚动键（j/k/Ctrl+d/u/f/b/Space/gg/G/H/M/L/0/$）与解释内链接：当前解释为占位文本，无滚动量与链接。
  3. 历史菜单 Enter 恢复与空历史列表：会改变用户工作区，未执行；空列表未构造。
  4. 工作区页签 × 关闭按钮：仅验证 Tab 可聚焦，未按 Enter 关闭用户仓库页签。
  5. 分支/主题下拉的实际选择切换：按约束未改变用户选择，仅验证 Tab 可达。
  6. 仓库提示条 repo-notice：本轮界面未出现，关闭按钮不可达验证。
  7. 各对话框的保存/提交类按钮（保存设置、添加知识库路径、打开仓库等）：仅验证焦点与 Tab，未执行写操作。
  8. nvim 插件级 K/F 映射与终端内命令语义：属用户本地 nvim 配置，不在应用层判定范围。
  9. `:w`/`:!`/git fetch/LLM 提交：按测试约束未执行。