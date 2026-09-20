import type { Db } from "./types";

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

/** 默认字典：key → [label, 是否完成态][]。已交付不算完成态（见设计文档 5.1）。 */
const DEFAULT_LISTS: { key: string; label: string; values: { value: string; isDone?: boolean }[] }[] = [
  { key: "system", label: "系统", values: [] },
  { key: "work_category", label: "例行工作内容划分", values: [{ value: "执行类" }, { value: "辅助类" }] },
  {
    key: "status",
    label: "状态",
    values: [
      { value: "待处理" },
      { value: "开发中" },
      { value: "待产品交付" },
      { value: "搁置中" },
      { value: "已交付" },
      { value: "已上线", isDone: true },
      { value: "已终止", isDone: true },
    ],
  },
  {
    key: "work_type",
    label: "工作内容划分",
    values: ["需求对接", "功能架构设计", "功能开发", "功能自测", "功能联调", "功能上线", "系统架构设计", "其他"].map((value) => ({ value })),
  },
  { key: "requester_type", label: "需求方类型", values: ["业务方", "内部协作", "外部机构", "其他"].map((value) => ({ value })) },
];

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function seedStatements(): string[] {
  const out: string[] = [];
  for (const list of DEFAULT_LISTS) {
    out.push(`INSERT OR IGNORE INTO option_lists (id, key, label, editable) VALUES (${sqlStr("list:" + list.key)}, ${sqlStr(list.key)}, ${sqlStr(list.label)}, 1)`);
    list.values.forEach((v, i) => {
      out.push(
        `INSERT OR IGNORE INTO options (id, list_id, value, label, sort_order, is_done) VALUES (${sqlStr(`${list.key}:${v.value}`)}, ${sqlStr("list:" + list.key)}, ${sqlStr(v.value)}, ${sqlStr(v.value)}, ${i}, ${v.isDone ? 1 : 0})`,
      );
    });
  }
  return out;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "core schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS option_lists (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        editable INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS options (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES option_lists(id),
        value TEXT NOT NULL,
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        is_done INTEGER NOT NULL DEFAULT 0,
        UNIQUE (list_id, value)
      )`,
      `CREATE TABLE IF NOT EXISTS requesters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        requester_type_option_id TEXT REFERENCES options(id),
        note TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        task_kind TEXT NOT NULL DEFAULT 'requirement',
        system_option_id TEXT REFERENCES options(id),
        category_option_id TEXT REFERENCES options(id),
        status_option_id TEXT REFERENCES options(id),
        version_no TEXT,
        branch TEXT,
        requirement_pool_no TEXT,
        belongs_month TEXT,
        estimated_days REAL,
        planned_start TEXT,
        target_date TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        legacy_code TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS task_requesters (
        task_id TEXT NOT NULL REFERENCES tasks(id),
        requester_id TEXT NOT NULL REFERENCES requesters(id),
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (task_id, requester_id)
      )`,
      `CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL REFERENCES tasks(id),
        tag_id TEXT NOT NULL REFERENCES tags(id),
        PRIMARY KEY (task_id, tag_id)
      )`,
      `CREATE TABLE IF NOT EXISTS requester_tags (
        requester_id TEXT NOT NULL REFERENCES requesters(id),
        tag_id TEXT NOT NULL REFERENCES tags(id),
        PRIMARY KEY (requester_id, tag_id)
      )`,
      `CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        entry_date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        duration_hours REAL NOT NULL,
        is_time_based INTEGER NOT NULL DEFAULT 1,
        work_type_option_id TEXT REFERENCES options(id),
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        source_file TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        sheet_mapping_json TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS import_row_refs (
        batch_id TEXT NOT NULL REFERENCES import_batches(id),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        source_sheet TEXT NOT NULL,
        source_row INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(entry_date, start_time)`,
      `CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status_option_id)`,
      `CREATE INDEX IF NOT EXISTS idx_task_requesters_req ON task_requesters(requester_id)`,
      ...seedStatements(),
    ],
  },
];

export async function getUserVersion(db: Db): Promise<number> {
  const rows = await db.select<{ user_version: number }>("PRAGMA user_version");
  return Number(rows[0]?.user_version ?? 0);
}

/** 按 `PRAGMA user_version` 依次执行未执行过的迁移；每条语句都是幂等的，中途失败可以直接重试。 */
export async function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): Promise<number> {
  let current = await getUserVersion(db);
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    for (const stmt of m.statements) await db.execute(stmt);
    await db.execute(`PRAGMA user_version = ${m.version}`);
    current = m.version;
  }
  return current;
}
