// Explicit real-model acceptance run; uses existing local model configuration.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {explainSource} from '../src/llm.js';
import {createAnimationHtml} from '../public/animation-html.js';
const output = new URL('../bug-reports/missed-service-20261122/', import.meta.url);
await mkdir(output,{recursive:true});
const root=process.env.CODE_READER_KERNEL_ROOT || '/Volumes/kernel-data/KernelSrc/linux';
const question='请深入解释 COMP_MISSED_SERVICE_ERROR 并生成 3D 动画。以输入的官方 xHCI 规范为依据，讲清设计该错误码解决的实际问题、ESIT 的时限、正常路径与具体异常场景（例如周期数据 DMA 延迟）、为何过期数据不能简单重试、下一 ESIT 如何继续。结合当前代码逐步解释 ep->skip、有效及零/无效 TRB 指针、find_td_by_dma、process_isoc_td、xhci_dequeue_td、跳过多个 TD、-EXDEV 与 actual_length、恢复匹配后清 skip、与 ring underrun/overrun 的区别。请核对实际代码而不是只看注释，规范要求与 Linux 策略分开，动画每步对应真实行号及规范章节，展示一个具体 TD 队列的前后状态。无法确认的原因标明假设。';
await writeFile(new URL('question.txt', output),question);
const start=Date.now();
const content=await readFile(root+'/drivers/usb/host/xhci-ring.c','utf8');
const result=await explainSource({content,lines:content.split('\n').length},'drivers/usb/host/xhci-ring.c',2762,question,{repositoryRoot:root,animate:true,signal:AbortSignal.timeout(240000)});
await writeFile(new URL('response.json',output),JSON.stringify({...result,elapsedMs:Date.now()-start},null,2));
if(!result.explanation.animation?.steps?.length) throw Error('No animation returned');
const runtime=await readFile(new URL('../public/vendor/three/animation.bundle.js',import.meta.url),'utf8');
await writeFile(new URL('animation.html',output),createAnimationHtml(result.explanation.animation,runtime));
console.log(JSON.stringify({model:result.model,elapsedMs:Date.now()-start,sources:result.sources.local.map(s=>s.source),steps:result.explanation.animation.steps.length}));
