// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: nvim PTY 通道与应用仓库会话强绑定
// grill: 成品检索=skill 库无 nvim PTY 通道成品; 输入固定=HTTP upgrade + WS JSON 消息; 步骤机械=校验仓库/路径→spawn PTY→双向转发; 判读固定=进程退出码与 WS 消息; 失效场景=构造不出（仅本应用）
import path from 'node:path';
import pty from 'node-pty';
import { WebSocketServer } from 'ws';
import { editorStatus } from './editor-env.js';
import { getRepository } from './repositories.js';

const MAX_INPUT_BYTES = 1024 * 1024;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;

function resolveRepositoryFile(root, file) {
  if (typeof file !== 'string' || !file || file.includes('\0') || path.isAbsolute(file)) return null;
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(`${root}${path.sep}`)) return null;
  return absolute;
}

// 浏览器端的 nvim 面板：每个 WebSocket 对应一个本地 nvim PTY，cwd 为仓库根，
// 继承用户的 HOME/XDG 环境，因此本地 nvim 配置与全部插件原样可用。
export function attachNvim(server, { port }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT_BYTES });
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);

  server.on('upgrade', (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, 'http://127.0.0.1');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/nvim') {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, url));
  });

  wss.on('connection', async (ws, url) => {
    const pending = [];
    let pendingBytes = 0;
    const bufferInput = (raw) => {
      pendingBytes += raw.length;
      if (pendingBytes > MAX_INPUT_BYTES) ws.close(1009, '输入过大');
      else pending.push(raw);
    };
    ws.on('message', bufferInput);
    let status;
    try { status = await editorStatus(); } catch {
      if (ws.readyState === 1) { ws.send(JSON.stringify({ t: 'e', m: '无法检测本地编辑器环境，请打开编辑器环境重新检测' })); ws.close(1011, '编辑器检测失败'); }
      return;
    }
    const active = status.active;
    if (ws.readyState !== 1) return;
    if (!status.available || process.env.CODE_READER_EDITOR_DISABLED === '1') {
      try {
        ws.send(JSON.stringify({ t: 'e', m: '未关联本地 vim/neovim 环境，已回退内置编辑器' }));
      } catch {
        // 连接可能已关闭
      }
      ws.close(1011, '编辑器环境不可用');
      return;
    }
    let repository;
    try {
      repository = getRepository(url.searchParams.get('repository') || '');
    } catch {
      ws.close(1008, '仓库未打开');
      return;
    }
    const file = url.searchParams.get('file') || '';
    const absolute = file ? resolveRepositoryFile(repository.root, file) : null;
    if (file && !absolute) {
      ws.close(1008, '文件路径无效');
      return;
    }
    const line = Math.max(1, Number.parseInt(url.searchParams.get('line') || '1', 10) || 1);
    const args = absolute ? [`+${line}`, absolute] : [];

    let term;
    try {
      term = pty.spawn(active.command, args, {
        name: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: repository.root,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
    } catch (error) {
      try {
        ws.send(JSON.stringify({ t: 'e', m: `无法启动 ${active.program}（${active.command}）：${error.message}` }));
      } catch {
        // 连接可能已关闭
      }
      ws.close(1011, `${active.program} 启动失败`);
      return;
    }

    ws.send(JSON.stringify({ t: 'ready', program: active.program }));
    term.onData((data) => {
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({ t: 'd', d: data }));
    });
    term.onExit(({ exitCode }) => {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ t: 'x', code: exitCode }));
        } catch {
          // 连接可能已关闭
        }
        ws.close(1000);
      }
    });

    const handleInput = (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      if (message.t === 'i' && typeof message.d === 'string') {
        term.write(message.d);
        return;
      }
      if (message.t === 'r') {
        const cols = Math.max(20, Math.min(400, Number(message.c) || DEFAULT_COLS));
        const rows = Math.max(5, Math.min(200, Number(message.r) || DEFAULT_ROWS));
        try {
          term.resize(cols, rows);
        } catch {
          // 进程可能已退出
        }
      }
    };
    ws.removeListener('message', bufferInput);
    ws.on('message', handleInput);
    for (const raw of pending) handleInput(raw);
    const shutdown = () => {
      try {
        term.kill();
      } catch {
        // 进程可能已退出
      }
    };
    ws.on('close', shutdown);
    ws.on('error', shutdown);
  });

  return wss;
}