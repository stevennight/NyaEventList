import type { Task } from "../../db/models";
import { matchesQuery, taskSearchText } from "./taskSearch";

export type PanelTab = "open" | "backlog" | "done" | "all";

export interface TaskFilters {
  system?: string;
  status?: string;
  category?: string;
  requester?: string;
  kind?: Task["kind"];
}

export interface PanelQuery {
  query: string;
  tab: PanelTab;
  filters: TaskFilters;
}

export const EMPTY_PANEL: PanelQuery = { query: "", tab: "open", filters: {} };

export const hasActiveFilters = (f: TaskFilters) => Object.values(f).some(Boolean);

/** “待安排”是算出来的：任务还没有任何时间记录。 */
export const isBacklog = (t: Task) => t.entryCount === 0;

const byUsage = (a: Task, b: Task) => b.entryCount - a.entryCount || (b.lastEntryDate ?? "").localeCompare(a.lastEntryDate ?? "") || a.title.localeCompare(b.title, "zh");

export function applyFilters(tasks: Task[], f: TaskFilters): Task[] {
  return tasks.filter(
    (t) => (!f.system || t.system === f.system) && (!f.status || t.status === f.status) && (!f.category || t.category === f.category) && (!f.requester || t.requesters.includes(f.requester)) && (!f.kind || t.kind === f.kind),
  );
}

export type PanelResult = { mode: "search"; open: Task[]; done: Task[] } | { mode: "tab"; list: Task[] };

/**
 * 面板的任务列表。有搜索词或筛选条件时永远搜全部任务，未完成的排前面、已完成的排后面分段；
 * 否则按 Tab（未完成/待安排/已完成/全部）取，按引用量排序。
 */
export function queryTasks(tasks: Task[], q: PanelQuery): PanelResult {
  const text = q.query.trim();
  if (text || hasActiveFilters(q.filters)) {
    const hits = applyFilters(tasks, q.filters).filter((t) => !text || matchesQuery(taskSearchText(t), text));
    return { mode: "search", open: hits.filter((t) => !t.statusDone).sort(byUsage), done: hits.filter((t) => t.statusDone).sort(byUsage) };
  }
  const pick: Record<PanelTab, (t: Task) => boolean> = {
    open: (t) => !t.statusDone,
    backlog: (t) => isBacklog(t) && !t.statusDone,
    done: (t) => t.statusDone,
    all: () => true,
  };
  return { mode: "tab", list: tasks.filter(pick[q.tab]).sort(byUsage) };
}

/** 进度看板用：跟面板共用搜索词和筛选条件，但不受 Tab 限制（看板自己按状态分列）。 */
export function boardTasks(tasks: Task[], q: Pick<PanelQuery, "query" | "filters">): Task[] {
  const text = q.query.trim();
  return applyFilters(tasks, q.filters).filter((t) => !text || matchesQuery(taskSearchText(t), text));
}

export const flattenResult = (r: PanelResult): Task[] => (r.mode === "search" ? [...r.open, ...r.done] : r.list);

export function tabCounts(tasks: Task[]): Record<PanelTab, number> {
  return {
    open: tasks.filter((t) => !t.statusDone).length,
    backlog: tasks.filter((t) => isBacklog(t) && !t.statusDone).length,
    done: tasks.filter((t) => t.statusDone).length,
    all: tasks.length,
  };
}
