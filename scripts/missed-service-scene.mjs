// Rebuild the source-checked state scene alongside the previously saved real LLM answer.
// No model request is needed: state transitions and code excerpts are derived locally.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createXhciMissedServiceScene } from '../src/animation/xhci-missed-service.js';
import { createAnimationHtml } from '../public/animation-html.js';
const output = new URL('../bug-reports/missed-service-20261122/', import.meta.url);
const root = process.env.CODE_READER_KERNEL_ROOT || '/Volumes/kernel-data/KernelSrc/linux';
const filePath = 'drivers/usb/host/xhci-ring.c';
const content = await readFile(`${root}/${filePath}`, 'utf8');
const previous = JSON.parse(await readFile(new URL('response.json', output), 'utf8'));
const input = { source: { content }, filePath, question: 'COMP_MISSED_SERVICE_ERROR 3D 动画', documentation: previous.sources.local };
const animation = createXhciMissedServiceScene(input);
assert(animation, 'Current source must match the checked driver branches');
const ids = ['A', 'B', 'C', 'D'];
for (const scenario of animation.scene.scenarios) {
  let lastClock = 0;
  for (const step of scenario.steps) {
    const s = step.snapshot;
    assert(s.clock >= lastClock, 'Hardware time cannot run backwards inside one scenario'); lastClock = s.clock;
    assert.equal(new Set(s.queue).size, s.queue.length);
    for (const id of ids) {
      assert(s.queue.includes(id) || s.frames[id], `${id} must remain queued or have a result`);
      if (s.frames[id]?.disposition === 'skipped') assert.deepEqual([s.frames[id].status, s.frames[id].actual], ['-EXDEV', 0]);
    }
    assert.equal(s.urbActual, Object.values(s.frames).reduce((sum, frame) => sum + (frame.actual || 0), 0));
    for (const evidence of step.evidence) {
      const expected = content.split('\n').slice(evidence.lineStart - 1, evidence.lineEnd).map((line, i) => `${evidence.lineStart + i}  ${line}`).join('\n');
      assert.equal(evidence.excerpt, expected, 'Each displayed code excerpt must match this repository');
    }
  }
}
const states = Object.fromEntries(animation.steps.map(step => [step.id, step.snapshot]));
assert.deepEqual(states['skip-a'].queue, ['B', 'C', 'D']);
assert.deepEqual(states['skip-b'].queue, ['C', 'D']);
assert.equal(states['match-c'].skip, false);
assert.equal(states['length-c'].frames.C.actual, 64);
assert.equal(states['length-c'].frames.C.status, '-EXDEV');
assert.deepEqual(states.aligned.queue, []);
assert.equal(states.aligned.urbActual, 192);
assert.equal(animation.scene.scenarios[1].steps.at(-1).snapshot.frames.C.actual, 0);
assert.equal(states.queued.frames.C, undefined, 'Later transitions must not mutate earlier snapshots');
assert.equal(createXhciMissedServiceScene({ ...input, filePath: 'other.c' }), null);
assert.equal(createXhciMissedServiceScene({ ...input, source: { content: content.replace('ep_trb_len - remaining', 'ep_trb_len + remaining') } }), null, 'Different driver semantics must not receive this scene');
assert.equal(createXhciMissedServiceScene({ ...input, source: {content: content.replace('if (ep->skip) {', 'if (ep->skip == true) {')} }), null, 'Unsupported code anchor must fall back, not fail the explanation');
assert.equal(createXhciMissedServiceScene({ ...input, documentation: [] }).scene.spec.verified, false);
const runtime = await readFile(new URL('../public/vendor/three/animation.bundle.js', import.meta.url), 'utf8');
await writeFile(new URL('scene-response.json', output), JSON.stringify({ ...previous, explanation: { ...previous.explanation, animation }, animationOrigin: 'source-checked-state-scene' }, null, 2));
await writeFile(new URL('animation.html', output), createAnimationHtml(animation, runtime));
console.log(`PASS checked scene: ${animation.steps.length} main steps, ${animation.scene.scenarios[1].steps.length} zero-pointer steps, code excerpts, frame/URB accounting, source mismatch guards`);
