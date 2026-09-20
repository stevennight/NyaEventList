import type { Db } from "./types";

/**
 * 快照式撤销的数据层：改之前、改之后各取一份“受影响的行”的完整快照；
 * 撤销 = 把库里这些行恢复成修改前的样子，重做 = 恢复成修改后的样子。
 * 库里的引用都是按 id 存的（任务指向字典项 id、需求方 id），所以字典改名不会让旧快照失效。
 */

type Row = Record<string, unknown>;

export interface OptionRow {
  id: string;
  list_id: string;
  value: string;
  label: string;
  sort_order: number;
  color: string | null;
  is_done: number;
}
export interface RequesterRow {
  id: string;
  name: string;
  requester_type_option_id: string | null;
  note: string | null;
}
export interface TagRow {
  id: string;
  name: string;
  color: string | null;
}
export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  task_kind: string;
  system_option_id: string | null;
  category_option_id: string | null;
  status_option_id: string | null;
  version_no: string | null;
  branch: string | null;
  requirement_pool_no: string | null;
  belongs_month: string | null;
  estimated_days: number | null;
  planned_start: string | null;
  target_date: string | null;
  is_pinned: number;
  legacy_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface EntryRow {
  id: string;
  task_id: string;
  entry_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_hours: number;
  is_time_based: number;
  work_type_option_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}
export interface TaskSnap {
  row: TaskRow;
  /** 需求方 id，按原来的顺序 */
  requesters: string[];
  tags: string[];
}

export interface Snapshot {
  tasks: TaskSnap[];
  missingTasks: string[];
  entries: EntryRow[];
  missingEntries: string[];
  /** 明确要还原的字典项/需求方（改名、改类型、删除、新增）——还原成这里记的样子 */
  options: OptionRow[];
  missingOptions: string[];
  requesters: RequesterRow[];
  missingRequesters: string[];
  /** 上面这些行引用到的字典项/需求方/标签：还原时如果已经不在了就补建，在的话不动它 */
  support: { options: OptionRow[]; requesters: RequesterRow[]; tags: TagRow[] };
}

export interface CaptureIds {
  tasks?: string[];
  entries?: string[];
  options?: string[];
  requesters?: string[];
}

export const emptySnapshot = (): Snapshot => ({
  tasks: [],
  missingTasks: [],
  entries: [],
  missingEntries: [],
  options: [],
  missingOptions: [],
  requesters: [],
  missingRequesters: [],
  support: { options: [], requesters: [], tags: [] },
});

const MAX_PARAMS = 800;
const chunk = <T>(list: T[], size = MAX_PARAMS): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
const uniq = <T>(list: Iterable<T | null | undefined>): T[] => [...new Set([...list].filter((x): x is T => x != null))];

const TASK_COLS = ["id", "title", "description", "task_kind", "system_option_id", "category_option_id", "status_option_id", "version_no", "branch", "requirement_pool_no", "belongs_month", "estimated_days", "planned_start", "target_date", "is_pinned", "legacy_code", "created_at", "updated_at"] as const;
const ENTRY_COLS = ["id", "task_id", "entry_date", "start_time", "end_time", "duration_hours", "is_time_based", "work_type_option_id", "content", "created_at", "updated_at"] as const;
const OPTION_COLS = ["id", "list_id", "value", "label", "sort_order", "color", "is_done"] as const;
const REQUESTER_COLS = ["id", "name", "requester_type_option_id", "note"] as const;

export function createSnapshots(db: Db) {
  const selectByIds = async <T>(table: string, ids: string[], idCol = "id", extra = ""): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunk(ids)) out.push(...(await db.select<Row>(`SELECT * FROM ${table} WHERE ${idCol} IN (${marks(part.length)})${extra}`, part)) as T[]);
    return out;
  };

  const insertRows = async (verb: "INSERT OR REPLACE" | "INSERT OR IGNORE", table: string, cols: readonly string[], rows: unknown[][]) => {
    const per = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
    for (const part of chunk(rows, per)) {
      await db.execute(`${verb} INTO ${table} (${cols.join(",")}) VALUES ${part.map(() => `(${marks(cols.length)})`).join(",")}`, part.flat());
    }
  };

  /** 取受影响的这些行的当前状态；不存在的记进 missing（“这一刻它们不存在”也是一种状态）。 */
  async function capture(ids: CaptureIds): Promise<Snapshot> {
    const snap = emptySnapshot();
    const taskIds = uniq(ids.tasks ?? []);
    const entryIds = uniq(ids.entries ?? []);
    const optionIds = uniq(ids.options ?? []);
    const requesterIds = uniq(ids.requesters ?? []);

    const taskRows = await selectByIds<TaskRow>("tasks", taskIds);
    const linkReq = new Map<string, string[]>();
    const linkTag = new Map<string, string[]>();
    for (const r of await selectByIds<Row>("task_requesters", taskIds, "task_id", " ORDER BY position")) {
      const list = linkReq.get(String(r.task_id)) ?? [];
      list.push(String(r.requester_id));
      linkReq.set(String(r.task_id), list);
    }
    for (const r of await selectByIds<Row>("task_tags", taskIds, "task_id")) {
      const list = linkTag.get(String(r.task_id)) ?? [];
      list.push(String(r.tag_id));
      linkTag.set(String(r.task_id), list);
    }
    snap.tasks = taskRows.map((row) => ({ row, requesters: linkReq.get(row.id) ?? [], tags: linkTag.get(row.id) ?? [] }));
    const foundTasks = new Set(taskRows.map((t) => t.id));
    snap.missingTasks = taskIds.filter((id) => !foundTasks.has(id));

    snap.entries = await selectByIds<EntryRow>("time_entries", entryIds);
    const foundEntries = new Set(snap.entries.map((e) => e.id));
    snap.missingEntries = entryIds.filter((id) => !foundEntries.has(id));

    snap.options = await selectByIds<OptionRow>("options", optionIds);
    const foundOptions = new Set(snap.options.map((o) => o.id));
    snap.missingOptions = optionIds.filter((id) => !foundOptions.has(id));
    snap.requesters = await selectByIds<RequesterRow>("requesters", requesterIds);
    const foundReq = new Set(snap.requesters.map((r) => r.id));
    snap.missingRequesters = requesterIds.filter((id) => !foundReq.has(id));

    // 这些行引用到的东西，一并记下来，将来还原时缺了能补建
    const refOptionIds = uniq([...snap.tasks.flatMap((t) => [t.row.system_option_id, t.row.category_option_id, t.row.status_option_id]), ...snap.entries.map((e) => e.work_type_option_id), ...snap.requesters.map((r) => r.requester_type_option_id)]);
    const refRequesterIds = uniq(snap.tasks.flatMap((t) => t.requesters));
    const refTagIds = uniq(snap.tasks.flatMap((t) => t.tags));
    const supportOptions = await selectByIds<OptionRow>("options", refOptionIds.filter((id) => !foundOptions.has(id)));
    const supportRequesters = await selectByIds<RequesterRow>("requesters", refRequesterIds.filter((id) => !foundReq.has(id)));
    const requesterTypeIds = uniq(supportRequesters.map((r) => r.requester_type_option_id)).filter((id) => !foundOptions.has(id) && !supportOptions.some((o) => o.id === id));
    snap.support = {
      options: [...supportOptions, ...(await selectByIds<OptionRow>("options", requesterTypeIds))],
      requesters: supportRequesters,
      tags: await selectByIds<TagRow>("tags", refTagIds),
    };
    return snap;
  }

  /**
   * 把库里这些行恢复成快照里的样子。返回没能还原的原因（比如“已经有同名项”），空数组表示全部还原。
   * 没有事务：每一步都是单条语句，先补齐被引用的行、再写主体、最后删除，中途出错重试也是安全的。
   */
  async function apply(snap: Snapshot): Promise<string[]> {
    const conflicts: string[] = [];

    /* 1. 被引用的字典项/需求方/标签：在就用现成的，不在就补建（id 被占了或同名已被重建，就映射到现有那个） */
    const optionMap = new Map<string, string>();
    for (const o of [...snap.support.options, ...snap.options]) {
      const byId = await db.select<Row>("SELECT id FROM options WHERE id = ?", [o.id]);
      if (byId[0]) continue;
      const byValue = await db.select<Row>("SELECT id FROM options WHERE list_id = ? AND value = ?", [o.list_id, o.value]);
      if (byValue[0]) optionMap.set(o.id, String(byValue[0].id));
      else await insertRows("INSERT OR IGNORE", "options", OPTION_COLS, [OPTION_COLS.map((c) => o[c])]);
    }
    const requesterMap = new Map<string, string>();
    for (const r of [...snap.support.requesters, ...snap.requesters]) {
      const byId = await db.select<Row>("SELECT id FROM requesters WHERE id = ?", [r.id]);
      if (byId[0]) continue;
      const byName = await db.select<Row>("SELECT id FROM requesters WHERE name = ?", [r.name]);
      if (byName[0]) requesterMap.set(r.id, String(byName[0].id));
      else await insertRows("INSERT OR IGNORE", "requesters", REQUESTER_COLS, [[r.id, r.name, optionMap.get(r.requester_type_option_id ?? "") ?? r.requester_type_option_id, r.note]]);
    }
    const tagMap = new Map<string, string>();
    for (const t of snap.support.tags) {
      const byId = await db.select<Row>("SELECT id FROM tags WHERE id = ?", [t.id]);
      if (byId[0]) continue;
      const byName = await db.select<Row>("SELECT id FROM tags WHERE name = ?", [t.name]);
      if (byName[0]) tagMap.set(t.id, String(byName[0].id));
      else await insertRows("INSERT OR IGNORE", "tags", ["id", "name", "color"], [[t.id, t.name, t.color]]);
    }
    const oid = (id: string | null) => (id == null ? null : (optionMap.get(id) ?? id));
    const rid = (id: string) => requesterMap.get(id) ?? id;
    const tid = (id: string) => tagMap.get(id) ?? id;

    /* 2. 明确要还原的字典项/需求方：还原成记下的样子；会和别的同名项撞车的不硬来 */
    for (const o of snap.options) {
      const clash = await db.select<Row>("SELECT id FROM options WHERE list_id = ? AND value = ? AND id <> ?", [o.list_id, o.value, o.id]);
      if (clash[0]) conflicts.push(`已经有同名的字典项「${o.value}」，没法还原`);
      else await insertRows("INSERT OR REPLACE", "options", OPTION_COLS, [OPTION_COLS.map((c) => (c === "id" ? o.id : o[c]))]);
    }
    for (const r of snap.requesters) {
      const clash = await db.select<Row>("SELECT id FROM requesters WHERE name = ? AND id <> ?", [r.name, r.id]);
      if (clash[0]) conflicts.push(`已经有同名的需求方「${r.name}」，没法还原`);
      else await insertRows("INSERT OR REPLACE", "requesters", REQUESTER_COLS, [[r.id, r.name, oid(r.requester_type_option_id), r.note]]);
    }

    /* 3. 任务和它的需求方/标签关联 */
    await insertRows(
      "INSERT OR REPLACE",
      "tasks",
      TASK_COLS,
      snap.tasks.map((t) => TASK_COLS.map((c) => (c === "system_option_id" || c === "category_option_id" || c === "status_option_id" ? oid(t.row[c]) : t.row[c]))),
    );
    const ids = snap.tasks.map((t) => t.row.id);
    for (const part of chunk(ids)) {
      await db.execute(`DELETE FROM task_requesters WHERE task_id IN (${marks(part.length)})`, part);
      await db.execute(`DELETE FROM task_tags WHERE task_id IN (${marks(part.length)})`, part);
    }
    await insertRows("INSERT OR IGNORE", "task_requesters", ["task_id", "requester_id", "position"], snap.tasks.flatMap((t) => t.requesters.map((r, i) => [t.row.id, rid(r), i])));
    await insertRows("INSERT OR IGNORE", "task_tags", ["task_id", "tag_id"], snap.tasks.flatMap((t) => t.tags.map((g) => [t.row.id, tid(g)])));

    /* 4. 时间记录 */
    await insertRows(
      "INSERT OR REPLACE",
      "time_entries",
      ENTRY_COLS,
      snap.entries.map((e) => ENTRY_COLS.map((c) => (c === "work_type_option_id" ? oid(e.work_type_option_id) : e[c]))),
    );

    /* 5. “此刻不存在”的：先删记录，再删任务（任务下还有记录就不删），最后删字典项/需求方（还有引用就不删） */
    for (const part of chunk(snap.missingEntries)) await db.execute(`DELETE FROM time_entries WHERE id IN (${marks(part.length)})`, part);
    for (const id of snap.missingTasks) {
      const has = await db.select<Row>("SELECT 1 AS x FROM time_entries WHERE task_id = ? LIMIT 1", [id]);
      if (has[0]) {
        conflicts.push("这个任务下已经有时间记录，没法撤销它的新建");
        continue;
      }
      await db.execute("DELETE FROM task_requesters WHERE task_id = ?", [id]);
      await db.execute("DELETE FROM task_tags WHERE task_id = ?", [id]);
      await db.execute("DELETE FROM tasks WHERE id = ?", [id]);
    }
    for (const id of snap.missingOptions) {
      const r = await db.execute(
        `DELETE FROM options WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM tasks WHERE system_option_id = options.id OR category_option_id = options.id OR status_option_id = options.id)
           AND NOT EXISTS (SELECT 1 FROM time_entries WHERE work_type_option_id = options.id)
           AND NOT EXISTS (SELECT 1 FROM requesters WHERE requester_type_option_id = options.id)`,
        [id],
      );
      if (r.rowsAffected === 0) conflicts.push("有记录正在使用这个字典项，没法撤销它的新增");
    }
    for (const id of snap.missingRequesters) {
      const r = await db.execute("DELETE FROM requesters WHERE id = ? AND NOT EXISTS (SELECT 1 FROM task_requesters WHERE requester_id = requesters.id)", [id]);
      if (r.rowsAffected === 0) conflicts.push("有任务正在使用这个需求方，没法撤销它的新增");
    }
    return conflicts;
  }

  return { capture, apply };
}

export type Snapshots = ReturnType<typeof createSnapshots>;
