import { useEffect, useMemo, useRef, useState } from "react";
import type { Task, TimeEntry } from "../../db/models";
import { addDays, fmtDate, normDate, parseISODate, weekStartOf } from "../../lib/time";
import { copyText, saveFile } from "../../lib/saveFile";
import { SegmentedField } from "../../shared/SegmentedField";
import { SelectOrCreate, type ComboItem } from "../../shared/SelectOrCreate";
import { getRepos, todayStr, useApp } from "../../store";
import { EXPORT_COLUMNS, formatEntries, toExportRow, toExportRows, toJSON, toTSV } from "../export/rows";
import { copyEntries, hasOwnTextSelection } from "../selection/actions";
import { clickSelect, EMPTY_SELECTION, marqueeSelect, rangeIds, selectAll, type SelectionState } from "../selection/selection";
import { matchesQuery, sortTasksForPicker, taskSearchText } from "../tasks/taskSearch";

type Preset = "week" | "month" | "all" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "all", label: "全部时间" },
  { key: "custom", label: "自定义" },
];
const PAGE = 200; // 一次最多画这么多行，其余点"显示更多"；筛选、复制、导出用的还是完整结果，只是渲染量被这个数封顶

/** [from, to]，"" 表示不设这一头。全部时间两头都是 "" */
function rangeOf(preset: Preset, today: string): [string, string] {
  if (preset === "all") return ["", ""];
  const d = parseISODate(today);
  if (preset === "week") {
    const s = weekStartOf(d);
    return [fmtDate(s), fmtDate(addDays(s, 6))];
  }
  if (preset === "month") return [fmtDate(new Date(d.getFullYear(), d.getMonth(), 1)), fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  return ["", ""];
}

/** 已选任务：显示成小标签，下面的输入框搜索任务加进筛选（不允许新建，这里只筛选已有任务） */
function TaskFilterPicker({ tasks, value, onChange }: { tasks: Task[]; value: string[]; onChange(next: string[]): void }) {
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const chosen = useMemo(() => new Set(value), [value]);
  const items = useMemo<ComboItem[]>(
    () =>
      sortTasksForPicker(tasks)
        .filter((t) => !chosen.has(t.id))
        .map((t) => ({ id: t.id, label: t.title, sub: `${t.code ? t.code + " · " : ""}${t.system ?? ""}`, search: taskSearchText(t) })),
    [tasks, chosen],
  );
  const matcher = useMemo(() => (it: ComboItem, q: string) => matchesQuery(`${it.label} ${it.search ?? ""}`, q), []);
  return (
    <div className="lq-task-filter">
      {value.length > 0 && (
        <div className="chips">
          {value.map((id) => (
            <span key={id} className="tag-pill">
              {byId.get(id)?.title ?? id}
              <button type="button" aria-label={`移除 ${byId.get(id)?.title ?? id}`} onClick={() => onChange(value.filter((x) => x !== id))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <SelectOrCreate items={items} value="" matcher={matcher} clearOnSelect placeholder="搜索任务加入筛选：标题 / 编号 / 系统 / 需求方，不填就是全部任务" onSelect={(id) => onChange([...value, id])} />
    </div>
  );
}

export function LogQueryView() {
  const tasks = useApp((s) => s.tasks);
  const toast = useApp((s) => s.toast);
  const today = todayStr();
  const rootRef = useRef<HTMLDivElement>(null);

  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [preset, setPreset] = useState<Preset>("all");
  const [[from, to], setRange] = useState<[string, string]>(() => rangeOf("all", today));
  const [fromText, setFromText] = useState(from);
  const [toText, setToText] = useState(to);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);

  useEffect(() => {
    let alive = true;
    void getRepos()
      .entries.search({ taskIds: taskIds.length ? taskIds : undefined, from: from || undefined, to: to || undefined })
      .then((list) => alive && setEntries(list));
    return () => {
      alive = false;
    };
  }, [taskIds, from, to]);

  useEffect(() => {
    setShown(PAGE);
    setSelection(EMPTY_SELECTION);
  }, [taskIds, from, to]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(selectAll(order));
      } else if (e.key === "Escape") {
        setSelection(EMPTY_SELECTION);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, shown]);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") {
      const r = rangeOf(p, today);
      setRange(r);
      setFromText(r[0]);
      setToText(r[1]);
    }
  };
  const editRange = (f: string, t: string) => {
    setFromText(f);
    setToText(t);
    const full = /^\d{4}-\d{2}-\d{2}$/;
    if (full.test(f) && full.test(t) && normDate(f, 0) && normDate(t, 0) && f <= t) setRange([f, t]);
    else if (!f && !t) setRange(["", ""]);
  };

  const total = entries.length;
  const totalHours = useMemo(() => entries.reduce((s, e) => s + e.durationHours, 0), [entries]);
  const visible = useMemo(() => (total > shown ? entries.slice(total - shown) : entries), [entries, total, shown]);
  const order = useMemo(() => visible.map((e) => e.id), [visible]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const chosen = useMemo(() => new Set(selection.ids), [selection.ids]);
  const allChosen = order.length > 0 && order.every((id) => chosen.has(id));

  const selectedEntries = useMemo(() => visible.filter((e) => chosen.has(e.id)), [visible, chosen]);
  const selectedHours = useMemo(() => selectedEntries.reduce((s, e) => s + e.durationHours, 0), [selectedEntries]);

  /* ---------- 选行：点行号 / Ctrl / Shift / 拖动（跟流水页同一套手势） ---------- */
  const onNumMouseDown = (ev: React.MouseEvent<HTMLElement>, id: string) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.currentTarget.focus();
    const mods = { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey };
    const first = clickSelect(order, selection, id, mods);
    setSelection(first);
    const additive = mods.shift || mods.ctrl;
    let moved = false;
    const scroller = rootRef.current?.closest<HTMLElement>(".scroll");
    const onMove = (m: MouseEvent) => {
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (m.clientY < r.top + 30) scroller.scrollTop -= 24;
        else if (m.clientY > r.bottom - 30) scroller.scrollTop += 24;
      }
      const over = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>("[data-row]")?.dataset.row;
      if (!over || (over === id && !moved)) return;
      moved = true;
      setSelection(marqueeSelect(order, additive ? first : EMPTY_SELECTION, rangeIds(order, id, over), additive));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  /* ---------- Ctrl+C 复制选中的行（只在这个板块是当前板块时接管） ---------- */
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const st = useApp.getState();
      if (st.screen !== "logQuery" || hasOwnTextSelection(e.target) || !selectedEntries.length || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", formatEntries(selectedEntries, st.tasks, { format: st.copyFormat, header: st.copyHeader }));
      st.toast(`已复制 ${selectedEntries.length} 条（${st.copyFormat === "excel" ? "Excel 表格，可直接粘到 Excel" : "JSON"}）`);
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [selectedEntries]);

  const stamp = from || to ? `${from || "起"}_${to || "止"}` : "全部";
  const doSave = async (name: string, data: Uint8Array | string) => {
    try {
      if ((await saveFile(name, data)) === "saved") toast(`已导出 ${total} 条记录`);
    } catch (e) {
      toast(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="lq-wrap" ref={rootRef}>
      <div className="lq-bar">
        <TaskFilterPicker tasks={tasks} value={taskIds} onChange={setTaskIds} />
        <div className="lq-range">
          <div className="seg">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className={preset === p.key ? "active" : ""} onClick={() => pick(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="stats-custom">
              <SegmentedField kind="date" value={fromText} onChange={(v) => editRange(v, toText)} picker ariaLabel="开始日期" />
              <span>至</span>
              <SegmentedField kind="date" value={toText} onChange={(v) => editRange(fromText, v)} picker ariaLabel="结束日期" />
            </div>
          )}
        </div>
        <div className="lq-export">
          <button
            type="button"
            className="btn-ghost"
            disabled={!total}
            onClick={() =>
              void copyText(toTSV(toExportRows(entries, tasks))).then(
                () => toast(`已复制 ${total} 条记录（可直接粘到 Excel）`),
                () => toast("复制失败"),
              )
            }
          >
            复制全部
          </button>
          <button type="button" className="btn-ghost" disabled={!total} onClick={() => void import("../export/xlsx").then(({ toXlsx }) => doSave(`流水查询_${stamp}.xlsx`, toXlsx(toExportRows(entries, tasks))))}>
            导出 Excel
          </button>
          <button type="button" className="btn-ghost" disabled={!total} onClick={() => void doSave(`流水查询_${stamp}.json`, toJSON(toExportRows(entries, tasks)))}>
            导出 JSON
          </button>
        </div>
      </div>

      <div className="lq-summary tnum">
        共 {total} 条 · {totalHours.toFixed(2)} h{taskIds.length > 0 && ` · 涉及 ${taskIds.length} 个任务`}
      </div>

      {total === 0 ? (
        <div className="panel-empty">没有符合条件的流水{taskIds.length === 0 && preset !== "all" ? "，也可以试试把日期范围改成“全部时间”" : ""}</div>
      ) : (
        <table className="dict-table lq-table">
          <thead>
            <tr>
              <th className="c-num" title={allChosen ? "取消全选" : "选中当前显示的全部行（Ctrl+A）"} onClick={() => setSelection(allChosen ? EMPTY_SELECTION : selectAll(order))}>
                #
              </th>
              {EXPORT_COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((e, i) => {
              const row = toExportRow(e, byId);
              return (
                <tr key={e.id} data-row={e.id} className={chosen.has(e.id) ? "selected" : ""}>
                  <td className="c-num" tabIndex={0} title="点击选中；Ctrl / Shift 叠加，拖动选多行，Ctrl+C 复制选中的行" onMouseDown={(ev) => onNumMouseDown(ev, e.id)}>
                    {i + 1}
                  </td>
                  {EXPORT_COLUMNS.map((c) => (
                    <td key={c} className={c === "工作内容" ? "lq-content" : undefined} title={c === "工作内容" ? String(row[c]) : undefined}>
                      {row[c]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {total > shown && (
        <button type="button" className="btn-ghost lq-more" onClick={() => setShown((n) => n + PAGE)}>
          显示更多（还有 {total - shown} 条）
        </button>
      )}

      {selection.ids.length > 0 && (
        <div className="sel-bar" role="toolbar" aria-label="已选中的记录">
          <span className="sel-count tnum">
            已选 {selection.ids.length} 条 · {selectedHours.toFixed(2)} h
          </span>
          <button type="button" onClick={() => void copyEntries(selectedEntries, "excel")} title="这也是 Ctrl+C 做的事">
            复制为 Excel 表格
            <em>Ctrl+C</em>
          </button>
          <button type="button" onClick={() => void copyEntries(selectedEntries, "json")}>
            复制为 JSON
          </button>
          <button type="button" className="plain" onClick={() => setSelection(EMPTY_SELECTION)} title="Esc">
            取消选择
          </button>
        </div>
      )}
    </div>
  );
}
