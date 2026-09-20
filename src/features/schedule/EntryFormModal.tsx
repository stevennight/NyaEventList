import { useShallow } from "zustand/react/shallow";
import { useMemo, useRef, useState } from "react";
import { EntryValidationError } from "../../db/repos";
import { normDate, normTime, nowClock } from "../../lib/time";
import { SegmentedField } from "../../shared/SegmentedField";
import { SelectOrCreate, type ComboItem } from "../../shared/SelectOrCreate";
import { useApp, weekEndOf, weekStartFor } from "../../store";
import { CROSS_DAY_MSG } from "../log/logModel";
import { matchesQuery, sortTasksForPicker, taskSearchText } from "../tasks/taskSearch";

/** 新建 / 编辑一条时间记录（日历里点色块、双击空白处会打开）。 */
export function EntryFormModal() {
  const form = useApp((s) => s.entryForm)!;
  const { tasks, entries, workTypes, weekStart } = useApp(useShallow((s) => ({ tasks: s.tasks, entries: s.entries, workTypes: s.workTypes, weekStart: s.weekStart })));
  const closeEntryForm = () => useApp.getState().closeEntryForm();
  const editing = form.mode === "edit" ? entries.find((e) => e.id === form.id) : undefined;
  const d = form.mode === "create" ? form.defaults : undefined;

  const [taskId, setTaskId] = useState(editing?.taskId ?? d?.taskId ?? "");
  const [date, setDate] = useState(editing?.date ?? d?.date ?? "");
  const [start, setStart] = useState(editing?.start ?? d?.start ?? "");
  const [end, setEnd] = useState(editing?.end ?? d?.end ?? "");
  const [workType, setWorkType] = useState(editing?.workType ?? "");
  const [content, setContent] = useState(editing?.content ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const taskItems = useMemo<ComboItem[]>(() => sortTasksForPicker(tasks).map((t) => ({ id: t.id, label: t.title, sub: `${t.code ? t.code + " · " : ""}${t.system ?? ""}`, search: taskSearchText(t) })), [tasks]);
  const typeItems = useMemo<ComboItem[]>(() => workTypes.map((w) => ({ id: w.value, label: w.label })), [workTypes]);
  const matcher = useMemo(() => (it: ComboItem, q: string) => matchesQuery(`${it.label} ${it.search ?? ""}`, q), []);
  const taskTitle = tasks.find((t) => t.id === taskId)?.title ?? "";

  const save = async () => {
    const nd = normDate(date, Number(weekStart.slice(0, 4)));
    const ns = normTime(start);
    const ne = normTime(end);
    if (!taskId) return setError("先选一个任务");
    if (!nd) return setError("日期没填完整，或者这一天不存在");
    if (!ns || !ne) return setError("开始/结束时间没填完整");
    setSaving(true);
    try {
      const app = useApp.getState();
      if (form.mode === "create") await app.createEntry({ taskId, date: nd, start: ns, end: ne, workType: workType || null, content });
      else await app.updateEntry(form.id, { taskId, date: nd, start: ns, end: ne, workType: workType || null, content });
      if (nd < weekStart || nd > weekEndOf(weekStart)) await app.setWeek(weekStartFor(nd));
      app.toast(form.mode === "create" ? "已新建时间记录" : "已保存时间记录");
      closeEntryForm();
    } catch (e) {
      setError(e instanceof EntryValidationError ? CROSS_DAY_MSG : e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const remove = async () => {
    if (form.mode !== "edit") return;
    await useApp.getState().removeEntry(form.id);
    useApp.getState().toast("已删除该条时间记录");
    closeEntryForm();
  };

  const nowBtn = (set: (v: string) => void) => (
    <button type="button" className="btn-now" onClick={() => set(nowClock())}>
      现在
    </button>
  );
  const focusField = (label: string) => document.querySelector<HTMLInputElement>(`.modal [aria-label="${label}"] input`)?.focus();
  const timeField = (label: string, value: string, set: (v: string) => void, next?: string) => (
    <div className="field">
      <label>{label}</label>
      <SegmentedField kind="time" value={value} onChange={set} picker allow24={label === "结束"} ariaLabel={label} extra={nowBtn(set)} onComplete={next ? () => focusField(next) : undefined} />
    </div>
  );

  return (
    <div
      className="modal-back"
      onMouseDown={(e) => e.target === e.currentTarget && closeEntryForm()}
      onKeyDown={(e) => {
        if (e.key === "Escape") closeEntryForm();
        else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur();
          setTimeout(() => void saveRef.current(), 0);
        }
      }}
    >
      <div className="modal" role="dialog" aria-label={form.mode === "create" ? "新建时间记录" : "编辑时间记录"}>
        <div className="modal-head">
          <strong>{form.mode === "create" ? "新建时间记录" : "编辑时间记录"}</strong>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>任务</label>
            <SelectOrCreate items={taskItems} value={taskTitle} matcher={matcher} revertOnBlur autoFocus={!taskId} placeholder="搜索任务：标题 / 编号 / 系统 / 需求方" onSelect={(id) => setTaskId(id)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>日期</label>
              <SegmentedField kind="date" value={date} onChange={setDate} picker ariaLabel="日期" defaultYear={Number(weekStart.slice(0, 4))} onComplete={() => focusField("开始")} />
            </div>
            {timeField("开始", start, setStart, "结束")}
            {timeField("结束", end, setEnd)}
          </div>
          <div className="field">
            <label>工作内容划分</label>
            <SelectOrCreate items={typeItems} value={workType} allowCreate commitOnBlur placeholder="搜索或新建工作内容划分" onSelect={(_id, label) => setWorkType(label)} />
          </div>
          <div className="field">
            <label>具体内容</label>
            <textarea className="text-in" rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="具体做了什么" />
          </div>
          <div className="field-hint" hidden={!!error} style={{ background: "var(--surface-2)", color: "var(--ink-dim)" }}>
            一条记录不能跨过午夜：跨天的工作请拆成两条（当天到 24:00，次日从 00:00 开始）。
          </div>
          {error && <div className="field-hint">{error}</div>}
        </div>
        <div className="modal-foot">
          {form.mode === "edit" && (
            <button type="button" className="btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>
              删除
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={closeEntryForm}>
            取消
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
            保存（Ctrl+Enter）
          </button>
        </div>
      </div>
    </div>
  );
}
