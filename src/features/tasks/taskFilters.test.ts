import { describe, expect, it } from "vitest";
import type { Task } from "../../db/models";
import { EMPTY_PANEL, boardTasks, flattenResult, queryTasks, tabCounts } from "./taskFilters";

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

const tasks = [
  task({ id: "a", title: "订单导出", system: "订单系统", requesters: ["张三", "李四"], entryCount: 5 }),
  task({ id: "b", title: "订单对账", system: "订单系统", requesters: ["张三"], entryCount: 0 }),
  task({ id: "c", title: "会员看板", system: "数据平台", requesters: ["王五"], entryCount: 9, statusDone: true, status: "已上线" }),
  task({ id: "d", title: "会员标签", system: "数据平台", requesters: ["王五"], entryCount: 2, kind: "routine" }),
];
const ids = (l: Task[]) => l.map((t) => t.id);

describe("queryTasks", () => {
  it("defaults to unfinished tasks ordered by how often they were used", () => {
    const r = queryTasks(tasks, EMPTY_PANEL);
    expect(r.mode).toBe("tab");
    expect(ids(flattenResult(r))).toEqual(["a", "d", "b"]);
  });
  it("backlog tab lists unfinished tasks that have no time entries", () => {
    expect(ids(flattenResult(queryTasks(tasks, { ...EMPTY_PANEL, tab: "backlog" })))).toEqual(["b"]);
  });
  it("search always covers every task, unfinished first then finished", () => {
    const r = queryTasks(tasks, { ...EMPTY_PANEL, tab: "backlog", query: "会员" });
    expect(r.mode).toBe("search");
    if (r.mode === "search") {
      expect(ids(r.open)).toEqual(["d"]);
      expect(ids(r.done)).toEqual(["c"]);
    }
  });
  it("multi-word search hits across title and requesters", () => {
    expect(ids(flattenResult(queryTasks(tasks, { ...EMPTY_PANEL, query: "订单 李四" })))).toEqual(["a"]);
  });
  it("structured filters combine and also ignore the tab", () => {
    expect(ids(flattenResult(queryTasks(tasks, { ...EMPTY_PANEL, tab: "done", filters: { system: "订单系统", requester: "张三" } })))).toEqual(["a", "b"]);
    expect(ids(flattenResult(queryTasks(tasks, { ...EMPTY_PANEL, filters: { kind: "routine" } })))).toEqual(["d"]);
  });
  it("board tasks share search and filters but ignore the tab", () => {
    expect(ids(boardTasks(tasks, { query: "会员", filters: {} }))).toEqual(["c", "d"]);
    expect(ids(boardTasks(tasks, { query: "", filters: { system: "订单系统" } }))).toEqual(["a", "b"]);
    expect(boardTasks(tasks, { query: "", filters: {} })).toHaveLength(4);
  });
  it("counts tabs", () => {
    expect(tabCounts(tasks)).toEqual({ open: 3, backlog: 1, done: 1, all: 4 });
  });
});
