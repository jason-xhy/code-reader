# Round 2 修复记录

- 时间：2026-11-20 17:04 CST
- 修改文件：
  - `public/keyboard-nav.js`（顶层判定与 modalRoot 统一、弹出菜单纳入顶层、K/F 遮挡探测、F 标签放置）
  - `public/app.js`（解释栏项列表 Esc 层级、文件树聚焦重试与焦点复核）
  - `public/vim-nav.js`（导出 closeSearch 供 Esc 层级使用）
  - `web-src/editor.js` + `public/vendor/cm6/editor.bundle.js`（Tab 仅在 INSERT/REPLACE 缩进）
- 验证环境：Code Reader 1.0.0，http://127.0.0.1:8766/（Node PID 2575520，未重启服务，仅浏览器 `?r=` 新导航）；Chromium 1280×720；工作区 linux，`drivers/usb/host/xhci-ring.c`。
- 命令结果：`npm run check` exit 0；`npm run build:vendor` 成功，`editor.bundle.js` 640KB 级别（639282B，mtime 16:53）。
- 自动化说明：本轮仍偶发“`document.hasFocus()===true` 但页面收不到任何 keydown”的通道故障（与 Round 2 报告第 3 条同类）。所有结论只采信“同一 JS 调用内先聚焦、再按键、DOM 确实变化”的轮次；每调用重新 bootstrap。

## 逐条处置

### BUG-R2-01 [fixed] 提问框打开时 Ctrl+Alt+K 标签层越界
- 根因：`topRoot()` 只列 dialog / 3D 动画 / 提交详情，不含 `#question-editor`；`modalRoot()` 已含提问框。Tab 焦点圈按模态处理，K/F 标签层却仍把 `body` 当顶层，背景顶栏/代码行全部参与。
- 修改：
  - `public/keyboard-nav.js:108` `topRoot()` 改为 `modalRoot() || openMenu() || document.body`，与 Tab 模态圈共用同一层级定义（含提问框）。
  - `public/keyboard-nav.js:116` 新增 `layerMount()`：唯一例外是原生 `<dialog>`（top layer），否则标签层统一挂 `body`；`public/keyboard-nav.js:290` `ensureLayer()` 改用 `layerMount()`，避免提问框/菜单自身的定位上下文影响 `position:fixed` 坐标。
- 自验：重载后 `\c` 打开发问框（`active=question-input`）→ `Ctrl+Alt+K`：
  `HINT · 9 个目标 · 输入标签跳转 · Esc 取消`；items = 5 个预设 chip + `#question-input` + `#question-animation` + `#question-cancel` + `#question-submit`，`editor-line` 0 个，全部 `#question-editor` 内，标签层 parent = `BODY`。
  F 同一层级：`Ctrl+Alt+F` → `th` → `SNEAK “th” · 1 处`，唯一匹配为提问框内的「同时生成 3D 动画解释（three.js）」，无代码匹配。
  截图 `fix-r2-01-question-k.png`（背景代码行无标签）。

### BUG-R2-02 [fixed] 解释栏项列表 Esc 无效
- 根因：Esc 只绑在 `#explanation-content` 的 keydown 上；焦点在 `.insights` 内的提交行/「深层演变」按钮时事件不经过该容器，document 级 Esc 处理器也没有解释栏分支。
- 修改：`public/app.js:4134` 在 document 级 keydown 增加洞察栏分支：`active` 在 `.insights` 内且不在 `#explanation-content` 内时，Esc 聚焦 `#explanation-content`；若搜索条仍打开则先 `vimNav.closeSearch()`（Esc 只退一层）。`public/vim-nav.js:522` 导出 `closeSearch`。
- 自验：`Ctrl+Alt+I`（active `explanation-content`）→ `Shift+Tab`（active `深层演变（git log -L，较慢）`）→ 第一次 `Esc`：`activeElement=#explanation-content`、`#app=insights-visible`；第二次 `Esc`：`activeElement=.cm-content`，面板保持。截图 `fix-r2-02-insights-esc.png`。

### BUG-R2-03 [fixed] 重载窗口首次 Ctrl+Alt+B 只开面板不聚焦
- 根因：三层叠加：① `requestTreeFocus().attempt()` 在 `#app` 尚无 `sidebar-visible` 时直接 `return`，不再安排重试；② 重载恢复流程把焦点设回编辑器后，`active !== origin && active !== body` 守卫把它当成“用户移走焦点”而放弃重试；③ `focusTree()` 返回 true 即当作成功，未复核 `activeElement` 是否真的在树内（树重渲染/恢复流程都可能冲掉）。
- 修改：`public/app.js:3061` 重写重试逻辑：
  - 面板未可见时也继续按 120ms 重试至 4s deadline；
  - 恢复期允许 `active.closest('#editor-host')`（恢复流程会程序化聚焦编辑器），仍保留“焦点被用户移到其它控件则放弃”的守卫；
  - `focusTree()` 后不再直接成功，下一轮以 `activeElement` 实测复核是否在 `#file-tree` 内，不在就继续补；
  - 成功后保留 700ms 观察窗，覆盖“恢复流程随后一帧又把焦点设回编辑器”的时序。
- 自验：新导航重载后约 0.6s 按 `Ctrl+Alt+B`，每 250ms 采样：250ms 时 `sidebar-visible` + `active=BODY`；500ms 起 `active=#file-tree`，持续到 4.5s 仍为 `#file-tree`。截图 `fix-r2-03-reload-b-focus.png`。

### BUG-R2-04 [fixed] Ctrl+Alt+F 对被侧栏遮挡的代码匹配仍打标签
- 根因：`collectSneakMatches()` 的编辑器匹配只做 `clipRect` 视口裁剪，没有遮挡判定；K 的 `collectEditorLines()` 已有 5 点探测，F 未同步。
- 修改：
  - `public/keyboard-nav.js:472` 抽出 `visibleInEditor(rect)`：沿匹配/行矩形取 5 个采样点（左+12、25%、50%、75%、右-6），任一点 `elementFromPoint` 属于 `#editor-host` 才保留；
  - `public/keyboard-nav.js:503` K 代码行复用该函数；`public/keyboard-nav.js:635` F 编辑器匹配同样过滤；
  - `public/keyboard-nav.js:363` 编辑器匹配的标签候选优先放匹配右侧，避免“匹配只露出一小段、标签又被放回覆盖层表面”。
- 自验：侧栏打开（`sidebar.right=312`），编辑器聚焦，`Ctrl+Alt+F` → `xh`：`SNEAK “xh” · 6 处`（修复前同条件 19 处、7 个标签落在侧栏列内）；全部标签 `left ≥ 312`，`underSidebar` 为空。侧栏关闭时同一查询 15 处，功能未丢。截图 `fix-r2-04-f-visible-only.png`（标签全部在代码区）。

### BUG-R2-05 [fixed] 弹出菜单打开时 K 不限定菜单层
- 根因：`topRoot()` 只认 dialog/动画/提交详情，菜单虽是最上层交互层但仍返回 `body`；K 收集整页目标，F 也会扫全页文本。
- 修改：`public/keyboard-nav.js:93` 新增 `openMenu()`：按 `tree-menu`（z-index 200）→ `history-menu`（60）检查 `hidden`、非零尺寸且矩形与视口相交，命中即作为顶层；`public/keyboard-nav.js:108` `topRoot()` 在无模态时返回它。菜单关闭（或侧栏整体滑出视口导致菜单不可见）后自动回到 `body`。
- 自验：
  - 历史菜单：聚焦「历史」→ `Enter`（`#history-menu.hidden=false`，5 项）→ `Ctrl+Alt+K`：`HINT · 5 个目标`，全部为菜单项，`outside=0`、`editor-line=0`；截图 `fix-r2-05-history-menu-k.png`。
  - 文件树菜单：`Shift+F10` → K：`HINT · 3 个目标`（复制相对路径/绝对路径/刷新文件树），`outside=0`。
  - 菜单关闭后 K：`HINT · 41 个目标（代码 11 行）`，恢复整页；Esc 关闭菜单后 `#tree-menu.hidden=true`、焦点回 `#file-tree`。

### BUG-R2-06 [fixed] 编辑器 Tab/Shift+Tab 被完全捕获
- 根因：`web-src/editor.js` 的静态 `indentWithTab` 在所有 Vim 模式注册 `Tab`/`Shift-Tab`，NORMAL/VISUAL 下也吃掉按键（NORMAL 下表现为插入/删除行首缩进，列号 33→25 即 Shift+Tab 的 indentLess）。
- 修改：`web-src/editor.js:57` 新增 `vimTypingMode()`（`insertMode` 或 mode 以 `insert`/`replace` 开头）；`:64` 用 `Prec.highest` 的 `VIM_TAB_KEYMAP` 替换静态 `indentWithTab`：INSERT/REPLACE 执行 `indentMore`/`indentLess`，NORMAL/VISUAL 返回 false 让浏览器默认焦点移动；`:497` 挂载该 keymap。已执行 `npm run build:vendor`，`public/vendor/cm6/editor.bundle.js` 更新（639282B，mtime 16:53）。`:e` 命令行补全的 document 级 Tab 捕获（`editor.js:376-396`）未改动，实测 `:e drivers/usb/host/xhci-r` + Tab 仍补全为 `xhci-rcar-regs.h`。
- 自验：
  - NORMAL（NORMAL 模式，光标 4431:47）：`Tab` → 焦点离开 `cm-content`；`Shift+Tab` → `#editor-host`，光标仍 4431:47（不再 outdent）。
  - NORMAL + 解释栏打开：`Tab` → `#splitter-right`（`display:block`），Round 2 的「`#editor-host → #splitter-right` 正向路径被截断」恢复。
  - INSERT：`i`（`--INSERT--`）→ `Tab`：焦点仍 `cm-content`，光标行 4436 列 2→3（缩进生效）。
  - VISUAL：`v`（`--VISUAL--`）→ `Tab` → `#splitter-right`，焦点成功离开编辑器。

## 回归验证

| 用例 | 结果 | 证据 |
|---|---|---|
| Ctrl+Alt+B 打开/收起 | 通过 | 打开：`sidebar-visible` + `active=#file-tree`；树内再按：class 移除、`active=.cm-content`、`.sidebar[inert]` |
| Ctrl+Alt+I 打开/收起 | 通过 | 打开：`insights-visible` + `active=#explanation-content`；再按：收起、`active=.cm-content`、`.insights[inert]` |
| 主页面 K | 通过 | `HINT · 36 个目标（代码 21 行）`，Esc 退出回编辑器 |
| 主页面 F | 通过 | `SNEAK “xh” · 12 处`，Esc 清除 |
| 打开仓库对话框 Tab 圈 | 通过 | `local-path→browse→open-submit→dialog-close→local-tab→remote-tab→local-path`，全程 `dialog[open]=true`、无 BODY；Esc 后 `active=#open-menu` |
| 提问框 Tab 圈 | 通过 | 连按 8 次 Tab：animation→cancel→submit→preset×5，`inside` 全真；Esc 关闭后 `active=.cm-content` |
| 提交详情 Esc 焦点恢复 | 通过 | 洞察栏提交行 `98d74f9cea` → Enter（`active=#commit-overlay-close`）→ Esc：同一 `.commit-header` 获得焦点，`insights-visible` 恢复、inert 移除 |
| 提交详情 K 层级 | 通过 | K：`1 个目标`（`#commit-overlay-close`），`outside=0`；Esc 先退标签层（浮层仍在），再 Esc 关浮层并回提交行 |
| 目录浏览器 | 通过 | 打开即 `active=.dir-row.selected`（`.0qaxsafebait`），前 4 行 tabIndex `[0,-1,-1,-1]`；Esc 只关子面板（`dir-browser.hidden=true`、dialog 仍开、焦点 `#browse-button`），再 Esc 关对话框回 `#open-menu` |
| 文件树过滤 Esc | 通过 | 输入 `README`（value=README）→ 一次 Esc：value 空、`active=#file-tree`、行数 74 |
| 隐藏解释栏 Tab | 通过 | 侧栏打开、`.insights[inert]`：Shift+Tab 链 `tree-filter→history-menu-button→open-menu→BODY→.cm-content`，未出现 `#explanation-content` |
| `:e` 命令行 Tab 补全 | 通过 | 输入 `:e drivers/usb/host/xhci-r` → Tab：输入框值变为 `e drivers/usb/host/xhci-rcar-regs.h`；Esc 取消，文件/光标仍 `xhci-ring.c 4461:1` |
| 菜单 Esc / 焦点 | 通过 | 历史菜单 Esc：`#history-menu.hidden=true`；树菜单 Esc：`hidden=true`、`active=#file-tree` |
| 最终状态 | 已恢复 | `drivers/usb/host/xhci-ring.c` 4461:1，`active=.cm-content`，NORMAL，两侧栏收起，无对话框/浮层/提问框；截图 `fix-r2-90-final-state.png` |

## 未修复/风险

1. **R2-06 的两侧栏全收起场景**：NORMAL 下 Tab 已能离开编辑器，但此时文档内编辑器之后没有可见的可聚焦元素，浏览器默认顺序导航落到 `BODY`（无焦点环）；解释栏打开时 Tab 可正常落在 `#splitter-right`，Shift+Tab 也能回 `#editor-host`。这是浏览器顺序导航的空档，不是编辑器焦点陷阱；若要求“任何布局下 Tab 都有可见落点”，需在应用层显式接管 Tab 顺序（本轮按报告要求返回 false，未做）。
2. **VISUAL 模式离开编辑器后仍保持 VISUAL**：Tab 把焦点移到 `#splitter-right`，编辑器 Vim 状态仍是 `--VISUAL--`；回到编辑器后需 Esc 退出。这是“NORMAL/VISUAL 不消费 Tab”的直接结果，未额外改 Vim 状态机。
3. **R2-03 的时序边界**：重试 deadline 仍为 4s，成功后观察窗 700ms；若工作区恢复流程在 4s 后仍把焦点设回编辑器，第一次 B 仍可能留在编辑器（第二次 B 正常）。继续扩大窗口会与“用户主动把焦点移回编辑器”冲突，未再放大。
4. **R2-02 搜索条优先级**：正常路径下搜索条输入框自身吞掉 Esc（`vim-nav.js` 的 input 处理器 `stopPropagation`），document 分支不会重复处理；`vimNav.closeSearch()` 作为“搜索条仍开但焦点不在输入框”的兜底，该状态在 UI 上通常不可达。
5. **build:vendor 的附带刷新**：`npm run build:vendor` 会同时重建 animation/terminal bundle。`public/vendor/three/animation.bundle.js` 出现 diff，是因为仓库里 `web-src/animation.js` 已有未提交改动（Escape → postMessage 关闭动画），构建把它同步进了产物；不属于本轮修复内容，也未回退。`public/vendor/xterm/terminal.bundle.js` 无 diff。
6. **自动化通道**：复现阶段遇到一次“所有按键无 keydown”的窗口，重载后恢复，与 Round 2 报告第 3 条一致；未计入应用 BUG。上述通过项均在按键真实触发、DOM 变化的轮次采集。