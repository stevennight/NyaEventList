import { beforeEach, describe, expect, it } from "vitest";
import { createNodeSqliteDb } from "./adapters/nodeSqlite";
import { runMigrations } from "./migrations";
import { createRepos, type Repos } from "./repos";
import type { Db } from "./types";

let db: Db;
let repos: Repos;

beforeEach(async () => {
  db = createNodeSqliteDb();
  await runMigrations(db);
  repos = createRepos(db);
});

/** 改之前取一份、改之后取一份，返回撤销/重做用的两个函数 */
async function track(ids: Parameters<Repos["snapshots"]["capture"]>[0], run: () => Promise<unknown>, created: Parameters<Repos["snapshots"]["capture"]>[0] = {}) {
  const before = await repos.snapshots.capture(ids);
  await run();
  const all = { tasks: [...(ids.tasks ?? []), ...(created.tasks ?? [])], entries: [...(ids.entries ?? []), ...(created.entries ?? [])], options: [...(ids.options ?? []), ...(created.options ?? [])], requesters: [...(ids.requesters ?? []), ...(created.requesters ?? [])] };
  const after = await repos.snapshots.capture(all);
  before.missingTasks.push(...(created.tasks ?? []));
  before.missingEntries.push(...(created.entries ?? []));
  before.missingOptions.push(...(created.options ?? []));
  before.missingRequesters.push(...(created.requesters ?? []));
  return { undo: () => repos.snapshots.apply(before), redo: () => repos.snapshots.apply(after) };
}

describe("time entries", () => {
  it("undoes and redoes an edit", async () => {
    const t = await repos.tasks.create({ title: "A" });
    const e = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00", end: "10:00", workType: "功能开发", content: "旧内容" });
    const h = await track({ entries: [e] }, () => repos.entries.update(e, { end: "11:30", content: "新内容" }));
    expect((await repos.entries.get(e))!).toMatchObject({ end: "11:30", content: "新内容", durationHours: 2.5 });
    expect(await h.undo()).toEqual([]);
    expect((await repos.entries.get(e))!).toMatchObject({ end: "10:00", content: "旧内容", durationHours: 1, workType: "功能开发" });
    await h.redo();
    expect((await repos.entries.get(e))!).toMatchObject({ end: "11:30", content: "新内容" });
  });

  it("undoes a creation by deleting the row, and redo brings it back with the same id", async () => {
    const t = await repos.tasks.create({ title: "A" });
    let id = "";
    const h = await track({}, async () => (id = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00", end: "10:00" })), {});
    // 创建的 id 事先不知道，这里补录
    const before = await repos.snapshots.capture({});
    before.missingEntries.push(id);
    const after = await repos.snapshots.capture({ entries: [id] });
    await repos.snapshots.apply(before);
    expect(await repos.entries.get(id)).toBeNull();
    await repos.snapshots.apply(after);
    expect((await repos.entries.get(id))!.start).toBe("09:00");
    expect(h).toBeTruthy();
  });

  it("undoes a deletion, including many rows at once", async () => {
    const t = await repos.tasks.create({ title: "A" });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await repos.entries.create({ taskId: t, date: "2026-09-16", start: `0${i}:00`, end: `0${i}:30`, content: `第${i}条` }));
    const before = await repos.snapshots.capture({ entries: ids });
    await repos.entries.removeMany(ids);
    expect(await repos.entries.listBetween("2026-09-16", "2026-09-16")).toHaveLength(0);
    await repos.snapshots.apply(before);
    const back = await repos.entries.listBetween("2026-09-16", "2026-09-16");
    expect(back.map((e) => e.content)).toEqual(["第0条", "第1条", "第2条", "第3条", "第4条"]);
  });

  it("brings back a work type that was deleted in the meantime", async () => {
    const t = await repos.tasks.create({ title: "A" });
    const e = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00", end: "10:00", workType: "临时划分" });
    const before = await repos.snapshots.capture({ entries: [e] });
    await repos.entries.update(e, { workType: "功能开发" });
    const type = (await repos.options.listWithUsage("work_type")).find((o) => o.value === "临时划分")!;
    expect(await repos.options.removeIfUnused(type.id)).toBe(true); // 现在没人用了，可以删
    await repos.snapshots.apply(before);
    expect((await repos.entries.get(e))!.workType).toBe("临时划分");
  });
});

describe("tasks", () => {
  it("restores fields, requesters in order and tags", async () => {
    const id = await repos.tasks.create({ title: "旧标题", system: "系统甲", status: "开发中", requesters: ["张三", "李四", "王五"], tags: ["重点"], description: "旧说明", pinned: true });
    const h = await track({ tasks: [id] }, () => repos.tasks.update(id, { title: "新标题", system: "系统乙", status: "已上线", requesters: ["王五"], tags: [], description: null, pinned: false }));
    expect((await repos.tasks.get(id))!).toMatchObject({ title: "新标题", system: "系统乙", statusDone: true, requesters: ["王五"], tags: [], pinned: false });
    await h.undo();
    expect((await repos.tasks.get(id))!).toMatchObject({ title: "旧标题", system: "系统甲", status: "开发中", requesters: ["张三", "李四", "王五"], tags: ["重点"], description: "旧说明", pinned: true });
    await h.redo();
    expect((await repos.tasks.get(id))!.requesters).toEqual(["王五"]);
  });

  it("undoes a bulk edit across many tasks", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 1200; i++) ids.push(await repos.tasks.create({ title: `T${i}`, system: i % 2 ? "奇" : "偶", requesters: ["张三"] }));
    const before = await repos.snapshots.capture({ tasks: ids });
    await repos.tasks.bulkSetOption(ids, "system", "统一");
    await repos.tasks.bulkRequesters(ids, { mode: "replace" }, ["李四", "王五"]);
    await repos.snapshots.apply(before);
    const t0 = (await repos.tasks.get(ids[0]))!;
    const t1 = (await repos.tasks.get(ids[1]))!;
    expect([t0.system, t1.system, t0.requesters]).toEqual(["偶", "奇", ["张三"]]);
  });

  it("undoes the creation of a task, but refuses if it has gained time entries", async () => {
    const before = await repos.snapshots.capture({});
    const id = await repos.tasks.create({ title: "新任务", requesters: ["张三"] });
    before.missingTasks.push(id);
    const entry = await repos.entries.create({ taskId: id, date: "2026-09-16", start: "09:00", end: "10:00" });
    const conflicts = await repos.snapshots.apply(before);
    expect(conflicts).toHaveLength(1);
    expect(await repos.tasks.get(id)).not.toBeNull();
    await repos.entries.remove(entry);
    expect(await repos.snapshots.apply(before)).toEqual([]);
    expect(await repos.tasks.get(id)).toBeNull();
    expect(await db.select("SELECT * FROM task_requesters WHERE task_id = ?", [id])).toEqual([]);
  });

  it("maps to the existing requester when the original was deleted and re-created under the same name", async () => {
    const id = await repos.tasks.create({ title: "A", requesters: ["张三"] });
    const before = await repos.snapshots.capture({ tasks: [id] });
    await repos.tasks.update(id, { requesters: [] });
    const old = (await repos.requesters.listWithUsage()).find((r) => r.name === "张三")!;
    await repos.requesters.removeIfUnused(old.id);
    await repos.requesters.ensure("张三"); // 同名重建，id 不同了
    await repos.snapshots.apply(before);
    expect((await repos.tasks.get(id))!.requesters).toEqual(["张三"]);
    expect((await repos.requesters.list()).filter((r) => r.name === "张三")).toHaveLength(1);
  });
});

describe("dictionaries", () => {
  it("undoes a rename and redoes it", async () => {
    const id = await repos.tasks.create({ title: "A", system: "旧名" });
    const opt = (await repos.options.listWithUsage("system")).find((o) => o.value === "旧名")!;
    const h = await track({ options: [opt.id] }, () => repos.options.rename(opt.id, "新名"));
    expect((await repos.tasks.get(id))!.system).toBe("新名");
    await h.undo();
    expect((await repos.tasks.get(id))!.system).toBe("旧名");
    await h.redo();
    expect((await repos.tasks.get(id))!.system).toBe("新名");
  });

  it("does not undo a rename when the old name has been taken by another item", async () => {
    await repos.tasks.create({ title: "A", system: "旧名" });
    const opt = (await repos.options.listWithUsage("system")).find((o) => o.value === "旧名")!;
    const before = await repos.snapshots.capture({ options: [opt.id] });
    await repos.options.rename(opt.id, "新名");
    await repos.options.ensure("system", "旧名"); // 旧名字被新建的另一项占了
    const conflicts = await repos.snapshots.apply(before);
    expect(conflicts[0]).toContain("同名");
    expect((await repos.options.list("system")).find((o) => o.id === opt.id)!.value).toBe("新名");
  });

  it("undoes deleting an unused item and the done flag", async () => {
    const id = await repos.options.ensure("system", "没用的");
    const before = await repos.snapshots.capture({ options: [id] });
    await repos.options.removeIfUnused(id);
    expect((await repos.options.list("system")).map((o) => o.value)).not.toContain("没用的");
    await repos.snapshots.apply(before);
    expect((await repos.options.list("system")).map((o) => o.value)).toContain("没用的");

    const done = (await repos.options.list("status")).find((o) => o.value === "已交付")!;
    const b2 = await repos.snapshots.capture({ options: [done.id] });
    await repos.options.setDone(done.id, true);
    await repos.snapshots.apply(b2);
    expect((await repos.options.list("status")).find((o) => o.value === "已交付")!.isDone).toBe(false);
  });

  it("refuses to undo an addition that is now in use", async () => {
    const before = await repos.snapshots.capture({});
    const id = await repos.options.ensure("system", "刚新增的");
    before.missingOptions.push(id);
    await repos.tasks.create({ title: "A", system: "刚新增的" });
    const conflicts = await repos.snapshots.apply(before);
    expect(conflicts).toHaveLength(1);
    expect((await repos.options.list("system")).map((o) => o.value)).toContain("刚新增的");
  });

  it("undoes a requester rename and type change", async () => {
    const t = await repos.tasks.create({ title: "A", requesters: ["张三"] });
    const r = (await repos.requesters.listWithUsage()).find((x) => x.name === "张三")!;
    const before = await repos.snapshots.capture({ requesters: [r.id] });
    await repos.requesters.rename(r.id, "张三丰");
    await repos.requesters.setType(r.id, "业务方");
    await repos.snapshots.apply(before);
    expect((await repos.tasks.get(t))!.requesters).toEqual(["张三"]);
    expect((await repos.requesters.list()).find((x) => x.id === r.id)).toMatchObject({ name: "张三", type: "其他" });
  });
});
