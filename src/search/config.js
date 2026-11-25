// 工作区搜索能力的配置：可调参数集中于此，新增语言只改 sourceGlobs。
export const searchConfig = {
  // 1 个字符只做文件名匹配；函数搜索至少 2 个字符，避免全仓库扫描。
  minQueryLength: 1,
  minFunctionQueryLength: 2,
  maxQueryLength: 200,
  maxResults: 60,
  maxFunctionResults: 40,
  maxFileResults: 40,
  gitTimeoutMs: 25_000,
  // 未跟踪源码文件单独补搜；超过这个数量就跳过（构建产物目录等）。
  maxUntrackedFiles: 500,
  // 结果缓存：打字时反复增删字符、以及 j/k 预览不会重复扫描仓库。
  cacheTtlMs: 30_000,
  cacheLimit: 24,
  // 源码文件扩展名（git grep 的 pathspec）。按语言增删即可扩展搜索范围。
  // *Kconfig* 纳入内核 Kconfig 符号（config FOO / menuconfig FOO）：
  // rg glob 与 git pathspec 下该写法都能命中任意深度的 lib/Kconfig.debug。
  sourceGlobs: [
    '*.c', '*.h', '*.hh', '*.cc', '*.cpp', '*.cxx', '*.hpp', '*.hxx', '*.inl',
    '*.S', '*.s', '*.asm',
    '*.js', '*.mjs', '*.cjs', '*.jsx', '*.ts', '*.tsx',
    '*.py', '*.pyi', '*.go', '*.rs', '*.java', '*.kt', '*.kts',
    '*.sh', '*.bash', '*.zsh', '*.lua', '*.rb', '*.php', '*.pl',
    '*.cs', '*.swift', '*.scala', '*.m', '*.mm',
    '*Kconfig*',
  ],
};