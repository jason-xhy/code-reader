# Code Reader

本地 Git 源码阅读器：CodeMirror 6 + Vim 键位、LSP 跳转、LLM 代码解释、本地文档检索、行历史、分支切换、FAQ 和主题切换。

服务只监听 `127.0.0.1`，代码和 API Key 不会上传到第三方；LLM 请求只发送当前文件的行上下文和你的问题。

## 功能

- 打开本地或远程 Git 仓库，浏览文件树、分支、Tag 和 Git 状态
- CodeMirror 6 编辑器，支持 Vim 模式（宏、寄存器、marks、`:s`、`:g`、`:norm` 等）
- nvim 面板：在浏览器内运行本地 `nvim`/`vim`（node-pty + xterm.js），直接使用你的配置与全部插件；打开面板时带入当前文件与行号，之后切文件不打扰 nvim，可点「打开当前文件」同步
- 编辑器环境：左下角「编辑器环境」自动探测本地 neovim/vim（版本、配置目录、lazy.nvim/pack/vim-plug 插件数），可选择自动/指定/自定义命令；未检测到或选择「内置」时使用自带编辑器（nvim 标签自动禁用）
- `Ctrl-o` 跳回上一个跳转位置，`Ctrl-i` 跳到较新的跳转位置（跨文件的应用级跳转栈，gd/gr 后可直接回退）
- LSP 跳转定义 / 查找引用；LSP 不可用或无结果时，定义跳转自动回退到 Git 文本检索；跳转栈
- `\e` 聚焦文件树（`j`/`k` 选择、`Enter` 打开、`q` 返回），`:e` / `:vi` 按路径打开文件并支持 `Tab` 补全
- LLM 解释当前行：支持 OpenAI 和 Anthropic Messages 协议
- LLM Key 存放在系统钥匙串（macOS Keychain / Linux Secret Service），不落盘
- 本地文档知识库（Markdown / reStructuredText / 文本 / HTML / PDF，长文档均匀采样），检索时结合文件路径与当前行上下文，可选联网检索
- 函数级历史（按函数范围 `git blame` 取最近 5 条提交，服务端按 HEAD+函数范围缓存）；点击某条提交在代码窗口内弹窗显示完整提交（作者、时间、message、文件统计、diff，Esc 关闭）
- 解释结果自动记录为 FAQ，按函数/代码段命中；列表只显示问题，点击展开完整解释
- 8 套 Vim 配色主题，三栏宽度可拖拽

## 环境要求

- Node.js >= 20
- Git
- Linux/macOS 下安装 `node-pty` 时若无预编译包，需要 Python 3、make、g++ 编译
- 可选：`nvim`（nvim 面板；可用 `CODE_READER_NVIM=/path/to/nvim` 指定）
- Linux 可选：`python3-keyring` + Secret Service（GNOME Keyring 等），用于保存 API Key
- 可选：`clangd` 18+、`pdftotext`（分别用于 LSP 和 PDF 文档索引）
  - 自动在 `PATH` 中寻找 `clangd`、`clangd18`…`clangd21`、`clangd-18` 等版本并取最高者；也支持 neovim mason 安装目录（`~/.local/share/nvim/mason/packages/clangd/*/bin/clangd`）。
  - 指定二进制：`CODE_READER_CLANGD=/path/to/clangd`；限定引擎：`CODE_READER_LSP=clangd|ccls`。
  - 系统自带 clangd 10 无法解析内核树的 `asm inline` 语法（`CONFIG_CC_HAS_ASM_INLINE=y`），定义/引用会为空；此时状态栏会提示升级，定义跳转回退到 Git 文本检索。

## 快速开始

```bash
npm install
npm run build:vendor
npm start
```

默认访问 <http://127.0.0.1:8765>。端口被占用时：

```bash
PORT=8766 npm start
```

打开页面后点击「打开」，输入本地仓库路径，或粘贴远程仓库 URL。首次使用 LLM 解释前，点击左下角「LLM 设置」选择厂商、协议和模型并保存 API Key。

### 自定义 Anthropic 兼容网关

在「LLM 设置」中选择「自定义兼容服务」：

- API 地址：例如 `https://your-gateway.example.com/apps/anthropic`
- API 协议：`Anthropic Messages（/v1/messages）`
- 模型：网关提供的模型 ID

程序会对 Anthropic 请求显式发送 `thinking: { "type": "disabled" }`，避免推理模型的 thinking token 耗尽 `max_tokens`，导致最终 JSON 没有生成。

## 测试

```bash
npm run check      # 语法检查
npm run test:llm   # Anthropic 协议与解析回归
npm run e2e        # 端到端 API 回归（临时 Git 仓库）
```

## 安全说明

- 服务默认只绑定 `127.0.0.1`，不要直接暴露到公网。
- nvim 面板是**真实本地终端**：`:w` 会写盘，`:!` 可执行命令；WebSocket 仅接受本机页面来源，关闭面板或断开页面会结束该 nvim 进程。
- LLM API Key 由系统钥匙串保存；`.data/`、`node_modules/` 和日志文件不会进入版本库。
- 本地文档检索和网页检索的配置由用户显式开启；网页结果会标注为「网络检索未核验」。
- 该工具会读取你打开的本地仓库，请只打开自己有权限访问的仓库。

## 许可证

[MIT](LICENSE)