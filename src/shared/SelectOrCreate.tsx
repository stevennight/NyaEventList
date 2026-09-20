import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboItem {
  id: string;
  label: string;
  sub?: string;
  /** 只参与搜索、不显示的文字 */
  search?: string;
}

interface Props {
  items: ComboItem[];
  /** 当前已选项的显示文字 */
  value: string;
  placeholder?: string;
  className?: string;
  /** 允许输入不存在的内容并新建；新建时 id 与 label 都是输入的文字 */
  allowCreate?: boolean;
  /** 失焦后把没选中的输入还原成 value（草稿行不还原，保留输入好让 Ctrl+Enter 去匹配） */
  revertOnBlur?: boolean;
  /** 选中后清空输入框（多选 chips 场景：选一个加一个） */
  clearOnSelect?: boolean;
  /** 失焦时把敲了但没选的文字当作选择：有同名项就选它，没有且允许新建就新建（表单里防止敲完直接保存丢内容） */
  commitOnBlur?: boolean;
  autoFocus?: boolean;
  matcher?: (item: ComboItem, query: string) => boolean;
  onSelect(id: string, label: string, created: boolean): void;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement> & { "data-cell"?: string };
}

const MAX_ROWS = 30;

/** 键盘优先的“选择或新建”：↑↓ 选，Enter 确认，Tab 直接接受高亮/首个匹配。 */
export function SelectOrCreate({ items, value, placeholder, className, allowCreate, revertOnBlur, clearOnSelect, commitOnBlur, autoFocus, matcher, onSelect, inputProps }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickedRef = useRef(false); // 刚通过键盘/鼠标选过一项：紧随其后的失焦不再重复提交敲的文字
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setText(value), [value]);
  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const typing = text !== value && text.trim() !== "";
  const rows = useMemo(() => {
    if (!open) return []; // 表格里有几十个下拉框，收起时别去过滤上千个选项
    const q = text.trim();
    const match = matcher ?? ((it: ComboItem, query: string) => `${it.label} ${it.search ?? ""}`.toLowerCase().includes(query.toLowerCase()));
    const list = typing ? items.filter((it) => match(it, q)) : items;
    const out: { item?: ComboItem; create?: string }[] = list.slice(0, MAX_ROWS).map((item) => ({ item }));
    const exact = items.some((it) => it.label.toLowerCase() === q.toLowerCase());
    if (allowCreate && q && !exact) out.push({ create: q });
    return out;
  }, [open, items, text, typing, matcher, allowCreate]);

  const pick = (i: number): boolean => {
    const r = rows[i];
    if (!r) return false;
    const id = r.create ?? r.item!.id;
    const label = r.create ?? r.item!.label;
    pickedRef.current = true;
    setText(clearOnSelect ? "" : label);
    setActive(-1);
    setOpen(false);
    onSelect(id, label, Boolean(r.create));
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    inputProps?.onKeyDown?.(e);
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (open && rows.length && (active >= 0 || typing)) {
        e.preventDefault();
        e.stopPropagation();
        pick(active >= 0 ? active : 0);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Tab") {
      if (open && typing && rows.length) pick(active >= 0 ? active : 0);
      setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="combo">
      <input
        {...inputProps}
        ref={inputRef}
        autoFocus={autoFocus}
        type="text"
        className={`combo-input ${className ?? ""}`}
        placeholder={placeholder ?? "搜索或新建…"}
        value={text}
        onFocus={() => {
          setActive(-1);
          setOpen(true);
        }}
        onChange={(e) => {
          pickedRef.current = false;
          setText(e.target.value);
          setActive(e.target.value.trim() ? 0 : -1);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // 输入内容的提交要立刻做（点“保存”的 click 紧跟在 blur 之后），只有菜单的收起才延迟
          const q = text.trim();
          if (pickedRef.current) {
            pickedRef.current = false;
          } else if (commitOnBlur && typing) {
            const hit = items.find((it) => it.label.toLowerCase() === q.toLowerCase());
            if (hit) {
              setText(clearOnSelect ? "" : hit.label);
              onSelect(hit.id, hit.label, false);
            } else if (allowCreate) {
              setText(clearOnSelect ? "" : q);
              onSelect(q, q, true);
            } else setText(value);
          } else if (revertOnBlur || commitOnBlur) setText(value);
          clearTimeout(blurTimer.current);
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
      />
      {open && (
        <div className="combo-menu" onMouseDown={(e) => e.preventDefault()}>
          {rows.length === 0 && <div className="combo-empty">没有匹配项{allowCreate ? "，输入内容即可新建" : ""}</div>}
          {rows.map((r, i) =>
            r.create ? (
              <div key="create" className={`combo-option combo-create${i === active ? " active" : ""}`} onMouseDown={() => pick(i)}>
                + 新建 “{r.create}”
              </div>
            ) : (
              <div key={r.item!.id} ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined} className={`combo-option${i === active ? " active" : ""}`} onMouseDown={() => pick(i)}>
                <span>{r.item!.label}</span>
                {r.item!.sub && <span className="sub">{r.item!.sub}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
