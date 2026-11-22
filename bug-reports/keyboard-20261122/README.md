# 2026-11-22 纯键盘测试与修复

目标：让规范、源码、历史与有出处的模型解释形成完整阅读流程。A 在测试前提交方案，不阅读 Code Reader 源码或 README，仅依据窗口提示使用键盘；B 修复，C 独立回归、补测并修复。GUI 功能操作全部使用键盘，截图/AX 仅观察；API、受控异步及浏览器回归另行标记，不能替代 GUI 证据。

## 最终结果

- 离线动画：真实 GUI 保存 HTML，实际导出文件以 file:// 打开，步进、播放和 3D 画面正常。文件运行时内嵌、无外部脚本/样式依赖；未全局断网。
- 本地主题：可读外壳与原本地编辑器配色同时显示；local 偏好刷新后仍保留，没有修改用户 Vim 配色文件。
- FAQ：代码变更识别过期、真实 OpenAI 重问、更新记录、删除及焦点恢复通过。
- Git：目录浏览、多仓往返、阅读路径隔离、分支切换、本地远端快进、提交 diff/深层演变、无效克隆地址、file:// 及公开 HTTPS 克隆通过；测试使用隔离仓库，未推送素材仓库。
- 阅读：搜索、LSP 引用/定义、Ctrl-o/i、HINT/两字符定位、键盘分隔条、代表性 Vim 宏/寄存器/marks、真实本地 Vim、提问预设及动画回放通过。
- 核心闭环：真实 USB/URB 文档与 usb_submit_urb 实现问答，能列出规范章节及源码行并区分未核实推断。

## 修复范围

| 范围 | 主要修复 |
|---|---|
| 请求生命周期 | 可取消按钮与 Esc、端到端 AbortSignal、立即重提与迟到响应隔离、正常取消不记 500 |
| 焦点/会话 | FAQ 删除与非活动页签关闭恢复焦点、尊重新焦点意图、跨仓同名文件/FAQ 响应归属、按会话保存阅读路径 |
| Vim/布局 | 实际选择 Vim/Neovim、PTY helper 执行权限/首包、Mac Ctrl-o/i 优先级及异步回退、侧栏与窄中心响应式 |
| 模型/凭据 | OpenAI 目录及账户可用型号刷新、Node20/22 代理、security stdin 命令模式及完整回读防长 Key 截断；独立本机 Codex ChatGPT 登录备用能力 |
| 规范检索 | 源码符号与路径领域上下文、下划线分词、配置目录权重、嵌套重复块去重 |
| 动画/主题 | 动画意图同步、父子窗口白名单键盘转发、持久动画回放、本地 shell 可读性、异步 profile 加载保留 local 偏好 |

## 解耦边界

- 配置：`src/llm/providers.js` 为厂商/端点/模型目录；`src/llm-config.js` 校验并持久化用户选择。
- 数据：`src/keychain.js` 只处理系统密钥读写与完整性；密钥不进入选项 JSON 或前端返回。会话阅读路径在工作区快照保存。
- 能力：`src/llm/models.js` 查询目录，`src/chatgpt.js` 执行本机已登录 CLI，`src/http/model-fetch.js` 传输，FAQ/工作区各自处理交互生命周期。
- 策略：`src/policies/llm.js` 过滤/超时，`src/policies/documentation.js` 检索权重，`public/core/theme-policy.js` 对比度；`public/core/animation-keys.js` 解码动画键盘命令，iframe 传输与渲染分离。

仅整理本轮涉及的模块，不宣称全仓完成解耦；未开发后续 Codex 键盘插件。

## 验证与限制

第三轮记录：90 个 JS 语法检查通过，API e2e 174/174，question/docs/workspace/theme 专项和 diff-check 通过。发布整理时还需在同步远端后重跑，结果追加于下节。

真实 OpenAI GPT-6.2 Sol 最小请求单样本约 2.658 秒，完整结构化解释约 6.258 秒；ChatGPT CLI 备用单样本约 12.864 秒。CUA 操作/读取开销与阻塞不计应用延迟，未获得可靠按键毫秒值或 p95。没有穷尽全部 Vim 组合、私有 Git 鉴权协议、任意尺寸/模型排列。Vimium 扩展会抢按键，GUI 使用无痕环境隔离。所有明确续测的分支已完成；阶段记录里的旧“受阻/待视觉复验”由第三轮结论取代。

## 归档

- [测试前方案](plan.md)
- [A 黑盒记录](blackbox-a.md)
- [B 修复与边界](fixes-b.md)
- [C 回归、补测与最终结论](regression-c.md)
- [问题状态](issues.md)

不发布密钥、用户配置/历史/FAQ 数据、原始日志、截图及离线产物。后者保留本机作复核证据。

## 推送前整合验证

同步远端 main 的 3e0cf41（面板异步焦点修复）后保留其行为和测试。e2e 冲突仅合并 fs 导入、临时目录 realpath 和可配置端口，并兼容原 E2E_LLM_PORT。构建输出已重建。

- `npm run build:vendor` 对应构建脚本通过；`npm run check` 对应检查脚本：**91 个 JS 文件通过**（含远端新增键盘回归脚本）。
- `CODE_READER_TEST_PORT=18799 CODE_READER_TEST_LLM_PORT=18899 node scripts/e2e.mjs`：**174/174、0 失败**。
- `RUN_EXISTING_BROWSER=1 node scripts/keyboard-regression.mjs`：**13 个键盘场景通过**，配套隔离浏览器检查 **91/91、0 失败**。第一次 Chrome 调试目标启动未就绪而失败，原命令重试通过；首次失败未执行测试断言，不掩盖该启动波动。此浏览器自动化包含程序化布置与观察，不冒充 A 的纯键盘黑盒。
- question/docs/workspace/theme 四组专项回归全部通过；`git diff --check` 通过。
- 待提交文件扫描未发现长 Key/私钥模式，发布报告不含本机 home 绝对路径；用户数据目录、密钥、原始日志/截图与测试克隆目录不提交。
