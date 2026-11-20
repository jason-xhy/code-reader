// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 动画运行时与 parseAnimation 输出结构强绑定
// grill: 成品检索=skill 库无 code-reader 动画运行时成品; 输入固定=受限动画 JSON; 步骤机械=确定性布局+步骤时间轴; 判读固定=挂载成功/降级; 失效场景=构造不出（仅本应用）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STEP_SECONDS = 2.5;
const NODE_STYLE = {
  code: { color: 0x5aa2ff, build: () => new THREE.BoxGeometry(1.1, 0.7, 0.7) },
  data: { color: 0x3fd0c9, build: () => new THREE.CylinderGeometry(0.42, 0.42, 0.7, 24) },
  spec: { color: 0xf0b64f, build: () => new THREE.IcosahedronGeometry(0.5, 0) },
  decision: { color: 0xb085f5, build: () => new THREE.OctahedronGeometry(0.55, 0) },
  output: { color: 0x67d98a, build: () => new THREE.SphereGeometry(0.46, 24, 16) },
};

function labelSprite(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.font = font;
  const width = Math.max(64, Math.ceil(ctx.measureText(text).width) + 28);
  canvas.width = width;
  canvas.height = 56;
  ctx.font = font;
  ctx.fillStyle = 'rgba(10, 15, 30, 0.78)';
  ctx.beginPath();
  ctx.roundRect(0, 0, width, 56, 12);
  ctx.fill();
  ctx.fillStyle = '#e8edfa';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(width / 160, 56 / 160, 1);
  return sprite;
}

function buildControls(container, state) {
  const bar = document.createElement('div');
  bar.className = 'anim-controls';
  bar.innerHTML = `
    <button type="button" data-act="prev" title="上一步（←）">上一步</button>
    <button type="button" data-act="play" title="播放/暂停（空格）">播放</button>
    <button type="button" data-act="next" title="下一步（→）">下一步</button>
    <input class="anim-progress" type="range" min="0" max="${state.totalSeconds}" step="0.05" value="0">
    <span class="anim-step-label"></span>
    <select data-act="speed" title="播放速度">
      <option value="0.5">0.5×</option>
      <option value="1" selected>1×</option>
      <option value="1.5">1.5×</option>
      <option value="2">2×</option>
    </select>
    <button type="button" data-act="reset-camera" title="重置视角">重置视角</button>
  `;
  container.appendChild(bar);

  const listWrap = document.createElement('div');
  listWrap.className = 'anim-steps';
  const list = document.createElement('ol');
  state.data.steps.forEach((step, index) => {
    const item = document.createElement('li');
    item.textContent = step.title;
    item.title = step.detail;
    item.dataset.index = String(index);
    item.addEventListener('click', () => state.seek(index * STEP_SECONDS, { pause: true }));
    list.appendChild(item);
  });
  listWrap.appendChild(list);
  container.appendChild(listWrap);

  const playButton = bar.querySelector('[data-act="play"]');
  const progress = bar.querySelector('.anim-progress');
  const stepLabel = bar.querySelector('.anim-step-label');
  bar.querySelector('[data-act="prev"]').addEventListener('click', () => state.stepBy(-1));
  bar.querySelector('[data-act="next"]').addEventListener('click', () => state.stepBy(1));
  playButton.addEventListener('click', () => state.togglePlay());
  bar.querySelector('[data-act="reset-camera"]').addEventListener('click', () => state.resetCamera());
  bar.querySelector('[data-act="speed"]').addEventListener('change', (event) => {
    state.speed = Number(event.target.value) || 1;
  });
  progress.addEventListener('input', () => state.seek(Number(progress.value), { pause: true }));
  state.ui = { playButton, progress, stepLabel, list };
}

export function mountAnimation(root, data) {
  const container = root.closest('.anim-stage')?.parentElement || document.body;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const totalSeconds = Math.max(1, data.steps.length * STEP_SECONDS - 0.5);
  const state = {
    data,
    totalSeconds,
    speed: 1,
    playing: false,
    time: 0,
    stepIndex: -1,
    nodes: new Map(),
    connections: [],
    ui: null,
    seek(seconds, { pause = false } = {}) {
      this.time = Math.min(Math.max(0, seconds), this.totalSeconds);
      if (pause) this.setPlaying(false);
      applyTime(this, this.time);
    },
    stepBy(delta) {
      const next = Math.min(Math.max(0, this.stepIndex + delta), this.data.steps.length - 1);
      this.seek(next * STEP_SECONDS, { pause: true });
    },
    setPlaying(playing) {
      this.playing = playing && !reduced;
      if (this.ui) this.ui.playButton.textContent = this.playing ? '暂停' : '播放';
      if (this.playing) startLoop(this);
    },
    togglePlay() { this.setPlaying(!this.playing); },
    resetCamera() {
      if (!this.camera || !this.controls) return;
      this.camera.position.set(0, 2.2, 6.4);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      renderOnce(this);
    },
  };
  state.stepIndex = 0;

  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    renderer = null;
  }
  if (!renderer) {
    const fallback = document.getElementById('animation-fallback');
    if (fallback) fallback.hidden = false;
    buildControls(container, state);
    applyTime(state, 0);
    window.__SCENE_READY__ = true;
    window.__ANIMATION_STATS__ = { nodes: data.nodes.length, steps: data.steps.length, drawCalls: 0, triangles: 0 };
    window.__seek = (seconds) => state.seek(seconds);
    return state;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  camera.position.set(0, 2.2, 6.4);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  root.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2033, 1.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);
  scene.add(new THREE.GridHelper(12, 24, 0x26314f, 0x1a2238));

  const count = data.nodes.length;
  const radius = Math.max(1.8, count * 0.42);
  data.nodes.forEach((node, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const style = NODE_STYLE[node.kind] || NODE_STYLE.code;
    const mesh = new THREE.Mesh(
      style.build(),
      new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.45, metalness: 0.15 }),
    );
    const position = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    mesh.position.copy(position);
    mesh.userData.nodeId = node.id;
    mesh.userData.baseScale = 1;
    scene.add(mesh);
    const label = labelSprite(node.label);
    label.position.copy(position).add(new THREE.Vector3(0, 0.78, 0));
    scene.add(label);
    state.nodes.set(node.id, { mesh, label, position, color: style.color });
  });

  data.steps.forEach((step, stepIndex) => {
    if (!step.from || !step.to || step.from === step.to) return;
    const fromNode = state.nodes.get(step.from);
    const toNode = state.nodes.get(step.to);
    if (!fromNode || !toNode) return;
    const material = new THREE.LineBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0.18 });
    const geometry = new THREE.BufferGeometry().setFromPoints([fromNode.position, toNode.position]);
    const line = new THREE.Line(geometry, material);
    line.userData.stepIndex = stepIndex;
    scene.add(line);
    state.connections.push(line);
  });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.controls = controls;

  const resize = () => {
    const width = root.clientWidth || 1;
    const height = root.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderOnce(state);
  };
  new ResizeObserver(resize).observe(root);
  resize();

  buildControls(container, state);
  applyTime(state, 0);
  renderOnce(state);

  controls.addEventListener('change', () => renderOnce(state));
  window.addEventListener('keydown', (event) => {
    if (event.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      // iframe 在 sandbox 里拿不到父页面 DOM，用 postMessage 请父页面关闭弹层。
      window.parent?.postMessage({ type: 'code-reader-animation-close' }, '*');
      return;
    }
    if (event.key === 'ArrowLeft') { state.stepBy(-1); event.preventDefault(); }
    if (event.key === 'ArrowRight') { state.stepBy(1); event.preventDefault(); }
    if (event.key === ' ') { state.togglePlay(); event.preventDefault(); }
  });

  window.__SCENE_READY__ = true;
  window.__seek = (seconds) => state.seek(seconds);
  window.__ANIMATION_STATS__ = {
    nodes: state.nodes.size,
    steps: data.steps.length,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
  return state;
}

function renderOnce(state) {
  if (!state.renderer) return;
  state.controls?.update();
  state.renderer.render(state.scene, state.camera);
  if (window.__ANIMATION_STATS__) {
    window.__ANIMATION_STATS__.drawCalls = state.renderer.info.render.calls;
    window.__ANIMATION_STATS__.triangles = state.renderer.info.render.triangles;
  }
}

function applyTime(state, time) {
  const index = Math.min(Math.floor(time / STEP_SECONDS), state.data.steps.length - 1);
  state.stepIndex = index;
  const active = state.data.steps[index];
  for (const [id, entry] of state.nodes) {
    const isActive = id === active.node || id === active.from || id === active.to;
    const isFocus = id === active.node;
    entry.mesh.scale.setScalar(isFocus ? 1.35 : isActive ? 1.15 : 1);
    entry.mesh.material.emissive = entry.mesh.material.emissive || new THREE.Color(0);
    entry.mesh.material.emissive.setHex(isFocus ? 0x223a66 : 0x000000);
  }
  for (const line of state.connections) {
    const isActive = line.userData.stepIndex === index;
    line.material.opacity = isActive ? 0.95 : 0.18;
  }
  if (state.ui) {
    state.ui.progress.value = String(time);
    state.ui.stepLabel.textContent = `${index + 1} / ${state.data.steps.length}`;
    [...state.ui.list.children].forEach((item, itemIndex) => {
      item.classList.toggle('active', itemIndex === index);
    });
  }
  renderOnce(state);
}

function startLoop(state) {
  if (state.loopActive) return;
  state.loopActive = true;
  let last = performance.now();
  const tick = (now) => {
    if (!state.playing) { state.loopActive = false; return; }
    const delta = ((now - last) / 1000) * state.speed;
    last = now;
    state.time += delta;
    if (state.time >= state.totalSeconds) {
      state.time = state.totalSeconds;
      state.setPlaying(false);
    }
    applyTime(state, state.time);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

window.CodeReaderAnimation = { mount: mountAnimation };

function autoMount() {
  const root = document.getElementById('animation-root');
  const dataElement = document.getElementById('animation-data');
  if (!root || !dataElement) return;
  let data = null;
  try {
    data = JSON.parse(dataElement.textContent || '{}');
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.steps) || !data.nodes.length || !data.steps.length) {
    const fallback = document.getElementById('animation-fallback');
    if (fallback) {
      fallback.hidden = false;
      fallback.querySelector('strong').textContent = '动画数据无效';
    }
    window.__SCENE_READY__ = true;
    return;
  }
  mountAnimation(root, data);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoMount, { once: true });
} else {
  autoMount();
}
