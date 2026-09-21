import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Task, TimeEntry } from "../../db/models";

/**
 * 鼠标停在日程色块上时弹出的详情卡片。色块太窄、太矮、被别的块挤住时也能完整看到
 * 标题、时间、划分、内容、需求方。挂在 body 上，不受日历容器裁剪；优先放在块的右边，放不下就放左边。
 */
export function EntryHoverCard({ entry, task, rect }: { entry: TimeEntry; task: Task | undefined; rect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 8;
    let left = rect.right + gap;
    if (left + width > window.innerWidth - gap) left = rect.left - width - gap;
    left = Math.max(gap, Math.min(left, window.innerWidth - width - gap));
    const top = Math.max(gap, Math.min(rect.top, window.innerHeight - height - gap));
    setPos({ left, top });
  }, [rect]);

  const open = !entry.end;
  return createPortal(
    <div ref={ref} className="entry-card" style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }} role="tooltip">
      <div className="ec-title">
        <span className={`kind-dot ${task?.kind === "routine" ? "kind-routine" : "kind-requirement"}`} />
        {entry.taskTitle}
      </div>
      <div className="ec-time tnum">
        {entry.date}
        {entry.start && (open ? ` · ${entry.start} 起` : ` · ${entry.start}–${entry.end} · ${entry.durationHours.toFixed(2)}h`)}
        {open && <span className="open-pill">进行中</span>}
      </div>
      {(task?.system || task?.status || entry.workType) && (
        <div className="ec-tags">
          {task?.system && <span>{task.system}</span>}
          {task?.status && <span className={task.statusDone ? "done" : ""}>{task.status}</span>}
          {entry.workType && <span className="type">{entry.workType}</span>}
        </div>
      )}
      {entry.content && <div className="ec-content">{entry.content}</div>}
      {!!task?.requesters.length && <div className="ec-meta">需求方：{task.requesters.join("、")}</div>}
      <div className="ec-hint">{open ? "进行中：色块高度只是示意，把下边缘往下拖就是设定结束时间" : "拖中间挪动、拖边缘改时长"} · 单击选中 · 双击编辑</div>
    </div>,
    document.body,
  );
}
