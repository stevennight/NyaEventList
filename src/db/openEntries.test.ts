import { beforeEach, describe, expect, it } from "vitest";
import { summarize } from "../features/stats/aggregate";
import { toExportRows } from "../features/export/rows";
import { createNodeSqliteDb } from "./adapters/nodeSqlite";
import { runMigrations } from "./migrations";
import { createRepos, EntryValidationError, type Repos } from "./repos";

let repos: Repos;
beforeEach(async () => {
  const db = createNodeSqliteDb();
  await runMigrations(db);
  repos = createRepos(db);
});

describe("进行中的时间记录（没设结束时间）", () => {
  it("can be created without an end time and counts as 0 hours", async () => {
    const t = await repos.tasks.create({ title: "A" });
    const id = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00" });
    expect(await repos.entries.get(id)).toMatchObject({ start: "09:00", end: null, durationHours: 0 });
    const withNull = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "10:00", end: null });
    expect((await repos.entries.get(withNull))!.end).toBeNull();
    expect((await repos.tasks.list()).find((x) => x.id === t)!.totalHours).toBe(0);
  });

  it("gets its duration when the end time is filled in, and goes back to open when it is cleared", async () => {
    const t = await repos.tasks.create({ title: "A" });
    const id = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00" });
    await repos.entries.update(id, { end: "11:30" });
    expect(await repos.entries.get(id)).toMatchObject({ end: "11:30", durationHours: 2.5 });
    await repos.entries.update(id, { end: null });
    expect(await repos.entries.get(id)).toMatchObject({ end: null, durationHours: 0 });
    await repos.entries.update(id, { content: "只改内容" }); // 不传 end = 保持进行中
    expect(await repos.entries.get(id)).toMatchObject({ end: null, content: "只改内容" });
  });

  it("still rejects an end that is not after the start", async () => {
    const t = await repos.tasks.create({ title: "A" });
    await expect(repos.entries.create({ taskId: t, date: "2026-09-16", start: "10:00", end: "09:00" })).rejects.toBeInstanceOf(EntryValidationError);
    const id = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "10:00" });
    await expect(repos.entries.update(id, { end: "10:00" })).rejects.toBeInstanceOf(EntryValidationError);
  });

  it("is left out of the hours in statistics but reported, and exported without a duration", async () => {
    const t = await repos.tasks.create({ title: "A" });
    await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00", end: "10:00" });
    await repos.entries.create({ taskId: t, date: "2026-09-16", start: "10:00" });
    const entries = await repos.entries.listBetween("2026-09-14", "2026-09-20");
    const tasks = await repos.tasks.list();
    const s = summarize(entries, tasks, {}, "2026-09-14", "2026-09-20");
    expect(s).toMatchObject({ totalHours: 1, entryCount: 2, openCount: 1, activeDays: 1 });
    const rows = toExportRows(entries, tasks);
    expect(rows.map((r) => [r["开始时间"], r["结束时间"], r["用时"]])).toEqual([
      ["09:00", "10:00", 1],
      ["10:00", "", ""],
    ]);
  });

  it("can be undone and redone like any other edit", async () => {
    const t = await repos.tasks.create({ title: "A" });
    const id = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00" });
    const before = await repos.snapshots.capture({ entries: [id] });
    await repos.entries.update(id, { end: "10:00" });
    const after = await repos.snapshots.capture({ entries: [id] });
    await repos.snapshots.apply(before);
    expect(await repos.entries.get(id)).toMatchObject({ end: null, durationHours: 0 });
    await repos.snapshots.apply(after);
    expect(await repos.entries.get(id)).toMatchObject({ end: "10:00", durationHours: 1 });
  });
});
