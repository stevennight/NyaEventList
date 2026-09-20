import { describe, expect, it } from "vitest";
import type { Task, TimeEntry } from "../../db/models";
import { matchesQuery, sortTasksForPicker, taskSearchText } from "../tasks/taskSearch";
import { nextDraft, parsePastedLine, parsePastedText, resolveTask } from "./logModel";

const task = (over: Partial<Task>): Task => ({
  id: "t",
  code: null,
  title: "任务",
  description: null,
  kind: "requirement",
  system: null,
  category: null,
  status: "待处理",
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
  id: "e",
  taskId: "t",
  taskTitle: "订单导出优化",
  taskCode: null,
  date: "2026-09-16",
  start: "09:00",
  end: "10:30",
  durationHours: 1.5,
  isTimeBased: true,
  workType: "功能开发",
  content: "写代码",
  ...over,
});

describe("task picker", () => {
  it("puts unfinished tasks first, then the most used", () => {
    const list = sortTasksForPicker([
      task({ id: "done", title: "已完成", statusDone: true, entryCount: 99 }),
      task({ id: "few", title: "少", entryCount: 1 }),
      task({ id: "many", title: "多", entryCount: 9 }),
    ]);
    expect(list.map((t) => t.id)).toEqual(["many", "few", "done"]);
  });
  it("matches every typed word against title, code, system and requesters", () => {
    const hay = taskSearchText(task({ title: "订单导出优化", code: "A12", system: "订单系统", requesters: ["张三", "李四"] }));
    expect(matchesQuery(hay, "订单 张三")).toBe(true);
    expect(matchesQuery(hay, "a12")).toBe(true);
    expect(matchesQuery(hay, "订单 王五")).toBe(false);
    expect(matchesQuery(hay, "")).toBe(true);
  });
});

describe("paste parsing", () => {
  it("reads the layout this app copies out", () => {
    expect(parsePastedLine("订单导出优化\t功能开发\t写代码\t2026-09-16\t09:00\t10:30")).toEqual({
      code: "",
      title: "订单导出优化",
      type: "功能开发",
      content: "写代码",
      date: "2026-09-16",
      start: "09:00",
      end: "10:30",
    });
  });
  it("recognises Excel 明细 rows by their leading A/B code", () => {
    const p = parsePastedLine("A12\t订单导出优化\t\t功能开发\t写代码\t2026/9/16\t9:00\t10:30");
    expect(p).toMatchObject({ code: "A12", title: "订单导出优化", type: "功能开发", content: "写代码", date: "2026/9/16", start: "9:00", end: "10:30" });
  });
  it("drops the redundant 「划分：」 prefix Excel rows carry in their content", () => {
    const line = ["A12", "订单导出优化", "执行类", "功能开发", "功能开发：写代码", "2026/9/16", "9:00", "10:30"].join("\t");
    expect(parsePastedLine(line).content).toBe("写代码");
  });
  it("recognises the layout by its date column even when the task has no code", () => {
    const line = ["", "订单导出优化", "执行类", "功能开发", "写代码", "2026-09-16", "09:00", "10:30", "1.5", "订单系统", "张三"].join("\t");
    expect(parsePastedLine(line)).toMatchObject({ code: "", title: "订单导出优化", type: "功能开发", content: "写代码", date: "2026-09-16", start: "09:00", end: "10:30" });
  });
  it("skips a header row of either layout", () => {
    const header = ["编号", "标题", "例行工作内容划分", "例行工作工作内容", "工作内容", "日期", "开始时间", "结束时间", "用时", "系统", "需求方"].join("\t");
    const row = ["A1", "订单导出优化", "执行类", "功能开发", "写代码", "2026-09-16", "09:00", "10:30", "1.5", "", ""].join("\t");
    expect(parsePastedText(header + "\n" + row)).toHaveLength(1);
    expect(parsePastedText("标题\t工作内容划分\t内容\t日期\t开始\t结束\n订单\t功能开发\t写\t9-16\t9:00\t10:00")).toHaveLength(1);
  });
  it("reads back the JSON this app copies", () => {
    const json = JSON.stringify([{ 编号: "A1", 标题: "订单导出优化", 例行工作工作内容: "功能开发", 工作内容: "写代码", 日期: "2026-09-16", 开始时间: "09:00", 结束时间: "10:30" }]);
    expect(parsePastedText(json)).toEqual([{ code: "A1", title: "订单导出优化", type: "功能开发", content: "写代码", date: "2026-09-16", start: "09:00", end: "10:30" }]);
    expect(parsePastedText("[not json")).toHaveLength(1); // 不是合法 JSON 就当普通文本
  });
  it("skips blank lines and CRLF", () => {
    expect(parsePastedText("a\tb\r\n\r\nc\td\r\n")).toHaveLength(2);
  });
});

describe("resolveTask", () => {
  const tasks = [task({ id: "1", title: "订单导出优化", code: "A12" }), task({ id: "2", title: "会员看板", code: "B3" })];
  it("prefers the code, then exact title, then loose title", () => {
    expect(resolveTask(tasks, { code: "B3", title: "随便" })?.id).toBe("2");
    expect(resolveTask(tasks, { code: "", title: "订单导出优化" })?.id).toBe("1");
    expect(resolveTask(tasks, { code: "", title: "会员" })?.id).toBe("2");
    expect(resolveTask(tasks, { code: "", title: "不存在" })).toBeNull();
  });
});

describe("drafts", () => {
  it("continues from the previous entry's end on the same day", () => {
    expect(nextDraft(entry({}), "2026-09-20", "2026-09-14", "2026-09-20")).toMatchObject({ date: "2026-09-16", start: "10:30", type: "功能开发" });
  });
  it("does not start a new draft at 24:00", () => {
    expect(nextDraft(entry({ end: "24:00" }), "2026-09-20", "2026-09-14", "2026-09-20").start).toBe("");
  });
  it("starts today when the week is current and empty, else the week's Monday", () => {
    expect(nextDraft(undefined, "2026-09-16", "2026-09-14", "2026-09-20").date).toBe("2026-09-16");
    expect(nextDraft(undefined, "2026-10-01", "2026-09-14", "2026-09-20").date).toBe("2026-09-14");
  });
});
