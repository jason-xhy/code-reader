// Verify the real-model output in the production 3D renderer, including keyboard playback.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
const output=new URL('../bug-reports/missed-service-20261122/',import.meta.url);
const profile=await mkdtemp(path.join(os.tmpdir(),'cr-animation-'));
const chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check','--remote-debugging-port=9455',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let socket;
try {
 let tab;
 for(let i=0;i<100;i++){try{tab=await(await fetch('http://127.0.0.1:9455/json/new?about:blank',{method:'PUT'})).json();break;}catch{await sleep(100);}}
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise(r=>socket.once('open',r));
 let id=0;const pending=new Map(),contexts=new Map(),downloadStates=new Map(),iframeSessions=new Set();
 socket.on('message',raw=>{
   const m=JSON.parse(raw);
   if(m.id){pending.get(m.id)?.(m.result);pending.delete(m.id);}
   else if(m.method==='Runtime.executionContextCreated') {const context={...m.params.context,sessionId:m.sessionId};contexts.set(`${m.sessionId||''}:${context.id}`,context);}
   else if(m.method==='Runtime.executionContextDestroyed') contexts.delete(`${m.sessionId||''}:${m.params.executionContextId}`);
   else if(m.method==='Runtime.executionContextsCleared') {for(const [key,context] of contexts)if(context.sessionId===m.sessionId)contexts.delete(key);}
   else if(m.method==='Browser.downloadProgress') downloadStates.set(m.params.guid,m.params.state);
   else if(m.method==='Target.attachedToTarget'&&m.params.targetInfo.type==='iframe') {iframeSessions.add(m.params.sessionId);send('Runtime.enable',{},m.params.sessionId);}
 });
 const send=(method,params={},sessionId)=>new Promise(r=>{pending.set(++id,r);socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const evaluate=async (expression,contextId,sessionId)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(contextId?{contextId}:{})},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:new URL('animation.html',output).href});
 for(let i=0;i<150;i++){if(await evaluate('Boolean(window.__SCENE_READY__)'))break;await sleep(100);}
 const stats=await evaluate('window.__ANIMATION_STATS__');
 assert(stats?.drawCalls>0,'WebGL must render, not merely fall back');
 const saved=JSON.parse(await readFile(new URL('scene-response.json',output),'utf8'));
 const animation=saved.explanation.animation;
 assert.equal(stats.type,'xhci-missed-service');
 assert.equal(stats.steps,animation.steps.length);
 const state=()=>evaluate('window.__XHCI_SCENE_STATE__');
 const key=async key=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key});await send('Input.dispatchKeyEvent',{type:'keyUp',key});};
 assert.equal((await state()).step,'queued');
 await key('j');assert.equal((await state()).step,'miss-a');
 await key('k');assert.equal((await state()).step,'queued');
 const screenshots=[];
 for(const id of ['find-c','skip-a','skip-b','match-c','length-c','aligned']) {
   const index=animation.steps.findIndex(step=>step.id===id);
   await evaluate(`window.__seek(${index*5})`);
   assert.equal((await state()).step,id);
   const visible=await evaluate("document.querySelector('.xhci-evidence').textContent");
   assert(visible.includes('xhci-ring.c:')&&visible.includes('4.10.3.2'),'Synchronized code and spec');
   const expected=animation.steps[index].snapshot;
   assert.deepEqual((await state()).queue,expected.queue);
   assert.equal((await state()).skip,expected.skip);
   assert.equal((await state()).urbActual,expected.urbActual);
   const geometry=await evaluate('window.__XHCI_SCENE_GEOMETRY__');
   if(expected.event?.target) {
     assert.equal(geometry.event[0],geometry.cards[expected.event.target][0], 'The drawn event arrow must follow the target TD');
   }
   if(id==='skip-a') assert.equal(geometry.cards.A[1],-2.05,'Skipped A must move to the result lane');
   if(id==='skip-b') {assert.equal(geometry.cards.C[0],-3.15);assert.equal(geometry.cards.B[1],-2.05);}

   assert.deepEqual((await state()).frames,expected.frames);
   if(['find-c','skip-b','length-c','aligned'].includes(id)) {
     const image=await send('Page.captureScreenshot',{format:'png'});
     await writeFile(new URL(`scene-${id}.png`,output),Buffer.from(image.data,'base64'));screenshots.push(`scene-${id}.png`);
   }
 }
 const final=await state();assert.equal(final.frames.C.actual,64);assert.equal(final.frames.D.actual,128);assert.equal(final.urbActual,192);
 // Scrubbing backwards restores state, not an accumulation of previous transitions.
 await evaluate('window.__seek(0)');assert.deepEqual((await state()).frames,{});assert.equal((await state()).skip,false);
 await evaluate("window.__xhciSelectScenario('zero')");
 assert.equal((await state()).event.pointer,'0x0');assert.equal((await state()).event.target,null);assert.equal((await state()).skip,true);
 await key('j');assert.equal((await state()).event.target,'D');
 await evaluate('window.__seek(30)');assert.equal((await state()).frames.C.actual,0);assert.equal((await state()).urbActual,128);
 // Exercise the visible select, buttons, and range, not only the debug bridge.
 await evaluate("document.querySelector('.xhci-scenario').value='main';document.querySelector('.xhci-scenario').dispatchEvent(new Event('change',{bubbles:true}))");
 await evaluate("document.querySelector('[data-command=next]').click()");assert.equal((await state()).step,'miss-a');
 await evaluate("document.querySelector('.xhci-progress').value=55;document.querySelector('.xhci-progress').dispatchEvent(new Event('input',{bubbles:true}))");
 assert.equal((await state()).step,'length-c');
 await evaluate("document.querySelector('[data-command=toggle]').click()");
 await evaluate("document.querySelector('.xhci-speed').value='2';document.querySelector('.xhci-speed').dispatchEvent(new Event('change',{bubbles:true}))");
 await new Promise(r=>setTimeout(r,2700));
 assert.equal((await state()).step,'finish-c','Playback must actually advance the scene');
 assert.match(await evaluate("document.querySelector('[data-command=toggle]').textContent"),/暂停/);
 await key(' ');assert.match(await evaluate("document.querySelector('[data-command=toggle]').textContent"),/播放/);
 await evaluate('window.__seek(55)');
 await send('Emulation.setDeviceMetricsOverride',{width:780,height:1000,deviceScaleFactor:1,mobile:false});
 await new Promise(r=>setTimeout(r,300));
 assert(await evaluate("document.querySelector('.xhci-player').scrollWidth <= document.querySelector('.xhci-player').clientWidth+1"),'Narrow layout must not overflow horizontally');
 assert(await evaluate("document.querySelector('.xhci-canvas').clientHeight >= 320"));
 const narrow=await send('Page.captureScreenshot',{format:'png'});await writeFile(new URL('scene-narrow.png',output),Buffer.from(narrow.data,'base64'));screenshots.push('scene-narrow.png');
 // The state scene must remain operable if WebGL cannot initialize.
 const disableWebGL="<script>const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args)}</script>";
 const offline=await readFile(new URL('animation.html',output),'utf8');
 await writeFile(path.join(profile,'fallback.html'),offline.replace('<head>','<head>'+disableWebGL));
 await send('Page.navigate',{url:`file://${profile}/fallback.html`});
 for(let i=0;i<150;i++){if(await evaluate("Boolean(window.__SCENE_READY__) && document.querySelector('.xhci-webgl-fallback')?.hidden === false"))break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(await evaluate("document.querySelector('.xhci-webgl-fallback').hidden"),false);
 await key('j');assert.equal((await state()).step,'miss-a');
 await evaluate('window.__seek(55)');assert.match(await evaluate("document.querySelector('.xhci-formula').textContent"),/64 B/);
 if(process.env.CODE_READER_URL) {
   await send('Page.enable');await send('Runtime.enable');await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
   await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   await send('Page.navigate',{url:process.env.CODE_READER_URL});
   for(let i=0;i<300;i++){if(await evaluate('Boolean(window.__ts?.snapshot().fileCount)'))break;await new Promise(r=>setTimeout(r,50));}
   await evaluate("window.__ts.openFile('drivers/usb/host/xhci-ring.c',2762)");
   const old=JSON.parse(await readFile(new URL('response.json',output),'utf8'));
   delete old.explanation.animation.scene;
   await evaluate(`(async()=>{const {state}=await import('/core/state.js');state.explanation={status:'done',path:'drivers/usb/host/xhci-ring.c',line:2762,...${JSON.stringify(old)}};const feature=await import('/features/insights.js');feature.renderExplanation();window.__crPanels.pin('insights');const original=window.fetch;window.__sceneCalls=[];window.fetch=async (...args)=>{const url=String(args[0]);if(url.includes('/animation-scene')){window.__sceneCalls.push(url);await new Promise(r=>setTimeout(r,250));}if(url.endsWith('/explain'))throw Error('Upgrade must not invoke LLM');return original(...args)}})()`);
   // Close during asynchronous upgrade: a stale completion must not resurrect the iframe.
   await evaluate("document.querySelector('.animation-open').click()");
   await evaluate("import('/features/insights.js').then(m=>m.closeAnimation())");
   await new Promise(r=>setTimeout(r,600));
   assert.equal(await evaluate("window.__ts.snapshot().animationOpen"),false);
   await evaluate("document.querySelector('.animation-open').click()");
   for(let i=0;i<300;i++){if(await evaluate("Boolean(document.querySelector('#animation-download')?.getAttribute('href'))"))break;await new Promise(r=>setTimeout(r,50));}
   await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:profile,eventsEnabled:true});
   assert(await evaluate("document.querySelector('#animation-download').download.endsWith('.html')"));
   const existingDownloads=new Set(await readdir(profile));
   const downloadRect=await evaluate("(()=>{const r=document.querySelector('#animation-download').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...downloadRect,button:'left',clickCount:1});
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',...downloadRect,button:'left',clickCount:1});
   let upgraded;
   for(let i=0;i<150;i++) { try {const files=await readdir(profile);const name=files.find(name=>!existingDownloads.has(name)&&name.endsWith('.html'));if(name&&[...downloadStates.values()].includes('completed')){upgraded=await readFile(path.join(profile,name),'utf8');break;}} catch {} await new Promise(r=>setTimeout(r,50)); }
   assert(upgraded,'Offline HTML must actually download through the browser');
   assert(upgraded.includes('xhci-missed-service'),'Existing generic animation must upgrade through the actual application route');
   assert(upgraded.includes('ep->skip'));
   assert.equal(await evaluate('window.__sceneCalls.length'),2);
   let childContext,childSession;
   for(let i=0;i<300;i++) {
     const tree=await send('Page.getFrameTree');
     const child=tree.frameTree.childFrames?.find(item=>item.frame.url.startsWith('blob:'));
     const context=[...contexts.values()].find(item=>item.auxData?.isDefault&&((child&&item.auxData.frameId===child.frame.id)||iframeSessions.has(item.sessionId)));
     if(context) {try {if(await evaluate('Boolean(window.__SCENE_READY__)',context.id,context.sessionId)){childContext=context.id;childSession=context.sessionId;break;}}catch{}}
     await new Promise(r=>setTimeout(r,50));
   }
   assert(childContext,'The sandboxed application iframe must finish mounting');
   assert.equal((await evaluate('window.__XHCI_SCENE_STATE__',childContext,childSession)).step,'queued');
   await key('j');await new Promise(r=>setTimeout(r,80));
   assert.equal((await evaluate('window.__XHCI_SCENE_STATE__',childContext,childSession)).step,'miss-a','Parent j must advance the actual sandboxed scene');
   await key('k');await new Promise(r=>setTimeout(r,80));
   assert.equal((await evaluate('window.__XHCI_SCENE_STATE__',childContext,childSession)).step,'queued');
   await evaluate('window.__seek(55)',childContext,childSession);
   const appShot=await send('Page.captureScreenshot',{format:'png'});await writeFile(new URL('scene-in-app.png',output),Buffer.from(appShot.data,'base64'));
   screenshots.push('scene-in-app.png');
   console.log('PASS in-app existing animation upgrade, offline export, parent j navigation, close-during-load guard, no new LLM call');
 }
 await writeFile(new URL('browser-result.json',output),JSON.stringify({stats,checks:['WebGL','timeline','queue transitions','event pointer','skip','frame lengths','URB accounting','code/spec synchronization','j/k','seek reset','zero-pointer scenario','visible controls','playback','narrow layout','WebGL fallback'],screenshots},null,2));
 console.log('PASS concrete xHCI scene: queue, timeline, event pointer, skip, 64/128 B, code/spec, j/k, controls, zero branch, responsive layout',stats);
} finally {socket?.close();chrome.kill();await sleep(500);await rm(profile,{recursive:true,force:true});}
