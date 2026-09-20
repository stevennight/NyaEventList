import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, fmtDate, parseISODate, weekStartOf } from "../lib/time";

const DOWS = ["一", "二", "三", "四", "五", "六", "日"];

/** 点弹层以外的地方或按 Esc 就收起 */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [ref, onClose]);
}

/** 月历：点一天就选中。周一开头，可以翻月，也可以一键回到今天。 */
export function CalendarPopover({ value, onPick, onClose }: { value: string | null; onPick(iso: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const base = value ? parseISODate(value) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const today = fmtDate(new Date());
  const cells = useMemo(() => {
    const start = weekStartOf(new Date(view.y, view.m, 1));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view]);
  const go = (delta: number) => setView((v) => ({ y: v.y + Math.floor((v.m + delta) / 12), m: (((v.m + delta) % 12) + 12) % 12 }));

  return (
    <div className="pop cal-pop" ref={ref} onMouseDown={(e) => e.preventDefault()}>
      <div className="cal-pop-head">
        <button type="button" onClick={() => go(-12)} aria-label="上一年" tabIndex={-1}>
          «
        </button>
        <button type="button" onClick={() => go(-1)} aria-label="上个月" tabIndex={-1}>
          ‹
        </button>
        <strong className="tnum">
          {view.y} 年 {view.m + 1} 月
        </strong>
        <button type="button" onClick={() => go(1)} aria-label="下个月" tabIndex={-1}>
          ›
        </button>
        <button type="button" onClick={() => go(12)} aria-label="下一年" tabIndex={-1}>
          »
        </button>
      </div>
      <div className="cal-pop-grid">
        {DOWS.map((d) => (
          <span key={d} className="dow">
            {d}
          </span>
        ))}
        {cells.map((d) => {
          const iso = fmtDate(d);
          const cls = ["day", d.getMonth() !== view.m ? "other" : "", iso === today ? "today" : "", iso === value ? "sel" : ""].join(" ");
          return (
            <button key={iso} type="button" className={cls} tabIndex={-1} onClick={() => onPick(iso)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="cal-pop-foot">
        <button type="button" tabIndex={-1} onClick={() => onPick(today)}>
          今天
        </button>
      </div>
    </div>
  );
}

const SLOTS = Array.from({ length: 97 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

/** 每 15 分钟一档的时间列表，打开时滚到当前值附近 */
export function TimePopover({ value, onPick, onClose }: { value: string | null; onPick(t: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const near = useMemo(() => {
    if (!value) return "09:00";
    const [h, m] = value.split(":").map(Number);
    const idx = Math.min(96, Math.round((h * 60 + m) / 15));
    return SLOTS[idx];
  }, [value]);
  useEffect(() => {
    ref.current?.querySelector(".on")?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div className="pop time-pop" ref={ref} onMouseDown={(e) => e.preventDefault()}>
      {SLOTS.map((s) => (
        <button key={s} type="button" tabIndex={-1} className={s === near ? "on" : ""} onClick={() => onPick(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}
