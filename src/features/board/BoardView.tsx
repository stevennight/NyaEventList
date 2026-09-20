import { useMemo, useState } from "react";
import type { Task } from "../../db/models";
import { todayStr, useApp } from "../../store";
import { SearchBar } from "../tasks/SearchBar";
import { boardTasks } from "../tasks/taskFilters";
import { KindBadge } from "../tasks/TaskPanel";
import { dueLabel, dueState } from "./due";

const NO_STATUS = "（无状态）";
const COLUMN_LIMIT = 40; // 一列最多先画这么多张，剩下的点“显示更多”

interface Column {
  key: string;
  name: string;
  done: boolean;
  tasks: Task[];
}

function BoardCard({ task, soonDays, today }: { task: Task; soonDays: number; today: string }) {
  const due = dueState(task.targetDate, today, soonDays, task.statusDone);
  return (
    <div
      className="board-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/board-task", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => useApp.getState().openTaskForm({ mode: "edit", id: task.id })}
    >
      <div className="t">
        <KindBadge kind={task.kind} /> {task.title}
      </div>
      <div className="m">
        <span>{[task.system, task.requesters.join("、")].filter(Boolean).join(" · ") || "—"}</span>
        {due.kind !== "none" && <span className={`due-pill ${due.kind}`}>{dueLabel(due, task.targetDate)}</span>}
      </div>
    </div>
  );
}

/** 进度看板：按状态分列，回答“现在有哪些事还没做完”。拖卡片换列 = 改状态。 */
export function BoardView() {
  const tasks = useApp((s) => s.tasks);
  const statuses = useApp((s) => s.dicts.status);
  const panel = useApp((s) => s.panel);
  const soonDays = useApp((s) => s.dueSoonDays);
  const setDueSoonDays = useApp((s) => s.setDueSoonDays);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // 手动展开的完成态列
  const [more, setMore] = useState<Record<string, number>>({});
  const [over, setOver] = useState<string | null>(null);
  const today = todayStr();

  const columns = useMemo<Column[]>(() => {
    const visible = boardTasks(tasks, panel);
    const byStatus = new Map<string, Task[]>();
    for (const t of visible) (byStatus.get(t.status ?? NO_STATUS) ?? byStatus.set(t.status ?? NO_STATUS, []).get(t.status ?? NO_STATUS)!).push(t);
    // 有期望完成时间的排前面、越紧迫越靠前，其余按被引用次数
    const order = (a: Task, b: Task) => (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") || b.entryCount - a.entryCount;
    const cols: Column[] = statuses.map((s) => ({ key: s.value, name: s.label, done: s.isDone, tasks: (byStatus.get(s.value) ?? []).sort(order) }));
    const orphan = byStatus.get(NO_STATUS);
    if (orphan?.length) cols.unshift({ key: NO_STATUS, name: NO_STATUS, done: false, tasks: orphan.sort(order) });
    return cols;
  }, [tasks, statuses, panel]);

  const drop = async (e: React.DragEvent, col: Column) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/board-task");
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === col.key || col.key === NO_STATUS) return;
    const app = useApp.getState();
    await app.updateTask(id, { status: col.key });
    app.toast(`「${task.title}」→ ${col.name}`);
  };

  return (
    <div className="board-wrap">
      <div className="board-toolbar">
        <SearchBar className="board-search" />
        <label className="board-due">
          临近截止
          <input type="number" min={0} max={60} value={soonDays} onChange={(e) => setDueSoonDays(Math.max(0, Number(e.target.value) || 0))} />天
        </label>
        <span className="hint">拖卡片换列即改状态；已完成的列默认折叠</span>
      </div>
      <div className="board-cols">
        {columns.map((col) => {
          const collapsed = col.done && !expanded.has(col.key);
          if (collapsed) {
            return (
              <button
                key={col.key}
                type="button"
                className={`board-collapsed${over === col.key ? " drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col.key);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => void drop(e, col)}
                onClick={() => setExpanded((cur) => new Set(cur).add(col.key))}
              >
                <span className="name">{col.name}</span>
                <span className="cnt tnum">{col.tasks.length}</span>
                <span className="open">展开</span>
              </button>
            );
          }
          const limit = more[col.key] ?? COLUMN_LIMIT;
          return (
            <div
              key={col.key}
              className={`board-col${over === col.key ? " drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => void drop(e, col)}
            >
              <div className="board-col-head">
                <span className="name">{col.name}</span>
                <span className="cnt tnum">
                  {col.tasks.length}
                  {col.done && (
                    <button type="button" className="link-btn" onClick={() => setExpanded((cur) => new Set([...cur].filter((k) => k !== col.key)))}>
                      折叠
                    </button>
                  )}
                </span>
              </div>
              <div className="board-col-body">
                {col.tasks.slice(0, limit).map((t) => (
                  <BoardCard key={t.id} task={t} soonDays={soonDays} today={today} />
                ))}
                {col.tasks.length > limit && (
                  <button type="button" className="btn-ghost" onClick={() => setMore((m) => ({ ...m, [col.key]: limit + COLUMN_LIMIT }))}>
                    显示更多（还有 {col.tasks.length - limit} 张）
                  </button>
                )}
                {col.tasks.length === 0 && <div className="panel-empty">空</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
