> 归档测试记录（2026-11-22）。主机路径已脱敏；截图、原始日志和测试产物保留在本机，未随仓库发布。最终结论以 [README](README.md) 和 C 报告第三轮结论为准。

# C 独立回归与修复报告

2026-11-22，Mac Chrome 无痕，纯键盘应用交互，无鼠标/DOM触发功能。C可读实现修复，A的源码盲测限制继续保留于A轮。当前不能宣称全功能通过。

## 已实际观察

- 刷新页面加载新版，本地编辑器标签已由nvim改为本地Vim。
- Ctrl+Alt+B展开树，主区横向预留树宽，截图中顶部文件名、工作区标签及源码不再藏在树下；后补200%缩放等效窄视口，发现中心工具栏挤占源码，已用reader容器查询修复并复验。
- Ctrl+Alt+K按可见cl进入模型设置，显示OpenAI/GPT-6.2 Sol、Key已存钥匙串。Tab三次到刷新，Enter查询成功显示39个文本模型，Shift+Tab/Enter保存成功。
- 发现刷新期间disabled使焦点落到HTML：已修为aria-busy与防重入，保持原焦点，无强制抢焦点。
- 内置Vim \c打开提问，输入提交，取消按钮保持可用。Esc后立即\c能重新提问，旧问题文本已清空、输入可用。Shift+Enter多行成功。真实gpt-6.2-sol回答完成，代码证据包含xhci-mem.c:515-532、xhci-dbg.c:16-19、xhci.h:403-409，清楚标记规范未核实，没有编造章节。
- 同时发现本地资料严重偏题：xHCI问题命中中文GFP/SCSI/GDB/CPU-freq资料，未把USB目录排前。模型诚实报告资料不相关；检索已修，见下。
- Ctrl+Alt+2启动真实/usr/bin/vim，终端显示vim，键盘执行 :echo "C_KEYBOARD_OK" 成功显示，证据c-vim-keyboard.png。未写Linux文件。
- Ctrl+Alt+1返回内置编辑器，gd从xhci-dbg.c:16跳到xhci.h:2002成功；Ctrl-o最初失败且误插入换行；根因是Mac CodeMirror默认Ctrl-o先执行insertNewline，同时应用异步回调被当真值。新增NORMAL最高优先级映射并修空栈回退后，最终纯键盘gd→xhci-mem.c:524，Ctrl-o→xhci-dbg.c:16，Ctrl-i→xhci-mem.c:524全部通过，无额外换行。

## C修复

1. 模型刷新不disable当前焦点控件，使用aria-busy和独立防重入状态，保留纯键盘连续操作。
2. server.js对已断开的响应停止回错误，不将正常取消记为500堆栈。
3. Ctrl-o/i等待应用异步跳栈结果，再按false结果回退Vim内部jumplist，错误显示到状态栏。
4. 文档检索将源码路径/符号作为独立sourceQuery，拆分下划线标识符，降低通用CJK提问词权重，提高技术领域词权重，优先用户指定目录，去重嵌套目录重复块。策略独立在src/policies/documentation.js，数据/索引/执行仍在docs.js，调用层只传上下文。

## 检索证据

真实Linux语料，usb_submit_urb查询前两项命中usb/URB.rst的“How to submit an URB?”与“Basic concept or What is an URB?”，随后写USB驱动、错误码和USB Core API；不再被中文通用词挤走。xHCI查询命中USB调试、xHCI电源管理等，不能据此声称本地库含xHCI槽状态官方规范。

新增scripts/docs-regression.mjs用隔离临时目录构造USB英文规范与高频中文无关资料，确认源领域相关规范优先及嵌套目录不重复，通过。

## 环境限制

CUA再次出现input_required did not complete within 10 MRTR rounds；下一只读调用设置15秒超时仍实际挂起290.924秒后运行时重置、app未定义。该段不计应用延迟。恢复后已补完核心规范闭环与布局/跳转；下列未完成项目仍保留。


## 修复后的真实规范闭环

先以`:e drivers/usb/core/urb.c`打开实现，`/^int usb_submit_urb`定位第367行，`\c`输入URB前置校验、所有权、回调与规范依据问题。真实OpenAI/gpt-6.2-sol完成回答，界面列出：

- `usb/URB.rst`：How to submit an URB?、How to get an URB?、Basic concept；`usb/writing_usb_driver.rst`：Device operation。
- 代码证据：urb.c:376-397、402-434、436-499、506-533、543-587。
- 区分Linux实现校验与USB总线规范，区分提交接受和异步完成、在途使用约束与对象寿命；资料无法证明的下层回调先后和引用计数行为明确标记未证实。

证据：`c-spec-code-answer.txt`和`c-spec-code-answer.png`。这证明本地规范→实现→有出处解释的主要流程已完成；不等于对模型每条推断的正式规范审计。

## 布局、焦点与延迟

200%浏览器缩放等效约830CSS像素宽，双侧面板同时开启。发现剩余中心宽度较小导致原工具栏换行占据过多高度；修复为reader容器查询、文件信息独立行、工具栏/模式栏横向可滚。复验源码区可见、不被侧栏覆盖；窄中心仍需横向滚动访问长工具栏，这是明确的布局折衷。证据`c-narrow-200.png`。Shift+Tab聚焦解释栏分隔条，Right使宽度372→360、Left恢复，键盘调整通过。结束恢复100%缩放。

普通按键工具回合多为0.8–1.7秒、设置刷新约两个观察回合完成，不能分离CUA调度和截图开销；没有获得应用内部按键毫秒值、p95或搜索稳定统计。规范问答批次工具报错但实际上已执行，随后读取又阻塞290秒，故该次模型耗时不可归因。B的独立API样本2.658秒/完整结构化6.258秒可参考，不能替代GUI总体延迟。

## 最终状态与剩余覆盖

| 项目 | 最终状态 |
|---|---|
| A-01 LLM取消/Esc | 已修，C真实键盘取消→立即重新提问及成功新回答通过；B受控竞态与后端断连检查通过 |
| A-02 ChatGPT/模型配置 | 用户后续指定OpenAI Key，C以OpenAI/gpt-6.2-sol验收，设置刷新39型号并保存通过；Codex登录备用仅B CLI验证 |
| A-03 本地Vim | 已修，C真实终端键盘echo通过，有截图；未写源文件 |
| A-04 侧栏遮盖 | 已修，宽窗口及200%双栏重排通过；窄中心工具栏可横滚，物理窗口任意尺寸未穷尽 |
| C-01 模型刷新丢焦点 | 已修为aria-busy防重入；第二轮已再次GUI刷新通过，焦点保持原按钮 |
| C-02 规范检索偏题 | 已修，隔离测试/真实语料/真实GUI规范问答通过 |
| C-03 Ctrl-o/i错误 | 已修，真实跨文件前后跳转通过 |
| C-04 正常取消错误日志 | 已修，e2e客户端断连174/174通过；未把正常取消当模型故障 |
| E-01 Vimium冲突 | 无痕隔离后通过，普通扩展窗口仍有兼容风险 |
| E-02 CUA长阻塞 | 仍存在，自动化工具问题；不算应用性能 |

第一轮结束时的未测范围已继续执行第二轮，新增结果见后文。最终剩余范围：远程仓库克隆/原生目录浏览入口、工作区关闭的GUI交互、FAQ删除/过期重问的GUI分支、所有Vim组合与任意物理窗口排列；离线导出已实际触发保存面板但落盘受CUA连续超时阻塞。不能把这些算通过，也不能以API替代纯键盘验收。主要功能类别已有真实键盘证据，但当前不宣称所有分支与性能指标达标。

当前服务PID2942，http://127.0.0.1:8766，最终源码已加载（前端重建/刷新），OpenAI/gpt-6.2-sol，Key只存系统钥匙串。工作区未提交未推送。C没有更改Linux文件磁盘内容，内置误编辑经重新加载源文件清除，未执行:w。

## 第一轮阶段检查（最终值见文末）

- `node scripts/check-syntax.mjs`：86个JS文件通过（第一轮阶段值；最终90个）。
- `CODE_READER_TEST_PORT=18799 CODE_READER_TEST_LLM_PORT=18899 node scripts/e2e.mjs`：174项通过、0失败，证据e2e-c.log。最后额外的前端Ctrl-o优先级修复由真实键盘回归和重建验证；它之后未重复整套后端e2e。
- `node scripts/question-regression.mjs`：取消、立即重提、旧回答迟到不覆盖新结果通过。
- `node scripts/docs-regression.mjs`：领域相关性、嵌套目录去重通过。
- `git diff --check`通过；三个vendor包已重建。
- CUA已结束并交回控制权，当前100%缩放，无源码写盘操作。

## C第二轮补测（首轮后的新增证据）

继续使用纯键盘，CUA input_required之后用js_reset/getApp恢复，避免只读调用长挂起。

- 模型刷新焦点：再次刷新39型号，完成后焦点明确仍在“刷新OpenAI可用模型”按钮，C-01已独立GUI复验通过。
- 内置主题：Vim One Dark、Gruvbox、Nord、Dracula、Tokyo Night、Catppuccin Mocha、Solarized Dark、Monokai均已逐项用下拉方向键切换；本地主题也已观察。内置暗色显示正常。本地主题白底与浅色UI文字的低对比另列C08，已在尾项修复。
- 阅读路径：HINT标签ao返回xhci-dbg.c:16；两字符Ctrl+Alt+F输入st，17个可见匹配标签，按h精确到第17行第55列，均通过。
- 新建隔离fixture：fixtures/keyboard-fixture，main/topic分支及本地bare origin，donor预置一个远程提交。通过工作区＋→绝对路径键盘打开，保留Linux为第一仓，fixture为第二仓。
- 捕获多仓新缺陷C-05：新仓未选文件仍显示Linux xhci阅读路径。修复为会话快照保存/恢复路径；新仓清空、同仓刷新保留、关闭所有仓清空。GUI实际Linux→fixture→Linux→fixture往返，各自只显示xhci或main.c路径，已通过。
- 分支：fixture main→topic→main纯键盘成功，有“已切换到”反馈。更新按钮完成fetch+快进，界面出现REMOTE.txt且文件数2→3，提示“已从origin/main快进1个提交”。没有修改Linux分支。
- 提交详情：Ctrl+Alt+I→Enter打开Document addition contract；Tab/Space展开diff，显示main.c +1 -0及新增注释；Esc退出。深层演变按钮Enter成功切换git log -L模式并列两次提交。
- Vim代表功能：qa录制j、q结束、@a回放，光标从1到3；ma设标记，G到9:1，`a回3:1；"ayy显示复制1行到a，"ap出现重复return行，u撤销后恢复。均仅内存，未执行:w。


### 第二轮动画与持久化补测结果

五个提问预设逐项用Shift+Tab定位、Space填入问题并回到输入框，全部通过。真实提交3D预设后，gpt-6.2-sol生成add(2,3)的3节点/3步骤动画，明确引用fixture的docs/SPEC.md加法契约，说明有符号溢出不能承诺回绕结果。

发现并修复C-06：3D预设用程序赋值没有触发input，复选框仍未勾选，等待文字只说“正在解释”但后端实际生成动画。现预设和提交识别均同步动画意图；专项回归确认未触发input事件也发送animate=true，等待标识含3D。

发现并修复C-07：动画初始焦点在关闭按钮，提示“空格播放”但空格直接关闭，方向键也未送入iframe。现父层将规定的三个键解码成previous/next/toggle，发往特定animationFrame.contentWindow；子层仅接收window.parent且固定类型消息，执行白名单动作。键盘解码独立public/core/animation-keys.js，DOM传输和渲染状态分开。修复后真实GUI Right使1/3→2/3；Space令播放按钮变暂停、画面显示三个3D节点，截图c-animation-playing.png。

刷新后FAQ原本只显示文字，已保存的完整动画没有回放入口；已补条件显示“查看已保存的3D动画”。真实刷新、展开FAQ、键盘回放成功，避免依赖重新请求模型才能看旧动画。

### 离线导出的具体受阻与补证

Shift+Tab到“下载离线HTML”并Enter，已打开macOS存储面板，文件名c-animation-offline.html已输入。Cmd+Shift+G输入报告目录后CUA连续15秒超时，重新getApp也连续超时。最后一次恢复仍失败，故停止GUI重试，未观察到目标文件，不能报告GUI导出通过；Chrome可能仍停在存储/前往目录面板。

另用应用正常FAQ接口取出持久化动画，调用同一createAnimationHtml模板生成c-animation-offline-api.html作为补证：538091字节，3节点3步骤，运行时内嵌、无外部script源，所有内嵌JavaScript语法解析通过。该文件是API/模板补证，明确不是浏览器下载成功产物，尚未独立离线浏览器运行。

### 最终清理、状态和检查（第二轮后）

由于GUI存储面板受阻，通过正常workspace API激活Linux并关闭fixture会话，服务器持久工作区只剩Linux；fixture目录保留作证据，git status干净。该清理不算GUI关闭测试。浏览器当前画面可能仍旧，不能宣称已恢复原主题：当前浏览器主题为Gruvbox，原为local/未命名，存储面板可能仍打开。100%缩放在第一轮末已恢复且第二轮未改。

为防切仓在飞读请求污染同名文件，selectFile增加repository对象身份校验：旧仓main.c响应不能写新仓main.c或附加旧路径。scripts/workspace-regression.mjs对实际函数构造受控乱序回复、会话路径快照隔离，均通过。

第二轮检查：88个JS语法通过（C08尾项完成后最终90个）；e2e-c-final.log为174/174、0失败；question-regression（含3D意图）、docs-regression、workspace-regression全部通过；git diff --check通过。vendor编辑器、终端、动画均重建。服务PID2942仍在线，OpenAI/gpt-6.2-sol/configured=true/keySource=keychain，最后正常API确认工作区仅Linux。源码未提交未推送。

第二轮最终状态：C-01、C-05、C-06、C-07已修并有上述GUI或专项复验；C-05同时有跨仓纯键盘往返及受控迟到回归。离线GUI导出是明确环境受阻。既有local主题的浅底/浅文字低对比已在C08尾项修复，见文末；未修改用户本地Vim配色文件。


## C08尾项：本地主题应用外壳可读性兜底

根因：本机Vim为未命名浅色profile，Normal白底黑字，映射panel为#f0f0f0；应用外壳仍包含固定的浅色标题/深色按钮，因此直接把浅色编辑器palette用于shell会导致近白文字在近白面板上不可读。不是用户故意把Vim正文配置成低对比：原Vim正文黑白对比正常，问题来自应用外壳映射。

最小修复：新增public/core/theme-policy.js独立亮度/对比策略；仅对local主题的shell校验。亮色或正文对比不足的shell复用现有OneDark外壳palette；编辑器的白底、黑字、语法高亮保持原样，可读暗色local及其他内置主题不变。没有更改任何用户Vim配置，也没有重构主题系统。

真实API读取当前profile计算证据：shell背景#ffffff、panel#f0f0f0、正文#000000；固定品牌前景#f2f6fb对panel对比从1.0501提升到14.1849；兜底正文对panel为7.2220。编辑器background仍为#ffffff。证据c-local-theme-contrast.json。scripts/theme-regression.mjs验证该场景、编辑器palette不被变更、可读暗色保留和无效色值兜底，通过。

最终统一检查：**90个JS文件语法通过**；vendor构建通过；question（含3D意图）/docs/workspace/theme专项全部通过；diff-check通过。e2e最新整套为e2e-c-final.log **174/174、0失败**，完成于第二轮所有业务修复之后、C08纯前端shell兜底之前；C08追加相关主题测试及构建，不重复无关后端e2e。

C08状态是“已修、数值/专项验证通过，GUI待视觉复验”：CUA保存面板持续受阻，本尾项按要求没有再做GUI。服务PID2942提供最终静态文件，现有浏览器未刷新C08；API确认OpenAI/gpt-6.2-sol/keychain、持久工作区仅Linux。浏览器之前的Gruvbox选择和可能仍打开的存储面板状态未被谎称恢复。

## C第三轮续测计划

本节之后是最新最终结果；前面的受阻、待GUI复验状态仅为当时阶段记录，已由下列第三轮结论取代。

继续补完明确剩余分支：先检查8766服务和持久工作区，恢复CUA并处理遗留存储面板；优先真实GUI保存离线动画并离线打开回放。随后刷新本地主题验证C08可读性、远程克隆入口（优先已有本地bare origin）、原生目录浏览、FAQ展开/删除/过期重问、工作区关闭。所有应用操作继续纯键盘，截图/AX只作观察。逐步落盘结果，发现缺陷直接修复并相关验证；结束保留Linux和钥匙串OpenAI配置、尽可能恢复原local主题。API补证继续与GUI证据区分。

### 第三轮阶段结果

- 遗留保存面板在恢复时已不在；从持久FAQ重新打开动画，下载→默认Documents保存成功。Chrome下载记录显示525KB完成，实际文件为 <local-path>`add(2, 3)`：从两个输入到一个返回值.html，538091字节。已将同字节副本保存在c-animation-offline-gui.html，SHA256 e20c8e5e9313e410643c2afeab612aee2818145272755b047689ef36e780b2fd。
- 键盘新标签用file://打开真实GUI导出文件，Right显示2/3、Space使播放按钮变暂停、3D画面正常，证据c-offline-gui-playback.png。文件自包含无外部script；没有全局断网，以本地file origin运行+静态无远程运行时依赖作为离线验证方式。此结果替代上一轮E03“导出受阻”最终结论。
- 刷新加载最新C08，选择本地/未命名主题，代码树/标题/模式栏为可读暗色外壳，源码保留本地白底高亮，可同时辨认；c-local-theme-fixed.png。C08视觉复验通过。
- “浏览…”入口实际使用应用自带目录列表而不是OS原生选择器。键盘指定fixture路径→浏览→Enter进入docs→选择目录，成功打开对应Git根目录，子目录解析通过。
- 在隔离fixture将return a+b改为a+b+0并仅本地提交，重载后FAQ显示“已过期：代码内容已变化”；键盘“按当前代码重问”预填原问题成功并真实提交，显示正在生成3D。后续删除及克隆继续执行。

### 第三轮最终结果（最终状态）

- FAQ过期重问真实完成：返回解释引用a+b+0，FAQ HEAD更新为96be26d，过期标记消失。随后键盘删除成功，FAQ区消失。为复验删除焦点，新发一条真实短问题，完成后再次删除；焦点回分析解释容器（有可见焦点框），没有落HTML。只操作隔离fixture的测试FAQ。
- 远程克隆：无效not-a-repository被明确拒绝，显示仅支持HTTPS/SSH/Git/file/scp；file://本地bare origin成功克隆并列出3文件；另以真实网络克隆https://github.com/octocat/Hello-World.git成功，键盘打开README显示Hello World!，证据c-https-clone.png。未使用凭据、未推送。没有穷尽所有私有鉴权/SSH协议排列。
- 工作区关闭：键盘关闭Hello-World、origin、fixture后保留Linux，活动仓关闭会恢复Linux源码与原阅读路径。新增非活动关闭焦点缺陷已修，并用再次打开fixture→切Linux→关闭非活动fixture复验：AX焦点落Linux页签按钮，非HTML。
- local主题在刷新后退回OneDark的初始化竞态已修：populateThemes在profile尚未加载时保留local偏好，profile到达后正常选中local。GUI重新选择local→Cmd+R→等待Linux恢复，仍是本地/未命名，源码白底和暗色外壳可读。最终c-final-linux-local.png同时保存Linux、local主题和已关闭测试页签状态。

### 第三轮新增修复及边界

C-09：删除FAQ使被移除按钮失焦，恢复到剩余FAQ或解释区；捕获focus intent、repository对象、文件身份，不抢夺后来用户焦点。fetchFaq同时校验repository对象、file、controller，delete完成后跨仓则不刷新新仓。受控同名文件跨仓迟到响应专项通过。

C-10：关闭非活动工作区重绘页签使焦点落body。仅原来关闭按钮持有焦点且用户intent未变时，恢复当前活动页签按钮。活动仓关闭既有源码焦点行为保留。真实键盘复验通过。

C-11：已保存local主题在profile异步加载前被populateThemes覆盖为one-dark。只延后尚未解析的local偏好降级；profile确实不可用时既有loadEditorProfile降级逻辑保留。theme-regression增加实际populateThemes的先无profile→后有profile状态测试，通过；真实刷新GUI通过。

这些改动分别留在FAQ能力、工作区能力、主题选择初始化边界；主题可读性策略仍独立theme-policy.js，没有改用户Vim配色或开发后续插件。

### 最终检查与交接

最终90个JS语法通过；question-regression（取消、3D意图、同路径跨仓FAQ迟到回复）、docs-regression、workspace-regression、theme-regression全部通过；git diff --check通过。第三轮完整API e2e使用隔离端口18799/18899，e2e-c-third-round.log为RESULT PASS checks=174 failures=0。默认8899已有其他本机服务，第一次起跑失败后改隔离端口，没有停止该服务。e2e结束后追加的纯前端主题偏好修复由相关theme专项及GUI刷新验证覆盖。

最终服务PID2942保持在线并提供最终静态文件。正常API确认工作区仅<linux-repository>，GUI同样仅Linux，原local主题已恢复且刷新保留；没有系统保存面板残留。OpenAI/gpt-6.2-sol沿用钥匙串配置，测试未输出key。源码未提交未推送，fixture本地提交与克隆目录保留作证据。

本次是功能分支和代表性Vim语义覆盖，不宣称穷尽Vim所有宏/寄存器排列、全部Git鉴权协议或全部LLM模型。GUI动作时间含CUA控制开销，不能当毫秒级键盘延迟；真实模型等待和CUA阻塞已分别记录。离线回放没有全局断网，证据为实际GUI产物file-origin运行及无外部script/stylesheet依赖。当前明确要求补测的离线导出、C08视觉、FAQ过期/重问/删除、目录浏览、工作区关闭、公开HTTPS克隆已完成。
