import { useCallback, useEffect, useMemo, useState } from "react";
import { DictionaryError } from "../../db/repos";
import { getRepos, useApp } from "../../store";
import type { TaskFilters } from "../tasks/taskFilters";

type DictKey = "system" | "status" | "work_category" | "work_type" | "requester_type" | "requesters";

const DICTS: { key: DictKey; label: string; hint: string; filter?: (name: string) => TaskFilters }[] = [
  { key: "system", label: "系统", hint: "任务属于哪个系统", filter: (v) => ({ system: v }) },
  { key: "status", label: "状态", hint: "“完成态”决定任务算不算做完；已交付不算完成态，只有已上线/已终止这类才算", filter: (v) => ({ status: v }) },
  { key: "work_category", label: "例行工作内容划分", hint: "执行类 / 辅助类", filter: (v) => ({ category: v }) },
  { key: "work_type", label: "工作内容划分", hint: "时间记录的分类：需求对接、功能开发……（计数是时间记录数）" },
  { key: "requester_type", label: "需求方类型", hint: "业务方、内部协作……（计数是需求方数）" },
  { key: "requesters", label: "需求方", hint: "人员/团队；类型可以改，重名请先把任务里的需求方批量换成同一个再删除", filter: (v) => ({ requester: v }) },
];

interface Row {
  id: string;
  name: string;
  usage: number;
  isDone?: boolean;
  type?: string | null;
}

type Sort = "usage" | "name" | "order";

export function DictionaryView() {
  const [dict, setDict] = useState<DictKey>("system");
  const [rows, setRows] = useState<Row[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("usage");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const app = useApp.getState();

  const def = DICTS.find((d) => d.key === dict)!;

  const load = useCallback(async () => {
    const repos = getRepos();
    if (dict === "requesters") {
      const [list, typeList] = await Promise.all([repos.requesters.listWithUsage(), repos.options.list("requester_type")]);
      setRows(list.map((r) => ({ id: r.id, name: r.name, usage: r.usage, type: r.type })));
      setTypes(typeList.map((t) => t.value));
    } else {
      const list = await repos.options.listWithUsage(dict);
      setRows(list.map((o) => ({ id: o.id, name: o.value, usage: o.usage, isDone: o.isDone })));
    }
  }, [dict]);

  // 数据在每次显示/切换字典时重新取（引用数可能在别的板块里变了），但筛选条件不动
  useEffect(() => {
    void load();
  }, [load]);
  const switchDict = (key: DictKey) => {
    if (key === dict) return;
    setDict(key);
    setQuery("");
    setUnusedOnly(false);
    setEditing(null);
    setError("");
  };

  /** 改完字典后，任务面板/表单/流水里用到的缓存也要一起刷新 */
  const mutate = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      await Promise.all([load(), app.reloadAll()]);
    } catch (e) {
      setError(e instanceof DictionaryError || e instanceof Error ? e.message : String(e));
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!unusedOnly || r.usage === 0));
    if (sort === "usage") return [...list].sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name, "zh"));
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name, "zh"));
    return list;
  }, [rows, query, unusedOnly, sort]);

  const commitRename = async () => {
    if (!editing) return;
    const cur = rows.find((r) => r.id === editing.id);
    setEditing(null);
    if (!cur || editing.text.trim() === cur.name) return;
    await mutate(() => (dict === "requesters" ? getRepos().requesters.rename(editing.id, editing.text) : getRepos().options.rename(editing.id, editing.text)));
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    await mutate(() => (dict === "requesters" ? getRepos().requesters.ensure(name) : getRepos().options.ensure(dict, name)));
  };

  const unusedCount = rows.filter((r) => r.usage === 0).length;

  return (
    <div className="dict-wrap">
      <nav className="dict-nav">
        {DICTS.map((d) => (
          <button key={d.key} type="button" className={dict === d.key ? "active" : ""} onClick={() => switchDict(d.key)}>
            {d.label}
          </button>
        ))}
      </nav>
      <section className="dict-main">
        <header>
          <h2>
            {def.label} <span className="cnt tnum">{rows.length} 项 · {unusedCount} 项未被引用</span>
          </h2>
          <p>{def.hint}</p>
        </header>
        <div className="dict-tools">
          <input className="text-in" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="筛选名称…" />
          <label className="checkbox-row">
            <input type="checkbox" checked={unusedOnly} onChange={(e) => setUnusedOnly(e.target.checked)} />
            只看未引用
          </label>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="dict-sort">
            <option value="usage">按引用数</option>
            <option value="name">按名称</option>
            <option value="order">默认顺序</option>
          </select>
          <div className="dict-add">
            <input className="text-in" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} placeholder={`新增${def.label}…`} />
            <button type="button" className="btn-ghost" onClick={() => void add()}>
              添加
            </button>
          </div>
        </div>
        {error && <div className="field-hint">{error}</div>}
        <table className="dict-table">
          <thead>
            <tr>
              <th>名称</th>
              {dict === "status" && <th className="c-flag">完成态</th>}
              {dict === "requesters" && <th className="c-type">类型</th>}
              <th className="c-num">引用</th>
              <th className="c-act" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  {editing?.id === r.id ? (
                    <input
                      className="text-in"
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                      onBlur={() => void commitRename()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <button type="button" className="dict-name" title="点击重命名" onClick={() => setEditing({ id: r.id, text: r.name })}>
                      {r.name}
                    </button>
                  )}
                </td>
                {dict === "status" && (
                  <td className="c-flag">
                    <input type="checkbox" checked={!!r.isDone} onChange={(e) => void mutate(() => getRepos().options.setDone(r.id, e.target.checked))} />
                  </td>
                )}
                {dict === "requesters" && (
                  <td className="c-type">
                    <select value={r.type ?? ""} onChange={(e) => void mutate(() => getRepos().requesters.setType(r.id, e.target.value || null))}>
                      {!r.type && <option value="">（未设置）</option>}
                      {types.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="c-num tnum">{r.usage}</td>
                <td className="c-act">
                  {def.filter && r.usage > 0 && (
                    <button type="button" className="link-btn" onClick={() => app.showTasks(def.filter!(r.name))}>
                      查看任务
                    </button>
                  )}
                  <button
                    type="button"
                    className="link-btn danger"
                    disabled={r.usage > 0}
                    title={r.usage > 0 ? "还有记录在引用，不能删" : "删除"}
                    onClick={() => void mutate(() => (dict === "requesters" ? getRepos().requesters.removeIfUnused(r.id) : getRepos().options.removeIfUnused(r.id)))}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="panel-empty">没有符合的项</div>}
      </section>
    </div>
  );
}
