import type { Task, TimeEntry } from "../../db/models";

/**
 * 复制/导出的列。前 9 列的顺序和名称跟旧「明细」表一致（编号、标题、划分、工作内容类型、内容、日期、开始、结束、用时），
 * 所以复制出去的行能直接贴回旧表，也能原样粘回本应用（粘贴时按第 6 列是日期来认出这种布局）；
 * 系统、需求方是额外附上的两列。
 */
export const EXPORT_COLUMNS = ["编号", "标题", "例行工作内容划分", "例行工作工作内容", "工作内容", "日期", "开始时间", "结束时间", "用时", "系统", "需求方"] as const;
export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string | number>;

export function toExportRows(entries: TimeEntry[], tasks: Task[]): ExportRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return [...entries]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""))
    .map((e) => {
      const t = byId.get(e.taskId);
      return {
        编号: t?.code ?? "",
        标题: e.taskTitle,
        例行工作内容划分: t?.category ?? "",
        例行工作工作内容: e.workType ?? "",
        工作内容: e.content,
        日期: e.date,
        开始时间: e.start ?? "",
        结束时间: e.end ?? "",
        用时: e.durationHours,
        系统: t?.system ?? "",
        需求方: t?.requesters.join("、") ?? "",
      };
    });
}

const cell = (v: string | number) => String(v).replace(/[\t\r\n]+/g, " ");

/** 制表符分隔，可以直接粘进 Excel；`header` 决定要不要带表头行 */
export function toTSV(rows: ExportRow[], header = true): string {
  const lines = rows.map((r) => EXPORT_COLUMNS.map((c) => cell(r[c])).join("\t"));
  return (header ? [EXPORT_COLUMNS.join("\t"), ...lines] : lines).join("\n");
}

export function toJSON(rows: ExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

export type CopyFormat = "excel" | "json";
export const COPY_FORMAT_LABEL: Record<CopyFormat, string> = { excel: "Excel 表格", json: "JSON" };

/** 按选定的格式把一批时间记录变成要放进剪贴板的文本 */
export function formatEntries(entries: TimeEntry[], tasks: Task[], opts: { format: CopyFormat; header: boolean }): string {
  const rows = toExportRows(entries, tasks);
  return opts.format === "json" ? toJSON(rows) : toTSV(rows, opts.header);
}
