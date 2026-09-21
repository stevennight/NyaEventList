import type { OptionRow, RequesterRow, Snapshot, TagRow, TaskSnap } from "../../db/snapshots";

/** 把“改之前/改之后”两份快照的差别，翻成人话：改了什么、从什么改成什么。撤销后的提示就用它。 */

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}
export type ChangeKind = "任务" | "时间记录" | "字典项" | "需求方";
export interface Change {
  kind: ChangeKind;
  op: "新建" | "删除" | "修改";
  name: string;
  fields: FieldChange[];
}

export interface DescribeContext {
  /** 时间记录所属任务的标题（快照里没有任务行时用它查） */
  taskTitle(taskId: string): string | undefined;
}

const LIST_LABEL: Record<string, string> = {
  "list:system": "系统",
  "list:work_category": "例行工作内容划分",
  "list:status": "状态",
  "list:work_type": "工作内容划分",
  "list:requester_type": "需求方类型",
};
const NOUN: Record<ChangeKind, string> = { 任务: "个任务", 时间记录: "条时间记录", 字典项: "个字典项", 需求方: "个需求方" };

const clip = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n)}…` : s);
const show = (v: unknown): string => (v == null || v === "" ? "（空）" : clip(String(v)));

function lookups(...snaps: Snapshot[]) {
  const options = new Map<string, OptionRow>();
  const requesters = new Map<string, RequesterRow>();
  const tags = new Map<string, TagRow>();
  for (const s of snaps) {
    for (const o of [...s.support.options, ...s.options]) options.set(o.id, o);
    for (const r of [...s.support.requesters, ...s.requesters]) requesters.set(r.id, r);
    for (const t of s.support.tags) tags.set(t.id, t);
  }
  return { options, requesters, tags };
}

function diffTask(a: TaskSnap, b: TaskSnap, L: ReturnType<typeof lookups>): FieldChange[] {
  const opt = (id: string | null) => (id ? (L.options.get(id)?.label ?? "（已删除的项）") : "");
  const out: FieldChange[] = [];
  const add = (label: string, from: unknown, to: unknown) => {
    if (String(from ?? "") !== String(to ?? "")) out.push({ label, from: show(from), to: show(to) });
  };
  const A = a.row;
  const B = b.row;
  add("标题", A.title, B.title);
  add("内容", A.description, B.description);
  add("类型", A.task_kind === "requirement" ? "需求" : "非需求", B.task_kind === "requirement" ? "需求" : "非需求");
  add("系统", opt(A.system_option_id), opt(B.system_option_id));
  add("状态", opt(A.status_option_id), opt(B.status_option_id));
  add("例行工作内容划分", opt(A.category_option_id), opt(B.category_option_id));
  add("期望完成时间", A.target_date, B.target_date);
  add("置顶", A.is_pinned ? "是" : "否", B.is_pinned ? "是" : "否");
  add("预计人天", A.estimated_days, B.estimated_days);
  add("需求方", a.requesters.map((id) => L.requesters.get(id)?.name ?? "?").join("、"), b.requesters.map((id) => L.requesters.get(id)?.name ?? "?").join("、"));
  add("标签", a.tags.map((id) => L.tags.get(id)?.name ?? "?").join("、"), b.tags.map((id) => L.tags.get(id)?.name ?? "?").join("、"));
  return out;
}

/** 收集这一步改动涉及的所有变化。before/after 的 id 集合是一样的（不存在的记在 missing 里）。 */
export function collectChanges(before: Snapshot, after: Snapshot, ctx: DescribeContext): Change[] {
  const L = lookups(before, after);
  const changes: Change[] = [];
  const opName = (id: string | null) => (id ? (L.options.get(id)?.label ?? "（已删除的项）") : "");

  // 任务
  const bTask = new Map(before.tasks.map((t) => [t.row.id, t]));
  const aTask = new Map(after.tasks.map((t) => [t.row.id, t]));
  for (const id of new Set([...bTask.keys(), ...aTask.keys()])) {
    const b = bTask.get(id);
    const a = aTask.get(id);
    if (b && a) {
      const fields = diffTask(b, a, L);
      if (fields.length) changes.push({ kind: "任务", op: "修改", name: `「${clip(a.row.title)}」`, fields });
    } else if (a) changes.push({ kind: "任务", op: "新建", name: `「${clip(a.row.title)}」`, fields: [] });
    else if (b) changes.push({ kind: "任务", op: "删除", name: `「${clip(b.row.title)}」`, fields: [] });
  }

  // 时间记录
  const bEntry = new Map(before.entries.map((e) => [e.id, e]));
  const aEntry = new Map(after.entries.map((e) => [e.id, e]));
  const title = (taskId: string) => ctx.taskTitle(taskId) ?? aTask.get(taskId)?.row.title ?? bTask.get(taskId)?.row.title ?? "（未知任务）";
  const when = (e: { entry_date: string; start_time: string | null; end_time: string | null }) => `${e.entry_date} ${e.start_time ?? ""}–${e.end_time ?? "进行中"}`;
  for (const id of new Set([...bEntry.keys(), ...aEntry.keys()])) {
    const b = bEntry.get(id);
    const a = aEntry.get(id);
    if (b && a) {
      const fields: FieldChange[] = [];
      const add = (label: string, from: unknown, to: unknown) => {
        if (String(from ?? "") !== String(to ?? "")) fields.push({ label, from: show(from), to: show(to) });
      };
      add("任务", title(b.task_id), title(a.task_id));
      add("日期", b.entry_date, a.entry_date);
      add("开始", b.start_time, a.start_time);
      add("结束", b.end_time ?? "进行中", a.end_time ?? "进行中");
      add("工作内容划分", opName(b.work_type_option_id), opName(a.work_type_option_id));
      add("内容", b.content, a.content);
      if (fields.length) changes.push({ kind: "时间记录", op: "修改", name: `「${clip(title(a.task_id))}」${when(a)}`, fields });
    } else if (a) changes.push({ kind: "时间记录", op: "新建", name: `「${clip(title(a.task_id))}」${when(a)}`, fields: [] });
    else if (b) changes.push({ kind: "时间记录", op: "删除", name: `「${clip(title(b.task_id))}」${when(b)}`, fields: [] });
  }

  // 字典项
  const bOpt = new Map(before.options.map((o) => [o.id, o]));
  const aOpt = new Map(after.options.map((o) => [o.id, o]));
  const listOf = (o: OptionRow) => LIST_LABEL[o.list_id] ?? "字典";
  for (const id of new Set([...bOpt.keys(), ...aOpt.keys()])) {
    const b = bOpt.get(id);
    const a = aOpt.get(id);
    if (b && a) {
      const fields: FieldChange[] = [];
      if (b.label !== a.label) fields.push({ label: "名称", from: show(b.label), to: show(a.label) });
      if (b.is_done !== a.is_done) fields.push({ label: "完成态", from: b.is_done ? "是" : "否", to: a.is_done ? "是" : "否" });
      if (fields.length) changes.push({ kind: "字典项", op: "修改", name: `「${listOf(a)}」的「${clip(b.label)}」`, fields });
    } else if (a) changes.push({ kind: "字典项", op: "新建", name: `「${listOf(a)}」的「${clip(a.label)}」`, fields: [] });
    else if (b) changes.push({ kind: "字典项", op: "删除", name: `「${listOf(b)}」的「${clip(b.label)}」`, fields: [] });
  }

  // 需求方
  const bReq = new Map(before.requesters.map((r) => [r.id, r]));
  const aReq = new Map(after.requesters.map((r) => [r.id, r]));
  for (const id of new Set([...bReq.keys(), ...aReq.keys()])) {
    const b = bReq.get(id);
    const a = aReq.get(id);
    if (b && a) {
      const fields: FieldChange[] = [];
      if (b.name !== a.name) fields.push({ label: "名称", from: show(b.name), to: show(a.name) });
      if (b.requester_type_option_id !== a.requester_type_option_id) fields.push({ label: "类型", from: show(opName(b.requester_type_option_id)), to: show(opName(a.requester_type_option_id)) });
      if (fields.length) changes.push({ kind: "需求方", op: "修改", name: `「${clip(b.name)}」`, fields });
    } else if (a) changes.push({ kind: "需求方", op: "新建", name: `「${clip(a.name)}」`, fields: [] });
    else if (b) changes.push({ kind: "需求方", op: "删除", name: `「${clip(b.name)}」`, fields: [] });
  }
  return changes;
}

type Direction = "do" | "undo" | "redo";

/** 一组同类改动（比如批量改了 1200 个任务的系统）合成一句 */
function summarizeGroup(kind: ChangeKind, op: Change["op"], items: Change[], dir: Direction): string {
  if (items.length === 1) {
    const c = items[0];
    if (!c.fields.length) return `${op}${kind}${c.name}`;
    const detail = c.fields.map((f) => (dir === "undo" ? `${f.label} ${f.to} → ${f.from}` : `${f.label} ${f.from} → ${f.to}`)).join("；");
    return `${op}${kind}${c.name}（${detail}）`;
  }
  const labels = [...new Set(items.flatMap((c) => c.fields.map((f) => f.label)))];
  let tail = labels.length ? `的${labels.join("、")}` : "";
  if (labels.length === 1 && dir !== "undo") {
    const to = new Set(items.map((c) => c.fields[0]?.to));
    if (to.size === 1) tail += ` → ${[...to][0]}`;
  } else if (labels.length && dir === "undo") tail += "（已恢复各自原来的值）";
  return `${op} ${items.length} ${NOUN[kind]}${tail}`;
}

/** 变化列表 → 一句话。dir: do 是刚做完这一步，undo/redo 用于提示。 */
export function summarize(changes: Change[], dir: Direction = "do"): string {
  const groups = new Map<string, Change[]>();
  for (const c of changes) {
    const key = `${c.kind}|${c.op}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const parts = [...groups.entries()].slice(0, 3).map(([key, items]) => {
    const [kind, op] = key.split("|") as [ChangeKind, Change["op"]];
    return summarizeGroup(kind, op, items, dir);
  });
  if (groups.size > 3) parts.push(`等 ${groups.size} 类改动`);
  return parts.join("；");
}

export interface Described {
  /** 这一步原本做了什么（撤销按钮的提示用） */
  label: string;
  undoMessage: string;
  redoMessage: string;
  changes: Change[];
}

/** 没有任何实际变化返回 null（这一步不必进撤销栈） */
export function describeStep(before: Snapshot, after: Snapshot, ctx: DescribeContext): Described | null {
  const changes = collectChanges(before, after, ctx);
  if (!changes.length) return null;
  return {
    label: summarize(changes, "do"),
    undoMessage: `已撤销：${summarize(changes, "undo")}`,
    redoMessage: `已重做：${summarize(changes, "redo")}`,
    changes,
  };
}
