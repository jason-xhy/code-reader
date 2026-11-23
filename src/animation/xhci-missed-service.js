import { detectFunctionSegment } from '../faq.js';

class UnsupportedSceneSource extends Error {}

export function createXhciMissedServiceScene(input) {
  try { return buildScene(input); }
  catch (error) { if (error instanceof UnsupportedSceneSource) return null; throw error; }
}

// This scene is a checked teaching scenario, not model-authored executable content.
// Bind it only to the driver branches whose semantics are shown below.
function buildScene({ source, filePath, question = '', line = 1, documentation = [] }) {
  if (!/(^|\/)xhci-ring\.c$/.test(filePath)) return null;
  const lines = source.content.split('\n');
  if (!/COMP_MISSED_SERVICE_ERROR/.test(question + (lines[line - 1] || ''))) return null;
  const scopes = {};
  for (const name of ['handle_tx_event', 'process_isoc_td', 'find_td_by_dma', 'xhci_dequeue_td']) {
    const start = lines.findIndex(text => new RegExp(`^static\\s+.*\\b${name}\\(`).test(text));
    if (start < 0) return null;
    const segment = detectFunctionSegment(source.content, start + 1);
    if (!segment || segment.symbol !== name) return null;
    scopes[name] = { start: segment.lineStart, end: segment.lineEnd, text: lines.slice(segment.lineStart - 1, segment.lineEnd).join('\n') };
  }
  const tx = scopes.handle_tx_event.text, iso = scopes.process_isoc_td.text;
  const guards = [
    /case COMP_MISSED_SERVICE_ERROR:[\s\S]*?ep->skip = true;/,
    /COMP_MISSED_SERVICE_ERROR && !find_td_by_dma\(ep_ring, ep_trb_dma\)/,
    /ep->skip && usb_endpoint_xfer_isoc/,
    /xhci_dequeue_td\(xhci, td, ep_ring, 0\)/,
    /ep->skip = false;/,
  ];
  if (!guards.every(pattern => pattern.test(tx)) ||
      !/case COMP_MISSED_SERVICE_ERROR:\s*frame->status = -EXDEV;\s*sum_trbs_for_length = true;/.test(iso) ||
      !/sum_trb_lengths\(td, ep_trb\)\s*\+\s*ep_trb_len - remaining/.test(iso) ||
      !/if \(dma\)[\s\S]*trb_in_td\(td, dma\)[\s\S]*return NULL/.test(scopes.find_td_by_dma.text) ||
      !/ring->dequeue = td->end_trb;[\s\S]*inc_deq/.test(scopes.xhci_dequeue_td.text)) return null;

  const code = (name, needle, length = 7, offset = 0) => {
    const scope = scopes[name];
    const relative = scope.text.split('\n').findIndex(text => text.includes(needle));
    if (relative < 0) throw new UnsupportedSceneSource(`Missing checked scene anchor: ${name}/${needle}`);
    const start = Math.max(scope.start, scope.start + relative + offset);
    const end = Math.min(scope.end, start + length - 1);
    return { file: filePath, lineStart: start, lineEnd: end, symbol: name,
      excerpt: lines.slice(start - 1, end).map((text, i) => `${start + i}  ${text}`).join('\n') };
  };
  const entry = code('handle_tx_event', 'case COMP_MISSED_SERVICE_ERROR:', 13);
  const lookup = code('handle_tx_event', 'trb_comp_code == COMP_MISSED_SERVICE_ERROR && !find_td_by_dma', 2);
  const skip = code('handle_tx_event', 'if (ep->skip && usb_endpoint_xfer_isoc', 11);
  const match = code('handle_tx_event', 'if (ep->skip) {', 7);
  const failure = code('process_isoc_td', 'case COMP_MISSED_SERVICE_ERROR:', 6);
  const length = code('process_isoc_td', 'if (sum_trbs_for_length)', 9);
  const finish = code('process_isoc_td', 'finish_td:', 10);
  const success = code('process_isoc_td', 'case COMP_SUCCESS:', 9);
  const dequeue = code('xhci_dequeue_td', 'ring->dequeue', 6);
  const find = code('find_td_by_dma', 'if (dma)', 6);
  const hits = documentation.filter(hit => /Missed Service|4\.10\.3\.2/.test(hit.text || hit.excerpt || ''));
  const primary = hits.find(hit => /This error only applies to Isochronous/.test(hit.text || hit.excerpt || '')) || hits[0];
  const spec = { section: 'xHCI §4.10.3.2 · Missed Service Error', source: primary?.source || '',
    verified: Boolean(primary), excerpt: primary ? hits.filter(hit => hit.source === primary.source)
      .map(hit => hit.text || hit.excerpt).join('\n').slice(0, 4200) : '',
    rule: '错过所属 ESIT 的 Isoch 数据丢弃；下一 ESIT 尝试下一 TD。事件环满恢复后，可报告最后一个未完成 TD。',
  };
  const initial = () => ({ queue: ['A', 'B', 'C', 'D'], frames: {}, hardware: ['pending', 'pending', 'pending', 'pending'], clock: 0,
    skip: false, event: null, eventQueue: [], urbActual: 0, formula: '', focus: null });
  const eventC = { code: 'COMP_MISSED_SERVICE_ERROR (23)', target: 'C', pointer: '0x3000', remaining: 64, handled: false };
  const eventD = { code: 'COMP_SUCCESS (1)', target: 'D', pointer: '0x4000', remaining: 0, handled: false };
  const step = (id, title, detail, snapshot, evidence, extra = {}) => ({ id, title, detail, node: 'driver',
    file: filePath, lineStart: evidence[0].lineStart, lineEnd: evidence[0].lineEnd,
    spec: spec.section, evidence, snapshot: structuredClone(snapshot), ...extra });
  const main = [], s = initial();
  const add = (id, title, detail, evidence, extra) => main.push(step(id, title, detail, s, evidence, extra));
  add('queued', 'A / B / C / D 已排队，各属一个 ESIT', '每个 TD 只有一个 128 B TRB。事件指针地址为演示值；初始无旧 error_mid_td。各窗口宽度表示相邻服务机会，不代表具体微秒数。', [entry], { hardwareOnly: true });
  s.hardware[0] = 'missed'; s.clock = 1;
  add('miss-a', 'ESIT A 结束：A 错过服务', '假设周期数据 DMA 延迟，A 未能在自己的窗口内完成。A 的数据不能挪到 B 的窗口重试；硬件继续推进，软件队列暂未改变。假设 Event Ring 满，错误事件尚无法投递。', [entry], { hardwareOnly: true });
  s.hardware[1] = 'missed'; s.clock = 2;
  add('miss-b', 'ESIT B 结束：B 也错过服务', '异常持续，B 的数据同样过期。红色的是错过的硬件服务机会，软件队首仍为 A；驱动尚未收到可用事件。', [entry], { hardwareOnly: true });
  s.hardware[2] = 'missed'; s.clock = 3; s.eventQueue = ['C · MISSED_SERVICE'];
  add('miss-c', 'ESIT C 结束：投递最后未完成 TD 的事件', 'C 也错过时限。假设事件环恢复空间，按规范为该 Transfer Ring 投递最后未完成的 C。事件指向 C 的末尾 TRB，remaining=64 B；不是宣称所有 MSE 都会合并。', [entry], { hardwareOnly: true });
  s.hardware[3] = 'success'; s.clock = 4; s.eventQueue.push('D · SUCCESS');
  add('hardware-d', '硬件已尝试 D 并成功，软件还没追上', '下一 ESIT 属于 D。假设 D 按时完成并排入成功事件。硬件继续调度不依赖 Linux 清 skip；以下软件处理步骤固定在这个硬件时间快照，不能按播放时长理解真实中断延迟。', [entry], { hardwareOnly: true });
  s.event = { ...eventC }; s.skip = true; s.focus = 'C'; s.eventQueue = ['D · SUCCESS'];
  add('set-skip', '消费 C 的错误事件：skip = true', '事件指针 0x3000 指向 C，软件队首仍是 A。只设置跳过模式，不重试过期 TD。地址非零并不自动证明有效。', [entry]);
  add('find-c', '找到 C：建立定位锚点，不移动队首', 'find_td_by_dma() 在当前队列找到 C，因此 MSE 专用守卫允许继续。黄色箭头指向事件 TRB 所属 C，蓝色标记仍指软件队首 A。', [lookup, find]);
  s.queue.shift(); s.frames.A = { status: '-EXDEV', actual: 0, disposition: 'skipped' }; s.focus = 'A';
  add('skip-a', '事件不属于 A：A 出队', 'skip=true 且 A 是等时 TD。驱动调用 xhci_dequeue_td(..., 0)，软件 dequeue 越过 A 的末尾；A 帧保留 core 预置的 -EXDEV / 0 B。参数 0 不会把帧改成成功。', [skip, dequeue]);
  s.queue.shift(); s.frames.B = { status: '-EXDEV', actual: 0, disposition: 'skipped' }; s.focus = 'B';
  add('skip-b', '同一事件不属于 B：B 出队', '继续使用同一个指向 C 的事件检查新队首 B。B 出队，仍是 -EXDEV / 0 B；没有消费第二个事件，也没有重传 A 或 B。', [skip, dequeue]);
  s.skip = false; s.focus = 'C';
  add('match-c', '队首现在是 C：恢复对齐，skip = false', '事件指针与当前队首 C 匹配，清除 skip。C 是错误事件直接指向的 TD，不属于前面被跳过的 A、B；D 保留在队列。', [match]);
  s.frames.C = { status: '-EXDEV', actual: null, disposition: 'processing' };
  add('fail-c', '处理 C：显式记录 -EXDEV', 'process_isoc_td() 对 MSE 写入 frame->status=-EXDEV 并启用长度求和。本场景事件指到 C 的末尾，因此不设置 error_mid_td。', [failure]);
  s.frames.C.actual = 64; s.urbActual = 64; s.formula = 'C.actual_length = 0 + 128 − 64 = 64 B';
  add('length-c', '按 TRB 剩余量计算：C = -EXDEV / 64 B', '单 TRB 场景下，事件 TRB 之前的字节和为 0，当前 TRB 长度 128 B，剩余 64 B。记账 64 B 并累加 URB；非零实际长度不代表按时成功，也不能把 A、B 改为 64 B。', [length, failure]);
  s.queue.shift(); s.frames.C.disposition = 'completed'; s.event.handled = true;
  add('finish-c', '收尾 C：只剩 D，skip 保持 false', 'C 的事件指在 TD 末尾，调用 finish_td() 收尾。已消费的黄色事件指针仍标识 C，颜色变灰并指向结果栏；它不是队首指针。', [finish]);
  s.event = { ...eventD }; s.eventQueue = []; s.focus = 'D'; s.formula = '';
  add('event-d', '取出 D 的成功事件：指针移动到 D', '接下来消费已排队的 D 成功事件。黄色事件指针和蓝色软件队首都落在 D，不需要再跳过任何 TD。', [match, success]);
  s.frames.D = { status: '0', actual: 128, disposition: 'processing' }; s.urbActual = 192;
  s.formula = 'D.actual_length = requested = 128 B；URB = 64 + 128 = 192 B';
  add('length-d', 'D 正常记账：0 / 128 B', 'D 无中途错误且 remaining=0，成功路径按 requested 记账 128 B。示例假设四个帧属于同一个 URB，累计实际长度 192 B；逐帧错误状态仍分别保留。', [success, length]);
  s.queue = []; s.frames.D.disposition = 'completed'; s.event.handled = true; s.focus = null;
  add('aligned', '队列清空：完成对齐，失败帧仍然失败', '最终 A=-EXDEV/0，B=-EXDEV/0，C=-EXDEV/64，D=0/128。软件完成队列清理；没有把过期数据重排到未来服务窗口。此处不把逐帧错误和整个 URB 的最终状态混为一谈。', [finish]);

  const z = initial(), zero = [];
  const addZero = (id, title, detail, evidence) => zero.push(step(id, title, detail, z, evidence));
  z.hardware = ['missed', 'missed', 'missed', 'success']; z.clock = 4;
  z.event = { ...eventC, target: null, pointer: '0x0', remaining: 64 }; z.skip = true; z.eventQueue = ['D · SUCCESS'];
  addZero('zero-pointer', '独立分支：零指针，先保留 skip', '重置到独立场景。MSE 指针为 0，find_td_by_dma 返回 NULL，守卫立即返回，队列保持 A/B/C/D。这里只演示当前 Linux 的兼容分支；未提供 xHCI 1.0 原文，不把零指针称为 1.2b 的合法格式。假设没有旧 error_mid_td。', [entry, lookup, find]);
  z.event = { ...eventD }; z.eventQueue = []; z.focus = 'D';
  addZero('later-d', '后续 D 成功事件提供有效定位', 'D 的正常事件到达，指向 0x4000。skip 从之前保留下来，队首仍为 A。普通成功事件不走 MSE 专用查找守卫。', [match]);
  for (const id of ['A', 'B', 'C']) {
    z.queue.shift(); z.frames[id] = { status: '-EXDEV', actual: 0, disposition: 'skipped' }; z.focus = id;
    addZero(`zero-skip-${id.toLowerCase()}`, `跳过 ${id}：保留 -EXDEV / 0 B`, `D 的地址不属于队首 ${id}，逐个移除。没有 C 的有效错误事件，不能为 C 推导部分长度。`, [skip, dequeue]);
  }
  z.skip = false; z.focus = 'D';
  addZero('zero-match-d', '匹配 D，清 skip', '队首终于追上事件指针 D。清 skip 后，D 携带的是自己的成功事件，不是最早那个无法定位的错误。', [match]);
  z.frames.D = { status: '0', actual: 128, disposition: 'completed' }; z.queue = []; z.urbActual = 128;
  z.event.handled = true; z.formula = 'D.actual_length = requested = 128 B；URB = 128 B';
  addZero('zero-complete', 'D 成功完成，A/B/C 都是跳过的零长度帧', 'D 按 128 B 正常完成；A/B/C 各为 -EXDEV/0。此分支独立于主场景的 C=-EXDEV/64，不能串接两种结局。', [success, length, finish]);

  return { title: '错过 ESIT 后，硬件与 Linux 如何重新对齐',
    summary: '可操作状态场景 · 相邻 ESIT、TD 队列、TRB 事件指针与 skip。128/64 B、地址及 DMA 延迟为演示假设；单 TRB/TD，无旧中途错误。',
    nodes: [{ id: 'driver', label: 'xHCI 等时事件处理', kind: 'code', description: '基于当前源码核对的状态场景' }], steps: main,
    scene: { type: 'xhci-missed-service', version: 1, spec,
      tds: ['A', 'B', 'C', 'D'].map((id, i) => ({ id, requested: 128, pointer: `0x${i + 1}000`, esit: i + 1 })),
      scenarios: [{ id: 'main', title: '有效 C 指针 · 部分长度 · 恢复对齐', steps: main }, { id: 'zero', title: '独立对照 · 零指针等待 D 事件', steps: zero }] },
  };
}
