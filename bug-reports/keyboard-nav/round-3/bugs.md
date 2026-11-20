# Round 3 键盘导航回归测试报告（收敛轮）

- 时间：2026-11-20 17:35 CST
- 应用/地址：Code Reader 1.0.0，http://127.0.0.1:8766/（Node 服务未重启，仅用 `?r=` 重新导航）
- 浏览器/视口：Chromium 1280×720；工作区 linux（active）+ klinux
- 起始状态：`drivers/usb/host/xhci-ring.c`，光标 4462:1，编辑器焦点，NORMAL，两侧栏收起
- 结束状态：`drivers/usb/host/xhci-ring.c` 4462:1，编辑器焦点，NORMAL；两侧栏收起；无对话框/提交浮层/提问框/标签层；右分隔条宽度已恢复测试前值 408（截图 `r3-39-final-state.png`）
- 截图目录：`/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-3/`
- 页面资源：本轮 Tab 新行为（NORMAL 可离开、INSERT 才缩进）实际生效，确认使用 B 重建后的 `public/vendor/cm6/editor.bundle.js`

## 测试方式与环境说明

1. 被测操作全部由键盘完成，未用鼠标点击任何功能。`evaluate` 仅用于只读读取 `activeElement`、DOM 序列、滚动值、元素矩形；未用 `evaluate` 触发功能或修改状态。
2. 未保存任何设置、未提交 LLM、未执行 `:w`/`:!`、未 git fetch、未关闭用户仓库页签、未执行历史菜单 Enter 恢复。
3. `cua.keypress` 本轮仍偶发组合键丢失：一次文件树菜单测试中 `Ctrl+Alt+B` 未生效（active 仍为编辑器、侧栏未开），reload 后同序列一次成功，未计入应用失败。大写 `Shift+N` 使用元素级 `locator('.cm-content').press('Shift+N')`（真实键盘事件），正文注明。
4. INSERT 模式 Tab 测试在内存缓冲区临时增删缩进，已用 `u`×2 撤销并以 `int xhci_queue_address_device(...)` 行文本与 `4462:1` 光标核对恢复，未保存；右分隔条宽度调整后已按原值 408 恢复。
5. 「深层演变」执行的是只读 `git log -L`；FAQ 展开只读；未触发生成、删除、重问等写操作。

## 18 条回归总表

| 编号 | 用例 | 结果 | 证据（DOM 序列 / 截图） |
|---|---|---|---|
| R1-01 | 六个对话框 Tab 正反向闭环无 BODY | **PASS** | open：`#local-path → #browse-button → #open-submit → #dialog-close → #local-tab → #remote-tab → #local-path` 循环，反向 8 步闭环；llm：8 个停靠点（close→provider→model→custom-model→base-url→protocol→api-key→save→close）；docs：7 个停靠点；editor-env：5 个停靠点（radio 组单停靠）；vim-help / nvim-keymap 仅关闭按钮，Tab/Shift+Tab 原地。全程 `document.activeElement !== BODY`；Esc 分别回 `#open-menu`/`#llm-status`/`#docs-settings`/`#editor-env-settings`/`.cm-content`/`#nvim-keys`。截图 r3-01/02/05/06/07/08/09 |
| R1-02 | 提问框 Tab 不逃逸到背景 | **PASS** | 提问框内 Tab×12：input→animation→cancel→submit→preset×5→input 循环；Shift+Tab×6 全部 `closest('#question-editor')` 为真；Esc 关闭后焦点 `.cm-content`。截图 r3-24 |
| R1-03 | Vim 帮助/本地快捷键 j/k/gg/G 滚动 + Esc 焦点 | **PASS** | Vim 帮助：j×5 `.vim-help-body.scrollTop` 0→105，G 保持 105（底部），gg→0，k 在顶部不变，焦点始终 `#vim-help-close`；Tab/Shift+Tab 原地；Esc→`.cm-content`。本地快捷键：j×4 `0→84`，G 84，gg 0；Esc→`#nvim-keys`。截图 r3-08/09 |
| R1-04 | 重载后 0.5s / 1s / 3.5s 首次 Ctrl+Alt+B 一次聚焦文件树 | **PASS**（有启动空窗，见下） | 0.5s：按键 632–679ms，侧栏 715ms 已开，BODY/rows=0 直至 1940ms，**2243ms 焦点进 `#file-tree`（rows=74）**，2520ms 短暂回编辑器，2615ms 起稳定在树至 5.8s。1s：按键 1123ms，BODY 1160–1688ms，1762ms 进树，1945–1964ms 短暂回编辑器，2060ms 起稳定。3.5s：按键 3619ms，3803ms 进树并稳定。三次均**未按第二次 B**。截图 r3-03/04 |
| R1-05 | 树内 B 收起→焦点回编辑器 | **PASS** | 文件树聚焦时 B：`sidebar-visible` 移除、`activeElement=.cm-content`、`.sidebar[inert]`，无 nav-tree 提示按钮停靠 |
| R1-06 | 过滤框 Esc 回树 | **PASS** | `/`→输入 `README`（value=README、rows=93）→一次 Esc：value 空、焦点 `#file-tree`、rows 恢复 74。截图 r3-10/11 |
| R1-07 | 侧栏打开时 K 含代码行 | **PARTIAL** | 目标已收集：`HINT · 44 个目标（代码 14 行）`（另一轮 42/12），输入标签确能跳行（ak→4453）；但 **14/14 个代码行标签绘制在 x=19（侧栏 0–312 内）的树行左缘**，与代码行错位（详见 BUG-R3-01）。截图 r3-12、r3-40 |
| R1-08 | 隐藏解释栏不参与 Tab | **PASS** | 侧栏开、`.insights[inert]`：从 `#file-tree` Shift+Tab 序列 `#tree-filter → #history-menu-button → #open-menu → BODY → .cm-content → #editor-host → #nav-insights`，全程未出现 `#explanation-content` |
| R1-09 | 搜索 N 反向 | **PASS** | `/xhci_queue` Enter：4462:5；n：4471→4478→4487；元素级 `Shift+N`：4478（向文件头），方向正确 |
| R1-10 | 分析栏 `/` Enter 后 n/N | **PASS** | `/` 打开 `.vim-search-input`→输入 `git`→Enter：搜索条移除、焦点 `#explanation-content`；n/N/n 均未再生成搜索框、未把字符写入查询；Esc 回编辑器，面板保持 |
| R1-11 | 深层演变 loading + 完成态焦点 | **PASS** | Enter 后 1.6s：`#history-content`（loading），非 BODY；第 50s 完成，4 条 `.commit-header` 渲染，焦点仍在 `#history-content`，非 BODY。截图 r3-19/20 |
| R1-12 | 目录浏览器打开即聚焦、↑↓、roving、Esc 两层 | **PASS** | 打开即 `BUTTON.dir-row.selected`（`.0qaxsafebait`），134 行，前 4 行 tabIndex `[0,-1,-1,-1]`；↓→`.agents`、↓→`.android`，roving 随动；Tab 直接到 `#open-submit`；Esc1：`#dir-browser.hidden=true`、dialog 仍开、焦点回浏览按钮；Esc2：对话框关闭、焦点 `#open-menu`。截图 r3-21/22 |
| R2-01 | 提问框 K/F 只覆盖提问框 | **PASS** | K：`HINT · 9 个目标`，全部 `#question-editor` 内（5 preset + input + animation + cancel + submit），无 editor-line；F `th`：1 处，唯一匹配为“同时生成 3D 动画解释（three.js）”；背景顶栏/代码行无标签。截图 r3-24/25 |
| R2-02 | 解释栏项列表 Esc 两段 | **PASS** | `#explanation-content` → Shift+Tab×1 深层演变按钮 → ×2/×3 提交行；Esc1→`#explanation-content`；Esc2→`.cm-content`，`insights-visible` 保持；Esc3 无变化。截图 r3-23 |
| R2-03 | 重载窗口首次 B | **PASS** | 与 R1-04 同一组重放：0.5s/1s/3.5s 三时机均一次按键最终聚焦 `#file-tree`，无需第二次 |
| R2-04 | 侧栏遮挡下 F 不打越界标签 | **PASS** | 侧栏打开 F `xh`：12 处（另一次 4 处，随视口），全部标签 x≥355>312；激活 label→行 654:56，该行可见宽度 953px（侧栏右 312）。见解栏内的 F 标签对应面板内 commit subject 的真实文本（outline 覆盖 `SPAN.commit-subject`），属合法匹配而非越界。截图 r3-13/33/34/38 |
| R2-05 | 菜单打开时 K 只覆盖菜单，关闭后恢复 | **PASS** | 历史菜单：`5 个目标`，全部为 5 个菜单项；树菜单：`3 个目标`（复制相对/绝对路径、刷新文件树）；K 的 Esc 只退标签层、菜单保持；菜单 Esc 关闭后焦点回 `#history-menu-button`/`#file-tree`；关闭后 K 恢复 `43 个目标（代码 13 行）`。截图 r3-26/27 |
| R2-06 | 编辑器 Tab 新行为 | **PASS** | NORMAL 两侧栏收起：`cm-content → BODY → #branch-select`（首次 Tab 为 BODY）；Shift+Tab 可 `BODY→cm-content`。见解栏开：`cm-content → #splitter-right → 第一个 .commit-header`，Shift+Tab 反向回编辑器。INSERT：Tab 光标 4462:1→2→3、模式 `--INSERT--`、焦点不离开；Shift+Tab 回 2（缩进减少）。VISUAL：`v` 后 Tab→`#splitter-right`，Ctrl+Alt+1 回编辑器仍 `--VISUAL--`，Esc 退出。`:e drivers/usb/host/xhci-r`+Tab 补全为 `xhci-rcar-regs.h`，Esc 取消后文件/光标不变。截图 r3-14/15/16/17/36 |

## 第二轮修复新行为验证

### 1. 编辑器 Tab 新行为与 BODY 落点判定

| 场景 | 实际 activeElement 序列 |
|---|---|
| NORMAL，两侧栏收起 | `.cm-content` → **BODY** → `#branch-select` → `#sync-button`；从 BODY 按 Shift+Tab 立即回 `.cm-content` |
| NORMAL，解释栏打开 | `.cm-content` → `#splitter-right` → `BUTTON.commit-header`；Shift+Tab 反向 `→ #splitter-right → .cm-content` |
| 右分隔条调整 | 焦点在 `#splitter-right` 时 ArrowLeft ×2：408→432，ArrowRight ×1：432→420；随后已恢复 408 |
| INSERT | `--INSERT--` 下 Tab：焦点保持 `.cm-content`，光标列 1→2→3，行首缩进增加；Shift+Tab 列 3→2，缩进减少 |
| VISUAL | `--VISUAL--` 下 Tab：焦点离开编辑器到 `#splitter-right`；`Ctrl+Alt+1` 回编辑器后仍 `--VISUAL--`；Esc 回 `--NORMAL--` |
| 离开后返回 | Tab 落到 BODY 后 Shift+Tab 可回编辑器；解释栏布局下从 `#splitter-right` Shift+Tab 也回编辑器 |

**BODY 判定**：算一次“有效焦点空档”（按 P2 口径属轻微不一致），但它是浏览器在文档首/尾的默认线性换行：再按一次 Tab 即到 `#branch-select`，Shift+Tab 可立刻回编辑器，无焦点陷阱、无功能丢失；R2-06 修复说明的“风险 1”已登记该边界。**本轮不把它计为 BUG**。若产品要求“任何一次 Tab 都有可见焦点环”，需应用层显式接管页面 Tab 顺序。

**VISUAL 残留判定**：Tab 离开后重新进入编辑器仍保持 VISUAL，符合 Vim“窗口切换不退出可视模式”的语义；未计为 BUG，若产品期望“离开即退出”可作 P2 改进项。

### 2. topRoot 统一后的 K/F 作用域矩阵

| 当前层级 | K 目标数 | F `xh` 结果 |
|---|---|---|
| 主页面，两侧栏收起 | 36（代码 21 行） | 12 处，全部编辑器内 |
| 侧栏打开 + 编辑器焦点 | 42（代码 12 行）/ 44（代码 14 行，视滚动位置） | 4 或 12 处（视滚动位置），标签全部 x≥355>312 |
| 解释栏打开 + 编辑器焦点 | 38（代码 21 行） | 25 处 = 15 个编辑器匹配 + 10 个见解栏文本匹配（commit subject 中的 “xhci”，标签与描边都在面板文本上） |
| 两侧栏均打开 | 44（代码 12 行） | 12 处 = 4 个编辑器 + 8 个见解栏文本 |
| 打开仓库对话框 | 6，全部在 `#open-dialog` 内 | `op` 无匹配、0 标签（背景代码未参与） |
| 提问框 | 9，全部在 `#question-editor` 内 | `th` 1 处，提问框内 |
| 提交详情浮层 | 2（关闭按钮 + Diff 摘要），全部在浮层内 | — |
| 历史菜单 / 文件树菜单 | 5 / 3，全部为菜单项 | — |
| 菜单关闭后 | 43（代码 13 行），恢复整页 | — |

结论：`topRoot()` 与 Tab 模态圈在对话框、提问框、提交详情、菜单上的范围一致；K/F 均未越界到遮罩后元素。侧栏场景唯一异常是 K 代码行标签的**绘制落点**（BUG-R3-01），不是目标范围。

### 3. 文件树聚焦重试

| 时机 | 按键时刻 | 焦点轨迹（100ms 采样） | 结果 |
|---|---|---|---|
| 重载后 0.5s | 632ms | 715–1940ms BODY（rows=0）→ 2243ms `#file-tree`（rows=74）→ 2520ms 编辑器 → 2615ms 起树稳定 | 一次按键最终聚焦，无需重按 |
| 重载后 1s | 1123ms | 1160–1688ms BODY → 1762ms 树 → 1945–1964ms 编辑器 → 2060ms 起树稳定 | 同上 |
| 重载后 3.5s | 3619ms | 3803ms 起 `#file-tree` 稳定至 6.6s | 同上 |
| 关闭解释栏后 | — | 一次 B：`sidebar-visible` + `#file-tree` | PASS |
| 切换工作区后 | — | klinux 下 B：一次聚焦 `#file-tree`；切回 linux 后编辑器焦点恢复 | PASS |

说明：0.5s/1s 场景存在 **0.4–1.5s 的 BODY 空窗**（树行尚未渲染），以及恢复流程约 100–120ms 把焦点设回编辑器后被 700ms 观察窗拉回。没有出现“面板已开且此后一直不在树内、必须再按一次”的旧问题；按“一次按键最终聚焦、4s 重试窗口内”判 PASS。

### 4. F 遮挡过滤

- 侧栏打开：12 处匹配的 12 个标签全部在 x≥355（侧栏右边界 312）；无标签落在树行/过滤框上。激活 label 后目标行 654 的可视宽度 953px，目标可见（`r3-13`、`r3-38`）。
- 解释栏打开：F 会同时匹配见解栏内可见文本（commit subject 的 “xhci”），这些标签的 outline 精确覆盖面板内文本，属“任意窗口内可见文本”的合法匹配，不是把被遮挡代码的标签画在面板上；编辑器匹配 4 处都在编辑器可见区。
- 对话框/提问框内：F 不扫描背景代码（`op`/`th` 分别 0 处与 1 处），无越界。

### 5. Vim 导航 / 搜索回归

- 编辑器 `/xhci_queue` + n/N：4462→4471→4478→4487；Shift+N→4478（反向）。
- `:help`：对话框打开、j/gg/G 滚动正确、Esc 回编辑器。
- `:e` + Tab：补全 `drivers/usb/host/xhci-rcar-regs.h`；Esc 取消后仍 `xhci-ring.c 4462:1`。
- 解释栏 `/` + Enter：退出输入态，n/N 不再写入查询。
- 目录浏览器字母跳转：输入 `d` 选中 `da244-build`（首行 `.0qaxsafebait` → `da244-build`）。
- 提交详情：j→SUMMARY、k→关闭按钮、j+Enter 展开 Diff（`details.open=true`）、Esc 回同一 `.commit-header`。
- 历史菜单：↑/↓ 在 5 项间移动，Esc 关闭并回 `#history-menu-button`。
- FAQ（前两轮受阻项，本轮补测）：K 激活 FAQ 问题→`aria-expanded=true`、body 展开；Tab→`SUMMARY`「展开逐点分析与总结」；Enter→details 展开；Esc1→`#explanation-content`；Esc2→编辑器（`r3-41`）。

### 6. Esc 层级

| 组合 | 第一次 Esc | 第二次 Esc |
|---|---|---|
| K 标签层 + 打开仓库对话框 | 标签层关闭，`dialog[open]=open-dialog`，焦点仍 `#local-path` | 对话框关闭，焦点 `#open-menu`，侧栏保持展开 |
| K 标签层 + 提问框 | 标签层关闭，提问框保持（随后 F 仍在框内生效） | — |
| 提问框（打开时 `hideAll()` 已收起面板） | 提问框关闭，焦点 `.cm-content`；`#app` 无 insights-visible | — |
| K 标签层 + 提交详情 | 标签层关闭，浮层仍开，焦点 `#commit-overlay-close` | 浮层关闭，焦点回到同一 `.commit-header`，`insights-visible` 恢复 |
| K 标签层 + 历史/树菜单 | 标签层关闭，菜单仍开，焦点仍在菜单项 | 菜单关闭，焦点回 `#history-menu-button` / `#file-tree` |
| 菜单 + 侧栏 | 菜单关闭，侧栏保持，焦点回 `#file-tree` | — |
| 侧栏（最底层） | 无独立 Esc 绑定；用 `Ctrl+Alt+B` 收起并回编辑器 | — |
| 3D 动画浮层 | 未能打开（受阻，见下） | — |

说明：提问框打开时 `openQuestion()` 会先 `hideAll()` 收起两侧栏，因此不存在“提问框覆盖解释栏”的同时可见层级；Esc 行为只验证到“关闭提问框回编辑器”。

## 新发现 BUG

### BUG-R3-01 [P1] 文件树侧栏打开时，K 的代码行标签全部绘制在侧栏上，与对应行错位

- 界面/入口：文件树侧栏打开 + 编辑器焦点，`Ctrl+Alt+K`。
- 复现步骤：
  1. 重载并等待加载完成；`Ctrl+Alt+B` 打开文件树，`q` 返回编辑器（侧栏保持）。
  2. 按 `Ctrl+Alt+K`，提示为 `HINT · 44 个目标（代码 14 行） · 输入标签跳转 · Esc 取消`。
  3. 观察代码行标签位置：14 个 `editor-line` 标签全部位于 `x=19`，而侧栏覆盖 0–312；例如 4453 行标签 `ak` 的 badge 坐标为 (19,188)，落在树行 `arc` 的左缘（该树行自身标签为 `al`），每行树出现两个标签。
  4. 输入 `ak` 仍能跳到 4453:1，说明目标与按键有效，但标签无法与代码行视觉对应。
- 期望：代码行标签位于可见代码区（x≥312）并贴近对应行，不与树行标签混淆（README：给所有可操作元素与代码行打字母标签）。
- 实际：标签以编辑器 gutter 为锚点（x≈19），而 gutter 被侧栏覆盖层盖住，标签浮在侧栏树行左缘；视觉上像树行标签，代码行一侧看不到任何标签。
- 证据：
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-3/r3-40-K-sidebar-line-label-pos.png`（44 目标/14 行，14/14 badge x=19）
  - `/home/js/work/tools/code-reader/bug-reports/keyboard-nav/round-3/r3-12-K-sidebar-code-lines.png`（42 目标/12 行，同现象）
  - DOM：items 中 kind=editor-line 的 14 项，badge x 全为 19；sidebar.right=312；sample：ak/4453/(19,188)、am/4454/(19,214)、ao/4455/(19,240)
- 频率：必现，3/3 侧栏打开轮次。
- 源码定位（只读）：`public/keyboard-nav.js` 的 `badgeCandidates()` 对 `editor-line` 固定用 `gutterRight` 放置标签；R1-07 修复只改了代码行的收集与可见性判定（5 点探测），未处理“gutter 被侧栏覆盖”时的标签落点，导致标签锚点落在覆盖层下方。

### BUG-R3-02 [P2] 从文件树焦点用 K 跳代码行后，焦点仍留在文件树

- 界面/入口：文件树焦点 + `Ctrl+Alt+K` + 代码行标签。
- 复现步骤：
  1. `Ctrl+Alt+B` 打开文件树（焦点 `#file-tree`）。
  2. `Ctrl+Alt+K`，读取任一 `editor-line` 标签（如 `al` 对应 4453 行），输入该标签。
  3. 光标从 4462:1 移到 4453:1，但 `document.activeElement` 仍为 `#file-tree`；随后 j/k/Enter 作用在文件树而不是代码。
- 期望：代码行跳转后焦点进入编辑器（与 K 激活其它目标、以及从编辑器焦点触发同一跳转时一致），可立即继续 Vim 编辑。
- 实际：焦点不跟进；从编辑器焦点触发同一操作时焦点保持编辑器，说明是“触发焦点在树”时的路径差异。
- 证据：DOM `activeElement=NAV#file-tree`、`#cursor-pos=4453:1`；2/2（硬编码 `ak` 与动态取首个 `editor-line` 标签 `al` 两次复现）。
- 频率：必现，2/2（从树焦点触发）。
- 级别说明：可按 `q` 回编辑器绕过，故 P2。

## 通过项（证明覆盖）

| 编号 | 界面/场景 | 操作 | 结果 |
|---|---|---|---|
| P3-01 | 全局 B/I | 打开/收起侧栏与解释栏 | B 开：`sidebar-visible`+`#file-tree`；B 收：`.cm-content`、sidebar inert；I 开：`insights-visible`+`#explanation-content`；I 收：编辑器焦点 |
| P3-02 | 工作区切换 | Ctrl+Alt+Shift+2/1、Ctrl+Alt+Shift+1 | klinux↔linux 切换正常，切回后 xhci-ring.c 与光标恢复 |
| P3-03 | nvim 页签 K/F | Ctrl+Alt+2 → K/F → Ctrl+Alt+1 | K 20 个目标（全部 nvim 工具条/顶栏），激活 `t` 打开本地快捷键；F `xh` 20 处/20 标签（终端文本）；回到编辑器后光标/滚动不变（4462/115758） |
| P3-04 | gd / Ctrl-o | 2726:7 标识符上 gd | 跳到定义 610:29，Ctrl-o 回 2726:7；截图 r3-31 |
| P3-05 | gr 引用列表 | gr → j×2/k → Enter | 8 个引用；active 行 1→2→3→2；Enter 跳到 660:7，列表关闭、焦点编辑器；截图 r3-32 |
| P3-06 | 右分隔条 | 解释栏开，编辑器 Tab→splitter→←/→→Tab | 正向 Tab 可达；宽度 408→432→420（已恢复 408）；再 Tab 到首个 `.commit-header`；Shift+Tab 回编辑器；截图 r3-36 |
| P3-07 | 工作区页签 × | 顶栏 Tab×13 | Tab6/Tab8 可聚焦两个 `.workspace-tab-close`，未激活；序列见 `r3-35` |
| P3-08 | K 代码行（无侧栏） | K → label `ap` | 光标 651:2，焦点编辑器；截图 r3-37 |
| P3-09 | K 代码行（侧栏打开、编辑器焦点） | K → label `al` | 光标 4453:1，焦点保持编辑器（标签位置问题见 R3-01） |
| P3-10 | 侧栏 F 跳转 | F `xh` → label | 光标 654:56，目标行可见宽度 953px；截图 r3-38 |
| P3-11 | 目录字母跳转 | 打开目录浏览器 → `d` | 选中 `da244-build` |
| P3-12 | 历史菜单方向键 | Enter 打开 → ↓↓↑ → Esc | linux→klinux→code-reader→klinux；Esc 关闭回历史按钮；未执行 Enter 恢复 |
| P3-13 | 提交详情 | K/j/k/Enter/Esc | K 2 目标全在浮层；j/k 移动；Enter 展开 Diff；Esc 回同一提交行并恢复 insights；截图 r3-29/30 |
| P3-14 | FAQ（前轮受阻补测） | K 激活 FAQ → Tab → Enter → Esc×2 | 展开 body、details.open=true、Esc 分段回解释内容/编辑器；截图 r3-41 |
| P3-15 | 顶栏 Tab 顺序 | Tab×13 | BODY→branch-select→sync→theme→workspace linux→×→klinux→×→＋→编辑器页签→nvim 页签→阅读路径→nav-tree |
| P3-16 | K/F 作用域 | 对话框/提问框/提交详情/菜单 | 见“第二轮修复新行为验证-2”，均不越界 |
| P3-17 | 最终状态 | — | xhci-ring.c 4462:1，NORMAL，编辑器焦点，两侧栏收起，无浮层；splitter 408；截图 r3-39 |

## 受阻/未覆盖

1. **3D 动画浮层**：`.data/animations/c5fad411c12823c2.json` 与 FAQ 数据存在，但 UI 无入口。FAQ 在 2704 行可展开（5 条，含“用 3D 动画解释 handle_tx_event”），FAQ 展开后 `animation-open` 按钮数为 0；只有实时 LLM 解释的 `explanation.animation` 才渲染「查看 3D 动画演示」按钮，而本轮按约束不提交 LLM。因此 3D 浮层的 Tab 圈、K/F、播放键、Esc 均未测。
2. **解释栏阅读模式滚动键与解释内链接**：解释内容仍是占位文本（`#explanation-content` 无滚动量），j/k/Ctrl+d/u/f/b/Space/gg/G/H/M/L/0/$ 的阅读模式方向无法判定；代码事实/本地文档/「建议继续阅读」等链接也因无真实 LLM 解释而不存在，未测（与 Round 2 同）。
3. **历史菜单 Enter 恢复与空状态**：Enter 会改变用户工作区/当前文件，未执行；仅测 ↑/↓/Esc。未清空用户历史，空列表状态未测。
4. **工作区页签 ×**：只验证 Tab 可聚焦，未按 Enter 关闭用户仓库页签。
5. **FAQ 删除/按当前代码重问**：属于写操作，未触发。
6. **仓库提示条 repo-notice**：本轮界面仍未出现提示条，关闭按钮不可达验证。
7. **分支/主题下拉实际切换**：按约束未改变用户选择，仅验证 Tab 可达。
8. **nvim 插件级 K/F 映射**：应用级 K/F 已在 nvim 页签验证；用户本地插件内部映射不在应用层判定范围。

## 结论

- **18 条回归：PASS 17 / PARTIAL 1 / FAIL 0**（PARTIAL=R1-07：代码行目标已收集且可跳转，但标签全部错位到侧栏上）。
- **新发现 2 条：P1×1（BUG-R3-01）+ P2×1（BUG-R3-02）**；无 P0、无焦点陷阱、无“无法到达/无法退出”的死路。
- **“仅靠键盘可完成所有导航操作”**：成立——侧栏/解释栏/对话框/菜单/提交详情/提问框/目录浏览器/FAQ 均有可达键盘路径和 Esc 或快捷键出口；编辑器的 Tab 空档有 B/I/K/F 等直达键兜底。
- **“键盘导航无已知 BUG”**：不成立。R1-07 的修复不完整（P1 标签错位），另有 P2 焦点不跟进。建议 B 侧修复：
  - R3-01：`badgeCandidates()` 的 `editor-line` 分支在 gutter 被侧栏覆盖时改用可见代码区左边界（x≥sidebar 右缘）或行文本起点放置标签；
  - R3-02：`activateHint()` 的 `editor-line` 分支在 `jumpToLine()` 后把焦点交给编辑器。
- Tab 落到 BODY 的一次空档已判定为浏览器文档边界默认换行（P2 边缘但可接受，不列 BUG）；VISUAL 模式残留判定为 Vim 语义，不列 BUG。