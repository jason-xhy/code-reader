// 用途：白盒测试 —— git.js repositoryStatus 对 -z porcelain 重命名条目的解析。
import { repositoryStatus } from '../src/git.js';
console.log(JSON.stringify(await repositoryStatus('/tmp/whitebox/strepo'), null, 0));
