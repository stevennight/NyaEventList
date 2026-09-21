import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useRef } from "react";
import type { TimeEntry } from "../../db/models";
import { addDays, clockToHours, fmtDate, hoursToClock, parseISODate } from "../../lib/time";
import { todayStr, useApp } from "../../store";
import { clickSelect, EMPTY_SELECTION, marqueeSelect, rectFromPoints, rectsIntersect, selectAll } from "../selection/selection";
import { SelectionBar } from "../selection/SelectionBar";
import { layoutDay } from "./layout";

const HOUR_H = 52; // 每小时的像素高度
const DAY_H = 24 * HOUR_H; // 网格覆盖完整一天 00:00–24:00
const DEFAULT_SCROLL_HOUR = 7;
const SNAP = 1 / 12; // 拖动时吸附到 5 分钟
const DRAG_THRESHOLD = 6; // 鼠标抖动不超过这个像素数就算“点击”，不算拖动
const OPEN_H = 0.75; // 没设结束时间（进行中）的记录，色块画这么高，只是个示意
const DOWS = ["一", "二", "三", "四", "五", "六", "日"];

const snap = (h: number) => Math.round(h / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type DragMode = "move" | "top" | "bottom";

/** 色块上显示的时间：进行中的只有开始 */
const timeLabel = (e: TimeEntry) => (e.end ? `${e.start}–${e.end}` : `${e.start} 起`);
/** 排版和画色块用的结束点；进行中的按示意高度算 */
const endHours = (e: TimeEntry) => (e.end ? clockToHours(e.end) : Math.min(24, clockToHours(e.start!) + OPEN_H));

function showTip(text: string, x: number, y: number) {
  let el = document.getElementById("drag-tip");
  if (!el) {
    el = document.createElement("div");
    el.id = "drag-tip";
    el.className = "drag-tooltip";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.left = `${x + 14}px`;
  el.style.top = `${y - 12}px`;
}
const hideTip = () => document.getElementById("drag-tip")?.remove();

export function CalendarView() {
  const { entries, tasks, weekStart, selection } = useApp(useShallow((s) => ({ entries: s.entries, tasks: s.tasks, weekStart: s.weekStart, selection: s.selection })));
  const canvasRef = useRef<HTMLDivElement>(null);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => fmtDate(addDays(parseISODate(weekStart), i))), [weekStart]);
  const today = todayStr();

  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current) return; // 板块被隐藏再显示时别把滚动位置又拉回 07:00
    const el = canvasRef.current?.parentElement;
    if (el) el.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_H;
    scrolled.current = true;
  }, []);

  const openEdit = (id: string) => useApp.getState().openEntryForm({ mode: "edit", id });
  const order = useMemo(() => entries.map((e) => e.id), [entries]);
  const chosen = useMemo(() => new Set(selection.ids), [selection.ids]);
  /** 键盘（Ctrl+C、Ctrl+A、Esc）要有个能接住焦点的地方 */
  const focusCanvas = () => canvasRef.current?.focus({ preventScroll: true });

  /** 点色块：选中它（Ctrl 加选、Shift 选区间、Ctrl+Shift 叠加区间）。已经是唯一选中的再点一下保持选中，方便紧接着双击编辑。 */
  const clickBlock = (id: string, mods: { shift: boolean; ctrl: boolean }) => {
    const st = useApp.getState();
    const cur = st.selection;
    const plainOnSole = !mods.shift && !mods.ctrl && cur.ids.length === 1 && cur.ids[0] === id;
    if (!plainOnSole) st.setSelection(clickSelect(order, cur, id, mods));
    focusCanvas();
  };

  /** 在空白处拖出一个矩形框，碰到的色块都选中；按住 Ctrl 或 Shift 拖，叠加在原来的选区上。拖到边缘会自动滚动。 */
  const startMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const scroller = canvasRef.current?.parentElement;
    if (!scroller) return;
    e.preventDefault();
    focusCanvas();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = useApp.getState().selection;
    const toContent = (x: number, y: number) => {
      const r = scroller.getBoundingClientRect();
      return { x: x - r.left + scroller.scrollLeft, y: y - r.top + scroller.scrollTop };
    };
    const start = toContent(e.clientX, e.clientY);
    const [x0, y0] = [e.clientX, e.clientY];
    let last = { x: e.clientX, y: e.clientY };
    let moved = false;
    let raf = 0;
    const box = document.createElement("div");
    box.className = "marquee";

    const update = () => {
      const cur = toContent(last.x, last.y);
      const rect = rectFromPoints(start.x, start.y, cur.x, cur.y);
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.right - rect.left}px`;
      box.style.height = `${rect.bottom - rect.top}px`;
      const hits: string[] = [];
      scroller.querySelectorAll<HTMLElement>(".cal-block").forEach((el) => {
        const b = el.getBoundingClientRect();
        const a = toContent(b.left, b.top);
        const z = toContent(b.right, b.bottom);
        if (rectsIntersect(rect, { left: a.x, top: a.y, right: z.x, bottom: z.y })) hits.push(el.dataset.id!);
      });
      useApp.getState().setSelection(marqueeSelect(order, base, hits, additive));
    };
    const tick = () => {
      const r = scroller.getBoundingClientRect();
      scroller.scrollTop += last.y < r.top + 90 ? -16 : last.y > r.bottom - 40 ? 16 : 0; // 顶部有一条粘住的星期栏，所以上边留得宽一点
      update();
      raf = requestAnimationFrame(tick);
    };
    const onMove = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!moved && Math.abs(ev.clientX - x0) <= 4 && Math.abs(ev.clientY - y0) <= 4) return;
      if (!moved) {
        moved = true;
        scroller.appendChild(box);
        raf = requestAnimationFrame(tick);
      }
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      cancelAnimationFrame(raf);
      box.remove();
      if (!moved && !additive) useApp.getState().setSelection(EMPTY_SELECTION); // 点一下空白处 = 取消选择
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      useApp.getState().setSelection(selectAll(order));
    } else if (e.key === "Escape") useApp.getState().setSelection(EMPTY_SELECTION);
  };

  /* ---------- 色块：拖中间挪动、拖上下边缘改时长、不动就是点击编辑 ---------- */
  const startPointer = (e: React.PointerEvent<HTMLDivElement>, entry: TimeEntry, mode: DragMode) => {
    if (e.button !== 0 || !entry.start) return;
    e.preventDefault();
    const el = e.currentTarget;
    const open = !entry.end;
    const origStart = clockToHours(entry.start);
    const origEnd = endHours(entry); // 进行中的按示意高度算：拖下沿就是给它定结束时间
    const dur = origEnd - origStart;
    const [x0, y0] = [e.clientX, e.clientY];
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    const saved = { top: el.style.top, height: el.style.height };
    let moved = false;
    let pStart = origStart;
    let pEnd = origEnd;
    let pDate = entry.date;
    const timeEl = el.querySelector<HTMLElement>(".b-range");

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!moved && Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        if (mode === "move") {
          el.style.pointerEvents = "none"; // 让 elementFromPoint 看到下面的日期列
          el.classList.add("dragging-block");
        }
      }
      if (mode === "top") {
        pStart = snap(clamp(origStart + dy / HOUR_H, 0, origEnd - SNAP));
        el.style.top = `${pStart * HOUR_H}px`;
        el.style.height = `${Math.max(20, (origEnd - pStart) * HOUR_H - 3)}px`;
        if (timeEl) timeEl.textContent = `${hoursToClock(pStart)}–${hoursToClock(origEnd)}`;
        showTip(`${hoursToClock(pStart)} · ${(origEnd - pStart).toFixed(2)}h`, ev.clientX, ev.clientY);
      } else if (mode === "bottom") {
        const raw = origEnd + dy / HOUR_H;
        pEnd = snap(clamp(raw, origStart + SNAP, 24));
        el.style.height = `${Math.max(20, (pEnd - origStart) * HOUR_H - 3)}px`;
        if (timeEl) timeEl.textContent = `${hoursToClock(origStart)}–${hoursToClock(pEnd)}`;
        showTip(raw > 24 ? "已到 24:00 · 跨天请拆成两条记录，次日从 00:00 开始" : `${open ? "结束于 " : ""}${hoursToClock(pEnd)} · ${(pEnd - origStart).toFixed(2)}h`, ev.clientX, ev.clientY);
      } else {
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(".day-col");
        pDate = col?.dataset.date ?? entry.date;
        const raw = origStart + dy / HOUR_H;
        pStart = snap(clamp(raw, 0, 24 - dur));
        pEnd = pStart + dur;
        showTip(raw + dur > 24 ? "已到 24:00 · 这条记录挪不到跨天，超出部分请新建一条次日的记录" : `${pDate.slice(5)} ${hoursToClock(pStart)}–${hoursToClock(pEnd)}`, ev.clientX, ev.clientY);
      }
    };

    const onUp = async () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      hideTip();
      el.style.pointerEvents = "";
      el.classList.remove("dragging-block");
      if (!moved) {
        if (mode === "move") clickBlock(entry.id, mods);
        return;
      }
      // 进行中的记录挪动时只改开始和日期，结束时间仍然留空
      const patch = mode === "top" ? { start: hoursToClock(pStart) } : mode === "bottom" ? { end: hoursToClock(pEnd) } : open ? { start: hoursToClock(pStart), date: pDate } : { start: hoursToClock(pStart), end: hoursToClock(pEnd), date: pDate };
      try {
        await useApp.getState().updateEntry(entry.id, patch);
        useApp.getState().toast(open && mode === "move" ? `已更新时间记录 · ${pDate.slice(5)} ${hoursToClock(pStart)} 起（进行中）` : `已更新时间记录 · ${pDate.slice(5)} ${hoursToClock(pStart)}–${hoursToClock(pEnd)}`);
      } catch (err) {
        el.style.top = saved.top;
        el.style.height = saved.height;
        if (timeEl) timeEl.textContent = timeLabel(entry);
        useApp.getState().toast(err instanceof Error ? err.message : String(err));
      } finally {
        el.style.transform = "";
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  /* ---------- 从任务面板拖进来 / 双击空白处新建 ---------- */
  const hourAt = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return clamp(Math.round(((e.clientY - rect.top) / HOUR_H) * 2) / 2, 0, 23);
  };
  const onDrop = async (e: React.DragEvent<HTMLDivElement>, date: string) => {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    const taskId = e.dataTransfer.getData("text/task-id");
    if (!taskId) return;
    const start = hourAt(e);
    const end = Math.min(24, start + 1);
    const app = useApp.getState();
    try {
      await app.createEntry({ taskId, date, start: hoursToClock(start), end: hoursToClock(end) });
      app.toast(`已把「${taskById.get(taskId)?.title ?? ""}」排到 ${date.slice(5)} ${hoursToClock(start)}，点色块补充详细内容`);
    } catch (err) {
      app.toast(err instanceof Error ? err.message : String(err));
    }
  };

  const byDay = useMemo(() => {
    const m = new Map<string, TimeEntry[]>();
    for (const e of entries) if (e.start) (m.get(e.date) ?? m.set(e.date, []).get(e.date)!).push(e);
    return m;
  }, [entries]);

  return (
    <div className="cal-wrap" ref={canvasRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="cal-header">
        <div />
        {days.map((d, i) => (
          <div key={d} className={`day-head${d === today ? " is-today" : ""}`}>
            <div className="dow">周{DOWS[i]}</div>
            <div className="dnum tnum">{Number(d.slice(8))}</div>
          </div>
        ))}
      </div>
      <div className="cal-grid">
        <div className="hour-col">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="hour-cell">
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((date) => {
          const dayEntries = byDay.get(date) ?? [];
          const layout = layoutDay(dayEntries.map((e) => ({ id: e.id, start: clockToHours(e.start!), end: endHours(e) })));
          return (
            <div
              key={date}
              className="day-col"
              data-date={date}
              style={{ height: DAY_H }}
              onPointerDown={startMarquee}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add("drag-over");
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove("drag-over")}
              onDrop={(e) => void onDrop(e, date)}
              onDoubleClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const start = hourAt(e);
                useApp.getState().openEntryForm({ mode: "create", defaults: { date, start: hoursToClock(start), end: hoursToClock(Math.min(24, start + 1)) } });
              }}
            >
              {dayEntries.map((entry) => {
                const task = taskById.get(entry.taskId);
                const s = clockToHours(entry.start!);
                const en = endHours(entry);
                const open = !entry.end;
                const slot = layout[entry.id] ?? { col: 0, cols: 1 };
                const w = 100 / slot.cols;
                return (
                  <div
                    key={entry.id}
                    data-id={entry.id}
                    className={`cal-block${task?.statusDone ? " done" : ""}${open ? " open" : ""}${chosen.has(entry.id) ? " selected" : ""}`}
                    onDoubleClick={() => openEdit(entry.id)}
                    style={{ top: s * HOUR_H, height: Math.max(20, (en - s) * HOUR_H - 3), left: `calc(${slot.col * w}% + 2px)`, width: `calc(${w}% - 4px)` }}
                    title={`${entry.taskTitle}\n${timeLabel(entry)}${entry.workType ? " · " + entry.workType : ""}${entry.content ? "\n" + entry.content : ""}\n${open ? "还没设结束时间（进行中），色块高度只是示意；把下边缘往下拖就是设定结束时间" : "拖中间挪动、拖边缘改时长"}；单击选中（Ctrl/Shift 叠加），双击或点 ✎ 编辑`}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).closest(".cal-block-edit")) return;
                      const handle = (e.target as HTMLElement).closest<HTMLElement>(".cal-block-handle");
                      startPointer(e, entry, handle ? (handle.dataset.h as DragMode) : "move");
                    }}
                  >
                    {!open && <div className="cal-block-handle" data-h="top" style={{ top: -4 }} />}
                    <div className="cal-block-body">
                      <div className="b-title">
                        <span className={`kind-dot ${task?.kind === "routine" ? "kind-routine" : "kind-requirement"}`} />
                        {entry.taskTitle}
                      </div>
                      <div className="b-time tnum">
                        {open && <span className="open-pill">进行中</span>}
                        <span className="b-range">{timeLabel(entry)}</span>
                      </div>
                    </div>
                    <button type="button" className="cal-block-edit" title="编辑这条记录" onPointerDown={(e) => e.stopPropagation()} onClick={() => openEdit(entry.id)}>
                      ✎
                    </button>
                    <div className="cal-block-handle" data-h="bottom" style={{ bottom: -4 }} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <SelectionBar />
    </div>
  );
}
