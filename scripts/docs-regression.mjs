import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = await mkdtemp(path.join(os.tmpdir(), 'reader-docs-regression-'));
process.env.CODE_READER_DATA_DIR = path.join(root, 'data');
try {
  const usb = path.join(root, 'Documentation/usb');
  const other = path.join(root, 'Documentation/translations');
  await mkdir(usb, { recursive: true }); await mkdir(other, { recursive: true });
  await writeFile(path.join(usb, 'URB.rst'), "Submit URB\n==========\n\nThe usb_submit_urb function submits an URB. The driver must not modify an URB until its completion callback. USB host transfers complete asynchronously.\n");
  await writeFile(path.join(other, 'unrelated.rst'), '通用接口规范\n============\n\n当前函数用途规范依据调用本地知识库说明代码关系回答保持简洁可追溯代码依据。'.repeat(8));
  const { saveDocsConfig, searchDocumentation } = await import('../src/docs.js');
  await saveDocsConfig({ directories: [usb], webEnabled: false });
  const result = await searchDocumentation({repositoryRoot: root, sourceQuery:'drivers/usb/core/urb.c usb_submit_urb', query:'结合本地知识库说明当前函数用途规范依据 回答保持简洁 给出可追溯代码依据 usb_submit_urb'});
  assert.match(result.hits[0].file, /URB\.rst$/);
  const identities = result.hits.map(h=>`${h.file}:${h.text}`);
  assert.equal(new Set(identities).size, identities.length, 'nested configured docs are deduplicated');
  console.log('PASS documentation domain relevance and overlapping-directory deduplication');
} finally { await rm(root, { recursive: true, force: true }); }
