import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { animationCommandForKey } from '../public/core/animation-keys.js';

const STEP_SECONDS = 5;
const SLOT = [-3.15, -1.05, 1.05, 3.15];
const COLORS = { pending: 0x28628f, missed: 0xa13d50, success: 0x248267, processing: 0xb47b24, skipped: 0x9d4055, completed: 0x9d4055 };
const CSS = `
.xhci-player{height:100%;overflow:auto;display:flex;flex-direction:column;background:#0b1220;color:#e8f0ff;font:14px/1.6 system-ui}
.xhci-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;padding:10px 16px;border-bottom:1px solid #2a3c53;background:#131f30}
.xhci-toolbar label{font-size:12px;color:#a7bbd3}.xhci-player select,.xhci-player button{font:inherit;color:#e8f0ff;background:#21324b;border:1px solid #47627e;border-radius:5px;padding:5px 9px;cursor:pointer}
.xhci-player button:disabled{opacity:.45;cursor:default}.xhci-skip{padding:3px 10px;border:1px solid #54c8db;border-radius:4px;color:#70e1ef;font:600 15px ui-monospace,monospace}.xhci-skip[data-value=true]{color:#ffd174;border-color:#c58e31;background:#3e2c17}
.xhci-workbench{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.7fr) minmax(350px,1fr)}
.xhci-visual{display:flex;flex-direction:column;min-height:0;border-right:1px solid #2a3c53}.xhci-canvas{position:relative;flex:1;min-height:320px}.xhci-canvas canvas{display:block;width:100%;height:100%}
.xhci-webgl-fallback{position:absolute;inset:0;display:grid;place-content:center;text-align:center;background:#101c2b}.xhci-webgl-fallback[hidden]{display:none}
.xhci-snapshot{padding:8px 14px;background:#101c2b;border-top:1px solid #2a3c53}.xhci-event{font-family:ui-monospace,monospace;color:#ffd174;overflow-wrap:anywhere}.xhci-head{color:#70e1ef}.xhci-queue{display:flex;gap:6px;align-items:center;min-height:34px}.xhci-queue span{border:1px solid #437999;background:#18374c;padding:1px 12px;border-radius:4px;font:600 15px ui-monospace,monospace}.xhci-queue small{color:#91a7bd}
.xhci-result-table{width:100%;border-collapse:collapse;margin:5px 0;font:13px ui-monospace,monospace;text-align:center}.xhci-result-table th,.xhci-result-table td{border:1px solid #2a3c53;padding:4px}.xhci-result-table .failed{color:#ff91a1}.xhci-result-table .success{color:#74e4bd}.xhci-formula{min-height:30px;color:#ffe09c;font:600 14px/1.7 ui-monospace,monospace;overflow-wrap:anywhere}.xhci-pending{color:#a4b6ca;font-size:12px}
.xhci-evidence{overflow:auto;padding:14px 18px}.xhci-evidence h2{font-size:19px;line-height:1.5;margin:0 0 9px}.xhci-evidence h3{font-size:14px;margin:16px 0 6px;color:#86d9f0}.xhci-evidence p{margin:7px 0}.xhci-evidence pre{margin:6px 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;padding:9px;background:#070e18;border-left:3px solid #4c9dca;color:#d3e5f8;font:12px/1.6 ui-monospace,monospace}.xhci-code-location{font:12px ui-monospace,monospace;color:#8ec6e6;overflow-wrap:anywhere}.xhci-spec-source{font-size:12px;color:#9eb5cc;overflow-wrap:anywhere}.xhci-rule{border-left:3px solid #e2ad51;padding:6px 10px;background:#302719;color:#ffe0a6}.xhci-assumptions{font-size:12px;color:#a4b6ca}
.xhci-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:9px 14px;background:#131f30;border-top:1px solid #2a3c53}.xhci-progress{flex:1;min-width:100px;accent-color:#e5bd65}.xhci-counter{min-width:60px}.xhci-step-list{display:flex;gap:5px;padding:7px 14px;background:#0e1928;border-top:1px solid #2a3c53;overflow-x:auto;flex-shrink:0}.xhci-step-list button{padding:2px 8px;font-size:12px;white-space:nowrap}.xhci-step-list .active{border-color:#ffd174;color:#ffd174;background:#443117}.xhci-legend{font-size:12px;color:#9ab4cd;padding:0 14px 5px}.xhci-legend b{font-weight:500;margin-right:12px}
@media(max-width:900px){.xhci-player{display:block}.xhci-workbench{display:flex;flex-direction:column}.xhci-visual{border-right:0}.xhci-canvas{height:390px;flex:none}.xhci-evidence{overflow:visible}.xhci-controls{position:sticky;bottom:0;z-index:3}.xhci-result-table{font-size:12px}.xhci-toolbar select{max-width:100%}}
`;

function textureLabel(lines, { width = 320, height = 144, fill = '#152b42', color = '#eff7ff', large = false } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = fill; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 && large ? '700 60' : '500 40'}px "PingFang SC", "Microsoft YaHei", system-ui`;
    ctx.fillText(line, width / 2, height * (i + .5) / lines.length, width - 24);
  });
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function label(lines, width, height, options) {
  const texture = textureLabel(lines, options);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(width, height, 1); sprite.renderOrder = 5;
  return sprite;
}
function replaceLabel(sprite, lines, options) {
  sprite.material.map.dispose(); sprite.material.map = textureLabel(lines, options); sprite.material.needsUpdate = true;
}
function el(tag, className, text) {
  const node = document.createElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node;
}

export function mountXhciScene(root, data) {
  if (data.scene?.version !== 1 || !data.scene.scenarios?.length) throw Error('Unsupported xHCI scene');
  const style = document.createElement('style'); style.textContent = CSS; root.append(style);
  const host = el('div', 'xhci-player'); root.append(host);
  host.innerHTML = `<div class="xhci-toolbar"><label>场景 <select class="xhci-scenario" aria-label="选择独立场景"></select></label><strong class="xhci-skip"></strong><span class="xhci-head"></span></div>
  <div class="xhci-workbench"><div class="xhci-visual"><div class="xhci-canvas"><div class="xhci-webgl-fallback" hidden>WebGL 不可用 · 下方状态表仍按步骤更新</div></div>
  <div class="xhci-legend"><b style="color:#ffd174">黄色 ↓ 事件 TRB 指针</b><b style="color:#70e1ef">蓝色 → 软件 dequeue</b><b style="color:#ff91a1">红色 × 错过 / 失败</b><b style="color:#74e4bd">绿色 ✓ 按时成功</b></div>
  <div class="xhci-snapshot"><div class="xhci-event"></div><div class="xhci-pending"></div><div class="xhci-queue" aria-label="当前软件 TD 队列"></div>
  <table class="xhci-result-table"><thead><tr><th>帧状态 / 实际字节</th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead><tbody><tr class="xhci-frame-row"><th>status / actual_length</th></tr></tbody></table><div class="xhci-formula"></div></div></div>
  <aside class="xhci-evidence"><h2></h2><p class="xhci-detail"></p><p class="xhci-assumptions">演示假设：同一 URB 的 4 个等时帧；每 TD 一个 128 B TRB；无旧 error_mid_td；DMA 延迟和地址均非现场测量。C 事件指向末尾 TRB。</p><h3 class="xhci-code-heading"></h3><div class="xhci-code"></div><h3>规范约束 · 与当前步骤同步</h3><p class="xhci-rule"></p><p class="xhci-spec-source"></p><details><summary>查看所依据的规范原文</summary><pre class="xhci-spec-excerpt"></pre></details></aside></div>
  <div class="xhci-controls"><button data-command="previous">上一步 k / ←</button><button data-command="toggle">播放 Space</button><button data-command="next">下一步 j / →</button><input class="xhci-progress" aria-label="场景进度" type="range" min="0" step="0.01"><span class="xhci-counter"></span><select class="xhci-speed" aria-label="播放速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><button class="xhci-reset">复位视角</button></div><nav class="xhci-step-list" aria-label="场景步骤"></nav>`;
  const q = selector => host.querySelector(selector);
  for (const scenario of data.scene.scenarios) {
    const option = el('option', '', scenario.title); option.value = scenario.id; q('.xhci-scenario').append(option);
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scenario = data.scene.scenarios[0], index = -1, time = 0, playing = false, speed = 1, lastTick = 0;
  let renderer, camera, controls, scene, visualFrom = null, transitionAt = 0, raf = 0, currentSnapshot;
  const cards = new Map(), windows = [], destinations = new Map();
  let eventArrow, eventLabel, headArrow, clockLine, hardwareLabel;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { renderer = null; }
  if (renderer) {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1220);
    camera = new THREE.OrthographicCamera(-6, 6, 4, -4, .1, 100);
    camera.position.set(0, 2.8, 18); camera.lookAt(0, 0, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); q('.xhci-canvas').append(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xddeaff, 3); light.position.set(3, 6, 9); scene.add(light);
    controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = true; controls.enableDamping = false;
    controls.minZoom = .5; controls.maxZoom = 2.2;
    for (const [text, y] of [['硬件：相邻 ESIT 服务窗口 →', 3.15], ['软件：待处理 TD 队列 →', 1.0], ['已出队的等时帧结果', -1.28]]) {
      const heading = label([text], 4.4, .35, { width: 760, height: 65, fill: '#0b1220', color: '#aec8e2' }); heading.position.set(-2.1, y, .2); scene.add(heading);
    }
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.96, .55, .1), new THREE.MeshStandardMaterial({ color: COLORS.pending }));
      mesh.position.set(SLOT[i], 2.45, 0); scene.add(mesh);
      const caption = label([`ESIT ${i + 1} · ${data.scene.tds[i].id}`, '待服务'], 1.85, .48, { width: 460, height: 130 });
      caption.position.set(SLOT[i], 2.45, .15); scene.add(caption); windows.push({ mesh, caption });
      const td = data.scene.tds[i], group = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.66, .83, .22), new THREE.MeshStandardMaterial({ color: COLORS.pending })); group.add(box);
      const captionTD = label([`TD ${td.id}`, `${td.pointer} · 128 B`], 1.58, .7, { large: true }); captionTD.position.z = .16; group.add(captionTD);
      group.position.set(SLOT[i], 0, 0); scene.add(group); cards.set(td.id, { group, box, caption: captionTD });
      // Result slots remain visible when a TD leaves the software queue.
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.7, .87, .1)), new THREE.LineBasicMaterial({ color: 0x344b64 }));
      outline.position.set(SLOT[i], -2.05, 0); scene.add(outline);
    }
    eventArrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), .7, 0xffce64, .19, .16); scene.add(eventArrow);
    eventLabel = label(['事件'], 2.35, .35, { width: 600, height: 80, fill: '#493618', color: '#ffdc8c' }); scene.add(eventLabel);
    headArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-4.4, 0, .25), .4, 0x70e1ef, .18, .14); scene.add(headArrow);
    const clockGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 2.05, .3), new THREE.Vector3(0, 2.85, .3)]);
    clockLine = new THREE.Line(clockGeometry, new THREE.LineBasicMaterial({ color: 0xffdc8c })); scene.add(clockLine);
    hardwareLabel = label(['硬件时间'], 3, .32, { width: 600, height: 70, fill: '#0b1220', color: '#ffdc8c' }); hardwareLabel.position.set(2.5, 3.15, .2); scene.add(hardwareLabel);
    const resize = () => {
      const canvasRoot = q('.xhci-canvas'), width = canvasRoot.clientWidth || 1, height = canvasRoot.clientHeight || 1;
      const aspect = width / height, halfHeight = Math.max(3.75, 5.05 / aspect), halfWidth = halfHeight * aspect;
      camera.left = -halfWidth; camera.right = halfWidth; camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.updateProjectionMatrix(); renderer.setSize(width, height); render();
    };
    new ResizeObserver(resize).observe(q('.xhci-canvas'));
    controls.addEventListener('change', render);
  } else q('.xhci-webgl-fallback').hidden = false;

  function drawSnapshot(snapshot, animate) {
    currentSnapshot = snapshot;
    if (!renderer) return;
    visualFrom = animate && !reduced ? new Map([...cards].map(([id, card]) => [id, card.group.position.clone()])) : null;
    transitionAt = performance.now();
    data.scene.tds.forEach((td, i) => {
      const queued = snapshot.queue.indexOf(td.id), frame = snapshot.frames[td.id];
      const card = cards.get(td.id);
      destinations.set(td.id, new THREE.Vector3(queued >= 0 ? SLOT[queued] : SLOT[i], queued >= 0 ? 0 : -2.05, 0));
      if (!visualFrom) card.group.position.copy(destinations.get(td.id));
      card.box.material.color.setHex(frame ? (frame.status === '0' ? COLORS.success : (queued >= 0 ? COLORS.processing : COLORS.skipped)) : COLORS.pending);
      card.group.scale.setScalar(snapshot.focus === td.id ? 1.05 : 1);
      replaceLabel(card.caption, [`TD ${td.id}`, frame ? `${frame.status} / ${frame.actual ?? '?'} B` : `${td.pointer} · 128 B`], { large: true, fill: '#142c43', color: frame?.status === '-EXDEV' ? '#ff9caa' : '#eefaff' });
    });
    snapshot.hardware.forEach((status, i) => {
      windows[i].mesh.material.color.setHex(COLORS[status] || COLORS.pending);
      replaceLabel(windows[i].caption, [`ESIT ${i + 1} · ${data.scene.tds[i].id}`, status === 'missed' ? '× 错过 · 不重试' : status === 'success' ? '✓ 按时完成' : '待服务'], { width: 460, height: 130, fill: status === 'missed' ? '#6d2738' : status === 'success' ? '#154f40' : '#152b42' });
    });
    clockLine.position.x = -4.2 + snapshot.clock * 2.1;
    replaceLabel(hardwareLabel, [snapshot.clock === 4 ? (snapshot.queue.length ? '硬件已推进；软件追赶中' : '硬件 / 软件已对齐') : `硬件时间：${snapshot.clock} / 4 ESIT`], { width: 680, height: 70, fill: '#0b1220', color: '#ffdc8c' });
    eventArrow.visible = Boolean(snapshot.event?.target); eventLabel.visible = Boolean(snapshot.event);
    if (snapshot.event) {
      replaceLabel(eventLabel, [`${snapshot.event.pointer} → ${snapshot.event.target || '无定位'}${snapshot.event.handled ? ' · 已消费' : ''}`], { width: 380, height: 80, fill: snapshot.event.handled ? '#253141' : '#493618', color: '#ffdc8c' });
      eventArrow.setColor(snapshot.event.handled ? 0x8292a5 : 0xffce64);
    }
    headArrow.visible = snapshot.queue.length > 0;
  }
  function render() {
    if (!renderer) return;
    if (visualFrom) {
      const t = Math.min(1, (performance.now() - transitionAt) / 480), eased = t * t * (3 - 2 * t);
      for (const [id, card] of cards) card.group.position.lerpVectors(visualFrom.get(id), destinations.get(id), eased);
      if (t === 1) visualFrom = null;
    }
    const target = currentSnapshot?.event?.target;
    if (target && cards.has(target)) {
      const position = cards.get(target).group.position;
      eventArrow.position.set(position.x, position.y + 1.12, .4);
      eventLabel.position.set(position.x, position.y + 1.46, .4);
    } else if (eventLabel) eventLabel.position.set(1.2, 1.46, .4);
    if (headArrow && currentSnapshot?.queue.length) {
      const head = cards.get(currentSnapshot.queue[0]).group.position;
      headArrow.position.set(head.x - 1.25, head.y, .25);
    }
    window.__XHCI_SCENE_GEOMETRY__ = {
      cards: Object.fromEntries([...cards].map(([id, card]) => [id, card.group.position.toArray()])),
      event: eventArrow.visible ? eventArrow.position.toArray() : null,
      head: headArrow.visible ? headArrow.position.toArray() : null,
      clockX: clockLine.position.x,
    };
    renderer.render(scene, camera);
    if (window.__ANIMATION_STATS__) Object.assign(window.__ANIMATION_STATS__, { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
  }
  function showStep(next, animate = false) {
    index = Math.max(0, Math.min(scenario.steps.length - 1, next));
    const step = scenario.steps[index], snapshot = step.snapshot;
    drawSnapshot(snapshot, animate);
    q('h2').textContent = `${index + 1}. ${step.title}`;
    q('.xhci-detail').textContent = step.detail;
    q('.xhci-evidence').scrollTop = 0;
    q('.xhci-skip').textContent = `ep->skip = ${snapshot.skip}`; q('.xhci-skip').dataset.value = String(snapshot.skip);
    q('.xhci-head').textContent = `软件 dequeue → ${snapshot.queue[0] || '空'} · URB.actual_length = ${snapshot.urbActual} B`;
    q('.xhci-event').textContent = snapshot.event ? `事件：${snapshot.event.code} | TRB Pointer ${snapshot.event.pointer} → ${snapshot.event.target || '无定位'} | remaining ${snapshot.event.remaining} B${snapshot.event.handled ? ' | 已消费' : ''}` : '当前没有消费中的 Transfer Event';
    q('.xhci-pending').textContent = `Event Ring 待处理：${snapshot.eventQueue.join(' → ') || '无'} · 硬件时间 ${snapshot.clock}/4 ESIT`;
    q('.xhci-queue').replaceChildren(el('small', '', '软件队列：'), ...snapshot.queue.map(id => el('span', '', id)), ...(snapshot.queue.length ? [] : [el('small', '', '∅ 已清空')]));
    const row = q('.xhci-frame-row'); row.replaceChildren(el('th', '', 'status / actual_length'));
    for (const td of data.scene.tds) {
      const frame = snapshot.frames[td.id]; row.append(el('td', frame ? (frame.status === '0' ? 'success' : 'failed') : '', frame ? `${frame.status} / ${frame.actual ?? '?'} B` : '待处理'));
    }
    q('.xhci-formula').textContent = snapshot.formula || '每 TD 请求 128 B；逐帧状态与 URB 总长度分别记账';
    q('.xhci-code-heading').textContent = step.hardwareOnly ? '对应驱动入口（此步仅硬件推进，尚未执行）' : '本步骤对应的驱动代码';
    q('.xhci-code').replaceChildren();
    for (const evidence of step.evidence) {
      q('.xhci-code').append(el('div', 'xhci-code-location', `${evidence.symbol} · ${evidence.file}:${evidence.lineStart}–${evidence.lineEnd}`), el('pre', '', evidence.excerpt));
    }
    const spec = data.scene.spec;
    q('.xhci-rule').textContent = step.hardwareOnly ? spec.rule : `${spec.rule} 当前高亮代码展示 Linux 的软件队列与长度处理策略；规范不要求使用 skip 这个变量。`;
    q('.xhci-spec-source').textContent = `${spec.section} · ${spec.source || '未提供规范原文，条款待核实'}`;
    q('.xhci-spec-excerpt').textContent = spec.excerpt || '没有可核实的本地规范原文。';
    q('.xhci-counter').textContent = `${index + 1} / ${scenario.steps.length}`;
    q('[data-command=previous]').disabled = index === 0; q('[data-command=next]').disabled = index === scenario.steps.length - 1;
    q('.xhci-progress').value = String(time);
    q('.xhci-step-list').querySelectorAll('button').forEach((button, i) => { button.classList.toggle('active', i === index); button.setAttribute('aria-current', i === index ? 'step' : 'false'); });
    window.__XHCI_SCENE_STATE__ = { scenario: scenario.id, index, step: step.id, ...structuredClone(snapshot) };
    Object.assign(window.__ANIMATION_STATS__, { steps: scenario.steps.length });
    render(); schedule();
  }
  function schedule() {
    if (!raf && (playing || visualFrom)) raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    raf = 0;
    if (playing) {
      time = Math.min((scenario.steps.length - 1) * STEP_SECONDS, time + (now - lastTick) / 1000 * speed);
      const next = Math.floor(time / STEP_SECONDS);
      if (next !== index) showStep(next, true);
      q('.xhci-progress').value = String(time);
      if (time >= (scenario.steps.length - 1) * STEP_SECONDS) setPlaying(false);
    }
    lastTick = now; render(); schedule();
  }
  function setPlaying(value) {
    playing = Boolean(value);
    q('[data-command=toggle]').textContent = playing ? '暂停 Space' : '播放 Space';
    if (playing) { lastTick = performance.now(); if (index === scenario.steps.length - 1) { time = 0; showStep(0); } }
    schedule();
  }
  function seek(seconds, animate = false) {
    setPlaying(false); time = Math.max(0, Math.min((scenario.steps.length - 1) * STEP_SECONDS, Number(seconds) || 0));
    showStep(Math.floor(time / STEP_SECONDS), animate);
  }
  function run(command) {
    if (command === 'next') seek((index + 1) * STEP_SECONDS, true);
    else if (command === 'previous') seek((index - 1) * STEP_SECONDS, true);
    else if (command === 'toggle') setPlaying(!playing);
  }
  function selectScenario(id) {
    const next = data.scene.scenarios.find(item => item.id === id); if (!next) return;
    setPlaying(false); scenario = next; index = -1; time = 0;
    q('.xhci-scenario').value = next.id;
    q('.xhci-progress').max = String((scenario.steps.length - 1) * STEP_SECONDS);
    q('.xhci-step-list').replaceChildren();
    scenario.steps.forEach((step, i) => {
      const button = el('button', '', `${i + 1}`); button.title = step.title; button.setAttribute('aria-label', step.title);
      button.addEventListener('click', () => seek(i * STEP_SECONDS)); q('.xhci-step-list').append(button);
    });
    showStep(0);
  }
  q('.xhci-scenario').addEventListener('change', event => selectScenario(event.target.value));
  host.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => run(button.dataset.command)));
  q('.xhci-progress').addEventListener('input', event => seek(event.target.value));
  q('.xhci-speed').addEventListener('change', event => { speed = Number(event.target.value); });
  q('.xhci-reset').addEventListener('click', () => { if (camera) { camera.position.set(0, 2.8, 18); camera.zoom = 1; camera.updateProjectionMatrix(); controls.target.set(0, 0, 0); controls.update(); render(); } });
  window.addEventListener('keydown', event => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input, select, textarea') || (event.key === ' ' && event.target.closest?.('button'))) return;
    if (event.key === 'Escape') { event.preventDefault(); window.parent?.postMessage({ type: 'code-reader-animation-close' }, '*'); return; }
    const command = animationCommandForKey(event.key); if (command) { event.preventDefault(); run(command); }
  });
  window.addEventListener('message', event => { if (event.source === window.parent && event.data?.type === 'code-reader-animation-command') run(event.data.command); });
  window.__ANIMATION_STATS__ = { type: 'xhci-missed-service', nodes: 4, steps: scenario.steps.length, drawCalls: 0, triangles: 0 };
  window.__seek = seconds => seek(seconds);
  window.__xhciSelectScenario = selectScenario;
  selectScenario(scenario.id);
  window.__SCENE_READY__ = true;
  return { seek, selectScenario };
}
