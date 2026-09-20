import { useMemo } from "react";
import { useApp } from "../store";
import { SelectOrCreate, type ComboItem } from "./SelectOrCreate";

/** 多个需求方：已选的显示成小标签，下面的输入框搜索已有的或直接输入新名字。 */
export function RequesterPicker({ value, onChange, placeholder }: { value: string[]; onChange(next: string[]): void; placeholder?: string }) {
  const requesters = useApp((s) => s.dicts.requesters);
  const items = useMemo<ComboItem[]>(() => requesters.filter((r) => !value.includes(r.name)).map((r) => ({ id: r.name, label: r.name, sub: r.type ?? undefined })), [requesters, value]);
  return (
    <>
      {value.length > 0 && (
        <div className="chips">
          {value.map((r) => (
            <span key={r} className="tag-pill">
              {r}
              <button type="button" aria-label={`移除 ${r}`} onClick={() => onChange(value.filter((x) => x !== r))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <SelectOrCreate items={items} value="" allowCreate commitOnBlur clearOnSelect placeholder={placeholder ?? "搜索已有的，或输入新的名字"} onSelect={(_id, label) => onChange(value.includes(label) ? value : [...value, label])} />
    </>
  );
}
