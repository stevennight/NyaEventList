import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EntryInput, Task, TimeEntry } from "../../db/models";
import { EntryValidationError } from "../../db/repos";
import { seedDemo } from "../../db/seedDemo";
import { durationHours, normDate, normTime } from "../../lib/time";
import { SegmentedField } from "../../shared/SegmentedField";
import { SelectOrCreate, type ComboItem } from "../../shared/SelectOrCreate";
import { getRepos, todayStr, useApp, weekEndOf, weekStartFor } from "../../store";
import { clickSelect, EMPTY_SELECTION, extendSelection, marqueeSelect, rangeIds, selectAll } from "../selection/selection";
import { SelectionBar } from "../selection/SelectionBar";
import { matchesQuery, sortTasksForPicker, taskSearchText } from "../tasks/taskSearch";
import { CROSS_DAY_MSG, LOG_FIELDS, nextDraft, parsePastedText, resolveTask, type Draft, type LogField } from "./logModel";

const DRAFT = "draft";
const FIELD_TO_DRAFT_KEY: Record<LogField, keyof Draft> = { task: "taskId", type: "type", content: "content", date: "date", start: "start", end: "end" };

interface Problem {
  row: string;
  field: LogField;
  msg: string;
}

const yearOf = (weekStart: string) => Number(weekStart.slice(0, 4));

/** 纯文字的格子（具体内容） */
function TextCell(props: { value: string; placeholder?: string; alwaysCommit?: boolean; onInput?(text: string): void; onCommit(text: string): void }) {
  const { value, placeholder, alwaysCommit, onInput, onCommit } = props;
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="log-in"
      type="text"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onInput?.(e.target.value);
      }}
      onBlur={() => {
        if (alwaysCommit || text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setText(value);
      }}
    />
  );
}

export function LogView() {
  const { tasks, workTypes, entries, weekStart, mode, selection } = useApp(useShallow((s) => ({ tasks: s.tasks, workTypes: s.workTypes, entries: s.entries, weekStart: s.weekStart, mode: s.mode, selection: s.selection })));
  const toast = useApp((s) => s.toast);
  const setSelection = useApp((s) => s.setSelection);
  const rootRef = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState("");
  const [comboTick, setComboTick] = useState(0); // 新建任务被取消时，让任务格丢掉敲了一半的文字

  const weekEnd = weekEndOf(weekStart);
  const [draft, setDraftState] = useState<Draft>(() => nextDraft(entries.at(-1), todayStr(), weekStart, weekEnd));
  const draftRef = useRef(draft);
  const patchDraft = (p: Partial<Draft>) => {
    draftRef.current = { ...draftRef.current, ...p };
    setDraftState(draftRef.current);
  };
  const resetDraft = (d: Draft) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const draftWeek = useRef(weekStart);
  useEffect(() => {
    // 只在真的换了周时重置草稿；同一周内录入产生的 entries 变化由 commitDraft 自己接续草稿。
    // （板块被隐藏再显示时这个副作用会重新跑一遍，所以要比较，不能无条件重置，否则写到一半的草稿会丢）
    if (draftWeek.current === weekStart) return;
    draftWeek.current = weekStart;
    resetDraft(nextDraft(entries.at(-1), todayStr(), weekStart, weekEnd));
    setProblem(null);
    setNotice("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  const pickerTasks = useMemo(() => sortTasksForPicker(tasks), [tasks]);
  const taskItems: ComboItem[] = useMemo(() => pickerTasks.map((t) => ({ id: t.id, label: t.title, sub: `${t.code ? t.code + " · " : ""}${t.system ?? ""}`, search: taskSearchText(t) })), [pickerTasks]);
  const typeItems: ComboItem[] = useMemo(() => workTypes.map((w) => ({ id: w.value, label: w.label })), [workTypes]);
  const taskMatcher = useMemo(() => (it: ComboItem, q: string) => matchesQuery(`${it.label} ${it.search ?? ""}`, q), []);
  const taskById = (id: string): Task | undefined => tasks.find((t) => t.id === id);

  const fail = (row: string, field: LogField, msg: string) => {
    setProblem({ row, field, msg });
    return false;
  };
  const clearProblem = () => setProblem(null);
  const errText = (e: unknown) => (e instanceof EntryValidationError ? CROSS_DAY_MSG : e instanceof Error ? e.message : String(e));

  const focusCell = (row: string, field: LogField) => {
    const inp = rootRef.current?.querySelector<HTMLInputElement>(`[data-row="${row}"] [data-field="${field}"] input`);
    if (inp) {
      inp.focus();
      inp.select();
      inp.scrollIntoView({ block: "nearest" });
    }
  };
  const focusNum = (row: string) => {
    const td = rootRef.current?.querySelector<HTMLElement>(`[data-row="${row}"] .c-num`);
    td?.focus();
    td?.scrollIntoView({ block: "nearest" });
  };
  const rowKeys = () => [...entries.map((e) => e.id), DRAFT];
  const order = useMemo(() => entries.map((e) => e.id), [entries]);

  /* ---------- 读取/写入某一格 ---------- */
  const fieldValue = (row: string, field: LogField): string => {
    if (row === DRAFT) return draftRef.current[FIELD_TO_DRAFT_KEY[field]];
    const e = entries.find((x) => x.id === row);
    if (!e) return "";
    return { task: e.taskId, type: e.workType ?? "", content: e.content, date: e.date, start: e.start ?? "", end: e.end ?? "" }[field];
  };

  /** 已经规范化的值写入某一格。草稿只改内存，已存的行直接落库。 */
  const setField = async (row: string, field: LogField, value: string): Promise<boolean> => {
    if (row === DRAFT) {
      patchDraft({ [FIELD_TO_DRAFT_KEY[field]]: value });
      return true;
    }
    const patch: Record<string, string | null> = { task: { taskId: value }, type: { workType: value }, content: { content: value }, date: { date: value }, start: { start: value }, end: { end: value } }[field] as never;
    try {
      await useApp.getState().updateEntry(row, patch);
      clearProblem();
      if (field === "date" && (value < weekStart || value > weekEnd)) {
        toast(`已移到 ${value} 所在的那一周`);
        await useApp.getState().setWeek(weekStartFor(value));
      }
      return true;
    } catch (e) {
      return fail(row, field, errText(e));
    }
  };

  /** 用户在格子里敲完（失焦）：写入。日期/时间来自分段输入框，已经是规范格式，空串表示没填完整。 */
  const commitText = async (row: string, field: LogField, raw: string) => {
    if (field === "date") {
      const nd = normDate(raw, yearOf(weekStart));
      if (!nd) return void fail(row, "date", "日期没填完整，或者这一天不存在");
      if (row === DRAFT || nd !== fieldValue(row, "date")) await setField(row, "date", nd);
      else clearProblem();
    } else if (field === "start" || field === "end") {
      if (raw.trim() === "") {
        if (row === DRAFT) await setField(row, field, "");
        else fail(row, field, "时间没填完整");
        return;
      }
      const nt = normTime(raw);
      if (!nt) return void fail(row, field, "时间不对");
      if (row === DRAFT || nt !== fieldValue(row, field)) await setField(row, field, nt);
      else clearProblem();
    } else if (row === DRAFT || raw !== fieldValue(row, field)) {
      await setField(row, field, raw);
    }
  };

  /* ---------- 保存草稿 ---------- */
  const commitDraft = async () => {
    const d = { ...draftRef.current };
    setProblem(null);
    setNotice("");
    const failDraft = (field: LogField, msg: string) => {
      fail(DRAFT, field, msg);
      focusCell(DRAFT, field);
    };
    if (!d.taskId) {
      const typed = rootRef.current?.querySelector<HTMLInputElement>(`[data-row="${DRAFT}"] [data-field="task"] input`)?.value.trim() ?? "";
      if (typed) {
        const hit = pickerTasks.find((t) => matchesQuery(taskSearchText(t), typed));
        if (hit) d.taskId = hit.id;
      }
    }
    if (!d.taskId) return failDraft("task", "先选一个任务：直接打字搜索标题、编号、系统或需求方都行。");
    const nd = normDate(d.date, yearOf(weekStart));
    if (!nd) return failDraft("date", "日期没填完整；Ctrl+; 直接填今天。");
    const ns = normTime(d.start);
    const ne = normTime(d.end);
    if (!ns) return failDraft("start", "开始时间没填完整；Ctrl+; 填现在。");
    if (!ne) return failDraft("end", "结束时间没填完整；Ctrl+; 直接填现在。");
    try {
      await useApp.getState().createEntry({ taskId: d.taskId, date: nd, start: ns, end: ne, workType: d.type || null, content: d.content });
    } catch (e) {
      return failDraft("end", errText(e));
    }
    if (nd < weekStart || nd > weekEnd) await useApp.getState().setWeek(weekStartFor(nd));
    resetDraft({ taskId: "", type: d.type, content: "", date: nd, start: ne === "24:00" ? "" : ne, end: "" });
    toast(`已记录 ${ns}–${ne}`);
    requestAnimationFrame(() => focusCell(DRAFT, "task"));
  };

  /* ---------- 键盘 ---------- */
  const copyFromAbove = (row: string, field: LogField) => {
    const keys = rowKeys();
    const prev = keys[keys.indexOf(row) - 1];
    if (!prev) return toast("上面没有可复制的行");
    const v = fieldValue(prev, field);
    if (!v) return toast("上一行这一格是空的");
    void setField(row, field, v);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const tr = target.closest<HTMLElement>("[data-row]");
    if (!tr) return;
    const row = tr.dataset.row!;
    const isDraft = row === DRAFT;
    const fieldTd = target.closest<HTMLElement>("[data-field]");
    const field = fieldTd?.dataset.field as LogField | undefined;
    const onNum = !fieldTd; // 焦点在行号格上
    const ctrl = e.ctrlKey || e.metaKey;
    const mods = { shift: e.shiftKey, ctrl };

    /* 行的选择：Shift+↑↓ 扩选，Ctrl+A 全选（不在输入框里时），Esc 取消，空格选/取消这一行 */
    if (!isDraft && e.shiftKey && !ctrl && (e.key === "ArrowUp" || e.key === "ArrowDown") && field !== "task" && field !== "type") {
      e.preventDefault();
      const r = extendSelection(order, selection, row, e.key === "ArrowDown" ? 1 : -1);
      setSelection(r.state);
      if (onNum) focusNum(r.cursor);
      else if (field) focusCell(r.cursor, field);
      return;
    }
    if (onNum && ctrl && !e.shiftKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(selectAll(order));
      return;
    }
    if (onNum && e.key === "Escape") {
      setSelection(EMPTY_SELECTION);
      return;
    }
    if (onNum && e.key === " " && !isDraft) {
      e.preventDefault();
      setSelection(clickSelect(order, selection, row, mods));
      return;
    }
    if (onNum && !ctrl && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const keys = rowKeys();
      const sib = keys[keys.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
      if (sib) {
        e.preventDefault();
        focusNum(sib);
      }
      return;
    }
    if (onNum && e.key === "Enter") {
      e.preventDefault();
      focusCell(row, "task");
      return;
    }
    if (!field) return;

    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      return copyFromAbove(row, field);
    }
    // 日期/时间格（分段输入框）自己处理 Ctrl+;，会拦下这个事件；能走到这里的是任务/划分/内容这些文字格：
    // 习惯上 Ctrl+; 填日期、Ctrl+Shift+; 填结束时间
    if (ctrl && (e.code === "Semicolon" || e.key === ";" || e.key === ":")) {
      e.preventDefault();
      if (e.shiftKey) {
        const d = new Date();
        void setField(row, "end", `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
      } else void setField(row, "date", todayStr());
      return;
    }
    if (ctrl && e.key === "Enter") {
      e.preventDefault();
      if (isDraft) void commitDraft();
      else focusCell(DRAFT, "task");
      return;
    }
    if (ctrl || e.altKey) return;
    const keys = rowKeys();
    if (e.key === "Enter") {
      e.preventDefault();
      if (isDraft) {
        if (field === "end") void commitDraft();
        else focusCell(row, LOG_FIELDS[LOG_FIELDS.indexOf(field) + 1]);
      } else {
        focusCell(keys[keys.indexOf(row) + 1] ?? row, field);
      }
      return;
    }
    if (field !== "task" && field !== "type" && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const sib = keys[keys.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
      if (sib) {
        e.preventDefault();
        focusCell(sib, field);
      }
    }
  };

  /* ---------- 粘贴（复制由全局的 Ctrl+C 处理，见 selection/actions） ---------- */
  const onPaste = async (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (!text || (!text.includes("\t") && !text.includes("\n") && !text.trimStart().startsWith("["))) return;
    const parsed = parsePastedText(text);
    if (!parsed.length) return;
    e.preventDefault();
    const inDraft = (e.target as HTMLElement).closest?.("[data-row]")?.getAttribute("data-row") === DRAFT;
    if (parsed.length === 1 && inDraft) {
      const p = parsed[0];
      const t = resolveTask(tasks, p);
      const patch: Partial<Draft> = {};
      if (t) patch.taskId = t.id;
      if (p.type) patch.type = p.type;
      if (p.content) patch.content = p.content;
      patchDraft(patch);
      toast(t ? "已带入任务、划分和内容，时间接着上一条，补个结束时间就行" : "没匹配到任务，请在任务格里搜索选择");
      requestAnimationFrame(() => focusCell(DRAFT, t ? "end" : "task"));
      return;
    }
    const skipped: string[] = [];
    const inputs: EntryInput[] = [];
    for (const [i, p] of parsed.entries()) {
      const t = resolveTask(tasks, p);
      if (!t) {
        skipped.push(`第${i + 1}行没匹配到任务「${p.code || p.title || "空"}」`);
        continue;
      }
      const nd = normDate(p.date, yearOf(weekStart));
      const ns = normTime(p.start);
      const ne = normTime(p.end);
      if (!nd || !ns || !ne) {
        skipped.push(`第${i + 1}行日期/时间缺失或格式不对`);
        continue;
      }
      if (durationHours(ns, ne) <= 0) {
        skipped.push(`第${i + 1}行结束不晚于开始`);
        continue;
      }
      inputs.push({ taskId: t.id, date: nd, start: ns, end: ne, workType: p.type || null, content: p.content });
    }
    const ok = inputs.length;
    const lastDate = inputs.at(-1)?.date;
    if (ok) await useApp.getState().createEntries(inputs);
    if (ok && lastDate && (lastDate < weekStart || lastDate > weekEnd)) await useApp.getState().setWeek(weekStartFor(lastDate));
    setNotice(skipped.length ? `已粘贴 ${ok} 行；跳过：${skipped.join("；")}` : "");
    toast(`已粘贴 ${ok} 行${skipped.length ? `，跳过 ${skipped.length} 行` : ""}${ok ? "，记得核对日期和时间" : ""}`);
  };

  /* ---------- 选行：点行号 / Ctrl / Shift / 拖动 ---------- */
  const onNumMouseDown = (ev: React.MouseEvent<HTMLElement>, id: string) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); // 别让拖动变成选文字
    ev.currentTarget.focus();
    const mods = { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey };
    const first = clickSelect(order, useApp.getState().selection, id, mods);
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
      if (!over || over === DRAFT || (over === id && !moved)) return;
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
  const chosen = useMemo(() => new Set(selection.ids), [selection.ids]);

  const total = entries.reduce((s, e) => s + e.durationHours, 0);
  const cellClass = (row: string, field: LogField) => (problem && problem.row === row && problem.field === field ? "invalid" : undefined);

  const renderRow = (e: TimeEntry | null, label: string | number) => {
    const isDraft = !e;
    const row = e?.id ?? DRAFT;
    const v = {
      task: e ? e.taskId : draft.taskId,
      type: e ? (e.workType ?? "") : draft.type,
      content: e ? e.content : draft.content,
      date: e ? e.date : draft.date,
      start: e ? (e.start ?? "") : draft.start,
      end: e ? (e.end ?? "") : draft.end,
    };
    const dur = e ? e.durationHours : normTime(v.start) && normTime(v.end) ? durationHours(normTime(v.start)!, normTime(v.end)!) : 0;
    const seg = (field: "date" | "start" | "end") => (
      <SegmentedField
        bare
        kind={field === "date" ? "date" : "time"}
        value={v[field]}
        allow24={field === "end"}
        arrows={false}
        picker={field === "date"}
        defaultYear={yearOf(weekStart)}
        ariaLabel={{ date: "日期", start: "开始", end: "结束" }[field]}
        onChange={(val) => isDraft && patchDraft({ [FIELD_TO_DRAFT_KEY[field]]: val })}
        onCommit={(val) => void commitText(row, field, val)}
        onComplete={() => (field === "date" ? focusCell(row, "start") : field === "start" ? focusCell(row, "end") : undefined)}
      />
    );
    return (
      <tr key={row} data-row={row} className={`log-row${isDraft ? " log-draft" : ""}${e && chosen.has(e.id) ? " selected" : ""}`}>
        <td className="c-num" tabIndex={0} title={isDraft ? undefined : "点击选中；Ctrl / Shift 叠加，上下拖动选多行，Ctrl+C 复制"} onMouseDown={e ? (ev) => onNumMouseDown(ev, e.id) : undefined}>
          {label}
        </td>
        <td className={`c-task ${cellClass(row, "task") ?? ""}`} data-field="task">
          <SelectOrCreate
            key={comboTick}
            items={taskItems}
            value={taskById(v.task)?.title ?? ""}
            placeholder={isDraft ? "搜索任务：标题 / 编号 / 系统 / 需求方" : ""}
            className="log-in"
            matcher={taskMatcher}
            allowCreate
            revertOnBlur={!isDraft}
            onSelect={(id, label, created) => {
              if (!created) return void setField(row, "task", id);
              useApp.getState().openTaskForm({
                mode: "create",
                title: label,
                onCreated: (newId) => {
                  void setField(row, "task", newId);
                  requestAnimationFrame(() => focusCell(row, "type"));
                },
                onCancel: () => setComboTick((n) => n + 1),
              });
            }}
          />
          {v.task && (
            <button type="button" className="task-edit" tabIndex={-1} title="编辑这个任务" onClick={() => useApp.getState().openTaskForm({ mode: "edit", id: v.task })}>
              ✎
            </button>
          )}
        </td>
        <td className={`c-type ${cellClass(row, "type") ?? ""}`} data-field="type">
          <SelectOrCreate items={typeItems} value={v.type} placeholder={isDraft ? "工作内容划分" : ""} className="log-in" allowCreate commitOnBlur onSelect={(_id, label) => void setField(row, "type", label)} />
        </td>
        <td className={`c-content ${cellClass(row, "content") ?? ""}`} data-field="content">
          <TextCell value={v.content} placeholder={isDraft ? "具体做了什么" : undefined} alwaysCommit={isDraft} onInput={isDraft ? (t) => patchDraft({ content: t }) : undefined} onCommit={(t) => void commitText(row, "content", t)} />
        </td>
        <td className={`c-date ${cellClass(row, "date") ?? ""}`} data-field="date">
          {seg("date")}
        </td>
        <td className={`c-time ${cellClass(row, "start") ?? ""}`} data-field="start">
          {seg("start")}
        </td>
        <td className={`c-time ${cellClass(row, "end") ?? ""}`} data-field="end">
          {seg("end")}
        </td>
        <td className="c-dur tnum">{dur > 0 ? `${dur.toFixed(2)}h` : ""}</td>
        <td className="c-del">
          {e && (
            <button
              type="button"
              className="log-del"
              title="删除这一行"
              onClick={() => {
                void useApp.getState().removeEntry(e.id);
                toast("已删除这一行");
              }}
            >
              ×
            </button>
          )}
        </td>
      </tr>
    );
  };

  const allChosen = entries.length > 0 && selection.ids.length === entries.length;

  return (
    <div className="log-wrap" ref={rootRef} onKeyDown={onKeyDown} onPaste={(e) => void onPaste(e)}>
      <div className="log-hint">
        <kbd>Tab</kbd> 换格 · 日期/时间直接敲数字，敲满自动跳下一段/下一格 · <kbd>Ctrl</kbd>+<kbd>;</kbd> 填今天/现在（按当前格的类型） · <kbd>Ctrl</kbd>+<kbd>D</kbd> 复制上一行同一格 · <kbd>Ctrl</kbd>+<kbd>Enter</kbd>{" "}
        保存并新开一行 · 点行号选中（<kbd>Ctrl</kbd> 加选、<kbd>Shift</kbd> 选区间、上下拖动框选、<kbd>Shift</kbd>+<kbd>↑↓</kbd> 扩选），<kbd>Ctrl</kbd>+<kbd>C</kbd> 复制，Excel 明细行也能直接粘进来
      </div>
      {tasks.length === 0 && (
        <div className="empty-note">
          还没有任务，流水没法关联。
          {mode === "browser" && (
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                await seedDemo(getRepos());
                useApp.getState().clearHistory();
                await useApp.getState().reloadAll();
                toast("已载入示例数据");
              }}
            >
              载入示例数据
            </button>
          )}
        </div>
      )}
      <table className="log-table">
        <thead>
          <tr>
            <th className="c-num pick-all" title={allChosen ? "取消全选" : "选中这一周的全部记录（Ctrl+A）"} onClick={() => setSelection(allChosen ? EMPTY_SELECTION : selectAll(order))}>
              #
            </th>
            <th className="c-task">任务</th>
            <th className="c-type">工作内容划分</th>
            <th className="c-content">具体内容</th>
            <th className="c-date">日期</th>
            <th className="c-time">开始</th>
            <th className="c-time">结束</th>
            <th className="c-dur">用时</th>
            <th className="c-del" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => renderRow(e, i + 1))}
          {renderRow(null, "＋")}
        </tbody>
      </table>
      <div className="log-msg">{problem?.msg ?? notice}</div>
      <div className="log-foot tnum">
        本周 {entries.length} 条 · 共 {total.toFixed(2)} h
      </div>
      <SelectionBar />
    </div>
  );
}
