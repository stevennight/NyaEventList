import { parseISODate } from "../../lib/time";

export type Due = { kind: "none" } | { kind: "ok" | "soon" | "late"; days: number };

/**
 * 期望完成时间相对今天的状态：超期标红、临近（默认 3 天内，含当天）标黄。
 * 没填期望完成时间的、或已经是完成态的任务不参与判断。
 */
export function dueState(targetDate: string | null, today: string, soonDays: number, done = false): Due {
  if (!targetDate || done) return { kind: "none" };
  const days = Math.round((parseISODate(targetDate).getTime() - parseISODate(today).getTime()) / 86400000);
  if (days < 0) return { kind: "late", days };
  if (days <= soonDays) return { kind: "soon", days };
  return { kind: "ok", days };
}

export function dueLabel(due: Due, targetDate: string | null): string {
  if (due.kind === "none" || !targetDate) return "";
  if (due.kind === "late") return `超期 ${-due.days} 天`;
  if (due.days === 0) return "今天截止";
  return `${targetDate.slice(5)}（${due.days} 天后）`;
}
