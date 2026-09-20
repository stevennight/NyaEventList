import type { Task } from "../../db/models";

/** 任务下拉的排序：没完成的在前，其次按被引用次数（越常用越靠前）。 */
export function sortTasksForPicker(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => Number(a.statusDone) - Number(b.statusDone) || b.entryCount - a.entryCount || a.title.localeCompare(b.title, "zh"));
}

const searchTextCache = new WeakMap<Task, string>();

/** 任务对象每次重载都是新的，所以按对象缓存；没变过的任务不用每敲一个字都重新拼一遍。 */
export function taskSearchText(t: Task): string {
  let text = searchTextCache.get(t);
  if (text === undefined) {
    text = [t.title, t.code ?? "", t.system ?? "", t.requesters.join(" "), t.kind === "requirement" ? "需求" : "非需求 例行"].join(" ").toLowerCase();
    searchTextCache.set(t, text);
  }
  return text;
}

/** 空格分隔的多个词要同时命中，所以“订单 张三”能同时按标题和需求方收窄。 */
export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((tok) => haystack.includes(tok));
}
