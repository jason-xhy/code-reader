// Source identifiers carry domain intent; conversational CJK phrases must not
// outrank USB/xHCI evidence merely because a translated manual shares wording.
const GENERIC_SOURCE_TERMS = new Set(['drivers', 'driver', 'host', 'src', 'source', 'kernel', 'include', 'documentation', 'docs', 'api', 'index', 'main', 'get', 'set', 'ctx', 'dbg', 'state', 'slot', 'struct', 'void', 'int', 'char']);
export function documentationSourceTerms(source) {
  return new Set((String(source).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((term) => !GENERIC_SOURCE_TERMS.has(term)));
}
export function documentationQueryWeight(token, sourceTerms) {
  if (sourceTerms.has(token)) return 6;
  return /[\u4e00-\u9fff]/.test(token) ? 0.2 : 1;
}

export const CONFIGURED_DOCUMENTATION_WEIGHT = 2;
