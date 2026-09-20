import { beforeEach, describe, expect, it } from "vitest";
import { createNodeSqliteDb } from "./adapters/nodeSqlite";
import { getUserVersion, MIGRATIONS, runMigrations } from "./migrations";
import { createRepos, DictionaryError, EntryValidationError, type Repos } from "./repos";
import type { Db } from "./types";

let db: Db;
let repos: Repos;

beforeEach(async () => {
  db = createNodeSqliteDb();
  await runMigrations(db);
  repos = createRepos(db);
});

describe("migrations", () => {
  it("creates the schema, seeds defaults and is safe to re-run", async () => {
    expect(await getUserVersion(db)).toBe(MIGRATIONS.at(-1)!.version);
    await runMigrations(db);
    const status = await repos.options.list("status");
    expect(status.map((s) => s.value)).toContain("已交付");
    expect(status.find((s) => s.value === "已交付")!.isDone).toBe(false);
    expect(status.filter((s) => s.isDone).map((s) => s.value)).toEqual(["已上线", "已终止"]);
  });
});

describe("options", () => {
  it("ensure reuses existing values and creates missing ones once", async () => {
    const a = await repos.options.ensure("system", "订单系统");
    const b = await repos.options.ensure("system", " 订单系统 ");
    expect(a).toBe(b);
    expect((await repos.options.list("system")).map((o) => o.value)).toEqual(["订单系统"]);
  });
  it("rejects unknown lists", async () => {
    await expect(repos.options.ensure("nope", "x")).rejects.toThrow();
  });
});

describe("tasks", () => {
  it("creates a task with several requesters in order, tags and dictionary fields", async () => {
    const id = await repos.tasks.create({
      title: "订单导出优化",
      system: "订单系统",
      category: "执行类",
      requesters: ["张三", "李四", "张三"],
      tags: ["性能", "导出"],
      code: "A12",
    });
    const t = (await repos.tasks.get(id))!;
    expect(t).toMatchObject({
      title: "订单导出优化",
      kind: "requirement",
      system: "订单系统",
      category: "执行类",
      status: "待处理",
      statusDone: false,
      code: "A12",
      entryCount: 0,
      totalHours: 0,
    });
    expect(t.requesters).toEqual(["张三", "李四"]);
    expect(t.tags).toEqual(["导出", "性能"]);
    // 新需求方默认类型为“其他”
    expect((await repos.requesters.list()).every((r) => r.type === "其他")).toBe(true);
  });

  it("updates fields and replaces requesters without touching untouched ones", async () => {
    const id = await repos.tasks.create({ title: "A", requesters: ["张三"], system: "S1" });
    await repos.tasks.update(id, { requesters: ["王五", "张三"], status: "已上线" });
    const t = (await repos.tasks.get(id))!;
    expect(t.requesters).toEqual(["王五", "张三"]);
    expect(t.system).toBe("S1");
    expect(t.statusDone).toBe(true);
    await repos.tasks.update(id, { system: null });
    expect((await repos.tasks.get(id))!.system).toBeNull();
  });

  it("enforces unique task codes", async () => {
    await repos.tasks.create({ title: "A", code: "X1" });
    await expect(repos.tasks.create({ title: "B", code: "X1" })).rejects.toThrow();
  });

  it("removes a task together with its entries and links", async () => {
    const id = await repos.tasks.create({ title: "A", requesters: ["张三"], tags: ["t"] });
    await repos.entries.create({ taskId: id, date: "2026-09-16", start: "09:00", end: "10:00" });
    await repos.tasks.remove(id);
    expect(await repos.tasks.get(id)).toBeNull();
    expect(await repos.entries.listBetween("2026-01-01", "2026-12-31")).toEqual([]);
    expect(await db.select("SELECT * FROM task_requesters")).toEqual([]);
    expect(await db.select("SELECT * FROM task_tags")).toEqual([]);
  });
});

describe("tasks.list with ids", () => {
  it("returns only the requested tasks, with fresh aggregates", async () => {
    const a = await repos.tasks.create({ title: "A" });
    const b = await repos.tasks.create({ title: "B" });
    await repos.tasks.create({ title: "C" });
    await repos.entries.create({ taskId: a, date: "2026-09-16", start: "09:00", end: "10:00" });
    const some = await repos.tasks.list([a, b, a, "nope"]);
    expect(some.map((t) => t.title).sort()).toEqual(["A", "B"]);
    expect(some.find((t) => t.id === a)!.totalHours).toBe(1);
    expect(await repos.tasks.list([])).toEqual([]);
  });
});

describe("bulk edit", () => {
  it("sets a dictionary field on many tasks at once, creating the value if needed", async () => {
    const a = await repos.tasks.create({ title: "A", system: "招聘系统（JAVA）" });
    const b = await repos.tasks.create({ title: "B", system: "招聘系统（JAVA）" });
    const c = await repos.tasks.create({ title: "C", system: "别的" });
    expect(await repos.tasks.bulkSetOption([a, b], "system", "JAVA-招聘系统")).toBe(2);
    const sys = Object.fromEntries((await repos.tasks.list()).map((t) => [t.title, t.system]));
    expect(sys).toEqual({ A: "JAVA-招聘系统", B: "JAVA-招聘系统", C: "别的" });
    await repos.tasks.bulkSetOption([c], "status", "已上线");
    expect((await repos.tasks.get(c))!.statusDone).toBe(true);
    await repos.tasks.bulkSetOption([c], "system", null);
    expect((await repos.tasks.get(c))!.system).toBeNull();
  });

  it("handles more ids than one statement can bind", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 1700; i++) ids.push(await repos.tasks.create({ title: `T${i}` }));
    expect(await repos.tasks.bulkSetOption(ids, "category", "执行类")).toBe(1700);
  });

  it("adds requesters without touching existing ones, keeping order", async () => {
    const a = await repos.tasks.create({ title: "A", requesters: ["张三"] });
    const b = await repos.tasks.create({ title: "B" });
    await repos.tasks.bulkRequesters([a, b], { mode: "add" }, ["李四", "张三"]);
    expect((await repos.tasks.get(a))!.requesters).toEqual(["张三", "李四"]);
    expect((await repos.tasks.get(b))!.requesters).toEqual(["李四", "张三"]);
  });

  it("replaces all requesters", async () => {
    const a = await repos.tasks.create({ title: "A", requesters: ["张三", "李四"] });
    await repos.tasks.bulkRequesters([a], { mode: "replace" }, ["王五"]);
    expect((await repos.tasks.get(a))!.requesters).toEqual(["王五"]);
  });

  it("swaps one requester for another and merges when the target is already there", async () => {
    const a = await repos.tasks.create({ title: "A", requesters: ["旧名", "张三"] });
    const b = await repos.tasks.create({ title: "B", requesters: ["旧名", "新名"] });
    const c = await repos.tasks.create({ title: "C", requesters: ["李四"] });
    await repos.tasks.bulkRequesters([a, b, c], { mode: "swap", from: "旧名" }, ["新名"]);
    expect((await repos.tasks.get(a))!.requesters).toEqual(["新名", "张三"]);
    expect((await repos.tasks.get(b))!.requesters).toEqual(["新名"]);
    expect((await repos.tasks.get(c))!.requesters).toEqual(["李四"]);
  });
});

describe("dictionary management", () => {
  it("counts usage per dictionary", async () => {
    const t1 = await repos.tasks.create({ title: "A", system: "S1", status: "开发中" });
    await repos.tasks.create({ title: "B", system: "S1" });
    await repos.options.ensure("system", "没人用");
    await repos.entries.create({ taskId: t1, date: "2026-09-16", start: "09:00", end: "10:00", workType: "功能开发" });
    const sys = Object.fromEntries((await repos.options.listWithUsage("system")).map((o) => [o.value, o.usage]));
    expect(sys).toEqual({ S1: 2, 没人用: 0 });
    expect((await repos.options.listWithUsage("status")).find((o) => o.value === "开发中")!.usage).toBe(1);
    expect((await repos.options.listWithUsage("work_type")).find((o) => o.value === "功能开发")!.usage).toBe(1);
  });

  it("renames an option for every task that uses it, and refuses a clash", async () => {
    const id = await repos.tasks.create({ title: "A", system: "旧名" });
    await repos.tasks.create({ title: "B", system: "新名" });
    const old = (await repos.options.listWithUsage("system")).find((o) => o.value === "旧名")!;
    await expect(repos.options.rename(old.id, "新名")).rejects.toBeInstanceOf(DictionaryError);
    await repos.options.rename(old.id, "改好的名字");
    expect((await repos.tasks.get(id))!.system).toBe("改好的名字");
  });

  it("only deletes options nobody references", async () => {
    await repos.tasks.create({ title: "A", system: "在用" });
    await repos.options.ensure("system", "没用");
    const all = await repos.options.listWithUsage("system");
    expect(await repos.options.removeIfUnused(all.find((o) => o.value === "在用")!.id)).toBe(false);
    expect(await repos.options.removeIfUnused(all.find((o) => o.value === "没用")!.id)).toBe(true);
    expect((await repos.options.list("system")).map((o) => o.value)).toEqual(["在用"]);
  });

  it("toggles the done flag on a status", async () => {
    const s = (await repos.options.list("status")).find((o) => o.value === "已交付")!;
    await repos.options.setDone(s.id, true);
    const t = await repos.tasks.create({ title: "A", status: "已交付" });
    expect((await repos.tasks.get(t))!.statusDone).toBe(true);
  });

  it("manages requesters: usage, rename, type, delete", async () => {
    await repos.tasks.create({ title: "A", requesters: ["张三", "李四"] });
    await repos.requesters.ensure("没任务的人");
    const list = await repos.requesters.listWithUsage();
    expect(Object.fromEntries(list.map((r) => [r.name, r.usage]))).toEqual({ 张三: 1, 李四: 1, 没任务的人: 0 });
    const zhang = list.find((r) => r.name === "张三")!;
    await expect(repos.requesters.rename(zhang.id, "李四")).rejects.toBeInstanceOf(DictionaryError);
    await repos.requesters.rename(zhang.id, "张三丰");
    await repos.requesters.setType(zhang.id, "业务方");
    const after = (await repos.requesters.listWithUsage()).find((r) => r.id === zhang.id)!;
    expect(after).toMatchObject({ name: "张三丰", type: "业务方", usage: 1 });
    expect(await repos.requesters.removeIfUnused(zhang.id)).toBe(false);
    expect(await repos.requesters.removeIfUnused(list.find((r) => r.name === "没任务的人")!.id)).toBe(true);
  });
});

describe("time entries", () => {
  it("aggregates entry count, hours and last date on the task", async () => {
    const id = await repos.tasks.create({ title: "A" });
    await repos.entries.create({ taskId: id, date: "2026-09-15", start: "09:00", end: "10:30", workType: "功能开发" });
    await repos.entries.create({ taskId: id, date: "2026-09-16", start: "14:00", end: "15:00" });
    const t = (await repos.tasks.get(id))!;
    expect(t.entryCount).toBe(2);
    expect(t.totalHours).toBe(2.5);
    expect(t.lastEntryDate).toBe("2026-09-16");
  });

  it("lists a date range ordered by day and start time", async () => {
    const id = await repos.tasks.create({ title: "A", code: "C1" });
    await repos.entries.create({ taskId: id, date: "2026-09-16", start: "14:00", end: "15:00" });
    await repos.entries.create({ taskId: id, date: "2026-09-16", start: "09:00", end: "10:00", workType: "功能开发", content: "写代码" });
    await repos.entries.create({ taskId: id, date: "2026-09-20", start: "09:00", end: "10:00" });
    const list = await repos.entries.listBetween("2026-09-16", "2026-09-16");
    expect(list.map((e) => e.start)).toEqual(["09:00", "14:00"]);
    expect(list[0]).toMatchObject({ taskTitle: "A", taskCode: "C1", workType: "功能开发", content: "写代码", durationHours: 1 });
  });

  it("allows 24:00 as an end but rejects reversed or cross-midnight ranges", async () => {
    const id = await repos.tasks.create({ title: "A" });
    await expect(repos.entries.create({ taskId: id, date: "2026-09-16", start: "23:00", end: "24:00" })).resolves.toBeTruthy();
    await expect(repos.entries.create({ taskId: id, date: "2026-09-16", start: "23:00", end: "01:00" })).rejects.toBeInstanceOf(EntryValidationError);
    await expect(repos.entries.create({ taskId: id, date: "2026-09-16", start: "10:00", end: "10:00" })).rejects.toBeInstanceOf(EntryValidationError);
  });

  it("updates a time range and recomputes the duration", async () => {
    const id = await repos.tasks.create({ title: "A" });
    const eid = await repos.entries.create({ taskId: id, date: "2026-09-16", start: "09:00", end: "10:00", workType: "功能开发" });
    await repos.entries.update(eid, { end: "11:30" });
    const e = (await repos.entries.get(eid))!;
    expect(e.durationHours).toBe(2.5);
    expect(e.workType).toBe("功能开发");
    await expect(repos.entries.update(eid, { start: "12:00" })).rejects.toBeInstanceOf(EntryValidationError);
  });
});

describe("removing entries in bulk", () => {
  it("deletes only the given ones and reports how many", async () => {
    const t = await repos.tasks.create({ title: "A" });
    const a = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00", end: "10:00" });
    const b = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "10:00", end: "11:00" });
    const c = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "11:00", end: "12:00" });
    expect(await repos.entries.removeMany([a, b, "nope"])).toBe(2);
    expect((await repos.entries.listBetween("2026-09-16", "2026-09-16")).map((e) => e.id)).toEqual([c]);
    expect(await repos.entries.removeMany([])).toBe(0);
  });
});

describe("settings", () => {
  it("round-trips JSON values with a fallback", async () => {
    expect(await repos.settings.get("dueSoonDays", 3)).toBe(3);
    await repos.settings.set("dueSoonDays", 5);
    await repos.settings.set("dueSoonDays", 7);
    expect(await repos.settings.get("dueSoonDays", 3)).toBe(7);
  });
});
