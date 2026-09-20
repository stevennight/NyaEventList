import { beforeEach, describe, expect, it } from "vitest";
import { createNodeSqliteDb } from "../../db/adapters/nodeSqlite";
import { runMigrations } from "../../db/migrations";
import { createRepos, type Repos } from "../../db/repos";
import { emptySnapshot } from "../../db/snapshots";
import { describeStep } from "./describe";
import { UndoHistory, type UndoItem } from "./history";

let repos: Repos;
beforeEach(async () => {
  const db = createNodeSqliteDb();
  await runMigrations(db);
  repos = createRepos(db);
});

const ctx = { taskTitle: () => undefined };

describe("describeStep", () => {
  it("names the field and the values for a single edit, in both directions", async () => {
    const t = await repos.tasks.create({ title: "导出优化", status: "待处理" });
    const before = await repos.snapshots.capture({ tasks: [t] });
    await repos.tasks.update(t, { status: "开发中" });
    const after = await repos.snapshots.capture({ tasks: [t] });
    const step = describeStep(before, after, ctx)!;
    expect(step.label).toBe("修改任务「导出优化」（状态 待处理 → 开发中）");
    expect(step.undoMessage).toBe("已撤销：修改任务「导出优化」（状态 开发中 → 待处理）");
    expect(step.redoMessage).toBe("已重做：修改任务「导出优化」（状态 待处理 → 开发中）");
  });

  it("describes a time entry move with the task title and the changed fields only", async () => {
    const t = await repos.tasks.create({ title: "月度核对" });
    const e = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00", end: "10:00" });
    const before = await repos.snapshots.capture({ entries: [e] });
    await repos.entries.update(e, { date: "2026-09-17", start: "14:00", end: "15:00" });
    const after = await repos.snapshots.capture({ entries: [e] });
    const step = describeStep(before, after, { taskTitle: (id) => (id === t ? "月度核对" : undefined) })!;
    expect(step.undoMessage).toBe("已撤销：修改时间记录「月度核对」2026-09-17 14:00–15:00（日期 2026-09-17 → 2026-09-16；开始 14:00 → 09:00；结束 15:00 → 10:00）");
  });

  it("summarizes creations, deletions and bulk edits", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await repos.tasks.create({ title: `T${i}`, system: "旧系统" }));
    const before = await repos.snapshots.capture({ tasks: ids });
    await repos.tasks.bulkSetOption(ids, "system", "新系统");
    const after = await repos.snapshots.capture({ tasks: ids });
    const bulk = describeStep(before, after, ctx)!;
    expect(bulk.label).toBe("修改 3 个任务的系统 → 新系统");
    expect(bulk.undoMessage).toBe("已撤销：修改 3 个任务的系统（已恢复各自原来的值）");

    const b2 = emptySnapshot();
    const created = await repos.tasks.create({ title: "新任务" });
    b2.missingTasks.push(created);
    const a2 = await repos.snapshots.capture({ tasks: [created] });
    expect(describeStep(b2, a2, ctx)!.undoMessage).toBe("已撤销：新建任务「新任务」");

    const t = await repos.tasks.create({ title: "要删的" });
    const e = await repos.entries.create({ taskId: t, date: "2026-09-16", start: "09:00", end: "10:00" });
    const b3 = await repos.snapshots.capture({ entries: [e] });
    await repos.entries.remove(e);
    const a3 = await repos.snapshots.capture({ entries: [e] });
    expect(describeStep(b3, a3, { taskTitle: () => "要删的" })!.undoMessage).toBe("已撤销：删除时间记录「要删的」2026-09-16 09:00–10:00");
  });

  it("describes dictionary renames and returns null when nothing really changed", async () => {
    await repos.tasks.create({ title: "A", system: "旧名" });
    const opt = (await repos.options.listWithUsage("system")).find((o) => o.value === "旧名")!;
    const before = await repos.snapshots.capture({ options: [opt.id] });
    await repos.options.rename(opt.id, "新名");
    const after = await repos.snapshots.capture({ options: [opt.id] });
    expect(describeStep(before, after, ctx)!.undoMessage).toBe("已撤销：修改字典项「系统」的「旧名」（名称 新名 → 旧名）");
    expect(describeStep(before, before, ctx)).toBeNull();
  });
});

describe("UndoHistory", () => {
  const item = (label: string, rows = 1): UndoItem => {
    const snap = emptySnapshot();
    snap.missingEntries = Array.from({ length: rows }, (_, i) => `${label}-${i}`);
    return { label, undoMessage: `撤销${label}`, redoMessage: `重做${label}`, before: snap, after: emptySnapshot() };
  };

  it("undoes and redoes in order, and a new step clears redo", () => {
    const h = new UndoHistory();
    h.push(item("a"));
    h.push(item("b"));
    expect(h.info()).toMatchObject({ undoCount: 2, redoCount: 0, undoLabel: "b" });
    h.commitUndo();
    expect(h.info()).toMatchObject({ undoCount: 1, redoCount: 1, undoLabel: "a", redoLabel: "b" });
    h.commitRedo();
    h.commitUndo();
    h.push(item("c"));
    expect(h.info()).toMatchObject({ undoCount: 2, redoCount: 0, undoLabel: "c" });
  });

  it("drops the oldest steps beyond the step limit", () => {
    const h = new UndoHistory(3, 1000);
    for (const l of ["a", "b", "c", "d", "e"]) h.push(item(l));
    expect(h.info().undoCount).toBe(3);
    h.commitUndo();
    h.commitUndo();
    h.commitUndo();
    expect(h.peekUndo()).toBeUndefined();
    expect(h.peekRedo()!.label).toBe("c"); // a、b 已被挤掉
  });

  it("drops the oldest steps when the row budget is exceeded but always keeps the newest", () => {
    const h = new UndoHistory(100, 50);
    h.push(item("a", 20));
    h.push(item("b", 20));
    expect(h.info().undoCount).toBe(2);
    h.push(item("c", 20));
    expect(h.info()).toMatchObject({ undoCount: 2, undoLabel: "c" });
    h.push(item("huge", 500));
    expect(h.info()).toMatchObject({ undoCount: 1, undoLabel: "huge" });
  });
});
