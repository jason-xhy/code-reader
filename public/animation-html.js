// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 动画 HTML 模板与本项目运行时强绑定
// grill: 成品检索=skill 库无动画 HTML 生成成品; 输入固定=受限动画 JSON 与运行时源码; 步骤机械=转义+模板拼接; 判读固定=预览/离线两种模式; 失效场景=构造不出（仅本应用）

function escapeScriptContent(text) {
  return String(text || '').replace(/<\/script/gi, '<\\/script');
}

function escapeAttribute(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const BASE_CSS = `
:root{color-scheme:dark;--bg:#0b1020;--panel:#131a2e;--line:#26314f;--fg:#e8edfa;--muted:#8d9bbd;--accent:#5aa2ff}
*{box-sizing:border-box}
body{margin:0;height:100vh;overflow:hidden;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;display:flex;flex-direction:column}
.anim-header{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--panel)}
.anim-title{font-weight:600;font-size:15px}
.anim-sub{color:var(--muted);font-size:12px}
.anim-stage{position:relative;flex:1;min-height:0}
#animation-root{position:absolute;inset:0}
#animation-root canvas{display:block;width:100%;height:100%}
.anim-fallback{position:absolute;inset:0;display:grid;place-content:center;gap:8px;padding:24px;text-align:center;color:var(--muted);background:var(--bg)}
.anim-fallback[hidden]{display:none!important}
.anim-fallback strong{color:var(--fg);font-size:16px}
.anim-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 14px;border-top:1px solid var(--line);background:var(--panel)}
.anim-controls button{background:#1c2742;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit}
.anim-controls button:hover{border-color:var(--accent)}
.anim-controls button:disabled{opacity:.4;cursor:default}
.anim-controls select{background:#1c2742;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 8px;font:inherit}
.anim-progress{flex:1;min-width:120px;accent-color:var(--accent)}
.anim-step-label{color:var(--muted);font-size:12px;min-width:72px;text-align:right}
.anim-steps{max-height:130px;overflow:auto;padding:6px 14px 10px;border-top:1px solid var(--line);background:#0e1426}
.anim-steps ol{margin:0;padding-left:20px}
.anim-steps li{padding:2px 4px;color:var(--muted);cursor:pointer;border-radius:4px}
.anim-steps li:hover{color:var(--fg)}
.anim-steps li.active{color:var(--fg);background:#1c2742}
@media (prefers-reduced-motion: reduce){.anim-steps li{transition:none}}
`;

export function createAnimationHtml(data, runtimeSource, { runtimeUrl = '' } = {}) {
  const title = escapeHtml(data?.title || '代码执行动画');
  const summary = escapeHtml(data?.summary || '');
  const json = escapeScriptContent(JSON.stringify(data ?? {}));
  const runtimeTag = runtimeUrl
    ? `<script src="${escapeAttribute(runtimeUrl)}"></script>`
    : `<script>\n${escapeScriptContent(runtimeSource)}\n</script>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<header class="anim-header">
  <span class="anim-title">${title}</span>
  ${summary ? `<span class="anim-sub">${summary}</span>` : ''}
</header>
<main class="anim-stage">
  <div id="animation-root"></div>
  <div id="animation-fallback" class="anim-fallback" hidden>
    <strong>无法使用 WebGL 渲染 3D 动画</strong>
    <span>下方步骤列表仍可阅读完整执行过程。</span>
  </div>
</main>
<script id="animation-data" type="application/json">${json}</script>
${runtimeTag}
</body>
</html>
`;
}
