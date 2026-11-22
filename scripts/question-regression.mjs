// Exercise the actual question lifecycle against controlled asynchronous replies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { ANIMATION_HINT_RE } from '../public/core/config.js';
const source = await readFile(new URL('../public/features/insights.js', import.meta.url), 'utf8');
const lifecycle = source.slice(source.indexOf('let questionRequest = null;'), source.indexOf('export function renderQuestionPresets'))
  .replaceAll('export function', 'function');
const control = () => ({ value: '', disabled: false, hidden: false, textContent: '', focus() {} });
const state = { source: {}, repository: { id: 'test' }, currentFile: 'demo.c', activeLine: 1 };
const elements = Object.fromEntries(['questionEditor', 'questionAnchor', 'questionError', 'questionInput', 'questionSubmit', 'questionCancel', 'questionAnimation'].map((name) => [name, control()]));
const requests = [];
const context = vm.createContext({
  state, elements, AbortController, ANIMATION_HINT_RE, window: {}, document: { addEventListener() {}, removeEventListener() {} },
  editor: { getCursor: () => ({ line: 1 }) }, noteFocusIntent() {}, renderExplanation() {}, fetchFaq() {},
  focusExplanationPanel() {}, setTimeout, api: (url, options) => new Promise((resolve, reject) => requests.push({ resolve, reject, options })),
});
vm.runInContext(lifecycle, context);
context.openQuestion();
elements.questionInput.value = 'old';
const old = context.submitQuestion();
assert.equal(elements.questionCancel.disabled, false);
context.closeQuestion();
assert.equal(requests[0].options.signal.aborted, true);
assert.equal(state.explaining, false);
assert.equal(elements.questionInput.disabled, false);
context.openQuestion();
elements.questionInput.value = 'new';
const fresh = context.submitQuestion();
requests[0].resolve({ explanation: { overview: 'stale' } });
await old;
assert.equal(state.explaining, true, 'late old finally must not reset the new request');
assert.equal(state.explanation.status, 'loading');
requests[1].resolve({ explanation: { overview: 'fresh' } });
await fresh;
assert.equal(state.explanation.explanation.overview, 'fresh');
assert.equal(state.explaining, false);
assert.equal(elements.questionInput.disabled, false);
console.log('PASS cancellation, immediate resubmit, late old reply, new result preserved');

context.openQuestion();
elements.questionInput.value = '请用3D动画解释';
elements.questionAnimation.checked = false;
const animationRequest = context.submitQuestion();
assert.equal(JSON.parse(requests[2].options.body).animate, true);
assert.match(elements.questionSubmit.textContent, /3D/);
requests[2].resolve({ explanation: { overview: 'animation' } });
await animationRequest;
console.log('PASS animation keyword and loading label agree without checkbox input event');

// FAQ results belong to a repository instance as well as its path.
const faqState = {repository:{id:'old'}, currentFile:'same.c'};
const faqRequests=[];
const faqContext=vm.createContext({state:faqState,AbortController,renderFaq(){},api:()=>new Promise(resolve=>faqRequests.push(resolve))});
vm.runInContext(source.slice(source.indexOf('export async function fetchFaq('),source.indexOf('export function renderFaq(')).replace('export async function','async function'),faqContext);
const oldFaq=faqContext.fetchFaq(1);
faqState.repository={id:'new'};
const newFaq=faqContext.fetchFaq(1);
faqRequests[1]({entries:[{id:'new'}]});await newFaq;
faqRequests[0]({entries:[{id:'old'}]});await oldFaq;
assert.equal(faqState.faqEntries[0].id,'new');
console.log('PASS same-path cross-repository late FAQ response is discarded');
