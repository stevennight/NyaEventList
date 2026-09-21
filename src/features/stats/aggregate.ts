import type { Task, TimeEntry } from "../../db/models";
import { addDays, fmtDate, parseISODate } from "../../lib/time";

export interface Bucket {
  key: string;
  hours: number;
  count: number;
}

export interface Stats {
  totalHours: number;
  entryCount: number;
  /** 其中还没设结束时间（进行中）的记录数：没有用时，不计入工时和各项分布 */
  openCount: number;
  taskCount: number;
  /** 有记录的天数 */
  activeDays: number;
  avgHoursPerActiveDay: number;
  bySystem: Bucket[];
  byWorkType: Bucket[];
  byStatus: Bucket[];
  byRequesterType: Bucket[];
  byRequester: Bucket[];
  /** 区间内每一天（没记录的天为 0），按日期升序 */
  byDay: { date: string; hours: number }[];
}

const NONE = "（未设置）";
const round2 = (n: number) => Math.round(n * 100) / 100;

function tally(map: Map<string, Bucket>, key: string, hours: number, count = 1) {
  const b = map.get(key) ?? { key, hours: 0, count: 0 };
  b.hours += hours;
  b.count += count;
  map.set(key, b);
}
const sorted = (map: Map<string, Bucket>): Bucket[] =>
  [...map.values()].map((b) => ({ ...b, hours: round2(b.hours) })).sort((a, b) => b.hours - a.hours || a.key.localeCompare(b.key, "zh"));

/**
 * 统计一段时间内的时间记录。
 * 一个任务有多个需求方时，这条记录的工时平均分给每个需求方（按需求方/需求方类型统计时不会重复计入总数）。
 */
export function summarize(entries: TimeEntry[], tasks: Task[], requesterTypes: Record<string, string | null>, from: string, to: string): Stats {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const system = new Map<string, Bucket>();
  const workType = new Map<string, Bucket>();
  const status = new Map<string, Bucket>();
  const reqType = new Map<string, Bucket>();
  const requester = new Map<string, Bucket>();
  const perDay = new Map<string, number>();
  const taskIds = new Set<string>();
  let total = 0;
  let openCount = 0;

  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    if (!e.end) {
      openCount++;
      continue;
    }
    const h = e.durationHours;
    const t = taskById.get(e.taskId);
    total += h;
    taskIds.add(e.taskId);
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + h);
    tally(system, t?.system ?? NONE, h);
    tally(workType, e.workType ?? NONE, h);
    tally(status, t?.status ?? NONE, h);
    const names = t?.requesters.length ? t.requesters : [];
    if (!names.length) {
      tally(requester, "（无需求方）", h);
      tally(reqType, "（无需求方）", h);
    }
    const share = names.length ? h / names.length : 0;
    for (const n of names) {
      tally(requester, n, share);
      tally(reqType, requesterTypes[n] ?? "其他", share);
    }
  }

  const byDay: Stats["byDay"] = [];
  const start = parseISODate(from);
  const days = Math.min(400, Math.round((parseISODate(to).getTime() - start.getTime()) / 86400000) + 1);
  for (let i = 0; i < days; i++) {
    const date = fmtDate(addDays(start, i));
    byDay.push({ date, hours: round2(perDay.get(date) ?? 0) });
  }
  const activeDays = perDay.size;
  return {
    totalHours: round2(total),
    entryCount: entries.filter((e) => e.date >= from && e.date <= to).length,
    openCount,
    taskCount: taskIds.size,
    activeDays,
    avgHoursPerActiveDay: activeDays ? round2(total / activeDays) : 0,
    bySystem: sorted(system),
    byWorkType: sorted(workType),
    byStatus: sorted(status),
    byRequesterType: sorted(reqType),
    byRequester: sorted(requester),
    byDay,
  };
}
