import { useShallow } from "zustand/react/shallow";
import { useState } from "react";
import { useApp } from "../../store";
import { hasActiveFilters, type TaskFilters } from "./taskFilters";

function FilterRow() {
  const { panel, dicts } = useApp(useShallow((s) => ({ panel: s.panel, dicts: s.dicts })));
  const setPanel = useApp((s) => s.setPanel);
  const set = (patch: TaskFilters) => setPanel({ filters: { ...panel.filters, ...patch } });
  const sel = (label: string, key: keyof TaskFilters, options: { value: string; label: string }[]) => (
    <label className="filter-item">
      <span>{label}</span>
      <select value={panel.filters[key] ?? ""} onChange={(e) => set({ [key]: e.target.value || undefined })}>
        <option value="">全部</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="filter-row">
      {sel("类型", "kind", [
        { value: "requirement", label: "需求" },
        { value: "routine", label: "非需求" },
      ])}
      {sel("系统", "system", dicts.system)}
      {sel("状态", "status", dicts.status)}
      {sel("划分", "category", dicts.category)}
      {sel(
        "需求方",
        "requester",
        dicts.requesters.map((r) => ({ value: r.name, label: r.name })),
      )}
      {hasActiveFilters(panel.filters) && (
        <button type="button" className="link-btn" onClick={() => setPanel({ filters: {} })}>
          清除筛选
        </button>
      )}
    </div>
  );
}

/** 搜索框 + 筛选：任务面板和进度看板共用同一份条件（store 里的 panel），只是入口不同。 */
export function SearchBar({ className }: { className?: string }) {
  const panel = useApp((s) => s.panel);
  const setPanel = useApp((s) => s.setPanel);
  const [showFilters, setShowFilters] = useState(() => Object.values(panel.filters).some(Boolean));
  const activeCount = Object.values(panel.filters).filter(Boolean).length;
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="search-box">
        <input value={panel.query} onChange={(e) => setPanel({ query: e.target.value })} placeholder="搜索标题 / 编号 / 系统 / 需求方（空格分隔多个词）" />
        {panel.query && (
          <button type="button" className="link-btn" onClick={() => setPanel({ query: "" })} aria-label="清空搜索">
            ×
          </button>
        )}
        <button type="button" className={`filter-toggle${activeCount ? " on" : ""}`} onClick={() => setShowFilters((v) => !v)} title="筛选">
          筛选{activeCount ? ` ${activeCount}` : ""}
        </button>
      </div>
      {showFilters && <FilterRow />}
    </div>
  );
}
