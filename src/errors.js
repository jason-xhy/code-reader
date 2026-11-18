// one-shot: code-reader 应用源码（本项目固定模块，非 agent 探索脚本）; no-generalize: 错误模型与 code-reader API 强绑定
// grill: 成品检索=skill 库无 code-reader 错误模型成品; 输入固定=message/status/code/details; 步骤机械=构造 Error 子类; 判读固定=HTTP 状态码与 details 透传; 失效场景=构造不出（仅本应用）
export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}