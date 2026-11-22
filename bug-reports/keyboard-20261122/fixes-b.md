> 归档测试记录（2026-11-22）。主机路径已脱敏；截图、原始日志和测试产物保留在本机，未随仓库发布。最终结论以 [README](README.md) 和 C 报告第三轮结论为准。

# B 修复报告

2026-11-22，Mac 本地；基线 791b522。修改保留在工作区，未提交或推送。A 的黑盒发现、用户后续指定 OpenAI API Key/扩充模型及模块解耦要求均纳入本轮。密钥未写入报告、源码或日志。

## 修复与根因

| 项目 | 根因 | 修复 |
|---|---|---|
| A-01 请求中取消不可用 | 按钮被 disabled，Esc 带 `!explaining` 条件，前后端无取消传递 | 取消按钮保持可用，Esc 关闭并取消；前端 AbortController、后端连接关闭传至模型请求；旧响应/旧 finally 不影响立即发起的新请求 |
| A-02 ChatGPT 登录入口缺失 | OpenAI 仅 API Key 通道 | 新增独立 ChatGPT 厂商，复用正规本机 Codex CLI 登录；不读取或复制 OAuth token；临时只读会话、禁 shell 工具、无持久会话。按用户后续要求，最终验收配置是 OpenAI API Key，不是该备用通道 |
| A-03 Vim 启动失败 | PTY 固定启动 nvim，与检测到的 auto→vim 不一致；本机 node-pty spawn-helper 权限为0644 | PTY 使用实时 editorStatus 的 active.command；错误与终端状态显示真实编辑器；postinstall 定点修复 macOS helper 执行权限，本机已执行；探测期间缓存首批键盘/resize 消息，避免丢输入 |
| A-04 面板遮盖主区 | 老实现刻意使用覆盖层，窄屏还残留五列网格规则 | 展开面板时主区预留对应宽度，顶部标签和代码随之重排；删旧网格、取消940px硬性最小宽度、面板及分隔条宽度限制到40vw。最终视觉效果待C独立回归 |
| 长 OpenAI Key 保存截断 | macOS security 密码提示读取仅128字节，退出0仍可能截断 | 改用 `security -i` 命令模式、完整命令经stdin传入，秘密不进argv；保存后完整读回核对。不使用会触发额外ACL授权的Python框架方案 |
| Node22模型请求无法联网 | 原生fetch不读取桌面HTTP(S)_PROXY | 模型传输使用undici环境代理分发器，回环地址保持直连；不改全局Node环境 |
| 模型列表不足 | 仅少量硬编码预设 | OpenAI默认19个账户可见文本型号；增加“刷新 OpenAI 可用模型”，由已保存Key实时请求官方/v1/models，当前得到39个适配文本型号；过滤audio/realtime/image/pro/live等不适配当前chat-completions通道者。目录可见不等于项目一定有调用额度 |
| 测试可移植性 | 默认8899被占用；Mac /var为/private/var别名；BSD cat不支持--version | e2e端口可配置；readSource先规范根目录realpath仍保留越界校验；测试专用编辑器桩支持版本探测和PTY回显 |

## 配置、数据、能力、策略边界

- `src/llm/providers.js`：厂商、端点及模型目录的纯配置数据。
- `src/llm-config.js`：用户选项验证与持久化，不承担模型目录查询。
- `src/keychain.js`：系统密钥数据读写及完整性校验；前端无法读回密钥。
- `src/llm/models.js`：查询账户可用型号的能力；`src/chatgpt.js`：本机已登录模型执行能力。
- `src/policies/llm.js`：请求超时预算及模型接口兼容过滤策略。
- `src/http/model-fetch.js`：模型网络传输与桌面代理适配。
- `public/llm-settings.js`：只消费配置/目录元数据并提交用户选择，密钥只作为新输入提交。
- 键盘取消保留在交互生命周期层，后端使用标准AbortSignal；未开始另一个插件项目，未全仓重构。

## 验证结果

1. `node scripts/check-syntax.mjs`：84个JS文件语法通过。
2. `CODE_READER_TEST_PORT=18799 CODE_READER_TEST_LLM_PORT=18899 node scripts/e2e.mjs`：**174项通过，0失败**。日志 `e2e-b.log`。新增检查确认浏览器请求断开后，后端真正中止模型传输；PTY首包与双向转发通过。
3. `node scripts/question-regression.mjs`：真实前端问题生命周期在受控异步响应下验证取消、立即重提、迟到旧响应和新结果保留，通过。
4. `git diff --check`：通过；前端三个预构建包已重建，仅终端包有实际差异。
5. macOS钥匙串：522字节临时Key完整往返、含引号/反斜线的Key往返均通过，临时条目已删除。主代理已重存用户真实Key并完整比对通过。
6. 真实OpenAI网络：用户Key调用 `gpt-6.2-sol` chat/completions HTTP200，简短JSON回答约2.658秒；完整应用源码解释（overview/details/summary/evidence等结构）约6.258秒，解析通过。均为单次样本，不代表p95；没有伪造模型结果。
7. 真实ChatGPT登录备用通道：Codex CLI `gpt-6.1-sol` 返回有效JSON，约12.864秒。
8. 真实本机Vim PTY：`/usr/bin/vim --version`退出0；运行服务WebSocket返回 `ready: vim` 并产生终端输出。
9. 运行服务配置确认：OpenAI / gpt-6.2-sol / configured=true / keySource=keychain；实际模型列表39项并包含6.2-sol。

## 运行与交接

服务已在 `http://127.0.0.1:8766` 重启加载最终代码，PID **98728**，Node22；日志 `server-b.log`。最终模型配置为OpenAI/gpt-6.2-sol，API Key仅在系统钥匙串。原Kimi Key未删除。A新增的USB知识库目录和关闭联网选择保留。

B未使用GUI、没有抢占A窗口；现在GUI控制权明确交回主代理供C使用。C应刷新页面加载新版静态资源。

C优先回归：

1. 从窗口提示纯键盘进入设置，选择OpenAI/6.2-sol，刷新型号、保存并读回；无需再次输入或显示密钥。
2. 发出解释后按Esc/取消，立即再问，确认无迟到回答/错误抢焦点；成功回答检查规范来源及代码证据。
3. Ctrl+Alt+2真实Vim启动、输入/退出/重启、与内置编辑器切换；不要对Linux文件执行`:w`。
4. 树与解释窗开关、双侧同时可见、键盘分隔条、窄宽窗口与100%/非100%缩放，确认主区标签/源码可见。
5. 补A未覆盖项，特别gd、Ctrl-o/i、阅读路径激活、两字符定位、多仓库/分支/更新、提交详情、主题、动画和规范到代码闭环。Git写操作只在隔离测试仓。

## 限制

B的CLI/API/受控异步测试不能替代C的真实纯键盘视觉验收；未宣称全功能通过。Vimium扩展冲突与CUA自动审批/AX阻塞仍是独立环境事项。ChatGPT CLI备用适配依赖已安装并登录的Codex及CLI选项兼容性；未登录时明确错误，不自动替换用户模型。OpenAI默认预设与动态列表按当前账户可见性维护，未知/自定义模型仍可能因接口或权限失败。

参考：[OpenAI模型目录](https://developers.openai.com/api/docs/models)、[模型列表API](https://developers.openai.com/api/reference/resources/models/methods/list)、[Codex非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)。
