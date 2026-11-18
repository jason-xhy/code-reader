// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 数据目录解析与 code-reader 全局路径强绑定
// grill: 成品检索=skill 库无 code-reader 数据目录成品; 输入固定=CODE_READER_DATA_DIR 或默认 ../.data/; 步骤机械=返回绝对目录并拼接; 判读固定=路径字符串; 失效场景=构造不出（仅本应用）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../.data/', import.meta.url));

export function dataRoot() {
  const configured = process.env.CODE_READER_DATA_DIR;
  if (configured && path.isAbsolute(configured)) {
    return configured.endsWith(path.sep) ? configured : `${configured}${path.sep}`;
  }
  return defaultRoot;
}

export function dataPath(...segments) {
  return path.join(dataRoot(), ...segments);
}