// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 浏览器 nvim 终端面板与 code-reader 服务端 PTY 强绑定
// grill: 成品检索=skill 库无 code-reader xterm 面板成品; 输入固定=固定 DOM 容器与 WS 消息; 步骤机械=建终端/连 WS/转发输入与尺寸; 判读固定=WS 消息类型与终端尺寸; 失效场景=构造不出（仅本应用）
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#9fc7f7',
  cursorAccent: '#0d1117',
  selectionBackground: '#264f78',
  black: '#161b22',
  red: '#f47067',
  green: '#7ee787',
  yellow: '#d29922',
  blue: '#6cb6ff',
  magenta: '#d2a8ff',
  cyan: '#76e3ea',
  white: '#c9d1d9',
  brightBlack: '#6e7681',
  brightRed: '#ff938a',
  brightGreen: '#9be9a8',
  brightYellow: '#e3b341',
  brightBlue: '#96d0ff',
  brightMagenta: '#e2c5ff',
  brightCyan: '#b3f0ff',
  brightWhite: '#f0f6fc',
};

let term = null;
let fitAddon = null;
let socket = null;
let session = null;
let observer = null;

function host() {
  return document.getElementById('nvim-host');
}

function termHost() {
  return document.getElementById('nvim-term');
}

function statusEl() {
  return document.getElementById('nvim-status');
}

function setStatus(text) {
  const el = statusEl();
  if (el) el.textContent = text;
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function fitNow() {
  if (!term || !fitAddon) return;
  const container = termHost();
  if (!container || !container.offsetWidth || !container.offsetHeight) return;
  try {
    fitAddon.fit();
  } catch {
    // 容器不可见时忽略
  }
}

function createTerminal() {
  term = new Terminal({
    allowProposedApi: true,
    convertEol: false,
    cursorBlink: true,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 1.15,
    scrollback: 10000,
    theme: THEME,
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(termHost());
  term.onData((data) => send({ t: 'i', d: data }));
  term.onResize(({ cols, rows }) => send({ t: 'r', c: cols, r: rows }));
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true;
    const key = event.key.toLowerCase();
    if (key === 'c' && term.hasSelection()) {
      navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
      return false;
    }
    if (key === 'v') {
      navigator.clipboard?.readText()
        .then((text) => { if (text) send({ t: 'i', d: text }); })
        .catch(() => {});
      return false;
    }
    return true;
  });
  termHost().addEventListener('mousedown', () => term.focus());
  observer = new ResizeObserver(() => fitNow());
  observer.observe(termHost());
}

function disconnect() {
  if (socket) {
    try {
      socket.close();
    } catch {
      // 已关闭
    }
    socket = null;
  }
  session = null;
}

function connect({ repositoryId, file, line }) {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({ repository: repositoryId });
  if (file) {
    params.set('file', file);
    params.set('line', String(Math.max(1, line || 1)));
  }
  socket = new WebSocket(`${scheme}://${location.host}/nvim?${params.toString()}`);
  socket.onopen = () => {
    setStatus(file ? `nvim · ${file}` : 'nvim');
    fitNow();
    term?.focus();
  };
  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.t === 'd') {
      term?.write(message.d);
      return;
    }
    if (message.t === 'x') {
      setStatus(`nvim 已退出（${message.code}）`);
      return;
    }
    if (message.t === 'e') {
      setStatus(message.m || 'nvim 启动失败');
      term?.write(`\r\n\x1b[31m${message.m || 'nvim 启动失败'}\x1b[0m\r\n`);
    }
  };
  socket.onclose = () => {
    socket = null;
    if (session) setStatus('连接已断开，点「重启」重连');
  };
}

function open(options) {
  if (!options?.repositoryId) {
    setStatus('先打开一个仓库');
    return;
  }
  const sameSession = session && session.repositoryId === options.repositoryId;
  if (!term) createTerminal();
  if (sameSession && socket && socket.readyState <= WebSocket.OPEN) {
    fitNow();
    term.focus();
    return;
  }
  disconnect();
  session = { repositoryId: options.repositoryId };
  setStatus('正在启动 nvim…');
  connect(options);
}

function close() {
  disconnect();
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (term) {
    term.dispose();
    term = null;
    fitAddon = null;
  }
  const container = termHost();
  if (container) container.textContent = '';
}

function refreshSize() {
  fitNow();
}

function openFile(file, line) {
  if (!term) return;
  const target = String(file || '').replace(/ /g, '\\ ');
  if (!target) return;
  send({ t: 'i', d: `\u001b:e ${target}\r` });
  if (line && line > 1) send({ t: 'i', d: `:${line}\r` });
  term.focus();
}

window.CodeReaderTerminal = { open, close, openFile, refreshSize, isOpen: () => Boolean(term) };