import { describe, expect, it } from "vitest";
import type { Task, TimeEntry } from "../../db/models";
import { summarize } from "./aggregate";

const task = (over: Partial<Task>): Task => ({
  id: "t",
  code: null,
  title: "任务",
  description: null,
  kind: "requirement",
  system: null,
  category: null,
  status: "开发中",
  statusDone: false,
  requesters: [],
  tags: [],
  estimatedDays: null,
  plannedStart: null,
  targetDate: null,
  pinned: false,
  entryCount: 0,
  totalHours: 0,
  lastEntryDate: null,
  ...over,
});
const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: Math.random().toString(),
  taskId: "a",
  taskTitle: "",
  taskCode: null,
  date: "2026-09-14",
  start: "09:00",
  end: "10:00",
  durationHours: 1,
  isTimeBased: true,
  workType: "功能开发",
  content: "",
  ...over,
});

const tasks = [
  task({ id: "a", system: "订单系统", requesters: ["张三", "李四"] }),
  task({ id: "b", system: "数据平台", requesters: ["王五"], status: "已上线", statusDone: true }),
  task({ id: "c", system: null, requesters: [] }),
];
const types = { 张三: "业务方", 李四: "内部协作", 王五: "业务方" };

describe("summarize", () => {
  const entries = [
    entry({ taskId: "a", durationHours: 2, date: "2026-09-14" }),
    entry({ taskId: "b", durationHours: 1.5, date: "2026-09-14", workType: "需求对接" }),
    entry({ taskId: "c", durationHours: 1, date: "2026-09-16", workType: null }),
    entry({ taskId: "a", durationHours: 9, date: "2026-10-01" }), // 区间外
  ];
  const s = summarize(entries, tasks, types, "2026-09-14", "2026-09-20");

  it("totals only what falls inside the range", () => {
    expect(s).toMatchObject({ totalHours: 4.5, entryCount: 3, taskCount: 3, activeDays: 2, avgHoursPerActiveDay: 2.25 });
  });
  it("groups by system, work type and status with a placeholder for blanks", () => {
    expect(s.bySystem.map((b) => [b.key, b.hours])).toEqual([
      ["订单系统", 2],
      ["数据平台", 1.5],
      ["（未设置）", 1],
    ]);
    expect(s.byWorkType.map((b) => b.key)).toEqual(["功能开发", "需求对接", "（未设置）"]);
    expect(s.byStatus.find((b) => b.key === "已上线")!.hours).toBe(1.5);
  });
  it("splits a task's hours evenly across its requesters so totals stay honest", () => {
    const r = Object.fromEntries(s.byRequester.map((b) => [b.key, b.hours]));
    expect(r).toEqual({ 张三: 1, 李四: 1, 王五: 1.5, "（无需求方）": 1 });
    expect(s.byRequester.reduce((sum, b) => sum + b.hours, 0)).toBe(s.totalHours);
    const t = Object.fromEntries(s.byRequesterType.map((b) => [b.key, b.hours]));
    expect(t).toEqual({ 业务方: 2.5, 内部协作: 1, "（无需求方）": 1 });
  });
  it("lists every day of the range, zero-filled", () => {
    expect(s.byDay).toHaveLength(7);
    expect(s.byDay[0]).toEqual({ date: "2026-09-14", hours: 3.5 });
    expect(s.byDay[1]).toEqual({ date: "2026-09-15", hours: 0 });
    expect(s.byDay[2]).toEqual({ date: "2026-09-16", hours: 1 });
  });
  it("handles an empty range", () => {
    expect(summarize([], tasks, types, "2026-09-14", "2026-09-14")).toMatchObject({ totalHours: 0, avgHoursPerActiveDay: 0, byDay: [{ date: "2026-09-14", hours: 0 }] });
  });
});
