import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const app = await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const workspace = await readFile(new URL('../public/features/workspace.js',import.meta.url),'utf8');
const state = { repository:{id:'old'}, currentFile:null, readingTrail:[], historyCache:new Map() };
const pending=[];
const noop=()=>{};
const sessions=new Map();
const control=()=>({textContent:'',hidden:false,querySelector:()=>({textContent:''})});
const context=vm.createContext({state,sessions, api:()=>new Promise(resolve=>pending.push(resolve)),getFocusIntent:()=>1,
 elements:{currentFile:control(),sourceStatus:control(),codeEmpty:control()}, editor:{isQuickpickOpen:()=>false, getCursor:()=>({line:1,character:0}),focus:noop,hide:noop},
 closeCommitOverlay:noop,closeQuestion:noop,closeAnimation:noop, renderTree:noop,renderHistory:noop,renderExplanation:noop,renderFaq:noop,
 renderSource:noop, sidePanelOwnsFocus:()=>false, pushReadingTrail:entry=>state.readingTrail.push(entry), fetchFunctionHistory:noop,fetchFaq:noop,scheduleHistoryTouch:noop,
 preparedForSession:()=>null,rememberPrepared:noop,loadBranches:noop,
 deps:{closeNvim:noop,applyRepositoryPayload:(data,options)=>{context.restoredTrail=options.readingTrail;},selectFile:async()=>{}},
});
vm.runInContext(app.slice(app.indexOf('async function selectFile('),app.indexOf('function applyRepositoryPayload(')),context);
const old=context.selectFile('main.c');
state.repository={id:'fresh'}; state.currentFile=null;
const fresh=context.selectFile('main.c');
pending[1]({content:'fresh'}); await fresh;
pending[0]({content:'old'}); await old;
assert.equal(state.source.content,'fresh');
assert.equal(state.readingTrail.length,1,'late old repository must not append a trail entry');
const sessionCode=workspace.slice(workspace.indexOf('export function captureSession('),workspace.indexOf('// 切仓期间再次触发'))
.replaceAll('export function','function');
vm.runInContext(sessionCode,context);
state.sessionKey='fresh';state.readingTrail=[{path:'main.c',line:3}];sessions.set('fresh',{});
context.captureSession();state.readingTrail[0].line=8;
assert.equal(sessions.get('fresh').readingTrail[0].line,3,'session trail is a snapshot');
await context.applySession({...sessions.get('fresh'),key:'fresh',data:{},currentFile:null,branchesLoaded:true});
assert.equal(context.restoredTrail[0].line,3,'workspace restore passes its own trail');
console.log('PASS cross-repository same-path late replies and independent reading trail snapshots');
