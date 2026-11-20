# 2026-11-20 grill：三症状实证与修复（已闭环）

用户实测否决「六期 87/87 PASS」的结论，指出三条：

1. Ctrl+Alt+B 打开代码树后，j/k 仍在代码窗口导航；Ctrl+Alt+I 解释窗口同样。
2. 工作区搜索无法搜 `xhci*.c` 这类通配符文件名。
3. `gr` 打开引用列表后，j/k 仍在代码窗口导航。

## 结论

- ② 已实现：`src/search/query.js` glob（`*`/`?`，`xhci*.c` 命中 23 个文件），e2e 172 项含 3 条 glob。
- ①③ 在 js-pc 的静态/真按键探针下不复现；但**补测「源码加载在飞」时序后复现真实竞态**：

  | 场景（fetch 延迟 700ms） | 修复前 | 修复后 |
  |---|---|---|
  | 点文件行 → Ctrl+Alt+I | 4098ms 焦点被 CM6 `view.focus()` 抢回编辑器，之后 j/k 落代码窗 | 焦点留在 `.insights`（1000ms 由 renderHistory 接走，仍在窗口内） |
  | 点文件行 → 悬停打开树 | 6097ms 焦点被抢，hover 无重试机制 | 焦点留在 `#file-tree` |
  | 点文件行 → Ctrl+Alt+B | 8104ms 被抢；8128ms 靠 `requestTreeFocus` 4s 重试才抢回 | 无抢焦点事件 |

- 根因：`selectFile(focus:'always')` 在源码到达后无条件 `editor.focus()`；`sidePanelOwnsFocus()` 只在恢复（`auto`）路径生效，且不识别 quickpick/对话框。加载期间用户打开的窗口会被迟到内容抢走。

## 修复（焦点意图纪元）

- `core/state.js`：`noteFocusIntent()` / `getFocusIntent()`。
- 窗口/弹层拿到焦点即递增：`focusTree`、`focusExplanationPanel`、`openQuestion`、`openWorkspaceSearch`、gd/gr quickpick、打开仓库/文档/LLM/编辑器环境/nvim 快捷键对话框、历史菜单/树右键菜单。
- `selectFile`：开始加载时记录纪元，完成时纪元未变才接管编辑器焦点（`always` 与 `auto` 两条路径都按此判定）。
- 树行激活/过滤框回车：同样按纪元决定是否 `editor.focus()`，避免二次抢焦点。

## 验证

- 竞态探针（CDP 1280×720，真实按键）：A/B/C 三条路径修复后焦点全部保持。
- `npm run check` 77 文件；`npm run e2e` **172/172 PASS**；`test:browser` **93/93 PASS**（新增 2 条「加载在飞」回归：解释窗口、悬停文件树，均断言加载完成后焦点仍在窗口且 j 不落代码窗）。
- 负对照：同套件在 HEAD（58b5a49）上 87 项 1 项失败（目录行焦点用例，受服务端 lastFile 影响的环境敏感用例）；恢复 lastFile 后新套件 93/93 全绿。