/**
 * 多选的规则（流水表和日历共用）。选中的东西按 id 记，`order` 是当前显示的先后顺序，
 * 区间选择、结果排序都按它来。这里都是纯函数，方便测试。
 *
 * 鼠标：
 * - 点一下：只选这一个（再点已选的唯一一个就取消）
 * - Ctrl+点：加选/减选一个
 * - Shift+点：从锚点选到这里（替换现有选区）——选 1 再 Shift 点 30，就是 1–30
 * - Ctrl+Shift+点：把锚点到这里的区间叠加到现有选区
 * - 拖框：框住的都选中；按住 Ctrl 或 Shift 拖框则叠加在现有选区上
 */
export interface SelectionState {
  ids: string[];
  /** 区间选择的起点：最近一次“点”选的那个 */
  anchor: string | null;
}

export interface Mods {
  shift: boolean;
  ctrl: boolean;
}

export const EMPTY_SELECTION: SelectionState = { ids: [], anchor: null };

const sortByOrder = (order: string[], ids: Iterable<string>): string[] => {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...new Set(ids)].filter((id) => pos.has(id)).sort((a, b) => pos.get(a)! - pos.get(b)!);
};

/** a 到 b 之间（含两端，不分先后）的所有 id */
export function rangeIds(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return j >= 0 ? [b] : [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

export function clickSelect(order: string[], state: SelectionState, id: string, mods: Mods): SelectionState {
  if (mods.shift) {
    const anchor = state.anchor && order.includes(state.anchor) ? state.anchor : (state.ids[0] ?? id);
    const range = rangeIds(order, anchor, id);
    return { ids: sortByOrder(order, mods.ctrl ? [...state.ids, ...range] : range), anchor };
  }
  if (mods.ctrl) {
    const has = state.ids.includes(id);
    return { ids: sortByOrder(order, has ? state.ids.filter((x) => x !== id) : [...state.ids, id]), anchor: id };
  }
  if (state.ids.length === 1 && state.ids[0] === id) return { ids: [], anchor: null };
  return { ids: [id], anchor: id };
}

/** 拖框结束/进行中：框住的 `hit`；叠加模式下并上原来的选区 */
export function marqueeSelect(order: string[], base: SelectionState, hit: string[], additive: boolean): SelectionState {
  const ids = sortByOrder(order, additive ? [...base.ids, ...hit] : hit);
  return { ids, anchor: hit.length ? hit[hit.length - 1] : base.anchor };
}

/** Shift+↑/↓：以锚点为不动的一端，把选区向上/向下扩一行。`cursor` 是当前所在行。 */
export function extendSelection(order: string[], state: SelectionState, cursor: string, dir: 1 | -1): { state: SelectionState; cursor: string } {
  const i = order.indexOf(cursor);
  const next = order[Math.max(0, Math.min(order.length - 1, i + dir))] ?? cursor;
  const anchor = state.anchor && order.includes(state.anchor) && state.ids.length ? state.anchor : cursor;
  return { state: { ids: rangeIds(order, anchor, next), anchor }, cursor: next };
}

export function selectAll(order: string[]): SelectionState {
  return { ids: [...order], anchor: order[0] ?? null };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const rectsIntersect = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** 把拖出来的两个点变成规范的矩形 */
export const rectFromPoints = (x1: number, y1: number, x2: number, y2: number): Rect => ({ left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) });
