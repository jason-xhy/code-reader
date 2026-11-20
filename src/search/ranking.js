// 排序策略：完全匹配 > 前缀匹配 > 部分匹配；同一档内函数优先于文件名。
export function matchRank(name, query) {
  if (name === query) return 0;
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerName === lowerQuery) return 1;
  if (name.startsWith(query)) return 2;
  if (lowerName.startsWith(lowerQuery)) return 3;
  return 4;
}

export function matchLabel(rank) {
  if (rank <= 1) return 'exact';
  if (rank <= 3) return 'prefix';
  return 'partial';
}

const KIND_RANK = { function: 0, file: 1 };

export function compareResults(a, b) {
  return a.rank - b.rank
    || KIND_RANK[a.kind] - KIND_RANK[b.kind]
    || a.name.length - b.name.length
    || a.path.length - b.path.length
    || a.path.localeCompare(b.path)
    || a.line - b.line;
}

export function fileMatchRank(filePath, query) {
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const basename = filePath.split('/').pop() || filePath;
  const lowerBase = basename.toLowerCase();
  if (basename === query) return 0;
  if (lowerBase === lowerQuery) return 1;
  if (basename.startsWith(query)) return 2;
  if (lowerBase.startsWith(lowerQuery)) return 3;
  if (lowerPath.includes(lowerQuery)) return 4;
  return 5;
}