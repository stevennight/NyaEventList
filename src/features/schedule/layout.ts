export interface Span {
  id: string;
  /** 小时数（9.5 = 09:30） */
  start: number;
  end: number;
}

export interface Slot {
  col: number;
  cols: number;
}

/**
 * 同一天里时间重叠的记录并排显示：先把首尾相连的重叠记录分成一簇，
 * 簇内贪心地放进第一个空得出来的列，整簇共用同一个列数（所以宽度一致）。
 */
export function layoutDay(spans: Span[]): Record<string, Slot> {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters: Span[][] = [];
  let current: Span[] = [];
  let currentEnd = -Infinity;
  for (const s of sorted) {
    if (current.length && s.start >= currentEnd) {
      clusters.push(current);
      current = [];
      currentEnd = -Infinity;
    }
    current.push(s);
    currentEnd = Math.max(currentEnd, s.end);
  }
  if (current.length) clusters.push(current);

  const out: Record<string, Slot> = {};
  for (const cluster of clusters) {
    const columns: number[] = []; // 每一列当前的结束时间
    const placed: [Span, number][] = [];
    for (const s of cluster) {
      let col = columns.findIndex((end) => end <= s.start);
      if (col === -1) col = columns.length;
      columns[col] = s.end;
      placed.push([s, col]);
    }
    for (const [s, col] of placed) out[s.id] = { col, cols: columns.length };
  }
  return out;
}
