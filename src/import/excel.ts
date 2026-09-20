import * as XLSX from "xlsx";
import { stripTypePrefix } from "../lib/content";
import { addDays, fmtDate, parseISODate } from "../lib/time";
import type { TaskKind } from "../db/models";

import { IMPORT_SHEETS } from "./sheets";

export interface ImportTask {
  code: string;
  kind: TaskKind;
  title: string;
  description: string | null;
  system: string | null;
  category: string | null;
  status: string | null;
  requesters: string[];
  versionNo: string | null;
  branch: string | null;
  poolNo: string | null;
  belongsMonth: string | null;
  estimatedDays: number | null;
  sheet: string;
  row: number;
}

export interface ImportEntry {
  /** 明细 Sheet 里的行号（从 1 开始，含表头），用来生成稳定 id、保证重复导入不产生重复记录 */
  row: number;
  /** 跨午夜的记录会拆成两条：第二段（次日 00:00 起）标 "b" */
  part?: "b";
  code: string;
  date: string;
  start: string;
  end: string;
  workType: string | null;
  content: string;
}

export interface ParsedWorkbook {
  tasks: ImportTask[];
  entries: ImportEntry[];
  pinnedCodes: string[];
  /** 「选项」Sheet 里的初始选项，key 与字典 key 对应 */
  options: { system: string[]; work_category: string[]; work_type: string[]; status: string[] };
  warnings: string[];
  sheetRows: Record<string, number>;
}

type Cell = string | number | boolean | null;
type Row = Cell[];

/** Excel 序列号 → YYYY-MM-DD（按序列号的整数部分，不经过时区换算）。 */
export function serialToDate(serial: number): string {
  const p = XLSX.SSF.parse_date_code(Math.floor(serial + 1e-9));
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Excel 序列号的小数部分 → 当天第几分钟（四舍五入到分钟，0–1439）。 */
export function serialToMinutes(serial: number): number {
  return Math.round((serial - Math.floor(serial)) * 1440) % 1440;
}

const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const NONE_WORDS = new Set(["无", "？", "?", "n/a", "#n/a", "-", "—"]);

function text(v: Cell | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
/** 表里用“无”“？”表示没有的，按空处理 */
function textOrNone(v: Cell | undefined): string | null {
  const s = text(v);
  return s && !NONE_WORDS.has(s.toLowerCase()) ? s : null;
}

export function splitRequesters(v: Cell | undefined): string[] {
  const s = text(v);
  if (!s) return [];
  const names = s
    .split(/[/／、，,;；\n]+/)
    .map((x) => x.trim())
    .filter((x) => x && !NONE_WORDS.has(x.toLowerCase()));
  return [...new Set(names)];
}

function headerIndex(header: Row, name: string, sheet: string, required: boolean): number {
  const i = header.findIndex((h) => text(h) === name);
  if (i < 0 && required) throw new Error(`「${sheet}」里找不到「${name}」这一列，表头被改过了？`);
  return i;
}

function sheetRows(wb: XLSX.WorkBook, name: string): Row[] | null {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null });
}

function belongsMonth(v: Cell | undefined): string | null {
  if (typeof v === "number") return serialToDate(v).slice(0, 7);
  return text(v);
}

function parseTasks(rows: Row[], kind: TaskKind, sheet: string, warnings: string[]): ImportTask[] {
  const header = rows[0] ?? [];
  const col = (name: string, required = false) => headerIndex(header, name, sheet, required);
  const iCode = col("编号", true);
  const iTitle = col("标题", true);
  const iSystem = col("系统");
  const iCategory = col("例行工作内容划分");
  const iStatus = col("状态");
  const iBranch = col("分支");
  const isReq = kind === "requirement";
  const iRequester = isReq ? col("产品") : col("对接人");
  const iDesc = isReq ? col("简要内容") : iTitle + 1; // 非需求表的这一列表头被数据顶掉了，位置固定在标题右边
  const iVersion = isReq ? col("版本号") : -1;
  const iMonth = isReq ? col("所属月份") : -1;
  const iDays = isReq ? col("预计人天") : -1;
  const iPool = isReq ? col("需求池编号") : col("Key Project需求池编号");
  const at = (r: Row, i: number) => (i >= 0 ? r[i] : null);

  const out: ImportTask[] = [];
  const seen = new Set<string>();
  rows.forEach((r, idx) => {
    if (idx === 0) return;
    const code = text(r[iCode]);
    const title = text(r[iTitle]);
    if (!code) return;
    if (!title) return; // 只有编号的预留空行
    if (seen.has(code)) {
      warnings.push(`「${sheet}」第 ${idx + 1} 行的编号 ${code} 重复，只保留第一次出现的`);
      return;
    }
    seen.add(code);
    const desc = text(at(r, iDesc));
    const days = at(r, iDays);
    out.push({
      code,
      kind,
      title,
      description: desc && desc !== title ? desc : null,
      system: text(at(r, iSystem)),
      category: textOrNone(at(r, iCategory)),
      status: text(at(r, iStatus)),
      requesters: splitRequesters(at(r, iRequester)),
      versionNo: text(at(r, iVersion)),
      branch: textOrNone(at(r, iBranch)),
      poolNo: text(at(r, iPool)),
      belongsMonth: belongsMonth(at(r, iMonth)),
      estimatedDays: typeof days === "number" ? days : null,
      sheet,
      row: idx + 1,
    });
  });
  return out;
}

function parseEntries(rows: Row[], warnings: string[]): ImportEntry[] {
  const sheet = "明细";
  const header = rows[0] ?? [];
  const col = (name: string) => headerIndex(header, name, sheet, true);
  const iCode = col("编号");
  const iDate = col("日期");
  const iStart = col("开始时间");
  const iEnd = col("结束时间");
  const iType = col("例行工作工作内容");
  const iContent = col("工作内容");
  const iHours = header.findIndex((h) => text(h) === "用时");

  const out: ImportEntry[] = [];
  const skip = (row: number, code: string, why: string) => warnings.push(`「明细」第 ${row} 行（${code}）${why}，已跳过`);
  rows.forEach((r, idx) => {
    if (idx === 0) return;
    const code = text(r[iCode]);
    if (!code) return;
    const row = idx + 1;
    const [d, s, e] = [r[iDate], r[iStart], r[iEnd]];
    if (typeof d !== "number" || typeof s !== "number" || typeof e !== "number") return skip(row, code, "日期或起止时间缺失/不是时间");
    // 日期以“日期”列为准；开始/结束列里的日期部分有时是错的，只取时间部分
    const sm = serialToMinutes(s);
    let em = serialToMinutes(e);
    if (em === 0 && Math.floor(e) > Math.floor(s)) em = 1440; // 结束在次日 0 点，按当天 24:00
    const workType = text(r[iType]);
    const content = stripTypePrefix(text(r[iContent]) ?? "", workType);
    if (em <= sm) {
      // 可能是跨午夜的工作：拿表里自己算的“用时”核对，对得上就按午夜拆成两条
      const hours = iHours >= 0 ? r[iHours] : null;
      const wrap = (1440 - sm + em) / 60;
      if (typeof hours === "number" && Math.abs(wrap - hours) <= 0.03 && em > 0) {
        const date = serialToDate(d);
        out.push({ row, code, date, start: clock(sm), end: "24:00", workType, content });
        out.push({ row, part: "b", code, date: fmtDate(addDays(parseISODate(date), 1)), start: "00:00", end: clock(em), workType, content });
        warnings.push(`「明细」第 ${row} 行（${code}）${clock(sm)}–${clock(em)} 跨了午夜，已拆成两条（当天到 24:00，次日从 00:00 起）`);
        return;
      }
      return skip(row, code, `结束时间（${clock(em % 1440)}）不晚于开始时间（${clock(sm)}）`);
    }
    out.push({
      row,
      code,
      date: serialToDate(d),
      start: clock(sm),
      end: em === 1440 ? "24:00" : clock(em),
      workType,
      content,
    });
  });
  return out;
}

function parseOptions(rows: Row[]): ParsedWorkbook["options"] {
  const header = rows[0] ?? [];
  const list = (name: string) => {
    const i = header.findIndex((h) => text(h) === name);
    if (i < 0) return [];
    return [...new Set(rows.slice(1).map((r) => text(r[i])).filter((v): v is string => !!v))];
  };
  return {
    system: list("系统"),
    work_category: list("例行工作内容划分"),
    work_type: list("例行工作工作内容"),
    // “待安排”在新系统里是按有没有排期算出来的，不是一个状态值
    status: list("任务状态").filter((v) => v !== "待安排"),
  };
}

function parsePinned(rows: Row[]): string[] {
  return [...new Set(rows.map((r) => text(r[0])).filter((v): v is string => !!v && !NONE_WORDS.has(v.toLowerCase())))];
}

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParsedWorkbook {
  const wb = XLSX.read(data, { type: "array", cellDates: false, sheets: [...IMPORT_SHEETS] });
  const warnings: string[] = [];
  const found: Record<string, Row[]> = {};
  const missing: string[] = [];
  for (const name of IMPORT_SHEETS) {
    const rows = sheetRows(wb, name);
    if (rows) found[name] = rows;
    else missing.push(name);
  }
  if (!found["需求列表"] && !found["非需求任务列表"] && !found["明细"]) throw new Error("这不像旧的工作统计表：找不到「需求列表」「非需求任务列表」「明细」中的任何一个 Sheet");
  if (missing.length) warnings.push(`没找到这些 Sheet，已跳过：${missing.join("、")}`);

  const tasks = [...(found["需求列表"] ? parseTasks(found["需求列表"], "requirement", "需求列表", warnings) : []), ...(found["非需求任务列表"] ? parseTasks(found["非需求任务列表"], "routine", "非需求任务列表", warnings) : [])];
  const entries = found["明细"] ? parseEntries(found["明细"], warnings) : [];
  const pinnedCodes = found["月日常性工作项"] ? parsePinned(found["月日常性工作项"]) : [];
  const options = found["选项"] ? parseOptions(found["选项"]) : { system: [], work_category: [], work_type: [], status: [] };

  // 「选项」里给了划分清单的话，明细里不在清单内的写法多半是列错位的脏数据，留空而不是污染字典
  if (options.work_type.length) {
    const allowed = new Set(options.work_type);
    const bad = entries.filter((e) => e.workType && !allowed.has(e.workType));
    for (const e of bad) {
      warnings.push(`「明细」第 ${e.row} 行（${e.code}）的工作内容划分「${e.workType!.slice(0, 24)}」不在「选项」里，已留空`);
      e.workType = null;
    }
  }

  const known = new Set(tasks.map((t) => t.code));
  const orphan = entries.filter((e) => !known.has(e.code));
  if (orphan.length) warnings.push(`有 ${orphan.length} 条明细的编号在任务表里找不到（如 ${[...new Set(orphan.map((e) => e.code))].slice(0, 3).join("、")}），导入时会跳过（已经导入过的任务除外）`);

  return { tasks, entries, pinnedCodes, options, warnings, sheetRows: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length])) };
}
