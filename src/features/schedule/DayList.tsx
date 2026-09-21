import type { Task, TimeEntry } from "../../db/models";

interface Props {
  date: string;
  entries: TimeEntry[];
  taskById: Map<string, Task>;
  chosen: Set<string>;
  hoverId: string | null;
  onHover(id: string | null): void;
  onPick(id: string, mods: { shift: boolean; ctrl: boolean }): void;
  onEdit(id: string): void;
}

/** 日视图右边的当天明细：按开始时间排好，一行一条，碎片记录也看得清。和左边的色块互相联动（悬停、选中）。 */
export function DayList({ date, entries, taskById, chosen, hoverId, onHover, onPick, onEdit }: Props) {
  const hours = entries.reduce((s, e) => s + e.durationHours, 0);
  const open = entries.filter((e) => !e.end).length;
  return (
    <aside className="day-list" aria-label="当天明细">
      <header>
        <strong>{Number(date.slice(5, 7))} 月 {Number(date.slice(8))} 日 · 共 {hours.toFixed(2)}h</strong>
        <span>
          {entries.length} 条{open > 0 && `（${open} 条进行中）`}
        </span>
      </header>
      {entries.length === 0 && <div className="dl-empty">这一天还没有记录。把左边的任务拖到时间轴上，或者在空白处双击新建。</div>}
      {entries.map((e) => {
        const task = taskById.get(e.taskId);
        return (
          <div
            key={e.id}
            data-list-id={e.id}
            className={`dl-item${chosen.has(e.id) ? " selected" : ""}${hoverId === e.id ? " linked" : ""}${task?.statusDone ? " done" : ""}`}
            onMouseEnter={() => onHover(e.id)}
            onMouseLeave={() => onHover(null)}
            onClick={(ev) => onPick(e.id, { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey })}
            onDoubleClick={() => onEdit(e.id)}
          >
            <div className="dl-time tnum">
              {e.start ? (e.end ? `${e.start}–${e.end}` : `${e.start} 起`) : "无时间"}
              {!e.end && e.start && <span className="open-pill">进行中</span>}
              {e.end && <em>{e.durationHours.toFixed(2)}h</em>}
            </div>
            <div className="dl-title">
              <span className={`kind-dot ${task?.kind === "routine" ? "kind-routine" : "kind-requirement"}`} />
              {e.taskTitle}
            </div>
            {(e.workType || e.content) && (
              <div className="dl-meta">
                {e.workType && <span className="dl-type">{e.workType}</span>}
                {e.content}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
