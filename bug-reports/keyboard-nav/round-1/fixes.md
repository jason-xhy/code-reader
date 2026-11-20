# Round 1 修复记录

- 时间：2026-11-20 15:45 CST
- 修改文件：
  - `public/keyboard-nav.js`（模态焦点圈；侧栏打开时代码行标签的可见性探测）
  - `public/vim-nav.js`（单目标窗口的滚动模式；搜索回车退出输入态）
  - `public/app.js`（隐藏面板 inert；文件树聚焦时序与收起焦点；过滤框 Esc；深层演变焦点保持；目录浏览器 roving tabindex/打开聚焦/Esc；Vim 帮助关闭焦点；提交详情焦点回退）
- 验证环境：Code Reader 1.0.0，http://127.0.0.1:8766/（Node PID 2575520，未重启，仅浏览器 reload）；Chromium 1280×720；`npm run check` 通过（exit 0，未改 `web-src/*`，无需 build:vendor）。
- 说明：自动化环境 `cua.keypress` 对 Shift/Control 组合仍偶发丢失，本记录中的结论只采信“DOM 状态确实变化”的轮次；多次重试后仍无法注入的操作会在“未修复/风险”中标注。

## 逐条处置

### BUG-R1-01 [fixed] 多个模态对话框 Tab 焦点逃逸到 BODY，模态焦点圈不闭环
- 根因：原生 `<dialog>` 的浏览器默认 tab 行为在越过最后一个可聚焦元素时把 activeElement 交给 `BODY`，再下一次才回到对话框首个元素；页面此前只在 commit overlay 内做了局部 Tab 循环，原生 dialog 与提问框没有统一处理。
- 修改：`public/keyboard-nav.js:104` 新增 `modalRoot()`（dialog[open] > 3D 动画 > 提交详情 > 提问框），`public/keyboard-nav.js:116` `focusableWithin()`，`public/keyboard-nav.js:127` `trapModalTab()`；`public/keyboard-nav.js:780` `handleKeydown` 在非标签/定位模式下先调用该陷阱。边界处 preventDefault 并循环到首/末元素；焦点已落到 BODY 时直接送回最近边界。
- 自验（打开仓库对话框）：
  - `Ctrl+Alt+B` → `Shift+Tab`×3 → `Enter` 打开；从 `#local-path` 连按 Tab：`#browse-button` → `#open-submit` → **`#dialog-close`（没有 BODY）** → `#local-tab` → `#remote-tab` → `#local-path`。
  - 在 `#dialog-close`（首个）按 `Shift+Tab` → `#open-submit`（末个），反向闭环成立。
  - Vim 帮助只有 `#vim-help-close` 一个可聚焦项：Tab/Shift+Tab 均停在关闭按钮，不再出现 BODY。
  - 截图：`fix-01-dialog-tab-wrap.png`（对话框焦点环）；序列 DOM 证据见上。

### BUG-R1-02 [fixed] 提问框 Tab 焦点逃逸到背景分析栏，并在背景元素上触发操作
- 根因：`question-editor` 是自绘浮层，没有焦点圈；Tab 从「确定」继续走到背景 `#history-content` 的 `.commit-header`，背景仍可被激活。
- 修改：同上 `modalRoot()` 把可见的 `#question-editor` 作为顶层模态，`trapModalTab()` 在预设按钮/文本框/复选框/取消/确定之间循环。
- 自验：`Ctrl+Alt+I` 打开分析栏 → 编辑器 `\c` 打开发问框；`question-editor.hidden === false` 时连按 Tab：`#question-input` → `#question-animation` → `#question-cancel` → `#question-submit` → `.preset-chip` → 下一个 `.preset-chip`，全程 `activeElement.closest('#question-editor')` 为真，未出现 `.commit-header`/`#explanation-content`；`Esc` 关闭后焦点回 `.cm-content`。
  - 截图：`fix-02-question-tab.png`（焦点在预设问题按钮，背景无焦点）。

### BUG-R1-03 [fixed] Vim 快捷键/本地快捷键对话框初始 j/k/gg/G 不滚动；Vim 帮助关闭后焦点回到 BODY
- 根因（两个独立原因）：
  1. `vim-nav.js` 用 `index >= 0` 判定列表模式。Vim 帮助/本地快捷键对话框只有「关闭」一个可聚焦项，焦点在关闭按钮时被当成列表模式，`j` 只是把焦点 clamp 在唯一按钮上，不滚动 `.vim-help-body` / `.nvim-keymap-body`。
  2. `:help` 由 Vim ex 命令行打开，关闭时要恢复的 ex 输入框已被移除，原生 dialog 的焦点恢复落到 BODY；此前没有 close 兜底。
- 修改：
  - `public/vim-nav.js:366`：`listMode = index >= 0 && (items.length > 1 || !scroller)`；只有一个目标且有可滚动容器时按阅读模式滚动。
  - `public/app.js:3729`：`vim-help-dialog` 的 `close` 事件把焦点送回编辑器，并在 `setTimeout(0)` 再补一次（原生 dialog 关闭后的焦点恢复可能晚于 close 事件）。
- 自验：
  - Vim 帮助：打开后焦点 `#vim-help-close`，`j`×5 → `.vim-help-body.scrollTop` 0→105；`G` → 105（内容最大滚动量）；`gg` → 0；焦点始终在关闭按钮。截图 `fix-03-vim-help.png`（已滚到中部）。
  - `Esc` 关闭后 `document.activeElement` 为编辑器区 `DIV`（`.cm-content`），不再是已关闭对话框按钮/BODY。
  - 本地快捷键：`Ctrl+Alt+2` → `#nvim-keys` Enter 打开，焦点 `#nvim-keymap-close`；`j`×4 → `.nvim-keymap-body.scrollTop` 0→84；`Esc` 关闭后焦点回 `#nvim-keys`；`Ctrl+Alt+1` 回编辑器。截图 `fix-03-nvim-keymap.png`（内容已滚动）。

### BUG-R1-04 [fixed] Ctrl+Alt+B 打开文件树偶现不聚焦，第一次按键只打开面板
- 根因：`toggleCodeTreePanel()` 打开面板后只做一次 80ms 的 `setTimeout(focusTree)`。页面刷新恢复工作区时 `state.tree` 尚未就绪（`renderTree` 还没有行），`focusTree()` 直接返回 false；面板 class 已变化但焦点仍留在编辑器，第二次按键才成功。
- 修改：`public/app.js:3036` 打开分支改为 `requestTreeFocus()`；`public/app.js:3057` 新增重试：立即尝试，失败后每 120ms 重试，最多 4s；遇到顶层弹层、面板已收起、焦点已被用户移到别处（非原焦点且非 body）即放弃；面板收起时 `treeFocusRequest += 1` 取消挂起重试。
- 自验：页面加载完成后从编辑器第一次按 `Ctrl+Alt+B`：120ms 时 `#app` 已含 `sidebar-visible` 且 `activeElement.id === "file-tree"`，450ms 复核仍在文件树；j×3 后 `.tree-row.key-focus` 从 `arch` 移到 `crypto`。
- 说明：页面刷新后数据异步恢复的窗口未能用自动化精确命中（按键注入在重载后不稳定），但重试路径即为该场景兜底，逻辑上覆盖“树未就绪”的失败原因。

### BUG-R1-05 [fixed] 从文件树内再按 Ctrl+Alt+B 收起后，焦点落在“打开代码树”提示按钮
- 根因：`toggleCodeTreePanel()` 收起分支显式 `elements.navTree.focus(...)`，把焦点交给提示按钮而不是编辑器。
- 修改：`public/app.js:3040` 收起分支改为 `editor.focus()`（无编辑器时才退回提示按钮），并取消正在进行的树聚焦重试。
- 自验：文件树聚焦时按 `Ctrl+Alt+B`：`sidebar-visible` 移除，`activeElement.className === "cm-content cm-lineWrapping"`，`activeElement.id` 为空；侧栏 `inert` 已置位。截图对照原 a22/a21。

### BUG-R1-06 [fixed] 文件树过滤框按 Esc 只清空内容，不退出过滤/不返回文件树
- 根因：`#tree-filter` 的 keydown 只处理 ArrowUp/ArrowDown/Enter，Esc 落到浏览器默认行为（清空 search 输入），焦点留在输入框。
- 修改：`public/app.js:3792` 在过滤框 keydown 增加 Esc：取消 pending 过滤定时器、清空值、重置 `filterIndex`、`renderTree()`，然后 `focusTree()`（无仓库时直接聚焦 `#file-tree`）。
- 自验：文件树聚焦 → `/` 跳过滤框 → 输入 `README`（value=README）→ 一次 `Esc`：`#tree-filter.value === ""`、`activeElement.id === "file-tree"`、行数恢复 51；不需要第二次 Esc/Tab。

### BUG-R1-07 [fixed] 文件树侧栏打开时 Ctrl+Alt+K 遗漏全部代码行标签
- 根因：`collectEditorLines()` 只用行首 `rect.left + 12` 一个点做 `elementFromPoint` 命中判定。侧栏是覆盖层（z-index 30），行首点落在侧栏上，代码行被整体误判为“被盖住”而丢弃。
- 修改：`public/keyboard-nav.js:444` 沿行宽取 5 个探测点（行首 +12、25%、50%、75%、行尾 -6），只要任意一点的最上层元素属于 `#editor-host` 就保留该行；整行确实被弹层完全覆盖时仍排除。
- 自验：侧栏打开（`sidebar-visible`）、编辑器聚焦，`Ctrl+Alt+K`：状态为 `HINT · 43 个目标（代码 13 行）`，`__crKeyboardNavState.items` 中 `kind === "editor-line"` 13 项；截图 `fix-07-k-sidebar-code-lines.png`。此前为 30 个目标、0 行。

### BUG-R1-08 [fixed] 隐藏的解释栏内容仍参与 Tab 顺序，焦点落到屏幕外
- 根因：两侧栏收起只是 `transform: translateX(±100%)` 移出视口，DOM 中仍可聚焦；`#explanation-content` 有 `tabindex="0"`，所以 Shift+Tab 能停到不可见元素。
- 修改：`public/app.js:338` 在 `initAutoPanels` 增加 `syncInert()`：面板可见时移除 `inert`，收起/隐藏/初始化时设置 `inert`；在 `reveal`/`conceal`/`toggle`/`hidePanel`/初始循环中同步。面板打开路径仍先移除 inert 再聚焦，不影响 B/I/`\e` 的聚焦。
- 自验：侧栏打开、解释栏关闭（`.insights[inert]`），从 `#file-tree` 连续 Shift+Tab：`#tree-filter` → `#history-menu-button` → `#open-menu` → BODY（文档末尾的正常浏览器换行）→ `.cm-content`；**未再出现 `#explanation-content`**。侧栏收起时 `.sidebar[inert]` 同样把树内元素移出 Tab 顺序。

### BUG-R1-09 [not-a-bug] 编辑器 Vim 搜索 N 与 n 同向
- 结论：应用侧没有缺陷；报告现象由 `cua.keypress` 丢失 Shift 导致。
- 证据：
  - 上游映射正确：`node_modules/@replit/codemirror-vim-core/vim.js:180` `{ keys: 'N', type:'motion', motion:'findNext', motionArgs:{ forward:false } }`，`n` 为 `forward:true`。
  - 元素级真实键盘复测：同一 `/xhci_queue` 搜索后，连续 4 次 `locator.press('Shift+N')`：4488 → 4479 → 4472 → 4462 → 4454（持续向文件头移动）；随后 `n`：4454 → 4462 → 4472（向文件尾移动）。方向完全符合 Vim 语义。
  - 用 `cua.keypress({keys:['N']})` 复现时 N 确实与 n 同向，说明注入路径把大写键降级为小写；报告测试方式说明第 2 条已记录同类 Shift/Control 丢失。
- 处置：不改代码。下一轮测试请使用元素级 `locator.press('Shift+N')` 或确认注入层保留 Shift。

### BUG-R1-10 [fixed] 分析栏 `/` 搜索回车后 n/N 被当作查询字符
- 根因：`vim-nav.js` 搜索框 Enter 处理在“无匹配”时直接 `return`，没有移除搜索条/退出输入态；n/N 继续写入 input，全局 Vim 处理器又忽略 `.vim-search` 内的按键。
- 修改：`public/vim-nav.js:312` Enter 一律 `update()` → `removeSearchBar()` → `restoreFocusSoon(previous, root)`。有命中时保留 ranges/高亮供 n/N 跳转；无命中时也只退出输入态，不吞导航键。
- 自验：分析栏 `/` 输入 `正在`（counter=无匹配）→ `Enter`：`.vim-search` 从 DOM 移除，`activeElement.id === "explanation-content"`，再按 `n` 后页面不存在 `.vim-search-input`，不会出现“正在n/正在nN”。

### BUG-R1-11 [fixed] 「深层演变」按钮激活后焦点掉到 BODY，面板键盘操作中断
- 根因：`fetchFunctionHistoryDeep()` 同步把历史区切成 loading 并 `renderHistory()` 重建列表，原按钮节点被移除，焦点落 BODY；完成/失败再次 render 时同样会丢。
- 修改：`public/app.js:2554` 新增 `focusHistoryPanel()`（有历史操作按钮时聚焦按钮，否则让 `#history-content` 临时 `tabindex=-1` 并聚焦容器）；`public/app.js:2561` 在开始、成功、失败三次 render 后调用；并用 `keepFocus` + “焦点仍在历史区或 body”守卫，避免异步返回时抢回用户已移走的焦点。
- 自验：分析栏聚焦 `#explanation-content` → `Shift+Tab` 到「深层演变（git log -L，较慢）」→ `Enter`，1.6s 后：`activeElement.id === "history-content"`、class 为 `insight-content empty-insight loading`，不是 BODY；截图 `fix-11-deep-loading.png`（面板显示“正在执行 git log -L…”）。完成后渲染会走同一 `restoreFocus()` 分支聚焦「深层演变模式」文本/按钮；本次 `git log -L` 在 14s 内未返回，未观测到完成态焦点，列为下一轮观察点。

### BUG-R1-12 [fixed] 目录浏览器打开后焦点不进入列表，↑/↓ 失效，列表行形成超长 Tab 链
- 根因：
  1. `loadDirectory()` 渲染后只更新 DOM，不聚焦；焦点留在「浏览…」按钮，`dirList` 的 ArrowDown 处理器收不到事件。
  2. `renderDirList()` 的每个 `.dir-row` 都是原生 button（默认 tabindex=0），134 行形成 134 个 Tab 停靠点。
  3. 行焦点与 `state.dirSelected` 不同步；从某行按 ↓ 时 `dirSelected` 仍是 -1，重置到第一项。
  4. Esc 落在原生 dialog 上，直接关闭整个「打开仓库」对话框。
- 修改：
  - `public/app.js:977` `selectDirIndex()` 增加 roving tabindex：只有当前项 `tabIndex=0`，其余 `-1`。
  - `public/app.js:1031` `renderDirList()` 初始所有行 `tabIndex=-1`。
  - `public/app.js:1061` `loadDirectory()` 渲染后：有子目录则 `selectDirIndex(0)` 聚焦首行，无子目录则聚焦 `#dir-list` 容器；`enterDirIndex()` 不再用容器覆盖行焦点。
  - `public/app.js:4007` `open-dialog` 的 `cancel` 事件：目录浏览器展开时 Esc 只隐藏子面板并把焦点还给「浏览…」，不关闭整个对话框。
- 自验：
  - 打开后立即 `activeElement.className === "dir-row selected"`、文本 `.0qaxsafebait`、134 行中 `tabIndex` 前 4 项为 `[0,-1,-1,-1]`。
  - `ArrowDown` 两次：`.0qaxsafebait` → `.agents` → `.android`（逐项前进，不重置）；roving tabindex 随选中项 `[ -1, -1, 0, -1 ]`。
  - 在首行按 `Tab`：直接跳到 `#open-submit`，不经过其余 133 行（单 Tab 停靠点成立）。
  - 按 `Esc`：`#dir-browser.hidden === true`、`open-dialog` 仍 open、焦点 `#browse-button`；再按 Esc 才关闭整个对话框。
  - 截图：`fix-12-dir-browser.png`（首行选中、列表获得焦点）。

## 回归验证

| 用例 | 结果 | 证据 |
|---|---|---|
| 全局 Ctrl+Alt+B 打开/收起 | 通过 | 打开：`sidebar-visible` + `activeElement=#file-tree`；从树内再按：`sidebar-visible` 移除、`activeElement=.cm-content`、`.sidebar[inert]` |
| 全局 Ctrl+Alt+I | 通过 | 多次验证 `insights-visible` 且 `activeElement=#explanation-content`；焦点在面板内再按可收起（本次自动化注入偶发丢失，已用 `#nav-insights` Enter 复核同一 `toggleInsightsPanel` 路径） |
| 全局 Ctrl+Alt+K | 通过 | 侧栏打开时 `HINT · 43 个目标（代码 13 行）`；截图 fix-07 |
| 全局 Ctrl+Alt+F | 通过 | `SNEAK · 输入两个字符` → `xh` → `20 处`；Esc 取消后状态清空 |
| 文件树 j/k 与 B 收起 | 通过 | 打开后 `.tree-row.key-focus=arch`，`j`×3 → `crypto`；B 收起 → `.cm-content` |
| 文件树过滤 Esc | 通过 | 输入 README 后一次 Esc：value 清空、焦点 `#file-tree` |
| 对话框 Tab 闭环 | 通过 | open-dialog：browse→submit→close（无 BODY）→local-tab→remote-tab→local-path；Shift+Tab 反向 submit |
| Vim 帮助 / 本地快捷键 | 通过 | 帮助 j×5 scrollTop 0→105、gg→0、Esc 回编辑器；keymap j×4 scrollTop 0→84、Esc 回 `#nvim-keys` |
| 编辑器 Vim 搜索 `/` + n | 通过 | `/xhci_queue` Enter → `#cursor-pos 4478:5`；`n` → `4487:5` |
| 分析栏搜索 Enter | 通过 | input `正在` + Enter → 搜索条移除、焦点 `#explanation-content`、n 不再追加字符 |
| 深层演变焦点 | 通过（加载态） | 激活后 `activeElement=#history-content`（loading），非 BODY；截图 fix-11 |
| 提交详情 j/Enter/Tab/Esc | 部分通过 | j：close→`SUMMARY Diff（1 个文件）`；Enter：`details.open=true`；Shift+Tab：summary→close；Esc：浮层隐藏。Esc 后焦点回提交行的问题见风险项 |
| 隐藏面板 Tab | 通过 | Shift+Tab 链 `#tree-filter → #history-menu-button → #open-menu → BODY → .cm-content`，无 `#explanation-content` |
| 目录浏览器 | 通过 | 打开聚焦首行、↓逐项、Tab 单停靠点、Esc 只关子面板（见 BUG-12 自验） |

## 未修复/风险

1. **提交详情 Esc 焦点恢复（本轮回归发现的连带影响，已补丁待复验）**：`showCommit()` 会先收起分析栏，新增的 `inert` 会让焦点先落到 BODY，`renderCommitOverlay()` 记录的返回焦点因此是 body；同时分析栏已设 inert，直接 `header.focus()` 会被静默拒绝。已在 `public/app.js:2196` 做两处修正：① body 不作为恢复目标，改走 `commitOverlayReturnHash` 找回同一 `.commit-header`；② 恢复前 `window.__crPanels.show('insights')` 展开面板并移除 inert，再聚焦。补丁后因自动化输入再次丢失（页面重载后 `cua`/`locator.press` 无法稳定注入），未能完成 Esc→提交行的实测；下一轮测试请重点验证：分析栏打开 → Shift+Tab 到提交行 → Enter 打开 → Esc 后 `activeElement` 应为同一 `.commit-header`，不是 `#commit-overlay-close`/BODY。
2. **BUG-11 完成态焦点**：只验到 loading 态焦点在 `#history-content`；`git log -L` 在 14s 内未返回，完成渲染后的 `restoreFocus()` 分支未实测，下一轮用较小仓库或等待更久复核。
3. **BUG-04 异步恢复窗口**：正常加载后的首次 B 已稳定一次聚焦；页面刷新后“树未就绪”的窗口因自动化注入不稳定未精确复现，重试逻辑（4s/120ms）为兜底，下一轮重载后立即按 B 验证。
4. **对话框覆盖面**：open-dialog 做了完整 Tab 正反向闭环；vim-help（单按钮）已验证；llm/docs/editor-env/nvim-keymap 共用同一 `trapModalTab`，本轮未逐个人工走完整圈，下一轮建议抽查 docs 与 editor-env（含隐藏字段）。
5. **自动化注入限制**：本环境 `cua.keypress` 的 Shift/Control 组合偶发丢失（与测试报告一致），部分验证需多次重试；凡 DOM 未变化的轮次均未计入通过。BUG-09 的结论尤其依赖元素级 `Shift+N`，下一轮请勿用 `cua` 大写单键判定 N 方向。