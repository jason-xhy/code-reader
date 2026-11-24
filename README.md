# Code Reader

本地 Git 源码阅读器：CodeMirror 6 + Vim 键位、LSP 跳转、LLM 代码解释、本地文档检索、行历史、分支切换、FAQ 和主题切换。

服务只监听 `127.0.0.1`，代码和 API Key 不会上传到第三方；LLM 请求只发送当前函数上下文（含相关定义）和你的问题。

## 功能

- 打开本地或远程 Git 仓库，浏览文件树、分支、Tag 和 Git 状态
- 工作区：可同时打开多个仓库（例如 `linux` 与 `klinux-v/klinux`），用顶部的仓库页签切换（`Ctrl+Alt+[` / `Ctrl+Alt+]` 前后切换，`Ctrl+Alt+Shift+1..9` 直达第 N 个页签）；**每个页签上方直接标出直达组合键**，工作区栏也显示前后切换键。每个仓库保留各自的文件、光标位置和目录折叠状态，后台预载并缓存代码树，大仓切换不再重扫文件列表；预载建树按空闲时间分片，j/k 导航不被后台扫描阻塞。页面刷新（含服务重启后重新打开页面）会自动恢复到上次的仓库、文件与行列位置，无需重新打开或从「历史」手动恢复
- 侧栏默认收起：代码树与「分析与解释」以覆盖层出现，鼠标移到左右边缘（或键盘聚焦过滤框/文件树）时滑入，移开自动收起；代码区始终满宽，面板显隐不触发编辑器/终端重排
- 侧栏快捷键：`Ctrl+Alt+B` 去代码树，`Ctrl+Alt+I` 去「分析与解释」——面板已打开但焦点在代码区时，按一下把焦点送进面板（不关闭）；焦点已在面板内时再按一次才收起。面板打开后钉住，鼠标移开不收回；键盘焦点在面板内（含鼠标点击解释窗口后）也保持展开。编辑器状态栏与 nvim 工具条直接显示这两个组合键。代码窗口上方左侧显示「← Ctrl+Alt+B 打开代码树」，右侧显示「Ctrl+Alt+I 打开代码解释窗口 →」，点击箭头提示也可进/出面板
- 全键盘导航（easymotion / sneak 风格）：任意窗口按 `Ctrl+Alt+K` 给所有可操作元素与代码行打字母标签，输入标签即点击/聚焦（代码行则把光标移到该行）；按 `Ctrl+Alt+F` 输入两个字符，视口内匹配处出现标签，输入标签即跳转（`Ctrl+Alt+L` 被 UKUI 系统锁屏占用，故改用 F）。标签层自动限定在当前顶层窗口（原生对话框、提交详情、引用列表），不会点到遮罩后面的元素；打开侧栏/对话框后焦点自动跟进；历史菜单/文件树右键菜单支持 ↑/↓ + Enter，Esc 返回；分隔条聚焦后 ←/→ 调整宽度
- 任意窗口 Vim 键（解释栏 / 函数提交历史 / 提交详情 / 所有对话框 / 菜单）：`j`/`k` 在可操作项之间移动，或（焦点在阅读容器上时）逐行滚动，支持计数（`5j`）；函数提交历史是列表容器，焦点在历史上时 `j`/`k` 始终在提交项之间移动（不会变成滚动文本）；`Ctrl+d`/`Ctrl+u` 半屏、`Ctrl+f`/`Ctrl+b`/`PageDown`/`PageUp` 整屏（阅读区还可用 `Space`/`Shift+Space`）；`gg`/`G` 跳到首个/最后一个目标，`12gg`/`12G` 跳到第 12 个，阅读区则为顶部/底部；`H`/`M`/`L` 首/中/末项（阅读区为顶部/中部/底部）；`0`/`^`/`$` 首/末项（阅读区横向滚到最左/最右）；`o` 激活当前项，`Enter` 走浏览器原生激活（提交详情里先 `j` 到「Diff」再 `Enter` 展开）；`/` 在当前窗口内搜索，`Enter` 定位，`n`/`N` 下一个/上一个，`Esc` 清除高亮并回到阅读模式。解释栏打开后默认是阅读模式，`Tab` 或点击链接进入项列表模式，`Esc` 先退回阅读模式再回编辑器；文件树与引用列表同样支持计数与翻屏，文件树里 `/` 直接跳到过滤框
- 工作区搜索：`Ctrl+Alt+P`（任意窗口）或 Vim `\s` / `:grep` / `:search`，按函数名或文件名模糊搜索整个仓库；关键字含 `*`/`?` 时按通配符匹配（如 `xhci*.c`），也可写 `/正则/`；**完全匹配排在前**，前缀匹配其次，部分匹配在后；结果复用 `gr` 的引用窗口（左侧列表 + 右侧前后 10 行上下文预览），`↑`/`↓`（或 `Ctrl+j`/`Ctrl+k`）选择、`Enter` 跳转、`Esc` 取消。函数搜索基于 `git grep` + 定义形态识别，支持 C/C++/汇编/JS/TS/Python/Go/Rust/Java/Shell 等，扩展名清单在 `src/search/config.js`
- **快捷键可改绑（跨平台/输入法兼容）**：所有 `Ctrl+Alt+X` 同时接受 `Ctrl+Alt+Shift+X` 备用键（macOS 另接受 `⌘+Option+X`）；被输入法或桌面环境抢走的组合键在左下角「快捷键」里点击键位后按下新组合键即可改绑（立即生效，只存本机浏览器），也可用 Vim `:keys` / `:keymap` 打开。常见冲突：fcitx 默认把 `Ctrl+Alt+P` 绑给 `SwitchPreedit`（只吞 P，B/I/K/F 正常）、UKUI 用 `Ctrl+Alt+L` 锁屏、fcitx 虚拟键盘默认用 `Ctrl+Alt+B`——都可在设置里直接改绑，无需改系统配置
- **NORMAL 模式输入法保护**：输入法组字（拼音预编辑）在 NORMAL/VISUAL 模式下不写入文档，也不会被当成 vim 命令（否则提交单字符 `i` 会进入 INSERT、切换输入法时整串拼音会落进源码）；状态栏提示「已忽略文字输入」，需要打字先按 `i` 进入 INSERT。`r`/`f`/`t` 等等待字面字符的动作不受影响；不经过组字的**直通符号键**仍照常执行 vim 命令——`*`/`#` 选中光标所在单词向前/向后搜索，`/`、`?` 打开搜索提示符，数字计数、`%`、`$` 等同理；全角标点（`＊`→`*`、`／`→`/`）与中文标点（`、`→`/`、`。`→`.`、`￥`→`$`、`《`→`<`、`》`→`>`、`·`→`` ` ``）都会自动还原成原按键的 ASCII 命令字符
- CodeMirror 6 编辑器，支持 Vim 模式（宏、寄存器、marks、`:s`、`:g`、`:norm` 等）
- nvim 面板：在浏览器内运行本地 `nvim`/`vim`（node-pty + xterm.js），直接使用你的配置与全部插件；打开面板时带入当前文件与行号，之后切文件不打扰 nvim，可点「打开当前文件」同步；编辑器 ⇄ nvim 页签用 `Ctrl+Alt+1` / `Ctrl+Alt+2` 切换（页签内直接标出组合键；兼容 `Ctrl+Alt+E` / `Ctrl+Alt+N`，但部分桌面把 `Ctrl+Alt+E` 注册为全局快捷键，会拦截该组合）。nvim 工具条已压缩并去掉底部重复状态栏，终端占满代码区
- 编辑器环境：左下角「编辑器环境」自动探测本地 neovim/vim（版本、配置目录、lazy.nvim/pack/vim-plug 插件数），可选择自动/指定/自定义命令；未检测到或选择「内置」时使用自带编辑器（nvim 标签自动禁用）
- `Ctrl-o` 跳回上一个跳转位置，`Ctrl-i` 跳到较新的跳转位置（跨文件的应用级跳转栈，gd/gr 后可直接回退）
- 阅读路径：编辑器上方记录最近访问的文件（面包屑），**按文件合并——同一文件只显示最新访问的那一行**；点击芯片即可回到该位置。`Ctrl+Alt+R`（或点面包屑末尾的「列表」）打开完整列表：最近访问的排在前面，`j`/`k` 或 `↑`/`↓` 选择、`Enter` 跳转、`Esc` 取消；也可用 Vim `:trail`
- LSP 跳转定义 / 查找引用；LSP 不可用或无结果时，定义跳转自动回退到 Git 文本检索；跳转栈
- 引用列表用 `j`/`k` 或 `↑`/`↓` 浏览时保留上一份上下文预览并预取相邻项，预览高度固定，不会闪回「正在读取」或上下跳动
- `\e` 聚焦文件树（`j`/`k` 选择（可 `5j`）、`Ctrl+d`/`Ctrl+u`/`Ctrl+f`/`Ctrl+b` 翻屏、`H`/`M`/`L` 首/中/末、`gg`/`G` 首个/最后一个文件、`Enter` 打开、`q` 返回、`/` 跳到过滤框），`:e` / `:vi` 按路径打开文件并支持 `Tab` 补全
- 代码树过滤支持键盘：在过滤框内用 `↑`/`↓` 选择候选，`Enter` 打开；只有一个候选时直接回车打开
- 「打开」对话框的目录浏览器：单击只选中（高亮），双击或 `Enter` 才进入并回填路径；选中后按字母可在目录间跳转，`↑`/`↓` 选择
- LLM 解释当前行：支持 OpenAI 和 Anthropic Messages 协议
- 上下文为**当前函数完整代码**（而不是固定行数窗口），并自动带上被调用函数的相关定义（最多 2 个）
  - 回答必须区分三类证据：代码事实（可点击跳转对应行）、本地文档事实（带来源/章节/页码与原文摘录）、推断（明确标注）
  - 「建议继续阅读」给出最多三个可点击的下一跳位置，形成引导式阅读路径
  - 提问框上方有预设问题（函数目的 / 数据流 / 设计原因 / 规范依据 / 3D 动画）
- 3D 动画演示：提问中明确要求动画时，模型输出受限的声明式 JSON，由内置 Three.js 运行时渲染为可播放的 3D 场景（播放/暂停/上一步/下一步/进度/速度/重置视角，支持 OrbitControls 旋转视角，WebGL 不可用时降级为步骤列表）；可下载自包含的离线 HTML。模型不生成任何可执行代码
- LLM Key 存放在系统钥匙串（macOS Keychain / Linux Secret Service），不落盘
- 本地文档知识库（Markdown / reStructuredText / 文本 / HTML / PDF，长文档均匀采样），检索时结合文件路径、当前函数与调用关系；命中结果带章节标题与 PDF 页码，可选联网检索
- 函数级历史（按函数范围 `git blame` 取最近 5 条提交，服务端按 HEAD+函数范围缓存）；「深层演变」按钮按需执行 `git log -L` 追踪函数体在历次提交中的修改（较慢，最多 5 条）；点击某条提交在代码窗口内弹窗显示完整提交（作者、时间、message、文件统计、diff，Esc 关闭）
- 解释结果自动记录为 FAQ，按函数/代码段命中；列表只显示问题，点击展开完整解释；代码或 HEAD 变化后条目标记「已过期」并给出原因，可一键按当前代码重问
- 规范核实状态由本地文档检索结果决定（来源+章节同时命中才算已核实），不信任模型自述
- 主题与字体：默认选中「本地」主题（按本地 nvim colorscheme 与 treesitter 高亮组生成），并同步本地终端/桌面等宽字体到编辑器与 nvim 面板；另有 8 套内置 Vim 配色，三栏宽度可拖拽

## 架构

代码按「配置 / 数据 / 策略 / 能力 / 装配」分层，新增功能不需要改大文件：

```
server.js                 装配层：配置 + 路由表 + 静态资源 + 错误边界
src/config.js             应用配置（端口、请求体上限、静态文件白名单）
src/http/                 传输层（JSON 读写、静态文件、路由分发）
src/policies/request.js   请求参数策略（行号/列号/路径/字符串校验）
src/routes/*.js           服务端能力：每个文件一组 API（editor/source/lsp/faq/search/...）
src/search/               工作区搜索能力：config / query 策略 / definitions 策略 / ranking 策略 / service
src/*.js                  Git、LSP、LLM、文档、FAQ、工作区等基础服务
public/core/              前端配置、DOM 句柄、运行时状态、API、通用工具、布局与交互策略、可改绑 keymap
public/features/*.js      前端能力模块：tree / workspace / insights / navigation / search / dialogs / shortcuts / keymap ...
public/app.js             前端装配层：创建编辑器、注入依赖、初始化能力模块
scripts/check-syntax.mjs  语法检查：遍历源码目录，新增模块无需改 package.json
```

扩展方式：

- **新增后端能力**：在 `src/routes/` 加一个 `{ method, pattern, handler }` 路由组，在 `server.js` 的路由表注册；参数校验放 `src/policies/`，配置放 `src/config.js` 或能力自己的 config。
- **新增前端能力**：在 `public/features/` 新建 `initXFeature(deps)` 模块，在 `app.js` 注入跨模块依赖并初始化；共享状态只从 `public/core/state.js` 读写。
- **扩展搜索**：改 `src/search/config.js` 的 `sourceGlobs` 增加语言；改 `src/search/definitions.js` 增加定义识别规则；改 `src/search/ranking.js` 调整完全匹配/前缀/部分的排序。

搜索接口：`GET /api/repositories/:id/search?q=<关键词>`，返回 `{ query, head, results: [{ kind, name, path, line, character, match }], counts, truncated }`，`match` 为 `exact` / `prefix` / `partial`。

## 环境要求

- Node.js >= 20
- Git
- Linux/macOS 下安装 `node-pty` 时若无预编译包，需要 Python 3、make、g++ 编译
- 可选：`nvim`（nvim 面板；可用 `CODE_READER_NVIM=/path/to/nvim` 指定）
- Linux 可选：`python3-keyring` + Secret Service（GNOME Keyring 等），用于保存 API Key
- 可选：`clangd` 18+、`pdftotext`（分别用于 LSP 和 PDF 文档索引）
  - 自动在 `PATH` 中寻找 `clangd`、`clangd18`…`clangd21`、`clangd-18` 等版本并取最高者；也支持 neovim mason 安装目录（`~/.local/share/nvim/mason/packages/clangd/*/bin/clangd`）。
  - 指定二进制：`CODE_READER_CLANGD=/path/to/clangd`；限定引擎：`CODE_READER_LSP=clangd|ccls`。
  - 服务运行中装好 clangd 无需重启：状态轮询发现新引擎后自动初始化并就绪（约一分钟内，受引擎探测缓存影响）。
  - 系统自带 clangd 10 无法解析内核树的 `asm inline` 语法（`CONFIG_CC_HAS_ASM_INLINE=y`），定义/引用会为空；此时状态栏会提示升级，定义跳转回退到 Git 文本检索。

## 快速开始

```bash
npm install
npm run build:vendor
npm start
```

`build:vendor` 会生成 CM6/xterm 包，并把 `three` 复制到 `public/vendor/three/`（3D viewer 离线使用）。

默认访问 <http://127.0.0.1:8765>。端口被占用时：

```bash
PORT=8766 npm start
```

打开页面后点击「打开」，输入本地仓库路径，或粘贴远程仓库 URL（目录浏览器中单击选中、双击进入）；新打开的仓库会加入工作区，之后用顶部页签或 `Ctrl+Alt+[` / `Ctrl+Alt+]`（`Ctrl+Alt+Shift+1..9` 直达）继续打开/切换其它仓库。代码树与右侧分析栏默认收起，鼠标移到窗口左/右边缘即可滑出。刷新页面会自动恢复上次的仓库与位置。首次使用 LLM 解释前，点击左下角「LLM 设置」选择厂商、协议和模型并保存 API Key。

OpenAI 支持刷新当前 Key 可访问的文本模型列表；Key 仅存系统钥匙串，保存后会完整回读校验。模型请求支持桌面 HTTP(S) 代理环境变量，本地回环请求直连。

也可选择「ChatGPT（本机 Codex 登录）」复用本机已安装并登录的 Codex CLI，无需把 ChatGPT 登录令牌填入 API Key。该通道使用临时只读会话，模型权限取决于当前登录。

### 自定义 Anthropic 兼容网关

在「LLM 设置」中选择「自定义兼容服务」：

- API 地址：例如 `https://your-gateway.example.com/apps/anthropic`
- API 协议：`Anthropic Messages（/v1/messages）`
- 模型：网关提供的模型 ID

程序会对 Anthropic 请求显式发送 `thinking: { "type": "disabled" }`，避免推理模型的 thinking token 耗尽 `max_tokens`，导致最终 JSON 没有生成。

## 测试

```bash
npm run check         # 语法检查
npm run test:llm      # Anthropic 协议与解析回归
npm run e2e           # 端到端 API 回归（临时 Git 仓库）
npm run test:keyboard # 隔离仓库的键盘焦点回归（需系统 Chrome）
npm run test:browser  # 浏览器验收：工作区/侧栏/过滤/引用预览/3D viewer（需系统 Chrome）
```

`test:browser` 默认只读检查（`CODE_READER_URL` 可改地址，`CHROME_BIN` 可指定 Chrome）；加 `-- --switch` 会额外验证工作区快捷键、仓库切换与切换后刷新，结束后自动恢复原当前仓库。

专项回归：`node scripts/question-regression.mjs`、`node scripts/docs-regression.mjs`、`node scripts/workspace-regression.mjs`、`node scripts/theme-regression.mjs`。端口冲突时可设置 `CODE_READER_TEST_PORT` 和 `CODE_READER_TEST_LLM_PORT`；旧 `E2E_LLM_PORT` 仍兼容。

[2026-11-22 纯键盘测试、修复边界和验证报告](bug-reports/keyboard-20261122/README.md)记录了 GUI 与自动化证据及限制。

## 安全说明

- 服务默认只绑定 `127.0.0.1`，不要直接暴露到公网。
- nvim 面板是**真实本地终端**：`:w` 会写盘，`:!` 可执行命令；WebSocket 仅接受本机页面来源，关闭面板或断开页面会结束该 nvim 进程。
- LLM API Key 由系统钥匙串保存；`.data/`、`node_modules/` 和日志文件不会进入版本库。
- 本地文档检索和网页检索的配置由用户显式开启；网页结果会标注为「网络检索未核验」。
- 通用 3D 动画由模型输出受限 JSON（节点/步骤/行号），xHCI Missed Service 使用与当前源码分支绑定的内置状态场景；不执行模型生成的任何 HTML/JavaScript；预览 iframe 启用 `sandbox="allow-scripts"`，CSP 仅额外放行 `frame-src blob:`。
- 该工具会读取你打开的本地仓库，请只打开自己有权限访问的仓库。

代码树支持连续输入字母前缀定位（保留导航键），完整文件名会在全仓匹配并展开祖先目录；同名文件选路径排序第一项。代码搜索 `/` 后按 Enter 提交并返回导航，上方向键逐条回填本次页面会话历史。3D 动画支持 `j/k` 或左右方向键切步，并显示当前步骤的详细解释、代码位置与规范章节。

### xHCI Missed Service 状态场景

`COMP_MISSED_SERVICE_ERROR` 的动画直接绘制四个 ESIT 窗口、A/B/C/D 软件队列、事件 TRB 指针、软件 dequeue 与 `ep->skip`，并逐帧显示错误状态、实际长度及 URB 累计长度。主场景有 16 步，零指针对照有 7 步；`j/k`、方向键、播放和拖动进度均可切换状态。右侧同步显示从当前仓库提取的源码和本地规范依据。

该场景按驱动分支生成可复现的演示状态，不执行模型生成的场景脚本。只有当前源码包含所需处理分支时才启用；已有相应 FAQ 动画可直接升级，无需再次请求模型。128/64 B、DMA 地址、延迟和事件环满均为明确标注的演示假设。硬件时钟与软件处理进度分开表示。

场景验收需要本地 Linux 源码、已配置的模型和本地规范目录；首次先运行 `node scripts/missed-service-live.mjs` 保存真实回答到 `bug-reports/missed-service-20261122/response.json`，再运行以下检查。验收生成的报告、规范副本及截图留在本地。

验证入口：`node scripts/missed-service-scene.mjs` 生成并检查状态场景（源码根目录可用 `CODE_READER_KERNEL_ROOT` 指定）；`node scripts/missed-service-animation-check.mjs` 验证 WebGL、队列位移、指针、长度、代码/规范、播放、窄屏和降级。设置 `CODE_READER_URL` 可同时验证应用中的旧动画升级及离线导出。

## 许可证

[MIT](LICENSE)
