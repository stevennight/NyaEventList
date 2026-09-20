import { useMemo, useState } from "react";
import type { BulkOptionField, RequesterBulkMode } from "../../db/repos";
import { RequesterPicker } from "../../shared/RequesterPicker";
import { SelectOrCreate, type ComboItem } from "../../shared/SelectOrCreate";
import { useApp } from "../../store";

type Field = BulkOptionField | "requesters";
const FIELDS: { key: Field; label: string }[] = [
  { key: "system", label: "系统" },
  { key: "status", label: "状态" },
  { key: "category", label: "例行工作内容划分" },
  { key: "requesters", label: "需求方" },
];
const MODES: { key: RequesterBulkMode["mode"]; label: string }[] = [
  { key: "add", label: "追加" },
  { key: "replace", label: "整体替换" },
  { key: "swap", label: "换掉其中一个" },
];

/** 多选之后的批量修改。只开放可以批量改的字段：标题、内容这类每个任务本来就该不同的不在里面。 */
export function BulkBar({ ids }: { ids: string[] }) {
  const dicts = useApp((s) => s.dicts);
  const [field, setField] = useState<Field>("system");
  const [value, setValue] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [mode, setMode] = useState<RequesterBulkMode["mode"]>("add");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const items = useMemo<ComboItem[]>(() => {
    const list = field === "requesters" ? [] : dicts[field];
    return list.map((o) => ({ id: o.value, label: o.label }));
  }, [dicts, field]);
  const fromItems = useMemo<ComboItem[]>(() => dicts.requesters.map((r) => ({ id: r.name, label: r.name, sub: r.type ?? undefined })), [dicts.requesters]);
  const label = FIELDS.find((f) => f.key === field)!.label;

  const apply = async () => {
    setError("");
    const app = useApp.getState();
    try {
      setBusy(true);
      if (field === "requesters") {
        if (!names.length) return setError("先填要设置的需求方");
        if (mode === "swap" && !from) return setError("选一下要被换掉的需求方");
        await app.bulkRequesters(ids, mode === "swap" ? { mode, from } : { mode }, names);
        app.toast(`已修改 ${ids.length} 个任务的需求方`);
        setNames([]);
      } else {
        if (!value.trim()) return setError(`先选或填新的${label}`);
        await app.bulkSetOption(ids, field, value.trim());
        app.toast(`已把 ${ids.length} 个任务的${label}改为「${value.trim()}」`);
        setValue("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-bar">
      <div className="bulk-row">
        <span>把选中的 {ids.length} 个任务的</span>
        <select
          value={field}
          onChange={(e) => {
            setField(e.target.value as Field);
            setValue("");
            setError("");
          }}
        >
          {FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {field === "requesters" ? (
        <>
          <div className="seg">
            {MODES.map((m) => (
              <button key={m.key} type="button" className={mode === m.key ? "active" : ""} onClick={() => setMode(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          {mode === "swap" && (
            <div className="bulk-row">
              <span>把</span>
              <div style={{ flex: 1 }}>
                <SelectOrCreate key={`from-${from}`} items={fromItems} value={from} revertOnBlur placeholder="被换掉的需求方" onSelect={(id) => setFrom(id)} />
              </div>
              <span>换成</span>
            </div>
          )}
          <RequesterPicker value={mode === "swap" ? names.slice(0, 1) : names} onChange={(n) => setNames(mode === "swap" ? n.slice(-1) : n)} placeholder={mode === "swap" ? "换成谁（一个）" : undefined} />
        </>
      ) : (
        <SelectOrCreate key={field} items={items} value={value} allowCreate commitOnBlur placeholder={`选择或新建${label}`} onSelect={(_id, l) => setValue(l)} />
      )}
      {error && <div className="field-hint">{error}</div>}
      <button type="button" className="btn-primary" disabled={busy || ids.length === 0} onClick={() => void apply()}>
        应用到 {ids.length} 个任务
      </button>
    </div>
  );
}
