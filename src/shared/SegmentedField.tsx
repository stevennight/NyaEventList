import { useEffect, useMemo, useRef, useState } from "react";
import { nowParts, partsFromPaste, partsFromValue, specsOf, stepPart, tidyParts, typeDigit, valueFromParts, type FieldKind } from "../lib/segments";
import { CalendarPopover, TimePopover } from "./DateTimeFields";

export interface SegmentedFieldProps {
  kind: FieldKind;
  /** 规范值：`2026-09-16` / `09:30` / `2026-09-16 09:30`；没有值就是空串 */
  value: string;
  /** 每次改动都会调用：填完整且合法就是规范值，否则是空串 */
  onChange(value: string): void;
  /** 整个输入框失去焦点时调用（此时没敲完的段已经补整齐） */
  onCommit?(value: string): void;
  /** 最后一段靠敲数字填完了（用来自动跳到下一个格子） */
  onComplete?(): void;
  /** 允许 24:00（结束时间用） */
  allow24?: boolean;
  /** 上下方向键调整当前这一段。流水表里上下键用来换行，所以那里关掉。 */
  arrows?: boolean;
  /** 流水表里的无边框样式 */
  bare?: boolean;
  /** 旁边显示月历（日期）/ 时间列表按钮 */
  picker?: boolean;
  extra?: React.ReactNode;
  autoFocus?: boolean;
  defaultYear?: number;
  ariaLabel?: string;
}

const SEPARATORS = new Set(["-", "/", ".", ":", "：", " ", "，", ",", "。", "、"]);

/**
 * 中文输入法开着时，keydown 的 key 可能是 "Process"/"Unidentified"，这时按物理键位（code）还原出按的是哪个键。
 */
function realKey(e: React.KeyboardEvent): string {
  if (e.key !== "Process" && e.key !== "Unidentified") return e.key;
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (m) return m[1];
  if (e.code === "Minus" || e.code === "NumpadSubtract") return "-";
  if (e.code === "Slash" || e.code === "NumpadDivide") return "/";
  if (e.code === "Period" || e.code === "NumpadDecimal") return ".";
  if (e.code === "Space") return " ";
  return e.key;
}

/**
 * 固定格式的日期/时间输入（像系统自带的日期框，但键盘更顺手）：
 * 年 4 位、月日时分各 2 位，分隔符删不掉；点哪一段就改哪一段；敲完一段自动跳下一段；
 * Backspace 清当前段（空了再按回到上一段）；上下键加减；Ctrl+; 填成现在。
 */
export function SegmentedField(props: SegmentedFieldProps) {
  const { kind, value, onChange, onCommit, onComplete, allow24 = false, arrows = true, bare, picker, extra, autoFocus, defaultYear, ariaLabel } = props;
  const specs = useMemo(() => specsOf(kind, allow24), [kind, allow24]);
  const last = specs.length - 1;
  const [parts, setPartsState] = useState<string[]>(() => partsFromValue(value, kind, allow24));
  const partsRef = useRef(parts);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const fresh = useRef(true); // 刚选中这一段：敲的数字替换整段
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);

  const setParts = (next: string[]) => {
    partsRef.current = next;
    setPartsState(next);
  };
  const emit = (next: string[]) => {
    setParts(next);
    onChange(valueFromParts(next, kind, allow24));
  };

  // 外面改了值（Ctrl+D、选月历、换一行……）就跟着变；自己敲出来的中间状态不动
  useEffect(() => {
    if (valueFromParts(partsRef.current, kind, allow24) !== value) setParts(partsFromValue(value, kind, allow24));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, kind, allow24]);

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  const focusSeg = (i: number) => inputs.current[Math.max(0, Math.min(last, i))]?.focus();
  const setPart = (i: number, text: string) => {
    const next = partsRef.current.slice();
    next[i] = text;
    emit(next);
  };

  /**
   * 在第 i 段敲一个数字；返回接下来该敲的是第几段（填完了就是下一段）。
   * 最后一段也填完了返回 -1：这个输入框已经满了，后面还有数字也不该再塞进来。
   */
  const type = (i: number, digit: string): number => {
    const r = typeDigit(specs[i], partsRef.current[i], digit, fresh.current);
    fresh.current = false;
    setPart(i, r.text);
    if (!r.done) return i;
    if (i < last) {
      focusSeg(i + 1);
      return i + 1;
    }
    onComplete?.();
    return -1;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    const k = realKey(e);
    const mod = e.ctrlKey || e.metaKey;
    // Ctrl+;（Ctrl+Shift+; 同义）：按这个输入框的类型填成当前日期/时间
    if (mod && (e.code === "Semicolon" || k === ";" || k === ":")) {
      e.preventDefault();
      e.stopPropagation();
      emit(nowParts(kind, allow24));
      return;
    }
    if (e.altKey && k === "ArrowDown" && picker) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (mod || e.altKey) return; // Ctrl+C / V / A 等交给浏览器和外层
    if (/^\d$/.test(k)) {
      e.preventDefault();
      type(i, k);
    } else if (SEPARATORS.has(k)) {
      // 习惯敲 9- 或 9: 的人：当前段补整齐，跳到下一段
      e.preventDefault();
      const tidy = tidyParts(partsRef.current, specs);
      if (tidy[i] !== partsRef.current[i]) emit(tidy);
      if (i < last) focusSeg(i + 1);
    } else if (k === "Backspace") {
      e.preventDefault();
      const cur = partsRef.current[i];
      if (!cur) {
        if (i > 0) focusSeg(i - 1);
      } else {
        setPart(i, fresh.current ? "" : cur.slice(0, -1));
        fresh.current = false;
      }
    } else if (k === "Delete") {
      e.preventDefault();
      setPart(i, "");
    } else if (k === "ArrowLeft") {
      if (i > 0) {
        e.preventDefault();
        focusSeg(i - 1);
      }
    } else if (k === "ArrowRight") {
      if (i < last) {
        e.preventDefault();
        focusSeg(i + 1);
      }
    } else if ((k === "ArrowUp" || k === "ArrowDown") && arrows) {
      e.preventDefault();
      const big = e.shiftKey ? (specs[i].id === "m" ? 5 : specs[i].id === "d" ? 7 : 1) : 1;
      setPart(i, stepPart(specs, partsRef.current, i, (k === "ArrowUp" ? 1 : -1) * big));
      requestAnimationFrame(() => inputs.current[i]?.select());
    } else if (k === "Home") {
      e.preventDefault();
      focusSeg(0);
    } else if (k === "End") {
      e.preventDefault();
      focusSeg(last);
    } else if (k === "Escape") {
      setParts(partsFromValue(value, kind, allow24));
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (/[\t\r\n]/.test(text)) return; // 多行/多列的粘贴交给外层（流水表的整行粘贴）
    e.preventDefault();
    const p = partsFromPaste(text, kind, defaultYear ?? new Date().getFullYear(), allow24);
    if (p) emit(p);
  };

  const dateOf = (v: string) => (kind === "datetime" ? v.split(" ")[0] : v);
  const bad = !focused && parts.some(Boolean) && valueFromParts(parts, kind, allow24) === "";

  const pickDate = (iso: string) => {
    const cur = partsFromValue(iso, "date");
    emit(kind === "datetime" ? [...cur, ...partsRef.current.slice(3)] : cur);
    setOpen(false);
  };

  return (
    <div
      className={`seg-field${bare ? " bare" : ""}${bad ? " bad" : ""}`}
      role="group"
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setFocused(false);
        const tidy = tidyParts(partsRef.current, specs);
        emit(tidy);
        onCommit?.(valueFromParts(tidy, kind, allow24));
      }}
      onMouseDown={(e) => {
        // 点在分隔符或空白处：落到第一个还没填的段（都填了就落在第一段）
        if (!(e.target as HTMLElement).closest("input, button, .pop")) {
          e.preventDefault();
          const firstEmpty = partsRef.current.findIndex((p, i) => p.length !== specs[i].len);
          focusSeg(firstEmpty < 0 ? 0 : firstEmpty);
        }
      }}
    >
      {specs.map((s, i) => (
        <span key={s.id} className="seg-wrap">
          <input
            ref={(el) => {
              inputs.current[i] = el;
            }}
            className="seg-in"
            data-seg={s.id}
            inputMode="numeric"
            autoComplete="off"
            style={{ width: `${s.len + 0.25}ch` }}
            value={parts[i] ?? ""}
            placeholder={s.placeholder}
            aria-label={`${ariaLabel ?? ""}${s.placeholder}`}
            onFocus={(e) => {
              fresh.current = true;
              e.currentTarget.select();
            }}
            onMouseUp={(e) => e.preventDefault()} // 别让鼠标抬起时把整段选中又取消掉
            onKeyDown={(e) => onKeyDown(e, i)}
            onPaste={onPaste}
            // 键盘之外的输入途径（输入法上屏、语音、自动化）：数字照样按段填，其它一律不让进
            onBeforeInput={(e) => {
              e.preventDefault();
              const data = (e.nativeEvent as InputEvent).data ?? "";
              if (/^\d+$/.test(data)) {
                let at = i;
                for (const d of data) {
                  if (at < 0) break;
                  at = type(at, d); // 一次上屏好几位（输入法、粘贴）时，逐位往后段推进
                }
              }
            }}
            onChange={() => {}}
          />
          {i < last && <span className="seg-sep">{s.sepAfter}</span>}
        </span>
      ))}
      {picker && (
        <button type="button" className={bare ? "cell-pick" : "pop-btn"} tabIndex={-1} title={kind === "time" ? "选择时间（Alt+↓）" : "选择日期（Alt+↓）"} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)}>
          {kind === "time" ? "▾" : "📅"}
        </button>
      )}
      {extra}
      {open && kind !== "time" && <CalendarPopover value={dateOf(valueFromParts(parts, kind, allow24)) || null} onClose={() => setOpen(false)} onPick={pickDate} />}
      {open && kind === "time" && (
        <TimePopover
          value={valueFromParts(parts, "time", allow24) || null}
          onClose={() => setOpen(false)}
          onPick={(t) => {
            emit(partsFromValue(t, "time", allow24));
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
