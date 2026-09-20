import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it } from "vitest";
import { createNodeSqliteDb } from "../db/adapters/nodeSqlite";
import { runMigrations } from "../db/migrations";
import { createRepos, type Repos } from "../db/repos";
import type { Db } from "../db/types";
import { parseWorkbook, serialToDate, serialToMinutes, splitRequesters } from "./excel";
import { importParsed } from "./importer";

// 2024-12-02 的 Excel 序列号是 45628
const D = 45628;
const at = (day: number, h: number, m = 0) => day + (h * 60 + m) / 1440;

function buildWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  add("需求列表", [
    ["编号", "系统", "版本号", "标题", "产品", "简要内容", "分支", "例行工作内容划分", "内容", "状态", "所属月份", "预计人天", "需求池编号"],
    ["A01", "CRM-会员端", "2.4.1", "CRM-会员端 2.4.1", "王五/李四", "提成核实表", "feat/x", "执行类", "x", "已上线", D, "无", "000441"],
    ["A02", "标签码", null, "标签码：v1.1.6", "？", "标签码：v1.1.6", "无", "执行类", "x", "开发中", "历史需求", 2, null],
    ["A03", "OA", null, "已终止的", "许三，金一", null, null, "执行类", null, "已终止", null, null, null],
    ["A04", null, null, null, null, null, null, null, null, null, null, null, null], // 只有编号的预留行
  ]);
  add("非需求任务列表", [
    ["编号", "系统", "标题", "标签码：这是被顶掉的表头", "对接人", "分支", "例行工作内容划分", "绩效统计归类", "状态", "Key Project需求池编号"],
    ["B01", "其他事务", "【固定】工作统计", "工作统计", "无", "无", "辅助类", "不统计", "长期", null],
    ["B02", "UAC", "UAC：跳过验证码", "UAC：跳过验证码", "钱一（业务）", "无", "执行类", "业务支持", "已处理", "K1"],
    ["B03", "OA", "处理中的事", null, "Project-X", "master", "执行类", "业务支持", "处理中", null],
  ]);
  add("明细", [
    ["编号", "标题", "例行工作内容划分", "例行工作工作内容", "工作内容", "日期", "开始时间", "结束时间", "用时", "备注"],
    ["A01", "t", "执行类", "需求对接", "需求对接：需求评审；沟通", D, at(D, 9, 30), at(D, 11), 1.5, null],
    // 开始/结束列里的日期部分是错的（比日期列多一天），以日期列为准
    ["A01", "t", "执行类", "功能开发", "功能开发：写代码", D, at(D + 1, 14), at(D + 1, 15, 30), 1.5, null],
    ["B01", "t", "辅助类", "辅助类", "工作整理", D, at(D, 23), at(D + 1, 0), 1, null], // 到次日 0 点 = 24:00
    ["B02", "t", "执行类", "功能开发", "结束早于开始", D, at(D, 10), at(D, 9), -1, null],
    ["B02", "t", "执行类", "功能开发", "日期缺失", null, at(D, 9), at(D, 10), 1, null],
    ["ZZZ", "t", "执行类", "功能开发", "找不到任务", D, at(D, 9), at(D, 10), 1, null],
    ["A01", "t", "执行类", "功能开发", "跨午夜的工作", D, at(D, 22, 30), at(D + 1, 1), 2.5, null], // 22:30–次日 01:00，用时对得上
    ["A01", "t", "执行类", "被错位的任务标题", "划分列错位", D, at(D, 8), at(D, 9), 1, null],
    [null, null, null, null, null, null, null, null, null, null],
  ]);
  add("月日常性工作项", [
    ["B01", "【固定】工作统计"],
    [null, null],
    ["#N/A", "#N/A"],
    ["NOPE", "不存在"],
  ]);
  add("选项", [
    ["系统", "例行工作内容划分", "例行工作工作内容", "任务状态"],
    ["其他事务", "执行类", "需求对接", "待产品交付"],
    ["UAC", "辅助类", "辅助类", "待安排"],
    [null, null, "功能开发", null],
  ]);
  add("待办", [["不该被读取"]]);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("excel helpers", () => {
  it("converts serials without timezone drift", () => {
    expect(serialToDate(D)).toBe("2024-12-02");
    expect(serialToDate(at(D, 23, 59))).toBe("2024-12-02");
    expect(serialToMinutes(at(D, 9, 30))).toBe(570);
    expect(serialToMinutes(D)).toBe(0);
  });
  it("splits several requesters and drops placeholders", () => {
    expect(splitRequesters("王五/李四")).toEqual(["王五", "李四"]);
    expect(splitRequesters("许三，金一")).toEqual(["许三", "金一"]);
    expect(splitRequesters("无")).toEqual([]);
    expect(splitRequesters("？")).toEqual([]);
    expect(splitRequesters(null)).toEqual([]);
    expect(splitRequesters("张三/张三")).toEqual(["张三"]);
  });
});

describe("parseWorkbook", () => {
  const parsed = parseWorkbook(buildWorkbook());

  it("reads requirement and non-requirement tasks and skips placeholder rows", () => {
    expect(parsed.tasks.map((t) => t.code)).toEqual(["A01", "A02", "A03", "B01", "B02", "B03"]);
    const a1 = parsed.tasks[0];
    expect(a1).toMatchObject({ kind: "requirement", title: "CRM-会员端 2.4.1", description: "提成核实表", system: "CRM-会员端", requesters: ["王五", "李四"], versionNo: "2.4.1", branch: "feat/x", poolNo: "000441", belongsMonth: "2024-12", estimatedDays: null });
    expect(parsed.tasks[1]).toMatchObject({ description: null, requesters: [], branch: null, belongsMonth: "历史需求", estimatedDays: 2 });
    expect(parsed.tasks[2].requesters).toEqual(["许三", "金一"]);
  });

  it("uses the column right of 标题 as the description of non-requirement tasks", () => {
    const b1 = parsed.tasks.find((t) => t.code === "B01")!;
    expect(b1).toMatchObject({ kind: "routine", description: "工作统计", requesters: [], branch: null, status: "长期", category: "辅助类" });
    expect(parsed.tasks.find((t) => t.code === "B02")).toMatchObject({ description: null, poolNo: "K1", requesters: ["钱一（业务）"] });
  });

  it("takes the date from the date column and only the time from start/end", () => {
    const e = parsed.entries;
    expect(e[0]).toMatchObject({ code: "A01", date: "2024-12-02", start: "09:30", end: "11:00", workType: "需求对接", content: "需求评审；沟通" });
    expect(e[1]).toMatchObject({ date: "2024-12-02", start: "14:00", end: "15:30", content: "写代码" });
    expect(e[2]).toMatchObject({ code: "B01", start: "23:00", end: "24:00" });
  });

  it("skips bad rows with a readable warning instead of importing nonsense", () => {
    expect(parsed.entries).toHaveLength(7); // 3 个好的 + 找不到任务的 + 拆成两段的跨午夜 + 划分错位的（找不到任务的到导入阶段才丢弃）
    expect(parsed.warnings.join("\n")).toContain("结束时间（09:00）不晚于开始时间（10:00）");
    expect(parsed.warnings.join("\n")).toContain("日期或起止时间缺失");
    expect(parsed.warnings.join("\n")).toContain("在任务表里找不到");
  });

  it("splits overnight work at midnight when the sheet's own 用时 agrees", () => {
    const night = parsed.entries.filter((e) => e.content === "跨午夜的工作");
    expect(night.map((e) => [e.date, e.start, e.end, e.part])).toEqual([
      ["2024-12-02", "22:30", "24:00", undefined],
      ["2024-12-03", "00:00", "01:00", "b"],
    ]);
    expect(parsed.warnings.join(" | ")).toContain("跨了午夜，已拆成两条");
  });

  it("blanks a work type that is not in the 选项 list instead of polluting the dictionary", () => {
    const bad = parsed.entries.find((e) => e.content === "划分列错位")!;
    expect(bad.workType).toBeNull();
    expect(parsed.warnings.join(" | ")).toContain("不在「选项」里");
  });

  it("collects initial options but not the computed 待安排 status, and ignores other sheets", () => {
    expect(parsed.options.status).toEqual(["待产品交付"]);
    expect(parsed.options.system).toEqual(["其他事务", "UAC"]);
    expect(parsed.options.work_type).toEqual(["需求对接", "辅助类", "功能开发"]);
    expect(parsed.pinnedCodes).toEqual(["B01", "NOPE"]);
    expect(Object.keys(parsed.sheetRows)).not.toContain("待办");
  });

  it("refuses files that are clearly not the old workbook", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"]]), "Sheet1");
    expect(() => parseWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })))).toThrow(/不像旧的工作统计表/);
  });
});

describe("importParsed", () => {
  let db: Db;
  let repos: Repos;
  beforeEach(async () => {
    db = createNodeSqliteDb();
    await runMigrations(db);
    repos = createRepos(db);
  });

  it("writes tasks, requesters, dictionaries and entries", async () => {
    const res = await importParsed(db, repos, parseWorkbook(buildWorkbook()), "test.xlsx");
    expect(res).toMatchObject({ tasksAdded: 6, tasksExisting: 0, entriesAdded: 6, entriesOrphan: 1, pinned: 1 });

    const tasks = await repos.tasks.list();
    const a1 = tasks.find((t) => t.code === "A01")!;
    expect(a1).toMatchObject({ kind: "requirement", system: "CRM-会员端", status: "已上线", requesters: ["王五", "李四"], entryCount: 5, totalHours: 6.5 });
    expect(tasks.find((t) => t.code === "B01")).toMatchObject({ pinned: true, kind: "routine", entryCount: 1, totalHours: 1 });
    expect(tasks.find((t) => t.code === "B02")).toMatchObject({ status: "已处理", statusDone: true, requesters: ["钱一（业务）"] });
    expect(tasks.find((t) => t.code === "B03")).toMatchObject({ status: "处理中", statusDone: false });

    const types = Object.fromEntries((await repos.requesters.list()).map((r) => [r.name, r.type]));
    expect(types["钱一（业务）"]).toBe("业务方");
    expect(types["王五"]).toBe("其他");

    expect((await repos.options.list("status")).map((o) => o.value)).toContain("长期");
    expect((await repos.options.list("status")).map((o) => o.value)).not.toContain("待安排");
    expect((await repos.options.list("work_type")).map((o) => o.value)).toContain("辅助类");

    const entries = await repos.entries.listBetween("2024-12-02", "2024-12-02");
    expect(entries.map((e) => [e.taskCode, e.start, e.end, e.workType, e.content])).toEqual([
      ["A01", "08:00", "09:00", null, "划分列错位"],
      ["A01", "09:30", "11:00", "需求对接", "需求评审；沟通"],
      ["A01", "14:00", "15:30", "功能开发", "写代码"],
      ["A01", "22:30", "24:00", "功能开发", "跨午夜的工作"],
      ["B01", "23:00", "24:00", "辅助类", "工作整理"],
    ]);
    expect(entries[4].durationHours).toBe(1);
    expect((await repos.entries.listBetween("2024-12-03", "2024-12-03")).map((e) => [e.start, e.end])).toEqual([["00:00", "01:00"]]);
    expect((await repos.options.list("work_type")).map((o) => o.value)).not.toContain("被错位的任务标题");
  });

  it("is idempotent and keeps edits made in the app", async () => {
    await importParsed(db, repos, parseWorkbook(buildWorkbook()), "test.xlsx");
    const a1 = (await repos.tasks.list()).find((t) => t.code === "A01")!;
    await repos.tasks.update(a1.id, { title: "我改过的标题", requesters: ["新需求方"] });

    const again = await importParsed(db, repos, parseWorkbook(buildWorkbook()), "test.xlsx");
    expect(again).toMatchObject({ tasksAdded: 0, tasksExisting: 6, entriesAdded: 0, entriesExisting: 6 });
    const after = (await repos.tasks.list()).find((t) => t.code === "A01")!;
    expect(after.title).toBe("我改过的标题");
    expect(after.requesters).toEqual(["新需求方"]);
    expect(after.entryCount).toBe(5);
    expect((await db.select("SELECT id FROM tasks")).length).toBe(6);
    expect((await db.select("SELECT id FROM import_batches")).length).toBe(2);
  });

  it("imports thousands of rows in chunks", async () => {
    const wb = XLSX.utils.book_new();
    const tasks: unknown[][] = [["编号", "标题"]];
    const details: unknown[][] = [["编号", "日期", "开始时间", "结束时间", "例行工作工作内容", "工作内容"]];
    for (let i = 1; i <= 300; i++) tasks.push([`B${i}`, `任务${i}`]);
    for (let i = 0; i < 3000; i++) details.push([`B${(i % 300) + 1}`, D + (i % 20), at(0, 9), at(0, 10), "功能开发", "x"]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tasks), "非需求任务列表");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(details), "明细");
    const res = await importParsed(db, repos, parseWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))), "big.xlsx");
    expect(res).toMatchObject({ tasksAdded: 300, entriesAdded: 3000 });
  });
});
