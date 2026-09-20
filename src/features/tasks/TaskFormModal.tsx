import { useShallow } from "zustand/react/shallow";
import { useMemo, useRef, useState } from "react";
import type { TaskKind } from "../../db/models";
import { normDate } from "../../lib/time";
import { SegmentedField } from "../../shared/SegmentedField";
import { RequesterPicker } from "../../shared/RequesterPicker";
import { SelectOrCreate, type ComboItem } from "../../shared/SelectOrCreate";
import { useApp } from "../../store";

const KIND_LABEL: Record<TaskKind, string> = { requirement: "需求", routine: "非需求" };

/** 新建 / 编辑任务。字典类字段都是“选择或新建”，需求方可以有多个。 */
export function TaskFormModal() {
  const form = useApp((s) => s.taskForm)!;
  const { tasks, dicts } = useApp(useShallow((s) => ({ tasks: s.tasks, dicts: s.dicts })));
  const { createTask, updateTask, toast } = useApp.getState();
  const closeTaskForm = () => {
    if (form.mode === "create") form.onCancel?.();
    useApp.getState().closeTaskForm();
  };
  const editing = form.mode === "edit" ? tasks.find((t) => t.id === form.id) : undefined;

  const [title, setTitle] = useState(editing?.title ?? (form.mode === "create" ? (form.title ?? "") : ""));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [kind, setKind] = useState<TaskKind>(editing?.kind ?? "requirement");
  const [system, setSystem] = useState(editing?.system ?? "");
  const [status, setStatus] = useState(editing?.status ?? "待处理");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? "");
  const [pinned, setPinned] = useState(editing?.pinned ?? false);
  const [requesters, setRequesters] = useState<string[]>(editing?.requesters ?? []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const items = (list: { value: string; label: string }[]): ComboItem[] => list.map((o) => ({ id: o.value, label: o.label }));
  const systemItems = useMemo(() => items(dicts.system), [dicts.system]);
  const statusItems = useMemo(() => items(dicts.status), [dicts.status]);
  const categoryItems = useMemo(() => items(dicts.category), [dicts.category]);

  const save = async () => {
    if (!title.trim()) return setError("标题不能为空");
    const target = targetDate.trim() ? normDate(targetDate, new Date().getFullYear()) : null;
    if (targetDate.trim() && !target) return setError("期望完成时间的格式不对，例如 9-30 或 2026-09-30");
    setSaving(true);
    try {
      const input = { title, description, kind, system: system.trim() || null, status: status.trim() || null, category: category.trim() || null, requesters, pinned, targetDate: target };
      if (form.mode === "create") {
        const id = await createTask(input);
        toast("已新建任务");
        useApp.getState().closeTaskForm();
        form.onCreated?.(id);
      } else {
        await updateTask(form.id, input);
        toast("已保存");
        useApp.getState().closeTaskForm();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  return (
    <div
      className="modal-back"
      onMouseDown={(e) => e.target === e.currentTarget && closeTaskForm()}
      onKeyDown={(e) => {
        if (e.key === "Escape") closeTaskForm();
        else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          // 先让当前输入框失焦，把敲了没选的文字提交进表单，再用最新的表单状态保存
          (document.activeElement as HTMLElement | null)?.blur();
          setTimeout(() => void saveRef.current(), 0);
        }
      }}
    >
      <div className="modal" role="dialog" aria-label={form.mode === "create" ? "新建任务" : "编辑任务"}>
        <div className="modal-head">
          <strong>{form.mode === "create" ? "新建任务" : "编辑任务"}</strong>
          {editing?.code && <span className="modal-code">旧编号 {editing.code}</span>}
        </div>
        <div className="modal-body">
          <div className="field">
            <label>类型</label>
            <div className="seg">
              {(Object.keys(KIND_LABEL) as TaskKind[]).map((k) => (
                <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>标题</label>
            <input className="text-in" autoFocus={!title} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任务标题" />
          </div>
          <div className="field">
            <label>内容</label>
            <textarea className="text-in" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="补充说明（可选）" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>系统</label>
              <SelectOrCreate items={systemItems} value={system} allowCreate commitOnBlur autoFocus={!!title && form.mode === "create"} placeholder="选择或新建系统" onSelect={(_id, label) => setSystem(label)} />
            </div>
            <div className="field">
              <label>状态</label>
              <SelectOrCreate items={statusItems} value={status} allowCreate commitOnBlur onSelect={(_id, label) => setStatus(label)} />
            </div>
            <div className="field">
              <label>例行工作内容划分</label>
              <SelectOrCreate items={categoryItems} value={category} allowCreate commitOnBlur placeholder="执行类 / 辅助类" onSelect={(_id, label) => setCategory(label)} />
            </div>
          </div>
          <div className="field">
            <label>需求方（可以有多个）</label>
            <RequesterPicker value={requesters} onChange={setRequesters} />
          </div>
          <div className="field">
            <label>期望完成时间（可选，进度看板据此标黄/标红）</label>
            <SegmentedField kind="date" value={targetDate} onChange={setTargetDate} picker ariaLabel="期望完成时间" />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            置顶为常用任务（显示在任务面板顶部，方便直接拖进日历）
          </label>
          {error && <div className="field-hint">{error}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={closeTaskForm}>
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
