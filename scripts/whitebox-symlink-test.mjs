// 用途：白盒测试 —— src/git.js readSource 对符号链接逃逸的防护（临时仓库 fixture）。
import { readSource } from '../src/git.js';
const root = '/tmp/whitebox/symrepo';
for (const p of ['sub/inside.c', 'sub/escape.c', 'escdir/symrepo-outside.c']) {
  try {
    const data = await readSource(root, p);
    console.log(`path=${p} -> OK, content[0..20]=${JSON.stringify(data.content.slice(0, 20))}`);
  } catch (error) {
    console.log(`path=${p} -> ${error.status} ${error.code} ${error.message}`);
  }
}
