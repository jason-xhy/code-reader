// one-shot: code-reader 浏览器验收（项目固定工具，非 agent 探索脚本）; no-generalize: 与 __ts 调试接口和 workspace/history API 强绑定
// grill: 成品检索=skill 库无 code-reader 浏览器验收成品; 输入固定=CODE_READER_URL 与服务端历史/工作区; 步骤机械=启动 Chrome→CDP 断言→可选切换; 判读固定=__ts.snapshot 字段与历史上次位置; 失效场景=构造不出（仅本应用）
//
// 依赖系统 Chrome（本机未安装 Playwright）：通过 CDP 控制 headless Chrome。
// 无头浏览器的两个已知坑：① 新版 /json/new 需要 PUT；② Runtime.evaluate 的
// 表达式里不能写顶层 await，异步逻辑要用 `(async () => …)()` 包一层。
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const appUrl = process.env.CODE_READER_URL || `http://127.0.0.1:${process.env.PORT || 8766}/`;
const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const debugPort = Number(process.env.CDP_PORT || 9333);
const doSwitch = process.argv.includes('--switch');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let checks = 0;
let failures = 0;
function check(name, ok, detail = '') {
  checks += 1;
  if (ok) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function api(pathname) {
  const response = await fetch(new URL(pathname, appUrl));
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}`);
  return response.json();
}

const workspace = await api('/api/workspace');
const history = await api('/api/history');
const entries = workspace.entries || [];
const activeEntry = entries.find((entry) => entry.key === workspace.activeKey) || entries[0];
const historyFor = (entry) => (history.repositories || []).find((item) => item.path === entry?.path) || null;

if (!activeEntry) {
  console.log('RESULT SKIP checks=0 failures=0 (工作区为空)');
  process.exit(0);
}

const profile = await mkdtemp(path.join(os.tmpdir(), 'code-reader-chrome-'));
const chrome = spawn(chromeBin, [
  '--headless=new',
  '--disable-gpu',
  // headless 无 GPU 时 three.js 需要 SwiftShader 才能建 WebGL 上下文。
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

async function waitDebugger() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome 尚未就绪
    }
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

let socket = null;
try {
  await waitDebugger();
  const created = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?about:blank`,
    { method: 'PUT' },
  );
  const target = await created.json();
  socket = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let nextId = 1;
  const pending = new Map();
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '页面脚本执行失败');
    }
    return result.result.value;
  };
  const waitFor = async (expression, timeoutMs = 45000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return;
      } catch (error) {
        lastError = error;
      }
      await sleep(300);
    }
    throw new Error(`等待超时：${expression}${lastError ? ` (${lastError.message})` : ''}`);
  };
  const snapshot = async () => JSON.parse(await evaluate('JSON.stringify(window.__ts.snapshot())'));

  await send('Runtime.enable');
  await send('Page.enable');
  // headless 页面默认没有焦点，programmatic focus() 不触发 focusin/focusout；
  // 打开焦点模拟，面板的键盘聚焦滑出/失焦收起才能被真实验证。
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // 记录页面从加载起的长任务：预载建树若一次性执行（旧实现 280ms）会在这里现形。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__longTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__longTasks.push({ start: Math.round(entry.startTime), dur: Math.round(entry.duration) });
          }
        }).observe({ entryTypes: ['longtask'] });
      } catch {}
    `,
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: appUrl });
  const waitReady = async () => {
    await waitFor(`Boolean(window.__ts && window.__ts.snapshot().workspace && window.__ts.snapshot().workspace.entries.length === ${entries.length})`);
    await waitFor("Boolean(window.__ts.snapshot().repository && window.__ts.snapshot().currentFile && window.__ts.snapshot().sourceLines > 0)");
  };

  await waitReady();
  await evaluate('window.__readyAt = performance.now(); true');
  const initial = await snapshot();
  // 同一实例可能正被用户在另一个窗口使用（阅读位置随时会变）：开始时与页面
  // 就绪后各取一次历史，页面匹配任一即可；滤波用例结束后回写页面起始位置。
  const startupExpected = historyFor(activeEntry);
  const historyNow = await api('/api/history');
  const latestExpected = (historyNow.repositories || []).find((item) => item.path === activeEntry.path) || startupExpected;
  const restoreTarget = initial.currentFile
    ? { lastFile: initial.currentFile, lastLine: initial.activeLine, lastCharacter: initial.editor?.cursor?.character || 0 }
    : null;
  check(
    '刷新后恢复到工作区当前仓库',
    initial.repository?.name === activeEntry.name && initial.workspace.activeKey === activeEntry.key,
    JSON.stringify({ repository: initial.repository?.name, activeKey: initial.workspace.activeKey }),
  );
  check(
    '工作区页签与服务端记录一致',
    initial.workspace.entries.map((entry) => entry.name).join(',') === entries.map((entry) => entry.name).join(','),
    JSON.stringify(initial.workspace.entries),
  );
  if (startupExpected?.lastFile || latestExpected?.lastFile) {
    const matches = (entry) => Boolean(entry?.lastFile)
      && initial.currentFile === entry.lastFile
      && initial.activeLine === entry.lastLine
      && initial.editor?.cursor?.line === entry.lastLine
      && initial.editor?.cursor?.character === entry.lastCharacter;
    check(
      '恢复到该仓库上次的文件与行列',
      matches(startupExpected) || matches(latestExpected),
      JSON.stringify({
        startupExpected,
        latestExpected,
        actual: { file: initial.currentFile, line: initial.activeLine, character: initial.editor?.cursor?.character },
      }),
    );
  }
  const tabs = await evaluate("JSON.stringify([...document.querySelectorAll('.workspace-tab')].map((tab) => ({ name: tab.querySelector('.workspace-tab-name').textContent, active: tab.classList.contains('active') })))");
  const tabState = JSON.parse(tabs);
  check(
    '页签渲染且当前仓库高亮',
    tabState.length === entries.length
    && tabState.filter((tab) => tab.active).length === 1
    && tabState.find((tab) => tab.active)?.name === activeEntry.name,
    tabs,
  );

  const evaluateJson = async (expression) => JSON.parse(await evaluate(expression));
  const filterPaths = async (value) => {
    await evaluate(`(() => { const input = document.querySelector('#tree-filter'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(200);
    return evaluateJson("JSON.stringify([...document.querySelectorAll('#file-tree .tree-row-flat')].map((row) => row.dataset.path))");
  };
  const pressFilterKey = async (key) => {
    await evaluate(`(() => { const input = document.querySelector('#tree-filter'); input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true })); return true; })()`);
  };

  // #4 每个工作区页签上方显示直达快捷键；编辑器/nvim 页签也标出组合键。
  const tabKeys = await evaluateJson("JSON.stringify([...document.querySelectorAll('.workspace-tab')].map((tab) => tab.querySelector('.workspace-tab-key')?.textContent || ''))");
  const editorKeys = await evaluateJson("JSON.stringify([...document.querySelectorAll('.editor-tab-key')].map((node) => node.textContent))");
  check(
    '页签上方显示直达快捷键',
    tabKeys.length === entries.length
    && tabKeys[0] === 'Ctrl+Alt+Shift+1'
    && (entries.length < 2 || tabKeys[1] === 'Ctrl+Alt+Shift+2')
    && editorKeys.join(',') === 'Ctrl+Alt+1,Ctrl+Alt+2',
    JSON.stringify({ tabKeys, editorKeys }),
  );
  const cycleHint = await evaluate("document.querySelector('.workspace-cycle-hint')?.textContent || ''");
  check('工作区显示前后切换组合键', cycleHint.includes('Ctrl+Alt+[') && cycleHint.includes('Ctrl+Alt+]'), cycleHint);

  // #8 两侧栏默认隐藏为覆盖层，鼠标移到边缘/键盘聚焦时滑出，离开后收起。
  const panelState = async () => evaluateJson(`JSON.stringify((() => {
    const app = document.querySelector('#app');
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
    };
    return {
      classes: app.className,
      sidebar: rect('.sidebar'),
      insights: rect('.insights'),
      reader: rect('.reader'),
      codeArea: rect('#code-area'),
      viewport: innerWidth,
    };
  })())`);
  const hiddenPanels = await panelState();
  check(
    '代码树/分析栏默认不显示',
    !hiddenPanels.classes.includes('sidebar-visible')
    && !hiddenPanels.classes.includes('insights-visible')
    && hiddenPanels.sidebar.right <= 0
    && hiddenPanels.insights.left >= hiddenPanels.viewport
    && hiddenPanels.reader.width >= hiddenPanels.viewport - 1,
    JSON.stringify(hiddenPanels),
  );
  // 悬停滑出面板=打开窗口：焦点立即交给窗口内容（窗口自己接收按键，而不是编辑器继续吃键）。
  await evaluate("document.querySelector('#sidebar-trigger').dispatchEvent(new PointerEvent('pointerenter')); true");
  await sleep(260);
  const sidebarHover = await panelState();
  const sidebarHoverFocus = await evaluate("document.activeElement?.id || ''");
  check(
    '鼠标移到左边缘打开代码树并把焦点交给文件树',
    sidebarHover.classes.includes('sidebar-visible') && sidebarHover.sidebar.left >= 0
    && sidebarHover.sidebar.right > 100 && sidebarHoverFocus === 'file-tree',
    JSON.stringify({ ...sidebarHover, focus: sidebarHoverFocus }),
  );
  // 窗口已有焦点，鼠标离开不收起（与键盘聚焦阅读一致）；q 把焦点还给代码窗后才收起。
  await evaluate("document.querySelector('#sidebar-trigger').dispatchEvent(new PointerEvent('pointerleave')); document.querySelector('.sidebar').dispatchEvent(new PointerEvent('pointerleave')); true");
  await sleep(650);
  const sidebarKept = await panelState();
  check('焦点在代码树时鼠标离开仍保持', sidebarKept.classes.includes('sidebar-visible'), JSON.stringify(sidebarKept));
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true })); true");
  await sleep(650);
  const sidebarGone = await panelState();
  check('q 返回代码窗后代码树收起', !sidebarGone.classes.includes('sidebar-visible') && sidebarGone.sidebar.right <= 0, JSON.stringify(sidebarGone));

  await evaluate("document.querySelector('#insights-trigger').dispatchEvent(new PointerEvent('pointerenter')); true");
  await sleep(260);
  const insightsHover = await panelState();
  const insightsHoverFocus = await evaluate("document.activeElement?.id || ''");
  check(
    '鼠标移到右边缘打开分析栏并把焦点交给解释窗口',
    insightsHover.classes.includes('insights-visible')
    && insightsHover.insights.left < insightsHover.viewport - 100 && insightsHoverFocus === 'explanation-content',
    JSON.stringify({ ...insightsHover, focus: insightsHoverFocus }),
  );
  await evaluate("document.querySelector('#insights-trigger').dispatchEvent(new PointerEvent('pointerleave')); document.querySelector('.insights').dispatchEvent(new PointerEvent('pointerleave')); true");
  await sleep(650);
  const insightsKept = await panelState();
  check('焦点在解释窗口时鼠标离开仍保持', insightsKept.classes.includes('insights-visible'), JSON.stringify(insightsKept));
  await evaluate("document.querySelector('.cm-content').focus(); true");
  await sleep(650);
  const insightsGone = await panelState();
  check('焦点回代码窗后分析栏收起', !insightsGone.classes.includes('insights-visible'), JSON.stringify(insightsGone));

  // Ctrl+Alt+B / Ctrl+Alt+I：按一次打开（钉住，鼠标移开仍保持），再按一次关闭。
  const pressPanelKey = async (code, key) => {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, ctrlKey: true, altKey: true, bubbles: true })); true`);
  };
  await pressPanelKey('KeyB', 'b');
  await sleep(260);
  const sidebarPinned = await panelState();
  await evaluate("document.querySelector('.sidebar').dispatchEvent(new PointerEvent('pointerleave')); document.querySelector('#sidebar-trigger').dispatchEvent(new PointerEvent('pointerleave')); true");
  await sleep(650);
  const sidebarStillPinned = await panelState();
  check(
    'Ctrl+Alt+B 打开代码树并保持',
    sidebarPinned.classes.includes('sidebar-visible') && sidebarStillPinned.classes.includes('sidebar-visible'),
    JSON.stringify({ sidebarPinned, sidebarStillPinned }),
  );
  await pressPanelKey('KeyB', 'b');
  await sleep(260);
  const sidebarToggledOff = await panelState();
  check('Ctrl+Alt+B 再按一次关闭代码树', !sidebarToggledOff.classes.includes('sidebar-visible'), JSON.stringify(sidebarToggledOff));
  await pressPanelKey('KeyI', 'i');
  await sleep(260);
  const insightsPinned = await panelState();
  await evaluate("document.querySelector('.insights').dispatchEvent(new PointerEvent('pointerleave')); document.querySelector('#insights-trigger').dispatchEvent(new PointerEvent('pointerleave')); true");
  await sleep(650);
  const insightsStillPinned = await panelState();
  check(
    'Ctrl+Alt+I 打开分析栏并保持',
    insightsPinned.classes.includes('insights-visible') && insightsStillPinned.classes.includes('insights-visible'),
    JSON.stringify({ insightsPinned, insightsStillPinned }),
  );
  await pressPanelKey('KeyI', 'i');
  await sleep(260);
  const insightsToggledOff = await panelState();
  check('Ctrl+Alt+I 再按一次关闭分析栏', !insightsToggledOff.classes.includes('insights-visible'), JSON.stringify(insightsToggledOff));
  const panelHints = await evaluateJson("JSON.stringify({ editor: document.querySelector('#panel-shortcuts')?.textContent || '', nvim: document.querySelector('#nvim-panel-hints')?.textContent || '', editorVisible: (document.querySelector('#panel-shortcuts')?.offsetWidth || 0) > 0 })");
  check(
    '代码窗口显示侧栏快捷键',
    panelHints.editor.includes('Ctrl+Alt+B')
    && panelHints.editor.includes('Ctrl+Alt+I')
    && panelHints.nvim.includes('Ctrl+Alt+B')
    && panelHints.editorVisible,
    JSON.stringify(panelHints),
  );

  // 代码窗口上方的左右箭头提示（Ctrl+Alt+B / Ctrl+Alt+I）。
  const navBar = await evaluateJson(`JSON.stringify({
    left: document.querySelector('#nav-tree')?.textContent.replace(/\\s+/g, ' ').trim() || '',
    right: document.querySelector('#nav-insights')?.textContent.replace(/\\s+/g, ' ').trim() || '',
    leftArrow: document.querySelector('#nav-tree .code-nav-arrow')?.textContent || '',
    rightArrow: document.querySelector('#nav-insights .code-nav-arrow')?.textContent || '',
    visible: (document.querySelector('#code-nav-bar')?.offsetHeight || 0) > 0,
    bar: (() => { const rect = document.querySelector('#code-nav-bar').getBoundingClientRect(); return { left: rect.left, right: rect.right }; })(),
    leftArrowBox: (() => { const rect = document.querySelector('#nav-tree .code-nav-arrow').getBoundingClientRect(); return { left: rect.left }; })(),
    rightArrowBox: (() => { const rect = document.querySelector('#nav-insights .code-nav-arrow').getBoundingClientRect(); return { right: rect.right }; })(),
  })`);
  check(
    '代码窗口上方显示左/右箭头与 Ctrl+Alt+B/I 提示',
    navBar.visible
    && navBar.leftArrow === '←' && navBar.rightArrow === '→'
    && navBar.left.includes('Ctrl + Alt + B') && navBar.left.includes('打开代码树')
    && navBar.right.includes('Ctrl + Alt + I') && navBar.right.includes('打开代码解释窗口')
    && navBar.leftArrowBox.left - navBar.bar.left < 20
    && navBar.bar.right - navBar.rightArrowBox.right < 20,
    JSON.stringify(navBar),
  );

  const dispatchKey = async (code, key, modifiers = {}) => {
    const parts = ['bubbles: true', 'cancelable: true'];
    for (const name of ['ctrlKey', 'altKey', 'shiftKey']) {
      if (modifiers[name]) parts.push(`${name}: true`);
    }
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, ${parts.join(', ')} })); true`);
    await sleep(80);
  };
  const navState = async () => evaluateJson('JSON.stringify(window.__crKeyboardNavState || null)');

  // 备用键：Ctrl+Alt+B 被输入法/桌面占用时用 Ctrl+Alt+Shift+B。
  await dispatchKey('KeyB', 'b', { ctrlKey: true, altKey: true, shiftKey: true });
  await sleep(220);
  const fallbackOpened = await evaluate("document.querySelector('#app').classList.contains('sidebar-visible')");
  await dispatchKey('KeyB', 'b', { ctrlKey: true, altKey: true, shiftKey: true });
  await sleep(220);
  const fallbackClosed = await evaluate("document.querySelector('#app').classList.contains('sidebar-visible')");
  check('Ctrl+Alt+Shift+B 备用键可开关代码树', fallbackOpened && !fallbackClosed, JSON.stringify({ fallbackOpened, fallbackClosed }));

  // easymotion 风格：Ctrl+Alt+K 给顶层窗口的可操作元素打标签，输入标签即点击。
  await evaluate("window.__crPanels?.hide('sidebar'); true");
  await dispatchKey('KeyK', 'k', { ctrlKey: true, altKey: true });
  await waitFor("Boolean(document.querySelector('.cr-hint-layer'))", 5000);
  const hintState = await navState();
  const navTreeItem = hintState?.items?.find((item) => item.id === 'nav-tree');
  const hintBadges = await evaluateJson("JSON.stringify({ badges: document.querySelectorAll('.cr-hint-badge').length, outlines: document.querySelectorAll('.cr-hint-outline').length })");
  check(
    'Ctrl+Alt+K 打开标签跳转层并覆盖可操作元素',
    hintState?.mode === 'hint' && hintState.targets >= 8
    && Boolean(navTreeItem?.label) && hintBadges.badges === hintState.targets && hintBadges.outlines <= hintState.targets,
    JSON.stringify({ hintState, hintBadges }),
  );
  // 标签不能遮挡要跳转的内容：代码行标签必须落在行号槽里，UI 标签不压自身文字。
  const hintCoverage = await evaluateJson(`JSON.stringify((() => {
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const textBounds = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || parent.closest('.cr-hint-layer')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const range = document.createRange();
      let bounds = null;
      let node = walker.nextNode();
      while (node) {
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width < 1 || rect.height < 1) continue;
          bounds = bounds
            ? { left: Math.min(bounds.left, rect.left), top: Math.min(bounds.top, rect.top), right: Math.max(bounds.right, rect.right), bottom: Math.max(bounds.bottom, rect.bottom) }
            : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        }
        node = walker.nextNode();
      }
      return bounds;
    };
    const state = window.__crKeyboardNavState;
    const badges = [...document.querySelectorAll('.cr-hint-badge')];
    const items = state?.items || [];
    const gutter = document.querySelector('#editor-host .cm-gutters');
    const gutterRight = gutter ? gutter.getBoundingClientRect().right : 0;
    let lines = 0;
    let lineHits = 0;
    let uiHits = 0;
    const hitDetails = [];
    for (let index = 0; index < items.length && index < badges.length; index += 1) {
      const badge = badges[index].getBoundingClientRect();
      if (items[index].kind === 'editor-line') {
        lines += 1;
        if (badge.right > gutterRight + 1) lineHits += 1;
      } else if (items[index].id) {
        const element = document.getElementById(items[index].id);
        const text = element ? textBounds(element) : null;
        if (text && overlap(badge, text)) {
          uiHits += 1;
          hitDetails.push({
            id: items[index].id,
            text: items[index].text.slice(0, 20),
            badge: { left: Math.round(badge.left), top: Math.round(badge.top), right: Math.round(badge.right), bottom: Math.round(badge.bottom) },
            textRect: { left: Math.round(text.left), top: Math.round(text.top), right: Math.round(text.right), bottom: Math.round(text.bottom) },
          });
        }
      }
    }
    return { lines, lineHits, uiHits, hitDetails, badges: badges.length };
  })())`);
  check(
    'Ctrl+Alt+K 标签不覆盖代码与目标文字',
    hintCoverage.lines >= 5 && hintCoverage.lineHits === 0 && hintCoverage.uiHits === 0,
    JSON.stringify(hintCoverage),
  );
  for (const character of navTreeItem?.label || '') await dispatchKey(`Key${character.toUpperCase()}`, character);
  await sleep(260);
  const afterHintClick = await evaluateJson("JSON.stringify({ visible: document.querySelector('#app').classList.contains('sidebar-visible'), mode: window.__crKeyboardNavState?.mode, layer: Boolean(document.querySelector('.cr-hint-layer')), focus: document.activeElement?.id || '', inSidebar: Boolean(document.activeElement?.closest?.('.sidebar')) })");
  check(
    '输入标签即点击目标（打开代码树）并把焦点移入侧栏',
    afterHintClick.visible && afterHintClick.mode === null && !afterHintClick.layer && afterHintClick.inSidebar,
    JSON.stringify(afterHintClick),
  );

  // 代码行标签：Ctrl+Alt+K 给视口内代码行打标签，输入标签把光标移到该行。
  await dispatchKey('KeyB', 'b', { ctrlKey: true, altKey: true });
  await sleep(220);
  await evaluate("window.__crPanels?.hide('sidebar'); true");
  await dispatchKey('KeyK', 'k', { ctrlKey: true, altKey: true });
  await waitFor("Boolean(document.querySelector('.cr-hint-layer'))", 5000);
  const lineHint = await evaluateJson(`JSON.stringify((() => {
    const state = window.__crKeyboardNavState;
    const items = (state?.items || []).filter((item) => item.kind === 'editor-line');
    const current = window.__ts.snapshot().editor.cursor.line;
    const target = items.find((item) => item.line && item.line !== current) || items[0] || null;
    return { total: state?.targets || 0, lines: items.length, target, current, badges: document.querySelectorAll('.cr-hint-badge').length, outlines: document.querySelectorAll('.cr-hint-outline').length };
  })())`);
  check(
    'Ctrl+Alt+K 给代码区逐行打标签',
    lineHint.lines >= 5 && Boolean(lineHint.target?.label) && lineHint.badges === lineHint.total,
    JSON.stringify(lineHint),
  );
  for (const character of lineHint.target?.label || '') await dispatchKey(`Key${character.toUpperCase()}`, character);
  await sleep(260);
  const afterLineHint = await evaluateJson(`JSON.stringify({
    mode: window.__crKeyboardNavState?.mode,
    cursor: window.__ts.snapshot().editor.cursor,
    inEditor: Boolean(document.activeElement?.closest?.('#editor-host')),
  })`);
  check(
    '输入行标签后光标跳到该行且焦点在编辑器',
    afterLineHint.mode === null && afterLineHint.inEditor
    && (lineHint.target?.line == null || afterLineHint.cursor.line === lineHint.target.line),
    JSON.stringify({ lineHint, afterLineHint }),
  );

  // 文件树目录行激活会重建整棵树：焦点不能掉到 body。
  await dispatchKey('KeyB', 'b', { ctrlKey: true, altKey: true });
  await sleep(300);
  await dispatchKey('KeyK', 'k', { ctrlKey: true, altKey: true });
  await waitFor("Boolean(document.querySelector('.cr-hint-layer'))", 5000);
  const treeDir = await evaluateJson(`JSON.stringify((() => {
    const row = [...document.querySelectorAll('#file-tree .tree-row')].find((element) => element.dataset.directory === 'true');
    if (!row) return null;
    const text = row.textContent.trim().slice(0, 40);
    const item = (window.__crKeyboardNavState?.items || []).find((entry) => entry.kind === 'hint' && entry.text === text);
    return { path: row.dataset.path, text, item };
  })())`);
  for (const character of treeDir?.item?.label || '') await dispatchKey(`Key${character.toUpperCase()}`, character);
  await sleep(260);
  const treeFocusAfter = await evaluateJson(`JSON.stringify({
    active: document.activeElement?.id || '',
    inSidebar: Boolean(document.activeElement?.closest?.('.sidebar')),
    focusedPath: document.querySelector('#file-tree .tree-row.key-focus')?.dataset.path || '',
  })`);
  check(
    '目录行激活重建树后焦点回到文件树',
    Boolean(treeDir?.item?.label) && treeFocusAfter.inSidebar && treeFocusAfter.focusedPath === treeDir.path,
    JSON.stringify({ treeDir, treeFocusAfter }),
  );
  await dispatchKey('KeyB', 'b', { ctrlKey: true, altKey: true });
  await sleep(200);
  await evaluate("window.__crPanels?.hide('sidebar'); true");
  await dispatchKey('KeyK', 'k', { ctrlKey: true, altKey: true });
  await sleep(150);
  await dispatchKey('Escape', 'Escape');
  const hintEscaped = await navState();
  check('Esc 退出标签跳转层', hintEscaped?.mode === null && !(await evaluate("Boolean(document.querySelector('.cr-hint-layer'))")), JSON.stringify(hintEscaped));

  // 原生 dialog 在 top layer：标签层必须挂进 dialog，且不能选到遮罩后的元素。
  await evaluate("document.querySelector('#open-menu').click(); true");
  await waitFor("Boolean(document.querySelector('dialog[open]'))", 5000);
  await sleep(250);
  await dispatchKey('KeyK', 'k', { ctrlKey: true, altKey: true });
  await sleep(250);
  const dialogHint = await evaluateJson(`JSON.stringify({
    inDialog: Boolean(document.querySelector('dialog[open] .cr-hint-layer')),
    state: window.__crKeyboardNavState,
    hasSubmit: Boolean(window.__crKeyboardNavState?.items?.some((item) => item.id === 'open-submit')),
  })`);
  check(
    '标签跳转在对话框内生效（不会点到遮罩后的元素）',
    dialogHint.inDialog && dialogHint.state?.mode === 'hint' && dialogHint.hasSubmit,
    JSON.stringify(dialogHint),
  );
  await dispatchKey('Escape', 'Escape');
  await evaluate("document.querySelector('#open-dialog')?.close(); true");

  // sneak 风格：Ctrl+Alt+F 输入两个字符，匹配处打标签，输入标签跳转。
  // 旧键 Ctrl+Alt+L 被 UKUI 锁屏（screensaver:<Ctrl><Alt>l）占用。
  const sneakSeed = await evaluateJson(`JSON.stringify((() => {
    const candidates = ['if', 're', 'st', 'in', 'th', 'er', 'on', 'le', 'ca', 'un'];
    for (const query of candidates) {
      const matches = window.__ts.visibleMatches(query, 20);
      if (matches.length) return { query, line: matches[0].line };
    }
    return null;
  })())`);
  check('sneak 测试能取到视口内两字符样本', Boolean(sneakSeed?.query), JSON.stringify(sneakSeed));
  await dispatchKey('KeyF', 'f', { ctrlKey: true, altKey: true });
  for (const character of sneakSeed?.query || '') {
    await dispatchKey(`Key${character.toUpperCase()}`, character);
    await sleep(120);
  }
  await sleep(300);
  const sneakState = await navState();
  const sneakBadges = await evaluate("document.querySelectorAll('.cr-hint-badge').length");
  const sneakTarget = sneakState?.items?.find((item) => item.kind === 'editor' && item.line) || sneakState?.items?.[0];
  check(
    'Ctrl+Alt+F 输入两字符后给匹配处打标签',
    sneakState?.mode === 'sneak' && sneakState.phase === 'pick' && sneakState.matches > 0
    && sneakBadges === sneakState.matches && Boolean(sneakTarget?.label),
    JSON.stringify({ sneakState, sneakBadges }),
  );
  for (const character of sneakTarget?.label || '') await dispatchKey(`Key${character.toUpperCase()}`, character);
  await sleep(300);
  const afterSneakJump = await evaluateJson(`JSON.stringify({
    mode: window.__crKeyboardNavState?.mode,
    cursor: window.__ts.snapshot().editor.cursor,
    inEditor: Boolean(document.activeElement?.closest?.('#editor-host')),
  })`);
  check(
    '输入标签后光标跳到匹配行',
    afterSneakJump.mode === null && afterSneakJump.inEditor
    && (sneakTarget?.line == null || afterSneakJump.cursor.line === sneakTarget.line),
    JSON.stringify({ sneakTarget, afterSneakJump }),
  );

  // 历史菜单 / 文件树右键菜单 / 分隔条都用键盘操作，不依赖鼠标。
  const pressActive = async (code, key, modifiers = {}) => {
    const parts = ['bubbles: true', 'cancelable: true'];
    for (const name of ['ctrlKey', 'altKey', 'shiftKey']) {
      if (modifiers[name]) parts.push(`${name}: true`);
    }
    await evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, ${parts.join(', ')} })); true`);
    await sleep(120);
  };
  // 真实按键（CDP）：用于验证浏览器原生行为，如 summary 上按 Enter 展开 <details>。
  // modifiers 位掩码：Alt=1 / Ctrl=2 / Meta=4 / Shift=8。
  const pressRealKey = async (key, code, vk, modifiers = 0, text = '') => {
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    if (text) Object.assign(base, { text, unmodifiedText: text });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(90);
  };
  await evaluate("window.__crPanels?.show('sidebar'); document.querySelector('#history-menu-button').focus(); true");
  await pressActive('ArrowDown', 'ArrowDown');
  await waitFor("Boolean(document.activeElement?.closest('#history-menu'))", 5000);
  const historyMenuOpen = await evaluateJson("JSON.stringify({ hidden: document.querySelector('#history-menu').hidden, active: document.activeElement?.closest?.('#history-menu') ? 'menu' : document.activeElement?.id || '', items: document.querySelectorAll('#history-menu button').length })");
  await pressActive('Escape', 'Escape');
  const historyMenuClosed = await evaluateJson("JSON.stringify({ hidden: document.querySelector('#history-menu').hidden, active: document.activeElement?.id || '' })");
  check(
    '历史菜单支持键盘打开/导航/关闭',
    !historyMenuOpen.hidden && historyMenuOpen.active === 'menu' && historyMenuOpen.items >= 1
    && historyMenuClosed.hidden && historyMenuClosed.active === 'history-menu-button',
    JSON.stringify({ historyMenuOpen, historyMenuClosed }),
  );

  await evaluate("document.querySelector('#file-tree').focus(); true");
  await pressActive('KeyJ', 'j');
  await pressActive('F10', 'F10', { shiftKey: true });
  await sleep(200);
  const treeMenuOpen = await evaluateJson("JSON.stringify({ hidden: document.querySelector('#tree-menu').hidden, active: document.activeElement?.closest?.('#tree-menu') ? 'menu' : document.activeElement?.id || '' })");
  await pressActive('Escape', 'Escape');
  const treeMenuClosed = await evaluateJson("JSON.stringify({ hidden: document.querySelector('#tree-menu').hidden, active: document.activeElement?.id || '' })");
  check(
    '文件树 Shift+F10 打开右键菜单并支持 Esc 返回',
    !treeMenuOpen.hidden && treeMenuOpen.active === 'menu'
    && treeMenuClosed.hidden && treeMenuClosed.active === 'file-tree',
    JSON.stringify({ treeMenuOpen, treeMenuClosed }),
  );

  const splitterBefore = await evaluate("getComputedStyle(document.querySelector('#app')).getPropertyValue('--sidebar-width').trim()");
  await evaluate("document.querySelector('#splitter-left').focus(); true");
  await pressActive('ArrowRight', 'ArrowRight');
  const splitterAfter = await evaluate("getComputedStyle(document.querySelector('#app')).getPropertyValue('--sidebar-width').trim()");
  await pressActive('ArrowLeft', 'ArrowLeft');
  const splitterRestored = await evaluate("getComputedStyle(document.querySelector('#app')).getPropertyValue('--sidebar-width').trim()");
  check(
    '分隔条聚焦后可用 ←/→ 调整宽度',
    splitterBefore !== splitterAfter && splitterRestored === splitterBefore,
    JSON.stringify({ splitterBefore, splitterAfter, splitterRestored }),
  );

  // 新版理解层：证据链 / 建议继续阅读 / 内嵌 Three.js 动画 / 预设问题 / 深层演变入口。
  await evaluate('window.__ts.showTestUnderstanding(); true');
  await waitFor("document.querySelectorAll('#explanation-content .evidence-card').length >= 3", 5000);
  await waitFor("Boolean(document.querySelector('#explanation-content .animation-open'))", 5000);
  await waitFor("Boolean([...document.querySelectorAll('#history-content .history-actions button')].find((button) => button.textContent.includes('深层演变')))", 10000);
  const understandingUi = await evaluateJson(`JSON.stringify({
    evidence: document.querySelectorAll('#explanation-content .evidence-card').length,
    docEvidence: document.querySelectorAll('#explanation-content .evidence-documentation').length,
    inference: document.querySelectorAll('#explanation-content .evidence-inference').length,
    nextSteps: document.querySelectorAll('#explanation-content .next-step').length,
    presets: document.querySelectorAll('#question-presets .preset-chip').length,
    deepButton: Boolean([...document.querySelectorAll('#history-content .history-actions button')].find((button) => button.textContent.includes('深层演变'))),
    animationButton: Boolean(document.querySelector('#explanation-content .animation-open')),
    sources: document.querySelectorAll('#explanation-content [data-nav="source"]').length,
  })`);
  check(
    '解释窗口渲染证据链/下一跳/预设/深层演变入口',
    understandingUi.evidence === 3 && understandingUi.docEvidence === 1 && understandingUi.inference === 1
    && understandingUi.nextSteps >= 1 && understandingUi.presets === 5 && understandingUi.deepButton
    && understandingUi.sources >= 2,
    JSON.stringify(understandingUi),
  );
  // 关闭后走真实快捷键路径：Ctrl+Alt+I 应打开并聚焦解释窗口。
  // 先把焦点移出面板再关（真实用户是焦点在代码区时按快捷键）。
  await evaluate("window.__crPanels?.toggle('insights'); document.querySelector('.cm-content')?.focus(); true");
  await sleep(260);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', ctrlKey: true, altKey: true, bubbles: true })); true");
  await waitFor("document.querySelector('#app').classList.contains('insights-visible')", 5000);
  await sleep(350);
  const focusedAfterToggle = await evaluate("document.activeElement?.id || document.activeElement?.className || ''");
  check('Ctrl+Alt+I 打开并聚焦解释窗口（阅读模式）', focusedAfterToggle === 'explanation-content', focusedAfterToggle);

  // 阅读模式：j/k 逐行滚动，gg/G 顶部/底部（内容不够高时补一段占位再测）。
  const scrollSetup = await evaluateJson(`JSON.stringify((() => {
    const box = document.querySelector('#explanation-content');
    if (box.scrollHeight <= box.clientHeight + 40) {
      const filler = document.createElement('div');
      filler.id = 'vim-scroll-filler';
      filler.style.height = '1500px';
      box.append(filler);
    }
    box.scrollTop = 0;
    return { scrollHeight: box.scrollHeight, clientHeight: box.clientHeight };
  })())`);
  await pressRealKey('j', 'KeyJ', 74);
  await pressRealKey('j', 'KeyJ', 74);
  const scrollAfterJ = await evaluate("document.querySelector('#explanation-content').scrollTop");
  await pressRealKey('G', 'KeyG', 71, 8);
  const scrollAfterG = await evaluate("document.querySelector('#explanation-content').scrollTop");
  await pressRealKey('g', 'KeyG', 71);
  await pressRealKey('g', 'KeyG', 71);
  const scrollAfterGG = await evaluate("document.querySelector('#explanation-content').scrollTop");
  check(
    '解释窗口 j/k 滚动、G/gg 跳到底部/顶部',
    scrollAfterJ > 0 && scrollAfterG > scrollAfterJ && scrollAfterGG === 0,
    JSON.stringify({ scrollSetup, scrollAfterJ, scrollAfterG, scrollAfterGG }),
  );
  await evaluate("document.querySelector('#vim-scroll-filler')?.remove(); document.querySelector('#explanation-content').scrollTop = 0; true");

  // 完整 Vim 动作：计数、半屏/整屏（Ctrl+d/u/f/b）、H/M/L。
  const vimLine = await evaluate("parseFloat(getComputedStyle(document.querySelector('#explanation-content')).lineHeight) || 20");
  await evaluate(`(() => {
    const box = document.querySelector('#explanation-content');
    box.focus();
    const filler = document.createElement('div');
    filler.id = 'vim-scroll-filler';
    filler.style.height = '2400px';
    box.append(filler);
    box.scrollTop = 0;
    return true;
  })()`);
  await pressRealKey('3', 'Digit3', 51);
  await pressRealKey('j', 'KeyJ', 74);
  const scrollCount = await evaluate("document.querySelector('#explanation-content').scrollTop");
  await pressRealKey('d', 'KeyD', 68, 2);
  const scrollHalf = await evaluate("document.querySelector('#explanation-content').scrollTop");
  await pressRealKey('u', 'KeyU', 85, 2);
  const scrollHalfBack = await evaluate("document.querySelector('#explanation-content').scrollTop");
  await pressRealKey('f', 'KeyF', 70, 2);
  const scrollPage = await evaluate("document.querySelector('#explanation-content').scrollTop");
  await pressRealKey('b', 'KeyB', 66, 2);
  const scrollPageBack = await evaluate("document.querySelector('#explanation-content').scrollTop");
  check(
    '解释窗口支持计数与 Ctrl+d/u/f/b 翻屏',
    scrollCount >= vimLine * 2 && scrollCount <= vimLine * 4
    && scrollHalf > scrollCount
    && Math.abs(scrollHalfBack - scrollCount) <= vimLine
    && scrollPage > scrollHalf
    && scrollPageBack < scrollPage,
    JSON.stringify({ vimLine, scrollCount, scrollHalf, scrollHalfBack, scrollPage, scrollPageBack }),
  );
  await pressRealKey('G', 'KeyG', 71, 8);
  const scrollBottom = await evaluate("document.querySelector('#explanation-content').scrollTop");
  const scrollMax = await evaluate("document.querySelector('#explanation-content').scrollHeight - document.querySelector('#explanation-content').clientHeight");
  await pressRealKey('H', 'KeyH', 72, 8);
  const scrollHome = await evaluate("document.querySelector('#explanation-content').scrollTop");
  await pressRealKey('L', 'KeyL', 76, 8);
  const scrollLast = await evaluate("document.querySelector('#explanation-content').scrollTop");
  await pressRealKey('M', 'KeyM', 77, 8);
  const scrollMiddle = await evaluate("document.querySelector('#explanation-content').scrollTop");
  check(
    '解释窗口 H/M/L 跳到顶部/中部/底部',
    scrollBottom === scrollMax && scrollHome === 0 && scrollLast === scrollMax
    && Math.abs(scrollMiddle - Math.round(scrollMax / 2)) <= 2,
    JSON.stringify({ scrollMax, scrollBottom, scrollHome, scrollLast, scrollMiddle }),
  );

  // / 窗口内搜索：输入即高亮，Enter 保留高亮并回到阅读模式，n/N 跳下一个，Esc 清除。
  await evaluate("document.querySelector('#explanation-content').focus(); true");
  await pressRealKey('/', 'Slash', 191);
  await waitFor("Boolean(document.querySelector('.vim-search input'))", 5000);
  await send('Input.insertText', { text: '测试' });
  await sleep(250);
  const searchState = await evaluateJson(`JSON.stringify({
    count: document.querySelector('.vim-search-count')?.textContent || '',
    highlight: typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights.has('cr-vim-search') : null,
    current: typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights.has('cr-vim-search-current') : null,
  })`);
  await pressRealKey('Enter', 'Enter', 13, 0, '\r');
  await sleep(250);
  const searchAfterEnter = await evaluateJson(`JSON.stringify({
    bar: Boolean(document.querySelector('.vim-search')),
    highlight: typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights.has('cr-vim-search') : null,
    focus: document.activeElement?.id || '',
  })`);
  await pressRealKey('n', 'KeyN', 78);
  const searchAfterNext = await evaluateJson(`JSON.stringify({
    highlight: typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights.has('cr-vim-search-current') : null,
  })`);
  check(
    '解释窗口 / 搜索、Enter 定位、n 跳到下一个命中',
    searchState.count.includes('处') && searchState.highlight !== false
    && searchState.current !== false
    && !searchAfterEnter.bar && searchAfterEnter.highlight !== false
    && searchAfterEnter.focus === 'explanation-content'
    && searchAfterNext.highlight !== false,
    JSON.stringify({ searchState, searchAfterEnter, searchAfterNext }),
  );
  await pressRealKey('/', 'Slash', 191);
  await waitFor("Boolean(document.querySelector('.vim-search input'))", 5000);
  await pressRealKey('Escape', 'Escape', 27);
  await sleep(200);
  const searchCleared = await evaluateJson(`JSON.stringify({
    bar: Boolean(document.querySelector('.vim-search')),
    highlight: typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights.has('cr-vim-search') : null,
    focus: document.activeElement?.id || '',
  })`);
  check(
    '搜索 Esc 清除高亮并返回阅读模式',
    !searchCleared.bar && searchCleared.highlight !== true && searchCleared.focus === 'explanation-content',
    JSON.stringify(searchCleared),
  );
  await evaluate("document.querySelector('#vim-scroll-filler')?.remove(); document.querySelector('#explanation-content').scrollTop = 0; true");

  // Ctrl+Alt+I 是「去解释窗口」：已打开但焦点在代码区时按一下应送回焦点，不关闭；
  // 焦点已在窗口内时再按才收起。
  await evaluate("document.querySelector('.cm-content')?.focus(); true");
  await sleep(200);
  await pressRealKey('i', 'KeyI', 73, 3);
  await sleep(350);
  const insightsReturn = await evaluateJson("JSON.stringify({ visible: document.querySelector('#app').classList.contains('insights-visible'), active: document.activeElement?.id || '' })");
  check(
    'Ctrl+Alt+I 在窗口已打开时把焦点送回解释窗口',
    insightsReturn.visible && insightsReturn.active === 'explanation-content',
    JSON.stringify(insightsReturn),
  );
  await pressRealKey('i', 'KeyI', 73, 3);
  await sleep(300);
  const insightsClosed = await evaluateJson("JSON.stringify({ visible: document.querySelector('#app').classList.contains('insights-visible'), active: document.activeElement?.id || '' })");
  check(
    '焦点在解释窗口内时 Ctrl+Alt+I 收起窗口',
    !insightsClosed.visible && insightsClosed.active !== 'explanation-content',
    JSON.stringify(insightsClosed),
  );
  await pressRealKey('i', 'KeyI', 73, 3);
  await waitFor("document.querySelector('#app').classList.contains('insights-visible')", 5000);
  await sleep(300);

  // 捕获阶段拦截 click，避免真的打开新标签。
  await evaluate(`(() => {
    window.__sourceClicked = false;
    for (const link of document.querySelectorAll('#explanation-content [data-nav="source"]')) {
      link.addEventListener('click', (event) => {
        window.__sourceClicked = true;
        event.preventDefault();
      }, true);
    }
    return true;
  })()`);
  // 列表模式：焦点进入来源链接后 j/k 在项间移动，gg/G 首尾。
  await evaluate("(() => { const link = document.querySelector('#explanation-content [data-nav=\"source\"]'); link?.focus(); return true; })()");
  const navTextBefore = await evaluate("document.activeElement?.textContent || ''");
  await pressRealKey('j', 'KeyJ', 74);
  const navTextAfterJ = await evaluate("document.activeElement?.textContent || ''");
  await pressRealKey('k', 'KeyK', 75);
  const navTextAfterK = await evaluate("document.activeElement?.textContent || ''");
  check(
    '解释窗口 j/k 切换来源链接',
    navTextAfterJ !== navTextBefore && navTextAfterK === navTextBefore,
    JSON.stringify({ navTextBefore, navTextAfterJ, navTextAfterK }),
  );
  // 目标顺序以 DOM 中可见的可聚焦项为准（首个通常是证据跳转/动画入口，不是来源链接）。
  const navOrder = await evaluateJson(`JSON.stringify((() => {
    const box = document.querySelector('#explanation-content');
    return [...box.querySelectorAll('a[href], button, summary, [data-nav], [tabindex="0"]')]
      .filter((element) => element !== box && element.getClientRects().length > 0)
      .map((element) => element.textContent.trim());
  })())`);
  await pressRealKey('G', 'KeyG', 71, 8);
  const navTextAfterG = await evaluate("document.activeElement?.textContent?.trim() || ''");
  await pressRealKey('g', 'KeyG', 71);
  await pressRealKey('g', 'KeyG', 71);
  const navTextAfterGG = await evaluate("document.activeElement?.textContent?.trim() || ''");
  check(
    '解释窗口 gg/G 跳到首个/最后一个目标',
    navOrder.length >= 2 && navTextAfterG === navOrder[navOrder.length - 1] && navTextAfterGG === navOrder[0],
    JSON.stringify({ navOrder, navTextAfterG, navTextAfterGG }),
  );
  // Enter 激活来源链接（重新聚焦第一条来源）。
  await evaluate("document.querySelector('#explanation-content [data-nav=\"source\"]')?.focus(); true");
  await pressRealKey('Enter', 'Enter', 13, 0, '\r');
  check('解释窗口 Enter 激活选中链接', await evaluate('window.__sourceClicked === true'), await evaluate("document.activeElement?.textContent || ''"));
  await evaluate("document.querySelector('#explanation-content .next-step')?.click(); true");
  await waitFor("!document.querySelector('#reading-trail')?.hidden && document.querySelectorAll('#reading-trail .trail-chip').length >= 1", 5000);
  const trailState = await evaluateJson("JSON.stringify({ hidden: document.querySelector('#reading-trail').hidden, chips: document.querySelectorAll('#reading-trail .trail-chip').length })");
  check('建议继续阅读会在编辑器上方留下阅读路径', !trailState.hidden && trailState.chips >= 1, JSON.stringify(trailState));

  await evaluate("(() => { const button = document.querySelector('#explanation-content .animation-open'); button?.focus(); button?.click(); return true; })()");
  await waitFor("!document.querySelector('#animation-overlay')?.hidden", 10000);
  await waitFor("document.querySelector('#animation-frame')?.getAttribute('src')?.startsWith('blob:')", 15000);
  const animationFocus = await evaluate("document.activeElement?.id || ''");
  check('打开 3D 动画弹层后焦点进入弹层', animationFocus === 'animation-close', animationFocus);
  const animationOverlay = await evaluateJson(`JSON.stringify({
    open: window.__ts.snapshot().animationOpen,
    overlay: !document.querySelector('#animation-overlay').hidden,
    frame: document.querySelector('#animation-frame')?.getAttribute('src') || '',
    download: document.querySelector('#animation-download')?.getAttribute('href') || '',
    filename: document.querySelector('#animation-download')?.getAttribute('download') || '',
  })`);
  check(
    '内嵌 3D 动画弹层加载 blob 预览并可下载离线 HTML',
    animationOverlay.open && animationOverlay.overlay
    && animationOverlay.frame.startsWith('blob:')
    && animationOverlay.download.startsWith('blob:')
    && animationOverlay.filename.endsWith('.html'),
    JSON.stringify(animationOverlay),
  );
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); true");
  await sleep(250);
  const animationClosed = await evaluateJson("JSON.stringify({ open: window.__ts.snapshot().animationOpen, overlay: document.querySelector('#animation-overlay').hidden, focus: document.activeElement?.className || '' })");
  check(
    'Esc 关闭 3D 动画弹层并把焦点还给打开按钮',
    animationClosed.open === false && animationClosed.overlay === true && animationClosed.focus.includes('animation-open'),
    JSON.stringify(animationClosed),
  );

  // 真实提问流程（fetch 桩拦截 /explain）：回答返回后应自动打开解释窗口并聚焦，
  // 用户不用鼠标就能用 j/k 阅读答案。
  await evaluate(`(() => {
    window.__realFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/explain')) {
        return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({
          model: 'stub-model',
          explanation: {
            overview: 'auto-focus-overview',
            details: ['细节'],
            evidence: [],
            specifications: [],
            summary: '总结',
            nextSteps: [],
            animation: null,
          },
          sources: { local: [], web: [], searchedFiles: 0 },
        }), { status: 200, headers: { 'content-type': 'application/json' } })), 350));
      }
      return window.__realFetch(input, init);
    };
    return true;
  })()`);
  await evaluate("window.__crPanels?.hide('insights'); document.querySelector('.cm-content')?.focus(); true");
  await sleep(200);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true })); true");
  await waitFor("document.querySelector('#question-editor')?.hidden === false", 5000);
  await evaluate("(() => { document.querySelector('#question-input').value = '这个函数做什么？'; document.querySelector('#question-submit').click(); return true; })()");
  await waitFor("window.__ts.snapshot().explanation?.status === 'done'", 15000);
  await sleep(400);
  const autoFocus = await evaluateJson(`JSON.stringify({
    visible: document.querySelector('#app').classList.contains('insights-visible'),
    focus: document.activeElement?.id || '',
    overview: document.querySelector('#explanation-content .explanation-card p')?.textContent || '',
  })`);
  check(
    '提问的回答返回后自动打开并聚焦解释窗口',
    autoFocus.visible && autoFocus.focus === 'explanation-content' && autoFocus.overview === 'auto-focus-overview',
    JSON.stringify(autoFocus),
  );
  await evaluate("window.fetch = window.__realFetch; true");

  // 任意窗口 Vim 键：函数提交历史 j/k/gg/G，提交详情里 j + Enter 展开 diff。
  // 历史列表项 = 提交行 + 「深层演变」按钮；用 DOM 顺序做期望值，不依赖提交条数。
  const historyItemTexts = await evaluateJson(`JSON.stringify((() => {
    const nodes = [...document.querySelectorAll('#history-content .commit-header, #history-content .history-actions button')];
    return nodes.map((node) => (node.querySelector('.commit-hash')?.textContent || node.textContent.trim()).trim());
  })())`);
  if (historyItemTexts.length >= 2) {
    const itemText = "document.activeElement?.querySelector?.('.commit-hash')?.textContent || document.activeElement?.textContent?.trim() || ''";
    await evaluate("document.querySelector('#history-content .commit-header').focus(); true");
    await pressRealKey('j', 'KeyJ', 74);
    const afterJ = await evaluate(itemText);
    await pressRealKey('G', 'KeyG', 71, 8);
    const afterG = await evaluate(itemText);
    await pressRealKey('g', 'KeyG', 71);
    await pressRealKey('g', 'KeyG', 71);
    const afterGG = await evaluate(itemText);
    check(
      '函数提交历史 j/k 移动、gg/G 首尾',
      afterJ !== historyItemTexts[0]
      && afterG === historyItemTexts[historyItemTexts.length - 1]
      && afterGG === historyItemTexts[0],
      JSON.stringify({ historyItemTexts, afterJ, afterG, afterGG }),
    );
    // Enter 打开第一条提交详情；j 到 Diff（summary），Enter 展开。
    await pressRealKey('Enter', 'Enter', 13, 0, '\r');
    await waitFor("!document.querySelector('#commit-overlay').hidden", 15000);
    await waitFor("Boolean(document.querySelector('#commit-overlay-body details summary'))", 60000);
    const overlayOpened = await evaluate("!document.querySelector('#commit-overlay').hidden");
    const overlayFocus = await evaluate("document.activeElement?.id || ''");
    await pressRealKey('j', 'KeyJ', 74);
    const diffFocus = await evaluate("document.activeElement?.tagName || ''");
    await pressRealKey('Enter', 'Enter', 13, 0, '\r');
    const diffState = await evaluateJson("JSON.stringify({ open: Boolean(document.querySelector('#commit-overlay-body details')?.open), lines: document.querySelectorAll('#commit-overlay-body .commit-diff span').length })");
    check(
      '提交详情可用键盘打开 diff（j 到 summary + Enter）',
      overlayOpened && overlayFocus === 'commit-overlay-close' && diffFocus === 'SUMMARY'
      && diffState.open === true && diffState.lines > 0,
      JSON.stringify({ overlayOpened, overlayFocus, diffFocus, diffState }),
    );
    await pressRealKey('Escape', 'Escape', 27);
    await sleep(250);
    const overlayClosed = await evaluateJson("JSON.stringify({ hidden: document.querySelector('#commit-overlay').hidden, backToHistory: Boolean(document.activeElement?.closest('#history-content')) })");
    check('Esc 关闭提交详情并把焦点还给同一提交', overlayClosed.hidden && overlayClosed.backToHistory, JSON.stringify(overlayClosed));
  } else {
    check('函数提交历史 j/k/gg/G 与提交详情 diff（历史列表为空）', false, JSON.stringify(historyItemTexts));
  }

  // 文件树 gg/G：焦点在树上时跳到最后一个/第一个文件。
  await evaluate("window.__crPanels?.show('sidebar'); document.querySelector('#file-tree').focus(); true");
  const treeRowCount = await evaluate("document.querySelectorAll('#file-tree .tree-row').length");
  if (treeRowCount >= 3) {
    await pressRealKey('G', 'KeyG', 71, 8);
    const lastTree = await evaluate("document.querySelector('#file-tree .tree-row.key-focus')?.dataset.path || ''");
    await pressRealKey('g', 'KeyG', 71);
    await pressRealKey('g', 'KeyG', 71);
    const firstTree = await evaluate("document.querySelector('#file-tree .tree-row.key-focus')?.dataset.path || ''");
    check('文件树 gg/G 跳到首个/最后一个文件', Boolean(firstTree) && Boolean(lastTree) && firstTree !== lastTree, JSON.stringify({ firstTree, lastTree }));
    // 文件树同样支持计数、Ctrl+d 半屏与 / 过滤框。
    const treeIndex = () => evaluate("[...document.querySelectorAll('#file-tree .tree-row')].findIndex((row) => row.classList.contains('key-focus'))");
    await pressRealKey('g', 'KeyG', 71);
    await pressRealKey('g', 'KeyG', 71);
    await pressRealKey('3', 'Digit3', 51);
    await pressRealKey('j', 'KeyJ', 74);
    const treeAfterCount = await treeIndex();
    await pressRealKey('d', 'KeyD', 68, 2);
    const treeAfterHalf = await treeIndex();
    await pressRealKey('/', 'Slash', 191);
    const treeFilterFocus = await evaluate("document.activeElement?.id || ''");
    check(
      '文件树支持 3j 计数、Ctrl+d 半屏与 / 跳到过滤框',
      treeAfterCount === 3 && treeAfterHalf > treeAfterCount && treeFilterFocus === 'tree-filter',
      JSON.stringify({ treeAfterCount, treeAfterHalf, treeFilterFocus }),
    );
    await evaluate("(() => { const input = document.querySelector('#tree-filter'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); input.blur(); document.querySelector('#file-tree').focus(); return true; })()");
  } else {
    check('文件树 gg/G 跳到首个/最后一个文件（需要 ≥3 行）', false, `rows=${treeRowCount}`);
  }

  // 悬停打开代码树=打开窗口：焦点立即交给文件树，j/k 由树自己处理。
  await evaluate("document.querySelector('.cm-content').focus(); true");
  await pressRealKey('Escape', 'Escape', 27);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 300 });
  await sleep(400);
  await pressRealKey('j', 'KeyJ', 74);
  const hoverNav = await evaluateJson(`JSON.stringify({
    sidebarVisible: document.querySelector('#app').classList.contains('sidebar-visible'),
    active: document.activeElement?.id || document.activeElement?.className || '',
    focused: [...document.querySelectorAll('#file-tree .tree-row')].findIndex((row) => row.classList.contains('key-focus')),
  })`);
  check(
    '悬停打开代码树后 j/k 直接导航文件树',
    hoverNav.sidebarVisible && hoverNav.active === 'file-tree' && hoverNav.focused >= 0,
    JSON.stringify(hoverNav),
  );
  await evaluate("document.querySelector('.cm-content').focus(); true");
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 400 });
  await sleep(700);

  // 原生对话框同样支持 j/k/gg/G（文本输入框不在项列表里，用 Tab 进入）。
  await evaluate("document.querySelector('#open-menu').click(); true");
  await waitFor("Boolean(document.querySelector('dialog[open]'))", 5000);
  await sleep(200);
  await evaluate("document.querySelector('#dialog-close').focus(); true");
  await pressRealKey('j', 'KeyJ', 74);
  const dialogAfterJ = await evaluate("document.activeElement?.id || ''");
  await pressRealKey('G', 'KeyG', 71, 8);
  const dialogAfterG = await evaluate("document.activeElement?.id || ''");
  await pressRealKey('g', 'KeyG', 71);
  await pressRealKey('g', 'KeyG', 71);
  const dialogAfterGG = await evaluate("document.activeElement?.id || ''");
  check(
    '对话框内 j/k 移动、gg/G 首尾',
    dialogAfterJ === 'local-tab' && dialogAfterG === 'open-submit' && dialogAfterGG === 'dialog-close',
    JSON.stringify({ dialogAfterJ, dialogAfterG, dialogAfterGG }),
  );
  await pressRealKey('Escape', 'Escape', 27);
  await waitFor("!document.querySelector('dialog[open]')", 5000);

  // 隐藏面板是 inert 的（防止焦点落进屏幕外）：先模拟鼠标移到左边缘滑出面板，
  // 再聚焦过滤框；聚焦期间面板应保持展开，失焦后自动收起。
  await evaluate("window.__crPanels?.unpin('sidebar'); window.__crPanels?.hide('sidebar'); document.querySelector('#sidebar-trigger').dispatchEvent(new PointerEvent('pointerenter', { bubbles: true })); true");
  await sleep(80);
  await evaluate("document.querySelector('#tree-filter').focus(); true");
  await sleep(260);
  const sidebarFocused = await panelState();
  check('聚焦过滤框时文件树滑出', sidebarFocused.classes.includes('sidebar-visible'), JSON.stringify(sidebarFocused));
  await evaluate("document.querySelector('#tree-filter').blur(); true");
  await sleep(650);
  const sidebarBlurred = await panelState();
  check('过滤框失焦后文件树收起', !sidebarBlurred.classes.includes('sidebar-visible'), JSON.stringify(sidebarBlurred));

  // #5 预载建树切片：页面就绪后不应再出现 ≥200ms 的长任务（旧实现单次 280–500ms）。
  await sleep(3000);
  const longTasks = await evaluateJson('JSON.stringify(window.__longTasks || [])');
  const readyAt = await evaluate('window.__readyAt || 0');
  const blocking = longTasks.filter((task) => task.start >= readyAt && task.dur >= 200);
  check(
    '预载建树不产生 ≥200ms 主线程长任务',
    blocking.length === 0,
    JSON.stringify({ readyAt, longTasks }),
  );
  // 直测 j/k 连按：每次按键的 CDP 往返时延，最慢应远低于可感知阈值。
  const burstStart = await snapshot();
  if (burstStart.sourceLines > 140) {
    await evaluate(`(async () => {
      await window.__ts.openFile(${JSON.stringify(burstStart.currentFile)}, 100, 0);
      await new Promise((resolve) => setTimeout(resolve, 250));
      document.querySelector('.cm-content')?.focus();
      await new Promise((resolve) => setTimeout(resolve, 80));
    })()`);
    const burstFocus = await evaluate("document.activeElement?.className || ''");
    const beforeLine = (await snapshot()).activeLine;
    const keyRounds = [];
    for (let index = 0; index < 20; index += 1) {
      const started = Date.now();
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74 });
      keyRounds.push(Date.now() - started);
      await sleep(40);
    }
    // onCursorLine 有 180ms 防抖，等它落定后再读 activeLine。
    await sleep(400);
    const afterLine = (await snapshot()).activeLine;
    check('j/k 连按光标连续前进', afterLine >= beforeLine + 15, JSON.stringify({ beforeLine, afterLine, burstFocus }));
    check('j/k 连按无输入卡顿（最慢 <120ms）', Math.max(...keyRounds) < 120, JSON.stringify({ worst: Math.max(...keyRounds), keyRounds }));
  }

  // #6 引用窗口 j/k 切换：保留上一份预览，不闪回「正在读取」。
  await evaluate('window.__ts.showTestQuickpick(); true');
  await waitFor("document.querySelector('.quickpick-preview')?.textContent.includes('preview 1')", 8000);
  const quickpickBefore = await evaluateJson("JSON.stringify({ text: document.querySelector('.quickpick-preview').textContent.slice(0, 40), height: Math.round(document.querySelector('.quickpick-preview').getBoundingClientRect().height) })");
  await evaluate("document.querySelector('#quickpick').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })); true");
  await sleep(80);
  const quickpickDuring = await evaluateJson("JSON.stringify({ text: document.querySelector('.quickpick-preview')?.textContent.slice(0, 60) || '', pending: document.querySelector('.quickpick-preview')?.classList.contains('pending'), height: Math.round(document.querySelector('.quickpick-preview').getBoundingClientRect().height) })");
  check(
    '引用窗 j/k 切换保留旧预览（不闪烁）',
    quickpickDuring.text.includes('preview 1')
    && !quickpickDuring.text.includes('正在读取')
    && quickpickDuring.pending === true
    && quickpickDuring.height === quickpickBefore.height,
    JSON.stringify({ quickpickBefore, quickpickDuring }),
  );
  await waitFor("document.querySelector('.quickpick-preview')?.textContent.includes('preview 2')", 8000);
  const quickpickAfter = await evaluateJson("JSON.stringify({ text: document.querySelector('.quickpick-preview')?.textContent || '', pending: document.querySelector('.quickpick-preview')?.classList.contains('pending') })");
  check('新引用预览就绪后替换', quickpickAfter.text.includes('preview 2') && quickpickAfter.pending === false, JSON.stringify(quickpickAfter));
  // gg/G：引用列表首尾跳转。
  await pressRealKey('G', 'KeyG', 71, 8);
  const quickpickLast = await evaluate("[...document.querySelectorAll('#quickpick .quickpick-row')].findIndex((row) => row.classList.contains('active'))");
  await pressRealKey('g', 'KeyG', 71);
  await pressRealKey('g', 'KeyG', 71);
  const quickpickFirst = await evaluate("[...document.querySelectorAll('#quickpick .quickpick-row')].findIndex((row) => row.classList.contains('active'))");
  check('引用列表 gg/G 跳到首/末项', quickpickLast === 3 && quickpickFirst === 0, JSON.stringify({ quickpickLast, quickpickFirst }));
  await evaluate("document.querySelector('#quickpick').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  await sleep(150);

  // #6b 工作区搜索（Ctrl+Alt+P）：输入框 + 完全匹配优先 + 复用 gr 引用窗预览。
  const searchSeed = await snapshot();
  const currentBase = String(searchSeed.currentFile || '').split('/').pop();
  const currentSymbol = searchSeed.history?.symbol || '';
  await dispatchKey('KeyP', 'p', { ctrlKey: true, altKey: true });
  await waitFor("Boolean(document.querySelector('#quickpick .quickpick-input'))", 5000);
  const searchInputFocused = await evaluate("document.activeElement === document.querySelector('.quickpick-input')");
  await evaluate(`(() => { const input = document.querySelector('.quickpick-input'); input.value = ${JSON.stringify(currentBase)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor("document.querySelectorAll('#quickpick .quickpick-row').length > 0", 20000);
  const fileSearch = await evaluateJson(`JSON.stringify({
    label: document.querySelector('#quickpick .quickpick-row .quickpick-label')?.textContent || '',
    kind: document.querySelector('#quickpick .quickpick-row .quickpick-kind')?.textContent || '',
    title: document.querySelector('#quickpick .quickpick-heading')?.textContent || '',
  })`);
  check(
    '工作区搜索：文件名完全匹配优先',
    searchInputFocused && fileSearch.label === currentBase && fileSearch.kind.includes('文件'),
    JSON.stringify({ currentBase, searchInputFocused, fileSearch }),
  );
  if (currentSymbol) {
    await evaluate(`(() => { const input = document.querySelector('.quickpick-input'); input.value = ${JSON.stringify(currentSymbol)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await waitFor(`document.querySelector('#quickpick .quickpick-row .quickpick-label')?.textContent === ${JSON.stringify(currentSymbol)}`, 20000);
    await waitFor("document.querySelector('#quickpick .quickpick-preview')?.textContent.includes('Caller')", 15000);
    const functionSearch = await evaluateJson(`JSON.stringify({
      label: document.querySelector('#quickpick .quickpick-row .quickpick-label')?.textContent || '',
      kind: document.querySelector('#quickpick .quickpick-row .quickpick-kind')?.textContent || '',
      location: document.querySelector('#quickpick .quickpick-row .quickpick-location')?.textContent || '',
      preview: document.querySelector('#quickpick .quickpick-preview')?.textContent.slice(0, 120) || '',
    })`);
    check(
      '工作区搜索：函数完全匹配优先并带引用窗预览',
      functionSearch.label === currentSymbol && functionSearch.kind.includes('函数') && functionSearch.preview.includes('Caller'),
      JSON.stringify({ currentSymbol, functionSearch }),
    );
    const separator = functionSearch.location.lastIndexOf(':');
    const targetPath = separator > 0 ? functionSearch.location.slice(0, separator) : '';
    const targetLine = separator > 0 ? Number(functionSearch.location.slice(separator + 1)) : 0;
    await evaluate("document.querySelector('#quickpick .quickpick-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); true");
    await sleep(500);
    const afterSearchJump = await snapshot();
    check(
      '工作区搜索：Enter 跳转到选中函数定义',
      Boolean(targetPath) && afterSearchJump.currentFile === targetPath && afterSearchJump.activeLine === targetLine,
      JSON.stringify({ targetPath, targetLine, after: { file: afterSearchJump.currentFile, line: afterSearchJump.activeLine } }),
    );
  } else {
    await evaluate("document.querySelector('#quickpick .quickpick-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true");
  }
  // 输入框聚焦时 j/k 是搜索词；列表导航用 Ctrl+j/k 或 ↑/↓。
  await dispatchKey('KeyP', 'p', { ctrlKey: true, altKey: true });
  await waitFor("Boolean(document.querySelector('.quickpick-input'))", 5000);
  await evaluate("(() => { const input = document.querySelector('.quickpick-input'); input.value = 'e'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await waitFor("document.querySelectorAll('#quickpick .quickpick-row').length >= 2", 15000);
  await evaluate("document.querySelector('.quickpick-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ctrlKey: true, bubbles: true, cancelable: true })); true");
  await sleep(150);
  const ctrlJActive = await evaluate("[...document.querySelectorAll('#quickpick .quickpick-row')].findIndex((row) => row.classList.contains('active'))");
  await evaluate("document.querySelector('.quickpick-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true })); true");
  await sleep(150);
  const ctrlKActive = await evaluate("[...document.querySelectorAll('#quickpick .quickpick-row')].findIndex((row) => row.classList.contains('active'))");
  check('工作区搜索：Ctrl+j/k 在输入框内选择结果', ctrlJActive === 1 && ctrlKActive === 0, JSON.stringify({ ctrlJActive, ctrlKActive }));
  await evaluate("document.querySelector('.quickpick-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true");

  // #7 nvim 占位：工具条紧凑、无底部重复状态栏、终端占满代码区。
  await evaluate("document.querySelector('#tab-nvim').click(); true");
  await waitFor("Boolean(window.CodeReaderTerminal && window.CodeReaderTerminal.isOpen() && document.querySelectorAll('.xterm-rows > div').length)", 20000);
  await sleep(1800);
  const nvimState = await evaluateJson(`JSON.stringify((() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    };
    return {
      bar: rect('.nvim-bar'),
      term: rect('#nvim-term'),
      codeArea: rect('#code-area'),
      statusbar: rect('.nvim-statusbar'),
      rows: document.querySelectorAll('.xterm-rows > div').length,
    };
  })())`);
  check(
    'nvim 代码区占满（工具条紧凑、无底部重复状态栏）',
    nvimState.bar.height <= 36
    && nvimState.term.height >= nvimState.codeArea.height - 50
    && nvimState.rows >= 30
    && !nvimState.statusbar,
    JSON.stringify(nvimState),
  );
  check('nvim 终端宽度占满代码区', nvimState.term.width === nvimState.codeArea.width, JSON.stringify(nvimState));
  await evaluate("document.querySelector('#tab-editor').click(); true");
  await sleep(200);

  // 过滤框键盘：唯一候选自动高亮 + Enter 直接打开。
  const startedFilter = await snapshot();
  const filesWindow = await evaluateJson('JSON.stringify(window.__ts.fileList(0, 400))');
  const candidates = filesWindow.filter((file) => file !== startedFilter.currentFile);
  let uniqueFilter = null;
  for (const candidate of candidates.slice(0, 25)) {
    const paths = await filterPaths(candidate);
    if (paths.length === 1 && paths[0] === candidate) {
      uniqueFilter = candidate;
      break;
    }
  }
  if (uniqueFilter) {
    const focused = await evaluate("document.querySelector('#file-tree .tree-row-flat.key-focus')?.dataset.path || ''");
    check('过滤唯一候选自动高亮', focused === uniqueFilter, focused);
    await pressFilterKey('Enter');
    await waitFor(`window.__ts.snapshot().currentFile === ${JSON.stringify(uniqueFilter)} && window.__ts.snapshot().sourceLines > 0`, 15000);
    check('唯一候选回车直接打开', true, uniqueFilter);
  } else {
    check('唯一候选回车直接打开', false, '前 25 个文件中未找到唯一过滤结果');
  }

  // 过滤框键盘：↑/↓ 在多个候选间移动。
  let arrowFilter = null;
  for (const candidate of ['.c', '.h', 'drivers/', 'kernel/', 'src/', 'a']) {
    const paths = await filterPaths(candidate);
    if (paths.length >= 2) {
      arrowFilter = candidate;
      break;
    }
  }
  if (arrowFilter) {
    await pressFilterKey('ArrowDown');
    const first = await evaluate("document.querySelector('#file-tree .tree-row-flat.key-focus')?.dataset.path || ''");
    await pressFilterKey('ArrowDown');
    const second = await evaluate("document.querySelector('#file-tree .tree-row-flat.key-focus')?.dataset.path || ''");
    await pressFilterKey('ArrowUp');
    const back = await evaluate("document.querySelector('#file-tree .tree-row-flat.key-focus')?.dataset.path || ''");
    check(
      '过滤框 ↓/↑ 选择候选',
      Boolean(first) && Boolean(second) && first !== second && back === first,
      JSON.stringify({ filter: arrowFilter, first, second, back }),
    );
  } else {
    check('过滤框 ↓/↑ 选择候选', false, '未找到多候选过滤条件');
  }

  // 恢复过滤框与原阅读位置（Enter 打开文件会触发历史 touch，这里写回原值）。
  await evaluate("(() => { const input = document.querySelector('#tree-filter'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await sleep(200);
  if (restoreTarget?.lastFile) {
    await evaluate(`(async () => { await window.__ts.openFile(${JSON.stringify(restoreTarget.lastFile)}, ${restoreTarget.lastLine || 1}, ${restoreTarget.lastCharacter || 0}); })()`);
    await sleep(1200);
  }

  // 打开对话框目录浏览：单击只选中，字母跳转，双击进入并回填路径。
  await evaluate("document.querySelector('#open-menu').click()");
  await waitFor("document.querySelector('#open-dialog')?.open === true");
  await evaluate("document.querySelector('#browse-button').click()");
  await waitFor("document.querySelectorAll('#dir-list .dir-row').length > 0");
  const dirRows = await evaluateJson("JSON.stringify([...document.querySelectorAll('#dir-list .dir-row')].map((row) => ({ name: row.textContent.replace(/Git$/u, '').trim(), path: row.dataset.path })))");
  const firstDir = dirRows[0];
  const singleClick = await evaluateJson("(() => { const row = document.querySelectorAll('#dir-list .dir-row')[0]; row.click(); return JSON.stringify({ selected: row.classList.contains('selected'), input: document.querySelector('#local-path').value, dirPath: document.querySelector('#dir-path').textContent }); })()");
  check(
    '目录浏览器单击只选中（不进入/不回填）',
    singleClick.selected === true && singleClick.input === '' && singleClick.dirPath !== firstDir.path,
    JSON.stringify({ firstDir, singleClick }),
  );
  const firstLetter = firstDir.name.charAt(0).toLowerCase();
  let letterIndex = -1;
  for (let index = 1; index < dirRows.length; index += 1) {
    const letter = dirRows[index].name.charAt(0).toLowerCase();
    if (/[a-z0-9]/.test(letter) && letter !== firstLetter) {
      letterIndex = index;
      break;
    }
  }
  if (letterIndex > 0) {
    const letter = dirRows[letterIndex].name.charAt(0);
    await evaluate(`(() => { const row = document.querySelectorAll('#dir-list .dir-row')[0]; row.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(letter)}, bubbles: true })); return true; })()`);
    const selected = await evaluateJson("JSON.stringify({ index: [...document.querySelectorAll('#dir-list .dir-row')].findIndex((row) => row.classList.contains('selected')), text: document.querySelector('#dir-list .dir-row.selected')?.textContent || '' })");
    check(
      '目录浏览器单击选中后字母跳转',
      selected.index > 0 && selected.text.toLowerCase().startsWith(letter.toLowerCase()),
      JSON.stringify(selected),
    );
    const selectedPath = selected.index > 0 ? dirRows[selected.index]?.path : null;
    if (selectedPath) {
      await evaluate("document.querySelector('#dir-list .dir-row.selected').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))");
      await waitFor(`document.querySelector('#dir-path').textContent === ${JSON.stringify(selectedPath)}`, 15000);
      const enteredByKey = await evaluateJson("JSON.stringify({ dirPath: document.querySelector('#dir-path').textContent, input: document.querySelector('#local-path').value })");
      check(
        '目录浏览器 Enter 进入选中目录',
        enteredByKey.dirPath === selectedPath && enteredByKey.input === selectedPath,
        JSON.stringify({ expected: selectedPath, enteredByKey }),
      );
      await evaluate("document.querySelector('#dir-up').click()");
      await waitFor(`document.querySelector('#dir-path').textContent === ${JSON.stringify(singleClick.dirPath)}`, 15000);
    } else {
      check('目录浏览器 Enter 进入选中目录', false, JSON.stringify(selected));
    }
  } else {
    check('目录浏览器单击选中后字母跳转', false, '没有不同首字母的目录');
    check('目录浏览器 Enter 进入选中目录', false, '没有不同首字母的目录');
  }
  await evaluate("(() => { const row = document.querySelectorAll('#dir-list .dir-row')[0]; row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()");
  await waitFor(`document.querySelector('#dir-path').textContent === ${JSON.stringify(firstDir.path)}`, 15000);
  const enteredDir = await evaluateJson("JSON.stringify({ dirPath: document.querySelector('#dir-path').textContent, input: document.querySelector('#local-path').value })");
  check(
    '目录浏览器双击进入并回填路径',
    enteredDir.dirPath === firstDir.path && enteredDir.input === firstDir.path,
    JSON.stringify({ expected: firstDir.path, enteredDir }),
  );
  await evaluate("document.querySelector('#dialog-close').click()");

  if (doSwitch && entries.length > 1) {
    const targetEntry = entries.find((entry) => entry.key !== activeEntry.key);
    // 切仓前重新取目标仓最新阅读位置，避免用户并发操作导致的假失败。
    const targetHistoryNow = await api('/api/history');
    const targetHistory = (targetHistoryNow.repositories || []).find((item) => item.path === targetEntry.path) || historyFor(targetEntry);
    const switched = JSON.parse(await evaluate(`(async () => JSON.stringify(await window.__ts.switchRepository(${JSON.stringify(targetEntry.name)})))()`));
    check(
      '页签切换到另一仓库并恢复其上次位置',
      switched.repository === targetEntry.name
      && (!targetHistory?.lastFile || switched.currentFile === targetHistory.lastFile)
      && (!targetHistory?.lastLine || switched.activeLine === targetHistory.lastLine),
      JSON.stringify({ expected: targetHistory, actual: switched }),
    );
    await send('Page.reload', { ignoreCache: true });
    await waitReady();
    const reloaded = await snapshot();
    const reloadHistoryNow = await api('/api/history');
    const reloadLatest = (reloadHistoryNow.repositories || []).find((item) => item.path === targetEntry.path) || targetHistory;
    const matchesTarget = (entry) => !entry?.lastFile
      || (reloaded.currentFile === entry.lastFile && (!entry.lastLine || reloaded.activeLine === entry.lastLine));
    check(
      '切换后刷新默认打开该仓库',
      reloaded.repository?.name === targetEntry.name
      && (matchesTarget(targetHistory) || matchesTarget(reloadLatest)),
      JSON.stringify({ repository: reloaded.repository?.name, file: reloaded.currentFile, line: reloaded.activeLine, targetHistory, reloadLatest }),
    );

    // 等后台预载/建树完成，先测一次缓存切换的真实耗时（页面内计时）。
    await sleep(3000);
    const timingSnapshot = await snapshot();
    const timingTarget = entries.find((entry) => entry.key !== timingSnapshot.workspace.activeKey);
    if (timingTarget) {
      const timedSwitch = JSON.parse(await evaluate(`(async () => { const t0 = performance.now(); await window.__ts.switchRepository(${JSON.stringify(timingTarget.key)}); return JSON.stringify({ ms: Math.round(performance.now() - t0) }); })()`));
      console.log(`INFO 工作区缓存切换实际耗时 ${timedSwitch.ms}ms`);
      check('工作区缓存切换实际耗时 < 400ms', timedSwitch.ms < 400, `${timedSwitch.ms}ms`);
    }
    const beforeShortcut = await snapshot();
    const currentIndex = entries.findIndex((entry) => entry.key === beforeShortcut.workspace.activeKey);
    const nextEntry = entries[(currentIndex + 1) % entries.length];
    const shortcutStart = Date.now();
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketRight', key: ']', ctrlKey: true, altKey: true, bubbles: true }))");
    await waitFor(`window.__ts.snapshot().workspace.activeKey === ${JSON.stringify(nextEntry.key)} && document.querySelector('.workspace-tab.active .workspace-tab-name')?.textContent === ${JSON.stringify(nextEntry.name)}`, 30000);
    const shortcutMs = Date.now() - shortcutStart;
    const shortcutSnapshot = await snapshot();
    const activeTabName = await evaluate("document.querySelector('.workspace-tab.active .workspace-tab-name')?.textContent || ''");
    console.log(`INFO 工作区缓存切换耗时 ${shortcutMs}ms`);
    check(
      'Ctrl+Alt+] 切换到下一个工作区仓库',
      shortcutSnapshot.repository?.name === nextEntry.name && activeTabName === nextEntry.name,
      JSON.stringify({ expected: nextEntry.name, actual: shortcutSnapshot.repository?.name, activeTabName }),
    );
    check('工作区缓存切换耗时 < 1200ms', shortcutMs < 1200, `${shortcutMs}ms`);

    const directIndex = nextEntry.key === entries[0].key ? 1 : 0;
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit${directIndex + 1}', key: '${directIndex + 1}', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }))`);
    await waitFor(`window.__ts.snapshot().workspace.activeKey === ${JSON.stringify(entries[directIndex].key)}`, 30000);
    const directSnapshot = await snapshot();
    check(
      'Ctrl+Alt+Shift+数字 直达工作区页签',
      directSnapshot.repository?.name === entries[directIndex].name,
      JSON.stringify({ expected: entries[directIndex].name, actual: directSnapshot.repository?.name }),
    );

    const previousEntry = entries[(directIndex - 1 + entries.length) % entries.length];
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketLeft', key: '[', ctrlKey: true, altKey: true, bubbles: true }))");
    await waitFor(`window.__ts.snapshot().workspace.activeKey === ${JSON.stringify(previousEntry.key)}`, 30000);
    const previousSnapshot = await snapshot();
    check(
      'Ctrl+Alt+[ 切换到上一个工作区仓库',
      previousSnapshot.repository?.name === previousEntry.name,
      JSON.stringify({ expected: previousEntry.name, actual: previousSnapshot.repository?.name }),
    );
  }

  } finally {
  // 恢复验收前的当前仓库，避免测试改变用户下次刷新落点。
  try {
    await fetch(new URL('/api/workspace/activate', appUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: activeEntry.key }),
    });
  } catch {
    // 恢复失败不掩盖验收结论
  }
  try {
    socket?.close();
  } catch {
    // 已关闭
  }
  chrome.kill('SIGTERM');
  await sleep(800);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`RESULT ${failures === 0 ? 'PASS' : 'FAIL'} checks=${checks} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);