# Round 3 修复记录

- 时间：2026-11-20 18:40 CST
- 修改文件：
  - `public/keyboard-nav.js`（K 代码行标签可见锚点、激活代码行后取消文件树补焦点）
  - `public/app.js`（新增 `cancelTreeFocusRequest()` 并注入导航层）
- 验证环境：Code Reader 1.0.0，http://127.0.0.1:8766/（Node 服务未重启，仅用 `?r=` 重新导航）；Chromium 1280×720；工作区 linux，`drivers/usb/host/xhci-ring.c`
- 命令结果：`npm run check` exit 0。未改 `web-src`，无需 build；public 改动 reload 生效。
- 自动化通道说明：本轮复用了 Round 2/3 报告提到的通道故障——多次导航后页面 `document.hasFocus()===true` 但 `key`/`cua` 均收不到 keydown。所有结论只采信“按键真实触发、DOM 实际变化”的轮次；故障期间停止按键类验证（详见“剩余风险”）。

## 逐条处置

### BUG-R3-01 [fixed] 侧栏打开时 K 的代码行标签全部绘制在侧栏上（R1-07 PARTIAL）

- 根因：`badgeCandidates()` 的 `editor-line` 分支固定用行号槽右缘 `gutterRight - width - 3` 作锚点。侧栏（0–312）盖住 gutter 时，标签仍画在 x≈19，落在树行左缘；R1-07 只修正了收集/可见性判定，没有处理锚点被覆盖层遮挡的情况。
- 修改：
  - `public/keyboard-nav.js:481-505` 抽出 `probeXs()`（沿用原 5 点：左+12 / 25% / 50% / 75% / 右-6）、`editorVisibleAt()`、`visibleAnchorX()`（返回行内第一个真正露在 `#editor-host` 上的探测点）；`visibleInEditor()` 改为 `visibleAnchorX() !== null`，行为不变。
  - `public/keyboard-nav.js:358-371` `editor-line` 分支：先用 `editorVisibleAt(gutterLeft + width/2, 行中线)` 判断行号槽是否真的可见；槽位可见（两侧栏收起/仅解释栏）保持原 gutter 锚点，槽位被覆盖时改用 `visibleAnchorX(rect) + 3`，标签贴同一行且落在可见代码区。
- 自验（侧栏打开，`sidebar.right=312`，编辑器焦点 → Ctrl+Alt+K）：
  - `HINT · 41 个目标（代码 11 行）`；11 个 editor-line badge 的 x = 326–437（全部 ≥312），逐个 `elementFromPoint(badge 中心)` 的 `closest('#editor-host')` 均为真；截图 `fix-r3-01-sidebar-labels.png`。
  - 两侧栏均打开（`insights.left=872`）：43 个目标（代码 11 行），badge x = 326–437，全部 <872 且在编辑器内；截图 `fix-r3-01-both-panels.png`。
  - 两侧栏均收起：36 个目标（代码 21 行），21 个 badge 全部 x=19、命中 `cm-gutterElement`（仍在行号槽，未改变原行为）；截图 `fix-r3-01-no-sidebars.png`。
  - 输入标签 `bk`（4462 行）→ 光标 `4462:1`、`activeElement=.cm-content`、标签层关闭；标签可正常跳转。
- 结论：R1-07 的 PARTIAL 收尾完成，功能与视觉落点均满足“侧栏打开时标签在可见代码区、贴近对应行”。

### BUG-R3-02 [fixed] 从文件树焦点用 K 跳代码行后焦点仍留在文件树

- 根因：不是 `jumpToLine()` 缺聚焦（`web-src/editor.js:946`/打包产物中已调用 `view.focus()`，实测按下标签后 80ms 焦点确实进入 `.cm-content`）。真正原因是 `app.js` 的 `requestTreeFocus()` 4s 重试窗口：为兼容重载恢复流程，它把“焦点回到 `#editor-host`”当作恢复时序，在随后 120ms 的下一次 attempt 里把焦点重新交给文件树（实测 t80 焦点在编辑器，t330 被拉回 `#file-tree`）。
- 修改：
  - `public/app.js:3063-3065` 新增 `cancelTreeFocusRequest()`（`treeFocusRequest += 1`，令在跑的重试 token 失效）；`public/app.js:4053` 注入导航层。
  - `public/keyboard-nav.js:583-595` `activateHint()` 的 `editor-line` 分支：记录触发时是否已在编辑器内，先 `cancelTreeFocus?.()` 再关闭标签层并 `jumpToLine()`；仅当触发源不在编辑器且跳转后焦点仍不在编辑器时才补 `editor.focus()`（从编辑器触发的路径不改变现有行为）。
- 自验（从文件树焦点触发，且刻意在 B 的 4s 重试窗口内完成跳转）：
  - Ctrl+Alt+B（`active=#file-tree`、sidebar-visible）→ 140ms 后 Ctrl+Alt+K → `HINT · 41 个目标`，输入 `an`（4446 行）。
  - t90：`active=.cm-content`、光标 `4446:2`；t440 / t1640：焦点仍在 `.cm-content`（修复前同场景 t330 已回 `#file-tree`）。
  - 随后 `j`：光标 `4446:2 → 4447:1`，证明焦点在编辑器；截图 `fix-r3-02-tree-jump-focus.png`。
  - 从编辑器焦点触发（侧栏打开、等待 5s 后）输入 `bk`：光标 `4462:1`、焦点保持编辑器，无回归。
- 结论：fixed。

## 回归验证

| 用例 | 结果 | 证据 |
|---|---|---|
| 侧栏打开 K 收集数/跳转 | 通过 | 41 目标（代码 11 行）；badge x 326–437 ≥ 312，全部 `insideEditor=true`；`bk` → 4462:1，焦点 `.cm-content`；`fix-r3-01-sidebar-labels.png` |
| 两侧栏同时打开 K | 通过 | 43 目标（代码 11 行）；badge 326–437，全部 < insights.left 872 且命中编辑器；`fix-r3-01-both-panels.png` |
| 两侧栏收起 K | 通过 | 36 目标（代码 21 行）；21 个 badge x=19，命中 `cm-gutterElement`，行号槽行为未变；`fix-r3-01-no-sidebars.png` |
| 树内 K 激活树行标签保持树焦点 | 通过 | `ah`（▼arch）激活：rows 89→51、`active=#file-tree`、`inSidebar=true`；再 K `ah`（▶arch）：rows 51→89、`active=#file-tree`（目录折叠状态已还原） |
| 文件树菜单 K 作用域 | 通过 | Shift+F10 → 菜单开 → K：`3 个目标`（复制相对路径/复制绝对路径/刷新文件树）；Esc×2：菜单 `hidden=true`、焦点回 `#file-tree` |
| 打开仓库对话框 K 作用域 | 通过 | K 激活 `ab`（打开）→ `dialog=open-dialog`、焦点 `#local-path`；对话框内 K：6 目标（×、本地仓库、远程仓库、输入框、浏览…、打开），6 个 badge 全部在 dialog 矩形内 |
| 对话框 Tab 焦点圈 | 通过 | 连续 Tab×9：`local-path→browse-button→open-submit→dialog-close→local-tab→remote-tab→local-path→…` 循环，全程 `insideDialog=true`、无 BODY；Esc 后 `active=#open-menu` |
| 提问框 K 作用域 | 通过 | `\c` → `active=#question-input`；K：9 目标（5 preset + input + animation + cancel + submit，文本为 函数目的/数据流/设计原因/规范依据/3D 动画/取消/确定 等），全部属于 `#question-editor`；Esc×2 → 提问框关闭、焦点 `.cm-content` |
| 侧栏打开 F 遮挡过滤 | 通过 | `Ctrl+Alt+F` + `xh`：10 处；10 个 badge x=355–654（全部 ≥312），逐个命中 `#editor-host`；`fix-r3-regress-f-sidebar.png` |
| 侧栏开/关与 B 聚焦 | 通过 | 多次 Ctrl+Alt+B：`sidebar-visible` + `active=#file-tree`；焦点在树内再按 B：侧栏收起、焦点 `.cm-content`；无侧栏 K 仍为 36 目标 |
| 重载后首次 B 聚焦重试 | 未重放 | 键盘通道在本轮后段失效，无法重放“重载后 0.5s/1s 按 B”时序；`requestTreeFocus()` 的重试逻辑未改动（仅新增独立 `cancelTreeFocusRequest()`），且本轮所有 B 聚焦均一次成功 |
| 最终状态 | 已恢复 | `xhci-ring.c 4462:1`、`--NORMAL--`、`.cm-content` 焦点、两侧栏收起、无对话框/提问框/标签层；`fix-r3-90-final-state.png` |

## 剩余风险

1. **自动化通道失效**：后段出现 `document.hasFocus()===true` 但 `cua.keypress`/`locator.press` 均无 keydown 的窗口（与 Round 2/3 报告同型），导致“重载后首次 B”时序未重放。该路径代码未改动，风险低；建议最终回归在新会话重放该用例。
2. **最终光标恢复方式**：键盘通道失效后无法用 `4462G`，最终用编辑器实例 dispatch 一次性恢复测试前光标（清理动作，不属于被测路径）；其余状态均由键盘操作恢复。
3. **窄可见条带**：标签锚点取“行内第一个可见探测点 + 3px”。本次实测可见代码区宽 560–1000px，标签均完整落在编辑器内；若两侧栏把编辑器压到比标签宽还窄的极端布局，标签仍可能压到覆盖层，未构造该场景。
4. **行标签横向位置随行宽变化**：被覆盖时标签落在该行第一个可见探测点附近（本次 x=326–437），不是统一贴侧栏右缘；与对应行同 y，满足“可见且不混淆”，但与无侧栏时统一在 gutter 的观感略有差异。