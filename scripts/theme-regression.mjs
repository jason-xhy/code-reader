import assert from 'node:assert/strict';
import { profileTheme, THEMES } from '../web-src/themes.js';
import { readableShell, contrast } from '../public/core/theme-policy.js';
// Current macOS local Vim profile: light default Normal, no named colorscheme.
const palette = profileTheme({ background:'light', colors:{Normal:{fg:'#000000',bg:'#ffffff'}} });
const original = structuredClone(palette);
const fixed = readableShell(palette.shell, THEMES[0].shell);
assert.ok(contrast('#f2f6fb',palette.shell.panel)<1.1);
assert.ok(contrast('#f2f6fb',fixed.panel)>4.5);
assert.ok(contrast(fixed.text,fixed.panel)>4.5);
assert.ok(contrast(fixed.text,fixed.background)>4.5);
assert.deepEqual(palette,original,'shell fallback must not mutate local editor colors');
assert.equal(palette.editor.background,'#ffffff');
assert.equal(readableShell(THEMES[0].shell,THEMES[1].shell),THEMES[0].shell,'readable dark local colors are preserved');
assert.equal(readableShell({background:'invalid',panel:'#ffffff'},THEMES[0].shell),THEMES[0].shell);
console.log('PASS local light shell contrast fallback, editor palette preservation, readable dark theme retention');

// A saved local selection must survive the initial selector render before profile fetch.
const {readFile}=await import('node:fs/promises');
const vm=await import('node:vm');
const layout=await readFile(new URL('../public/core/layout.js',import.meta.url),'utf8');
const optionValues=[];
let selected='';
const selector={replaceChildren(){optionValues.length=0;},append(o){optionValues.push(o.value);},get value(){return selected;},set value(v){selected=optionValues.includes(v)?v:'';}};
const themeState={theme:'local',themeExplicit:true,editorProfile:null};
const ctx=vm.createContext({state:themeState,THEMES,elements:{themeSelect:selector},document:{createElement(){return {};}}});
vm.runInContext(layout.slice(layout.indexOf('export function populateThemes(')).replace('export function','function'),ctx);
ctx.populateThemes();assert.equal(themeState.theme,'local');
themeState.editorProfile={available:true,colorscheme:'local'};ctx.populateThemes();assert.equal(selector.value,'local');
console.log('PASS saved local theme survives asynchronous profile initialization');
