import type { Task, TimeEntry } from "../../db/models";
import { stripTypePrefix } from "../../lib/content";
import { normDate } from "../../lib/time";

export const LOG_FIELDS = ["task", "type", "content", "date", "start", "end"] as const;
export type LogField = (typeof LOG_FIELDS)[number];

export const CROSS_DAY_MSG = "结束时间要晚于开始时间；跨天的工作请拆成两条记录（今天到 24:00，次日从 00:00 开始）。";

export interface PastedRow {
  code: string;
  title: string;
  type: string;
  content: string;
  date: string;
  start: string;
  end: string;
}

/**
 * 解析一行制表符分隔的文本。两种布局：
 * - 明细布局（本应用复制出来的“Excel 表格”，和旧「明细」表前 9 列一致）：编号 / 标题 / 划分 / 工作内容类型 / 内容 / 日期 / 开始 / 结束 / …
 *   认出它的办法是第 6 列是个日期；编号可以是空的（新建的任务没有旧编号）
 * - 精简布局（老版本复制出来的）：任务 / 划分 / 内容 / 日期 / 开始 / 结束
 */
export function parsePastedLine(line: string): PastedRow {
  const c = line.split("\t");
  if (c.length >= 8 && normDate(c[5] ?? "", 2000)) {
    const type = (c[3] || c[2] || "").trim();
    return {
      code: (c[0] ?? "").trim(),
      title: (c[1] ?? "").trim(),
      type,
      content: stripTypePrefix(c[4] ?? "", type),
      date: c[5] ?? "",
      start: c[6] ?? "",
      end: c[7] ?? "",
    };
  }
  return {
    code: "",
    title: (c[0] ?? "").trim(),
    type: (c[1] ?? "").trim(),
    content: (c[2] ?? "").trim(),
    date: c[3] ?? "",
    start: c[4] ?? "",
    end: c[5] ?? "",
  };
}

const isHeader = (line: string) => {
  const c = line.split("\t");
  return (c[0] === "编号" && c[1] === "标题") || (c[0] === "标题" && c[1]?.includes("划分"));
};

/** 本应用“JSON”格式复制出来的数组，也能粘回来 */
function parseJsonRows(text: string): PastedRow[] | null {
  const t = text.trim();
  if (!t.startsWith("[")) return null;
  try {
    const data = JSON.parse(t) as Record<string, unknown>[];
    if (!Array.isArray(data)) return null;
    const s = (v: unknown) => (v == null ? "" : String(v));
    return data.map((r) => ({
      code: s(r["编号"]).trim(),
      title: s(r["标题"]).trim(),
      type: s(r["例行工作工作内容"]).trim(),
      content: s(r["工作内容"]).trim(),
      date: s(r["日期"]),
      start: s(r["开始时间"]),
      end: s(r["结束时间"]),
    }));
  } catch {
    return null;
  }
}

export function parsePastedText(text: string): PastedRow[] {
  const json = parseJsonRows(text);
  if (json) return json;
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "" && !isHeader(line))
    .map(parsePastedLine);
}

/** 先按编号，再按标题全等，最后按标题互相包含来找任务。 */
export function resolveTask(tasks: Task[], p: Pick<PastedRow, "code" | "title">): Task | null {
  if (p.code) {
    const byCode = tasks.find((t) => t.code === p.code);
    if (byCode) return byCode;
  }
  if (p.title) {
    const exact = tasks.find((t) => t.title === p.title);
    if (exact) return exact;
    const loose = tasks.find((t) => t.title.includes(p.title) || p.title.includes(t.title));
    if (loose) return loose;
  }
  return null;
}

/** 新草稿行：沿用上一条的日期和划分，开始时间接上一条的结束。 */
export function nextDraft(last: Pick<TimeEntry, "date" | "end" | "workType"> | undefined, today: string, weekStart: string, weekEnd: string) {
  const inWeek = today >= weekStart && today <= weekEnd;
  const date = last ? last.date : inWeek ? today : weekStart;
  return {
    taskId: "",
    type: last?.workType ?? "",
    content: "",
    date,
    start: last && last.date === date && last.end && last.end !== "24:00" ? last.end : "", // 上一条到 24:00 收尾的，下一条不能从 24:00 开始
    end: "",
  };
}

export type Draft = ReturnType<typeof nextDraft>;
