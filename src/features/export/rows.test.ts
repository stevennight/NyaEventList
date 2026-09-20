import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { Task, TimeEntry } from "../../db/models";
import { EXPORT_COLUMNS, formatEntries, toExportRows, toJSON, toTSV } from "./rows";
import { toXlsx } from "./xlsx";

const tasks = [
  {
    id: "a",
    code: "A12",
    title: "订单导出",
    system: "订单系统",
    category: "执行类",
    requesters: ["张三", "李四"],
  } as Task,
];
const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: "e",
  taskId: "a",
  taskTitle: "订单导出",
  taskCode: "A12",
  date: "2026-09-16",
  start: "09:00",
  end: "10:30",
  durationHours: 1.5,
  isTimeBased: true,
  workType: "功能开发",
  content: "写代码",
  ...over,
});

describe("export rows", () => {
  const rows = toExportRows([entry({ id: "2", date: "2026-09-17" }), entry({ id: "1", content: "a\tb\nc" })], tasks);

  it("sorts by date and start, and flattens task fields", () => {
    expect(rows.map((r) => r.日期)).toEqual(["2026-09-16", "2026-09-17"]);
    expect(rows[0]).toMatchObject({ 编号: "A12", 系统: "订单系统", 需求方: "张三、李四", 例行工作内容划分: "执行类", 例行工作工作内容: "功能开发", 用时: 1.5 });
    expect(Object.keys(rows[0]).slice(0, 9)).toEqual(["编号", "标题", "例行工作内容划分", "例行工作工作内容", "工作内容", "日期", "开始时间", "结束时间", "用时"]); // 前 9 列跟旧「明细」一致
  });
  it("makes TSV that pastes cleanly into Excel", () => {
    const lines = toTSV(rows).split("\n");
    expect(lines[0]).toBe(EXPORT_COLUMNS.join("\t"));
    expect(lines).toHaveLength(3); // 内容里的换行/制表符被压平，不会多出行
    expect(lines[1].split("\t")).toHaveLength(EXPORT_COLUMNS.length);
    expect(lines[1]).toContain("a b c");
  });
  it("can leave the header row out", () => {
    expect(toTSV(rows, false).split("\n")).toHaveLength(2);
  });
  it("formats entries in the chosen copy format", () => {
    const entries = [entry({})];
    expect(formatEntries(entries, tasks, { format: "excel", header: false }).split("\t")).toHaveLength(EXPORT_COLUMNS.length);
    expect(formatEntries(entries, tasks, { format: "excel", header: true }).split("\n")).toHaveLength(2);
    expect(JSON.parse(formatEntries(entries, tasks, { format: "json", header: true }))[0]["标题"]).toBe("订单导出");
  });
  it("makes JSON", () => {
    expect(JSON.parse(toJSON(rows))).toHaveLength(2);
  });
  it("makes an xlsx that reads back with the same columns", () => {
    const wb = XLSX.read(toXlsx(rows), { type: "array" });
    const back = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["明细"]);
    expect(back).toHaveLength(2);
    expect(Object.keys(back[0])).toEqual([...EXPORT_COLUMNS]);
    expect(back[0]["用时"]).toBe(1.5);
  });
});
