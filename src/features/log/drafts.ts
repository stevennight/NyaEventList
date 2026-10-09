import type { Draft } from "./logModel";

/**
 * 流水页的草稿行（最下面那行还没保存的记录）每一天、每一周各有一份：
 * 日视图按那一天，周视图按那一周的周一。切走再切回来，各自写到一半的内容都还在。
 */
export interface DraftSlot {
  draft: Draft;
  /** 用户动过这份草稿；没动过的是按上一条记录自动预填的，换个时候再看可以重新预填 */
  touched: boolean;
}

export type DraftView = "day" | "week";

export const draftKey = (view: DraftView, date: string) => `${view}:${date}`;

export function parseDraftKey(key: string): { view: DraftView; date: string } | null {
  const m = /^(day|week):(\d{4}-\d{2}-\d{2})$/.exec(key);
  return m ? { view: m[1] as DraftView, date: m[2] } : null;
}

/** 填了任务或者具体内容才算是“有东西”：只有这种草稿要存盘、要提醒 */
export const draftHasContent = (d: Draft) => !!(d.taskId || d.content.trim());

export const sameDraft = (a: Draft, b: Draft) => a.taskId === b.taskId && a.type === b.type && a.content === b.content && a.date === b.date && a.start === b.start && a.end === b.end;

const FIELD_NAMES: [keyof Draft, string][] = [
  ["taskId", "任务"],
  ["type", "工作内容划分"],
  ["content", "具体内容"],
  ["date", "日期"],
  ["start", "开始"],
  ["end", "结束"],
];

const md = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;

/** 给人看的草稿位置：“10月9日” 或 “10月5日那一周” */
export function draftKeyLabel(key: string): string {
  const k = parseDraftKey(key);
  if (!k) return key;
  return k.view === "day" ? md(k.date) : `${md(k.date)}那一周`;
}

/** 草稿的一步修改怎么描述；什么都没变返回 null */
export function describeDraftStep(key: string, before: Draft, after: Draft, label?: string): { label: string; undoMessage: string; redoMessage: string } | null {
  if (sameDraft(before, after)) return null;
  const what = label ?? `修改草稿的${FIELD_NAMES.filter(([f]) => before[f] !== after[f])
    .map(([, n]) => n)
    .join("、")}`;
  const where = `（${draftKeyLabel(key)}）`;
  return { label: what, undoMessage: `已撤销：${what}${where}`, redoMessage: `已重做：${what}${where}` };
}

/** 要写进数据库的草稿：动过而且有内容的 */
export function persistableDrafts(slots: Record<string, DraftSlot>): Record<string, Draft> {
  const out: Record<string, Draft> = {};
  for (const [k, s] of Object.entries(slots)) if (s.touched && draftHasContent(s.draft)) out[k] = s.draft;
  return out;
}

/** 从数据库读回来的草稿：格式不对的直接丢掉，别让一份坏数据卡住启动 */
export function restoreDrafts(raw: unknown): Record<string, DraftSlot> {
  const out: Record<string, DraftSlot> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!parseDraftKey(k) || !v || typeof v !== "object") continue;
    const d = v as Record<string, unknown>;
    const s = (x: unknown) => (typeof x === "string" ? x : "");
    const draft: Draft = { taskId: s(d.taskId), type: s(d.type), content: s(d.content), date: s(d.date), start: s(d.start), end: s(d.end) };
    if (draftHasContent(draft)) out[k] = { draft, touched: true };
  }
  return out;
}
