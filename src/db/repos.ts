import { durationHours } from "../lib/time";
import { createSnapshots } from "./snapshots";
import type { Db } from "./types";
import type { EntryInput, EntryPatch, OptionItem, OptionUsage, Requester, RequesterUsage, Task, TaskInput, TaskPatch, TimeEntry } from "./models";

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const SEP = "";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));

export class EntryValidationError extends Error {}

export type BulkOptionField = "system" | "status" | "category";
const BULK_OPTION_FIELDS: Record<BulkOptionField, { column: string; listKey: string }> = {
  system: { column: "system_option_id", listKey: "system" },
  status: { column: "status_option_id", listKey: "status" },
  category: { column: "category_option_id", listKey: "work_category" },
};
/** 各个字典“被谁引用”的统计口径 */
const USAGE_SQL: Record<string, string> = {
  system: "(SELECT COUNT(*) FROM tasks WHERE system_option_id = o.id)",
  work_category: "(SELECT COUNT(*) FROM tasks WHERE category_option_id = o.id)",
  status: "(SELECT COUNT(*) FROM tasks WHERE status_option_id = o.id)",
  work_type: "(SELECT COUNT(*) FROM time_entries WHERE work_type_option_id = o.id)",
  requester_type: "(SELECT COUNT(*) FROM requesters WHERE requester_type_option_id = o.id)",
};

export class DictionaryError extends Error {}

export type RequesterBulkMode = { mode: "add" } | { mode: "replace" } | { mode: "swap"; from: string };

/** 分批，每批的绑定参数不超过 900 个（Tauri/sql.js 都安全） */
const chunk = <T>(list: T[], size = 800): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const marks = (list: unknown[]) => list.map(() => "?").join(",");

/** 结束必须晚于开始；一条记录不跨越午夜（跨天请拆成两条，见设计文档 5.6）。 */
export function assertValidRange(start: string, end: string | null | undefined): void {
  if (end && durationHours(start, end) <= 0) {
    throw new EntryValidationError("结束时间要晚于开始时间；跨天的工作请拆成两条记录（今天到 24:00，次日从 00:00 开始）。");
  }
}

export function createRepos(db: Db) {
  /* ---------------- options ---------------- */
  const options = {
    async list(listKey: string): Promise<OptionItem[]> {
      const rows = await db.select<Row>(
        `SELECT o.id, l.key AS list_key, o.value, o.label, o.sort_order, o.is_done
           FROM options o JOIN option_lists l ON l.id = o.list_id
          WHERE l.key = ? ORDER BY o.sort_order, o.label`,
        [listKey],
      );
      return rows.map((r) => ({
        id: String(r.id),
        listKey: String(r.list_key),
        value: String(r.value),
        label: String(r.label),
        sortOrder: num(r.sort_order),
        isDone: num(r.is_done) === 1,
      }));
    },
    /** 取某个字典里 value 对应的 id；不存在就新建（“选择或新建”的写入路径）。 */
    async ensure(listKey: string, value: string): Promise<string> {
      const label = value.trim();
      const found = await db.select<Row>(
        `SELECT o.id FROM options o JOIN option_lists l ON l.id = o.list_id WHERE l.key = ? AND o.value = ?`,
        [listKey, label],
      );
      if (found[0]) return String(found[0].id);
      const id = uid();
      await db.execute(
        `INSERT OR IGNORE INTO options (id, list_id, value, label, sort_order, is_done)
         SELECT ?, l.id, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM options WHERE list_id = l.id), 0), 0
           FROM option_lists l WHERE l.key = ?`,
        [id, label, label, listKey],
      );
      const again = await db.select<Row>(
        `SELECT o.id FROM options o JOIN option_lists l ON l.id = o.list_id WHERE l.key = ? AND o.value = ?`,
        [listKey, label],
      );
      if (!again[0]) throw new Error(`字典 ${listKey} 不存在`);
      return String(again[0].id);
    },
    async ensureOrNull(listKey: string, value: string | null | undefined): Promise<string | null> {
      const v = value?.trim();
      return v ? options.ensure(listKey, v) : null;
    },
    /** 字典管理页用：连同引用数一起列出来 */
    async listWithUsage(listKey: string): Promise<OptionUsage[]> {
      const usage = USAGE_SQL[listKey] ?? "0";
      const rows = await db.select<Row>(
        `SELECT o.id, l.key AS list_key, o.value, o.label, o.sort_order, o.is_done, ${usage} AS usage
           FROM options o JOIN option_lists l ON l.id = o.list_id
          WHERE l.key = ? ORDER BY o.sort_order, o.label`,
        [listKey],
      );
      return rows.map((r) => ({ id: String(r.id), listKey: String(r.list_key), value: String(r.value), label: String(r.label), sortOrder: num(r.sort_order), isDone: num(r.is_done) === 1, usage: num(r.usage) }));
    },
    /** 重命名：所有引用它的记录自动跟着变（引用的是 id）。已有同名项时拒绝，合并请用任务面板的筛选 + 批量修改。 */
    async rename(id: string, name: string): Promise<void> {
      const value = name.trim();
      if (!value) throw new DictionaryError("名称不能为空");
      const clash = await db.select<Row>(
        `SELECT o.id FROM options o WHERE o.list_id = (SELECT list_id FROM options WHERE id = ?) AND o.value = ? AND o.id <> ?`,
        [id, value, id],
      );
      if (clash[0]) throw new DictionaryError(`已经有叫「${value}」的选项了。要合并的话，先在任务面板里筛出旧的那批任务，批量改成这个。`);
      await db.execute(`UPDATE options SET value = ?, label = ? WHERE id = ?`, [value, value, id]);
    },
    /** 只删没有任何引用的；返回是否真的删掉了 */
    async removeIfUnused(id: string): Promise<boolean> {
      const r = await db.execute(
        `DELETE FROM options WHERE id = ?
            AND NOT EXISTS (SELECT 1 FROM tasks WHERE system_option_id = options.id OR category_option_id = options.id OR status_option_id = options.id)
            AND NOT EXISTS (SELECT 1 FROM time_entries WHERE work_type_option_id = options.id)
            AND NOT EXISTS (SELECT 1 FROM requesters WHERE requester_type_option_id = options.id)`,
        [id],
      );
      return r.rowsAffected > 0;
    },
    /** 状态字典的“是否完成态”：只有已上线/已终止这类才算，已交付不算（设计文档 5.1） */
    async setDone(id: string, done: boolean): Promise<void> {
      await db.execute(`UPDATE options SET is_done = ? WHERE id = ?`, [done ? 1 : 0, id]);
    },
  };

  /* ---------------- requesters ---------------- */
  const requesters = {
    async list(): Promise<Requester[]> {
      const rows = await db.select<Row>(
        `SELECT r.id, r.name, r.note, o.label AS type_label
           FROM requesters r LEFT JOIN options o ON o.id = r.requester_type_option_id
          ORDER BY r.name`,
      );
      return rows.map((r) => ({ id: String(r.id), name: String(r.name), type: str(r.type_label), note: str(r.note) }));
    },
    async listWithUsage(): Promise<RequesterUsage[]> {
      const rows = await db.select<Row>(
        `SELECT r.id, r.name, r.note, o.label AS type_label, (SELECT COUNT(*) FROM task_requesters WHERE requester_id = r.id) AS usage
           FROM requesters r LEFT JOIN options o ON o.id = r.requester_type_option_id
          ORDER BY r.name`,
      );
      return rows.map((r) => ({ id: String(r.id), name: String(r.name), type: str(r.type_label), note: str(r.note), usage: num(r.usage) }));
    },
    async rename(id: string, name: string): Promise<void> {
      const n = name.trim();
      if (!n) throw new DictionaryError("名称不能为空");
      const clash = await db.select<Row>(`SELECT id FROM requesters WHERE name = ? AND id <> ?`, [n, id]);
      if (clash[0]) throw new DictionaryError(`已经有叫「${n}」的需求方了。要合并的话，先在任务面板里筛出这个人的任务，用“换掉其中一个”批量替换。`);
      await db.execute(`UPDATE requesters SET name = ? WHERE id = ?`, [n, id]);
    },
    async setType(id: string, typeValue: string | null): Promise<void> {
      await db.execute(`UPDATE requesters SET requester_type_option_id = ? WHERE id = ?`, [await options.ensureOrNull("requester_type", typeValue), id]);
    },
    async removeIfUnused(id: string): Promise<boolean> {
      const r = await db.execute(`DELETE FROM requesters WHERE id = ? AND NOT EXISTS (SELECT 1 FROM task_requesters WHERE requester_id = requesters.id)`, [id]);
      if (r.rowsAffected > 0) await db.execute(`DELETE FROM requester_tags WHERE requester_id = ?`, [id]);
      return r.rowsAffected > 0;
    },
    /** 同名的复用，没有就新建；类型先落“其他”，回头在字典管理里再补（设计文档 5.5）。 */
    async ensure(name: string): Promise<string> {
      const n = name.trim();
      const found = await db.select<Row>(`SELECT id FROM requesters WHERE name = ?`, [n]);
      if (found[0]) return String(found[0].id);
      const typeId = await options.ensure("requester_type", "其他");
      const id = uid();
      await db.execute(`INSERT OR IGNORE INTO requesters (id, name, requester_type_option_id) VALUES (?, ?, ?)`, [id, n, typeId]);
      const again = await db.select<Row>(`SELECT id FROM requesters WHERE name = ?`, [n]);
      return String(again[0].id);
    },
  };

  /* ---------------- tags ---------------- */
  async function ensureTag(name: string): Promise<string> {
    const n = name.trim();
    const found = await db.select<Row>(`SELECT id FROM tags WHERE name = ?`, [n]);
    if (found[0]) return String(found[0].id);
    const id = uid();
    await db.execute(`INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)`, [id, n]);
    const again = await db.select<Row>(`SELECT id FROM tags WHERE name = ?`, [n]);
    return String(again[0].id);
  }

  /* ---------------- tasks ---------------- */
  const TASK_SELECT = `
    SELECT t.id, t.legacy_code, t.title, t.description, t.task_kind, t.estimated_days, t.planned_start, t.target_date, t.is_pinned,
           so.label AS system, co.label AS category, st.label AS status, COALESCE(st.is_done, 0) AS status_done,
           (SELECT GROUP_CONCAT(name, char(31)) FROM
              (SELECT r.name AS name FROM task_requesters tr JOIN requesters r ON r.id = tr.requester_id
                WHERE tr.task_id = t.id ORDER BY tr.position)) AS requesters,
           (SELECT GROUP_CONCAT(name, char(31)) FROM
              (SELECT g.name AS name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
                WHERE tt.task_id = t.id ORDER BY g.name)) AS tags,
           (SELECT COUNT(*) FROM time_entries e WHERE e.task_id = t.id) AS entry_count,
           (SELECT COALESCE(SUM(e.duration_hours), 0) FROM time_entries e WHERE e.task_id = t.id) AS total_hours,
           (SELECT MAX(e.entry_date) FROM time_entries e WHERE e.task_id = t.id) AS last_entry_date
      FROM tasks t
      LEFT JOIN options so ON so.id = t.system_option_id
      LEFT JOIN options co ON co.id = t.category_option_id
      LEFT JOIN options st ON st.id = t.status_option_id`;

  const mapTask = (r: Row): Task => ({
    id: String(r.id),
    code: str(r.legacy_code),
    title: String(r.title),
    description: str(r.description),
    kind: r.task_kind === "routine" ? "routine" : "requirement",
    system: str(r.system),
    category: str(r.category),
    status: str(r.status),
    statusDone: num(r.status_done) === 1,
    requesters: r.requesters ? String(r.requesters).split(SEP) : [],
    tags: r.tags ? String(r.tags).split(SEP) : [],
    estimatedDays: r.estimated_days == null ? null : Number(r.estimated_days),
    plannedStart: str(r.planned_start),
    targetDate: str(r.target_date),
    pinned: num(r.is_pinned) === 1,
    entryCount: num(r.entry_count),
    totalHours: Math.round(num(r.total_hours) * 100) / 100,
    lastEntryDate: str(r.last_entry_date),
  });

  async function replaceRequesters(taskId: string, names: string[]): Promise<void> {
    await db.execute(`DELETE FROM task_requesters WHERE task_id = ?`, [taskId]);
    const seen = new Set<string>();
    let pos = 0;
    for (const raw of names) {
      const name = raw.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const rid = await requesters.ensure(name);
      await db.execute(`INSERT OR IGNORE INTO task_requesters (task_id, requester_id, position) VALUES (?, ?, ?)`, [taskId, rid, pos++]);
    }
  }
  async function replaceTags(taskId: string, names: string[]): Promise<void> {
    await db.execute(`DELETE FROM task_tags WHERE task_id = ?`, [taskId]);
    for (const raw of new Set(names.map((n) => n.trim()).filter(Boolean))) {
      const tid = await ensureTag(raw);
      await db.execute(`INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)`, [taskId, tid]);
    }
  }

  const tasks = {
    /** 不传 ids 就是全部任务；传了就只查这几个（改一条记录后只刷新受影响的任务用） */
    async list(ids?: string[]): Promise<Task[]> {
      if (!ids) return (await db.select<Row>(`${TASK_SELECT} ORDER BY t.title`)).map(mapTask);
      const out: Task[] = [];
      for (const part of chunk([...new Set(ids)])) out.push(...(await db.select<Row>(`${TASK_SELECT} WHERE t.id IN (${marks(part)})`, part)).map(mapTask));
      return out;
    },
    async get(id: string): Promise<Task | null> {
      const rows = await db.select<Row>(`${TASK_SELECT} WHERE t.id = ?`, [id]);
      return rows[0] ? mapTask(rows[0]) : null;
    },
    async create(input: TaskInput): Promise<string> {
      const id = uid();
      const ts = nowIso();
      await db.execute(
        `INSERT INTO tasks (id, title, description, task_kind, system_option_id, category_option_id, status_option_id,
                            estimated_days, planned_start, target_date, is_pinned, legacy_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.title.trim(),
          input.description?.trim() || null,
          input.kind ?? "requirement",
          await options.ensureOrNull("system", input.system),
          await options.ensureOrNull("work_category", input.category),
          await options.ensureOrNull("status", input.status ?? "待处理"),
          input.estimatedDays ?? null,
          input.plannedStart ?? null,
          input.targetDate ?? null,
          input.pinned ? 1 : 0,
          input.code?.trim() || null,
          ts,
          ts,
        ],
      );
      await replaceRequesters(id, input.requesters ?? []);
      await replaceTags(id, input.tags ?? []);
      return id;
    },
    async update(id: string, patch: TaskPatch): Promise<void> {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, v: unknown) => {
        sets.push(`${col} = ?`);
        params.push(v);
      };
      if (patch.title !== undefined) set("title", patch.title.trim());
      if (patch.description !== undefined) set("description", patch.description?.trim() || null);
      if (patch.kind !== undefined) set("task_kind", patch.kind);
      if (patch.code !== undefined) set("legacy_code", patch.code?.trim() || null);
      if (patch.system !== undefined) set("system_option_id", await options.ensureOrNull("system", patch.system));
      if (patch.category !== undefined) set("category_option_id", await options.ensureOrNull("work_category", patch.category));
      if (patch.status !== undefined) set("status_option_id", await options.ensureOrNull("status", patch.status));
      if (patch.estimatedDays !== undefined) set("estimated_days", patch.estimatedDays);
      if (patch.plannedStart !== undefined) set("planned_start", patch.plannedStart);
      if (patch.targetDate !== undefined) set("target_date", patch.targetDate);
      if (patch.pinned !== undefined) set("is_pinned", patch.pinned ? 1 : 0);
      set("updated_at", nowIso());
      await db.execute(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
      if (patch.requesters !== undefined) await replaceRequesters(id, patch.requesters);
      if (patch.tags !== undefined) await replaceTags(id, patch.tags);
    },
    /**
     * 批量改字典类字段（系统 / 状态 / 例行工作内容划分），value 为空表示清空。
     * 只开放这几个字段：标题、内容这类每个任务本来就该不同的字段不允许批量改。
     */
    async bulkSetOption(ids: string[], field: BulkOptionField, value: string | null): Promise<number> {
      const { column, listKey } = BULK_OPTION_FIELDS[field];
      const optionId = await options.ensureOrNull(listKey, value);
      let changed = 0;
      for (const part of chunk(ids)) {
        const r = await db.execute(`UPDATE tasks SET ${column} = ?, updated_at = ? WHERE id IN (${marks(part)})`, [optionId, nowIso(), ...part]);
        changed += r.rowsAffected;
      }
      return changed;
    },
    /**
     * 批量改需求方（多值字段，走关联表）：
     * - add：追加，已有的不动
     * - replace：整体替换成 names
     * - swap：把其中的 from 换成 names[0]，其余需求方不动（合并重复的需求方用这个）
     */
    async bulkRequesters(ids: string[], mode: RequesterBulkMode, names: string[]): Promise<void> {
      const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
      if (mode.mode === "swap") {
        if (!clean[0]) return;
        const from = await requesters.ensure(mode.from);
        const to = await requesters.ensure(clean[0]);
        if (from === to) return;
        for (const part of chunk(ids)) {
          // 已经有目标需求方的任务只删掉旧的，其余直接改名，保留原来的顺序
          await db.execute(
            `UPDATE task_requesters SET requester_id = ?
              WHERE requester_id = ? AND task_id IN (${marks(part)})
                AND NOT EXISTS (SELECT 1 FROM task_requesters x WHERE x.task_id = task_requesters.task_id AND x.requester_id = ?)`,
            [to, from, ...part, to],
          );
          await db.execute(`DELETE FROM task_requesters WHERE requester_id = ? AND task_id IN (${marks(part)})`, [from, ...part]);
          await db.execute(`UPDATE tasks SET updated_at = ? WHERE id IN (${marks(part)})`, [nowIso(), ...part]);
        }
        return;
      }
      if (mode.mode === "replace") {
        for (const part of chunk(ids)) await db.execute(`DELETE FROM task_requesters WHERE task_id IN (${marks(part)})`, part);
      }
      for (const name of clean) {
        const rid = await requesters.ensure(name);
        for (const part of chunk(ids)) {
          await db.execute(
            `INSERT OR IGNORE INTO task_requesters (task_id, requester_id, position)
             SELECT t.id, ?, COALESCE((SELECT MAX(position) + 1 FROM task_requesters WHERE task_id = t.id), 0) FROM tasks t WHERE t.id IN (${marks(part)})`,
            [rid, ...part],
          );
        }
      }
      for (const part of chunk(ids)) await db.execute(`UPDATE tasks SET updated_at = ? WHERE id IN (${marks(part)})`, [nowIso(), ...part]);
    },
    /** 级联删除由这里显式完成（不依赖 SQLite 的外键开关）。 */
    async remove(id: string): Promise<void> {
      await db.execute(`DELETE FROM time_entries WHERE task_id = ?`, [id]);
      await db.execute(`DELETE FROM task_requesters WHERE task_id = ?`, [id]);
      await db.execute(`DELETE FROM task_tags WHERE task_id = ?`, [id]);
      await db.execute(`DELETE FROM tasks WHERE id = ?`, [id]);
    },
  };

  /* ---------------- time entries ---------------- */
  const ENTRY_SELECT = `
    SELECT e.id, e.task_id, t.title AS task_title, t.legacy_code AS task_code, e.entry_date, e.start_time, e.end_time,
           e.duration_hours, e.is_time_based, w.label AS work_type, e.content
      FROM time_entries e
      JOIN tasks t ON t.id = e.task_id
      LEFT JOIN options w ON w.id = e.work_type_option_id`;

  const mapEntry = (r: Row): TimeEntry => ({
    id: String(r.id),
    taskId: String(r.task_id),
    taskTitle: String(r.task_title),
    taskCode: str(r.task_code),
    date: String(r.entry_date),
    start: str(r.start_time),
    end: str(r.end_time),
    durationHours: num(r.duration_hours),
    isTimeBased: num(r.is_time_based) === 1,
    workType: str(r.work_type),
    content: String(r.content ?? ""),
  });

  const entries = {
    /** 闭区间 [from, to]，按日期、开始时间排序 */
    async listBetween(from: string, to: string): Promise<TimeEntry[]> {
      const rows = await db.select<Row>(`${ENTRY_SELECT} WHERE e.entry_date >= ? AND e.entry_date <= ? ORDER BY e.entry_date, e.start_time, e.created_at`, [from, to]);
      return rows.map(mapEntry);
    },
    async get(id: string): Promise<TimeEntry | null> {
      const rows = await db.select<Row>(`${ENTRY_SELECT} WHERE e.id = ?`, [id]);
      return rows[0] ? mapEntry(rows[0]) : null;
    },
    async create(input: EntryInput): Promise<string> {
      const end = input.end || null;
      assertValidRange(input.start, end);
      const id = uid();
      const ts = nowIso();
      await db.execute(
        `INSERT INTO time_entries (id, task_id, entry_date, start_time, end_time, duration_hours, is_time_based, work_type_option_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [id, input.taskId, input.date, input.start, end, end ? durationHours(input.start, end) : 0, await options.ensureOrNull("work_type", input.workType), input.content ?? "", ts, ts],
      );
      return id;
    },
    async update(id: string, patch: EntryPatch): Promise<void> {
      const cur = await entries.get(id);
      if (!cur) throw new Error("时间记录不存在");
      const start = patch.start ?? cur.start;
      const end = patch.end === undefined ? cur.end : patch.end || null;
      if (!start) throw new Error("这条记录没有开始时间");
      assertValidRange(start, end);
      await db.execute(
        `UPDATE time_entries SET task_id = ?, entry_date = ?, start_time = ?, end_time = ?, duration_hours = ?,
                work_type_option_id = ?, content = ?, updated_at = ? WHERE id = ?`,
        [
          patch.taskId ?? cur.taskId,
          patch.date ?? cur.date,
          start,
          end,
          end ? durationHours(start, end) : 0,
          patch.workType !== undefined ? await options.ensureOrNull("work_type", patch.workType) : await options.ensureOrNull("work_type", cur.workType),
          patch.content ?? cur.content,
          nowIso(),
          id,
        ],
      );
    },
    async remove(id: string): Promise<void> {
      await db.execute(`DELETE FROM time_entries WHERE id = ?`, [id]);
    },
    async removeMany(ids: string[]): Promise<number> {
      let n = 0;
      for (const part of chunk(ids)) n += (await db.execute(`DELETE FROM time_entries WHERE id IN (${marks(part)})`, part)).rowsAffected;
      return n;
    },
  };

  /* ---------------- settings ---------------- */
  const settings = {
    async get<T>(key: string, fallback: T): Promise<T> {
      const rows = await db.select<Row>(`SELECT value_json FROM app_settings WHERE key = ?`, [key]);
      if (!rows[0]) return fallback;
      try {
        return JSON.parse(String(rows[0].value_json)) as T;
      } catch {
        return fallback;
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      await db.execute(
        `INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
        [key, JSON.stringify(value)],
      );
    },
  };

  return { options, requesters, tasks, entries, settings, snapshots: createSnapshots(db) };
}

export type Repos = ReturnType<typeof createRepos>;
