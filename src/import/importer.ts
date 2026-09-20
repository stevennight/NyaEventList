import type { Db } from "../db/types";
import type { Repos } from "../db/repos";
import { durationHours } from "../lib/time";
import type { ParsedWorkbook } from "./excel";

export interface ImportResult {
  tasksAdded: number;
  tasksExisting: number;
  entriesAdded: number;
  entriesExisting: number;
  entriesOrphan: number;
  pinned: number;
  warnings: string[];
}

export type ImportProgress = (stage: string, done: number, total: number) => void;

/** 已经处理完的状态：旧表里非需求任务用的“已处理”，和“已上线/已终止”一样算完成态。 */
const DONE_STATUSES = new Set(["已处理"]);
/** 旧表里对接人写成「钱一（业务）」或直接写「业务」的，需求方类型先归到业务方；其余保持默认，之后在字典管理里再分。 */
const isBusinessName = (name: string) => /[（(]业务[)）]$/.test(name) || name === "业务";

const MAX_PARAMS = 900; // 远低于 SQLite 的绑定参数上限，Tauri/sql.js 都安全

async function insertRows(db: Db, table: string, cols: string[], rows: unknown[][], onChunk?: (done: number) => void): Promise<number> {
  const per = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
  const one = `(${cols.map(() => "?").join(",")})`;
  let affected = 0;
  for (let i = 0; i < rows.length; i += per) {
    const part = rows.slice(i, i + per);
    const r = await db.execute(`INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES ${part.map(() => one).join(",")}`, part.flat());
    affected += r.rowsAffected;
    onChunk?.(Math.min(rows.length, i + per));
  }
  return affected;
}

export const taskIdForCode = (code: string) => `legacy:${code}`;
export const entryIdForRow = (row: number, part?: "b") => `imp:明细:${row}${part ?? ""}`;

/**
 * 把解析好的旧表写进数据库。
 * 重复导入是安全的：任务按旧编号判重（已有的保留应用里的修改，不覆盖），
 * 明细用“来源行号”生成固定 id，重复的行会被忽略。
 */
export async function importParsed(db: Db, repos: Repos, parsed: ParsedWorkbook, sourceName: string, onProgress: ImportProgress = () => {}): Promise<ImportResult> {
  const now = new Date().toISOString();
  const warnings = [...parsed.warnings];

  /* 1. 字典：先放“选项”Sheet 里的（保持原顺序），再补任务和明细里出现过的 */
  onProgress("整理字典", 0, 1);
  const wanted: Record<"system" | "work_category" | "work_type" | "status", Set<string>> = {
    system: new Set(parsed.options.system),
    work_category: new Set(parsed.options.work_category),
    work_type: new Set(parsed.options.work_type),
    status: new Set(parsed.options.status),
  };
  for (const t of parsed.tasks) {
    if (t.system) wanted.system.add(t.system);
    if (t.category) wanted.work_category.add(t.category);
    if (t.status) wanted.status.add(t.status);
  }
  for (const e of parsed.entries) if (e.workType) wanted.work_type.add(e.workType);
  const optionId = new Map<string, string>();
  for (const [listKey, values] of Object.entries(wanted)) {
    for (const v of values) {
      const id = await repos.options.ensure(listKey, v);
      optionId.set(`${listKey}:${v}`, id);
      if (listKey === "status" && DONE_STATUSES.has(v)) await db.execute(`UPDATE options SET is_done = 1 WHERE id = ?`, [id]);
    }
  }
  const opt = (list: string, v: string | null) => (v ? (optionId.get(`${list}:${v}`) ?? null) : null);

  /* 2. 需求方 */
  onProgress("整理需求方", 0, 1);
  const knownRequesters = new Set((await repos.requesters.list()).map((r) => r.name));
  const requesterId = new Map<string, string>();
  const businessTypeId = await repos.options.ensure("requester_type", "业务方");
  for (const name of new Set(parsed.tasks.flatMap((t) => t.requesters))) {
    const id = await repos.requesters.ensure(name);
    requesterId.set(name, id);
    if (!knownRequesters.has(name) && isBusinessName(name)) await db.execute(`UPDATE requesters SET requester_type_option_id = ? WHERE id = ?`, [businessTypeId, id]);
  }

  /* 3. 任务 */
  const existing = new Map((await db.select<{ id: string; legacy_code: string }>(`SELECT id, legacy_code FROM tasks WHERE legacy_code IS NOT NULL`)).map((r) => [String(r.legacy_code), String(r.id)]));
  const fresh = parsed.tasks.filter((t) => !existing.has(t.code));
  const pinned = new Set(parsed.pinnedCodes);
  const taskTotal = fresh.length;
  const tasksAdded = await insertRows(
    db,
    "tasks",
    ["id", "title", "description", "task_kind", "system_option_id", "category_option_id", "status_option_id", "version_no", "branch", "requirement_pool_no", "belongs_month", "estimated_days", "is_pinned", "legacy_code", "created_at", "updated_at"],
    fresh.map((t) => [taskIdForCode(t.code), t.title, t.description, t.kind, opt("system", t.system), opt("work_category", t.category), opt("status", t.status), t.versionNo, t.branch, t.poolNo, t.belongsMonth, t.estimatedDays, pinned.has(t.code) ? 1 : 0, t.code, now, now]),
    (done) => onProgress("导入任务", done, taskTotal),
  );
  await insertRows(
    db,
    "task_requesters",
    ["task_id", "requester_id", "position"],
    fresh.flatMap((t) => t.requesters.map((name, i) => [taskIdForCode(t.code), requesterId.get(name)!, i])),
  );
  for (const t of fresh) existing.set(t.code, taskIdForCode(t.code));
  const knownPins = parsed.pinnedCodes.filter((c) => existing.has(c));
  if (knownPins.length < parsed.pinnedCodes.length) warnings.push(`「月日常性工作项」里有 ${parsed.pinnedCodes.length - knownPins.length} 个编号找不到对应任务，已跳过`);

  /* 4. 明细 */
  const usable = parsed.entries.filter((e) => existing.has(e.code));
  const entriesOrphan = parsed.entries.length - usable.length;
  const entryTotal = usable.length;
  const entriesAdded = await insertRows(
    db,
    "time_entries",
    ["id", "task_id", "entry_date", "start_time", "end_time", "duration_hours", "is_time_based", "work_type_option_id", "content", "created_at", "updated_at"],
    usable.map((e) => [entryIdForRow(e.row, e.part), existing.get(e.code)!, e.date, e.start, e.end, durationHours(e.start, e.end), 1, opt("work_type", e.workType), e.content, now, now]),
    (done) => onProgress("导入时间记录", done, entryTotal),
  );

  await db.execute(`INSERT INTO import_batches (id, source_file, imported_at, sheet_mapping_json) VALUES (?, ?, ?, ?)`, [
    `batch:${now}`,
    sourceName,
    now,
    JSON.stringify({ sheets: parsed.sheetRows, tasksAdded, entriesAdded }),
  ]);

  return {
    tasksAdded,
    tasksExisting: parsed.tasks.length - fresh.length,
    entriesAdded,
    entriesExisting: usable.length - entriesAdded,
    entriesOrphan,
    pinned: fresh.filter((t) => pinned.has(t.code)).length,
    warnings,
  };
}
