# Code Reader

本地 Git 源码阅读器：CodeMirror 6 + Vim 键位、LSP 跳转、LLM 代码解释、本地文档检索、行历史、分支切换、FAQ 和主题切换。

服务只监听 `127.0.0.1`，代码和 API Key 不会上传到第三方；LLM 请求只发送当前文件的行上下文和你的问题。

## 功能

- 打开本地或远程 Git 仓库，浏览文件树、分支、Tag 和 Git 状态
- CodeMirror 6 编辑器，支持 Vim 模式（宏、寄存器、marks、`:s`、`:g`、`:norm` 等）
- `Ctrl-o` 跳回上一个跳转位置，`Ctrl-i` 跳到较新的跳转位置（跨文件的应用级跳转栈，gd/gr 后可直接回退）
- LSP 跳转定义 / 查找引用；LSP 不可用或无结果时，定义跳转自动回退到 Git 文本检索；跳转栈
- `\e` 聚焦文件树（`j`/`k` 选择、`Enter` 打开、`q` 返回），`:e` / `:vi` 按路径打开文件并支持 `Tab` 补全
- LLM 解释当前行：支持 OpenAI 和 Anthropic Messages 协议
- LLM Key 存放在系统钥匙串（macOS Keychain / Linux Secret Service），不落盘
- 本地文档知识库（Markdown / reStructuredText / 文本 / HTML / PDF，长文档均匀采样），检索时结合文件路径与当前行上下文，可选联网检索
- 函数级历史（按函数范围 `git blame` 取最近 5 条提交，服务端按 HEAD+函数范围缓存）、提交详情与 diff
- 解释结果自动记录为 FAQ，按函数/代码段命中
- 8 套 Vim 配色主题，三栏宽度可拖拽

## 环境要求

- Node.js >= 20
- Git
- Linux 可选：`python3-keyring` + Secret Service（GNOME Keyring 等），用于保存 API Key
- 可选：`clangd`、`pdftotext`（分别用于 LSP 和 PDF 文档索引）

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
- LLM API Key 由系统钥匙串保存；`.data/`、`node_modules/` 和日志文件不会进入版本库。
- 本地文档检索和网页检索的配置由用户显式开启；网页结果会标注为「网络检索未核验」。
- 该工具会读取你打开的本地仓库，请只打开自己有权限访问的仓库。

## 许可证

[MIT](LICENSE)