import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "../../db/models";
import { useApp } from "../../store";
import { BulkBar } from "./BulkBar";
import { SearchBar } from "./SearchBar";
import { EMPTY_PANEL, flattenResult, isBacklog, queryTasks, tabCounts, type PanelTab } from "./taskFilters";

const PAGE = 120; // 一次最多画这么多张卡片，剩下的点“显示更多”
const TABS: { key: PanelTab; label: string }[] = [
  { key: "open", label: "未完成" },
  { key: "backlog", label: "待安排" },
  { key: "done", label: "已完成" },
  { key: "all", label: "全部" },
];

export const KindBadge = ({ kind }: { kind: Task["kind"] }) =>
  kind === "requirement" ? (
    <span className="kind-badge kind-requirement" title="需求">
      需
    </span>
  ) : (
    <span className="kind-badge kind-routine" title="非需求 / 例行事务">
      例
    </span>
  );

const TaskCard = memo(function TaskCard({ task, selectMode, checked, onToggle }: { task: Task; selectMode: boolean; checked: boolean; onToggle(id: string): void }) {
  const backlog = isBacklog(task);
  return (
    <div
      className={`task-card${checked ? " selected" : ""}`}
      draggable={!selectMode}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => (selectMode ? onToggle(task.id) : useApp.getState().openTaskForm({ mode: "edit", id: task.id }))}
    >
      <div className="task-card-top">
        {selectMode && <input type="checkbox" className="task-check" checked={checked} onChange={() => onToggle(task.id)} onClick={(e) => e.stopPropagation()} />}
        <KindBadge kind={task.kind} />
        <div className="task-title" style={{ flex: 1 }}>
          {task.title}
        </div>
        <div className="ref-badge tnum" title="被引用的时间记录数">
          ×{task.entryCount}
        </div>
      </div>
      <div className="task-meta">
        {task.system && <span className="chip">{task.system}</span>}
        {task.status && <span className={`chip ${task.statusDone ? "status-done" : "status-progress"}`}>{task.status}</span>}
        {backlog && !task.statusDone && <span className="chip status-backlog">待安排</span>}
        {task.tags.map((t) => (
          <span key={t} className="tag-dot">
            #{t}
          </span>
        ))}
      </div>
      <div className="task-foot">
        <span>{task.requesters.length ? task.requesters.join("、") : "—"}</span>
        <span className="hrs tnum">
          {task.totalHours.toFixed(1)}h · {task.lastEntryDate ? task.lastEntryDate.slice(5) : "暂无记录"}
        </span>
      </div>
    </div>
  );
});

export function TaskPanel() {
  const tasks = useApp((s) => s.tasks);
  const panel = useApp((s) => s.panel);
  const setPanel = useApp((s) => s.setPanel);
  const [shown, setShown] = useState(PAGE);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 敲字时输入框先响应，列表稍后再跟上，几千个任务也不卡手
  const deferredPanel = useDeferredValue(panel);
  const result = useMemo(() => queryTasks(tasks, deferredPanel), [tasks, deferredPanel]);
  const counts = useMemo(() => tabCounts(tasks), [tasks]);
  const pinned = useMemo(() => tasks.filter((t) => t.pinned), [tasks]);
  const lastPanel = useRef(panel);
  useEffect(() => {
    if (lastPanel.current === panel) return; // 只有搜索/筛选真的变了才收回“显示更多”
    lastPanel.current = panel;
    setShown(PAGE);
  }, [panel]);

  const flat = flattenResult(result);
  // 任务被删/改没了以后，选中集合里可能有已经不在的 id
  const selectedIds = useMemo(() => tasks.filter((t) => selected.has(t.id)).map((t) => t.id), [tasks, selected]);
  const toggle = useCallback(
    (id: string) =>
      setSelected((cur) => {
        const next = new Set(cur);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const visible = flat.slice(0, shown);
  const searching = result.mode === "search";
  const firstDoneIndex = result.mode === "search" ? result.open.length : -1;

  return (
    <aside className="panel">
      <div className="panel-search">
        <SearchBar />
        {pinned.length > 0 && (
          <div className="pinned-row" title="常用任务：拖到日历上，或点一下编辑">
            {pinned.map((t) => (
              <button
                key={t.id}
                type="button"
                className="pin-chip"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/task-id", t.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => useApp.getState().openTaskForm({ mode: "edit", id: t.id })}
              >
                📌 {t.title.replace("【固定】", "")}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="panel-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`panel-tab${!searching && panel.tab === t.key ? " active" : ""}`} onClick={() => setPanel({ tab: t.key, query: "", filters: {} })}>
            {t.label}
            <span className="cnt">{counts[t.key]}</span>
          </button>
        ))}
        <button type="button" className={`panel-tab sel${selectMode ? " active" : ""}`} title="多选，批量修改" onClick={() => setSelectMode((v) => !v)}>
          多选
        </button>
        <button type="button" className="panel-tab add" title="新建任务" onClick={() => useApp.getState().openTaskForm({ mode: "create" })}>
          ＋
        </button>
      </div>
      {searching && (
        <div className="panel-note">
          搜索的是全部任务，{flat.length} 条命中
          <button type="button" className="link-btn" onClick={() => setPanel(EMPTY_PANEL)}>
            退出搜索
          </button>
        </div>
      )}
      {selectMode && (
        <div className="panel-note">
          <span>
            已选 {selectedIds.length} 条 · 当前列表共 {flat.length} 条
          </span>
          <span>
            <button type="button" className="link-btn" onClick={() => setSelected(new Set(flat.map((t) => t.id)))}>
              选中全部 {flat.length} 条
            </button>
            <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
              清空
            </button>
          </span>
        </div>
      )}
      <div className="panel-list">
        {visible.map((t, i) => (
          <div key={t.id} style={{ display: "contents" }}>
            {i === firstDoneIndex && <div className="list-divider">已完成</div>}
            <TaskCard task={t} selectMode={selectMode} checked={selected.has(t.id)} onToggle={toggle} />
          </div>
        ))}
        {flat.length === 0 && <div className="panel-empty">{searching ? "没有匹配的任务" : "这里空空如也"}</div>}
        {flat.length > shown && (
          <button type="button" className="btn-ghost" onClick={() => setShown((n) => n + PAGE)}>
            显示更多（还有 {flat.length - shown} 条）
          </button>
        )}
      </div>
      {selectMode && selectedIds.length > 0 && <BulkBar ids={selectedIds} />}
    </aside>
  );
}
