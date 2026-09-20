import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store";
import { COPY_FORMAT_LABEL, type CopyFormat } from "../export/rows";
import { copyEntries, selectedEntries } from "./actions";

/** 选中记录后浮在底部的操作条：复制（两种格式）、删除、取消选择。 */
export function SelectionBar() {
  const { selection, entries, copyFormat } = useApp(useShallow((s) => ({ selection: s.selection, entries: s.entries, copyFormat: s.copyFormat })));
  const [confirming, setConfirming] = useState(false);
  const ids = selection.ids;
  useEffect(() => setConfirming(false), [ids.length]);
  if (!ids.length) return null;

  const chosen = new Set(ids);
  const hours = entries.filter((e) => chosen.has(e.id)).reduce((s, e) => s + e.durationHours, 0);
  const formats: CopyFormat[] = ["excel", "json"];

  return (
    <div className="sel-bar" role="toolbar" aria-label="已选中的记录">
      <span className="sel-count tnum">
        已选 {ids.length} 条 · {hours.toFixed(2)} h
      </span>
      {formats.map((f) => (
        <button key={f} type="button" onClick={() => void copyEntries(selectedEntries(), f)} title={f === copyFormat ? "这也是 Ctrl+C 用的默认格式，可以在设置里改" : undefined}>
          复制为 {COPY_FORMAT_LABEL[f]}
          {f === copyFormat && <em>Ctrl+C</em>}
        </button>
      ))}
      {confirming ? (
        <>
          <button
            type="button"
            className="danger"
            onClick={() => {
              const app = useApp.getState();
              void app.removeEntries(ids).then(() => app.toast(`已删除 ${ids.length} 条记录`));
            }}
          >
            确认删除 {ids.length} 条
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            不删了
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          删除
        </button>
      )}
      <button type="button" className="plain" onClick={() => useApp.getState().clearSelection()} title="Esc">
        取消选择
      </button>
    </div>
  );
}
