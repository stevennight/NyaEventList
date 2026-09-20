import { normDate, normTime, pad2 } from "./time";

/** 固定格式的日期/时间输入：年 4 位，月日时分各 2 位，分隔符不可编辑，按“段”输入。 */
export type FieldKind = "date" | "time" | "datetime";
export type SegId = "y" | "M" | "d" | "h" | "m";

export interface SegSpec {
  id: SegId;
  len: number;
  min: number;
  max: number;
  placeholder: string;
  /** 这一段后面跟的分隔符（最后一段为空） */
  sepAfter: string;
}

export function specsOf(kind: FieldKind, allow24 = false): SegSpec[] {
  const Y: SegSpec = { id: "y", len: 4, min: 1, max: 9999, placeholder: "YYYY", sepAfter: "-" };
  const M: SegSpec = { id: "M", len: 2, min: 1, max: 12, placeholder: "MM", sepAfter: "-" };
  const D: SegSpec = { id: "d", len: 2, min: 1, max: 31, placeholder: "DD", sepAfter: kind === "datetime" ? " " : "" };
  const H: SegSpec = { id: "h", len: 2, min: 0, max: allow24 ? 24 : 23, placeholder: "HH", sepAfter: ":" };
  const I: SegSpec = { id: "m", len: 2, min: 0, max: 59, placeholder: "mm", sepAfter: "" };
  if (kind === "date") return [Y, M, D];
  if (kind === "time") return [H, I];
  return [Y, M, D, H, I];
}

const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

/** 已有的值（`2026-09-16` / `09:30` / `2026-09-16 09:30`）拆成各段的数字串；拆不了就是全空。 */
export function partsFromValue(value: string, kind: FieldKind, allow24 = false): string[] {
  const specs = specsOf(kind, allow24);
  const nums = value.match(/\d+/g) ?? [];
  if (nums.length !== specs.length) return specs.map(() => "");
  return nums.map((n, i) => (n.length <= specs[i].len ? n.padStart(specs[i].len, "0") : ""));
}

/** 各段拼成规范文本；有段没填完、或日期/时间不存在时返回空串。 */
export function valueFromParts(parts: string[], kind: FieldKind, allow24 = false): string {
  const specs = specsOf(kind, allow24);
  if (parts.length !== specs.length) return "";
  const n: Partial<Record<SegId, number>> = {};
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    if (parts[i].length !== s.len) return "";
    const v = Number(parts[i]);
    if (v < s.min || v > s.max) return "";
    n[s.id] = v;
  }
  if (n.y !== undefined && n.M !== undefined && n.d !== undefined && n.d > daysIn(n.y, n.M)) return "";
  if (n.h === 24 && n.m !== 0) return "";
  return specs.map((s, i) => parts[i] + (i < specs.length - 1 ? s.sepAfter : "")).join("");
}

export interface TypeResult {
  text: string;
  /** 这一段填完了，该跳到下一段 */
  done: boolean;
}

/**
 * 在某一段里敲一个数字。
 * - `fresh`（刚选中这一段）时敲的数字替换整段，否则接在已有数字后面；
 * - 两位段的第一个数字如果已经不可能再接第二位（月份敲 2–9、日敲 4–9、时敲 3–9、分敲 6–9），直接补 0 并算填完；
 * - 两位数超出范围（如月份 13）就把新数字当作重新开始的第一位。
 */
export function typeDigit(spec: SegSpec, current: string, digit: string, fresh: boolean): TypeResult {
  const buf = fresh || current.length >= spec.len ? digit : current + digit;
  if (spec.len === 4) return { text: buf, done: buf.length === 4 };
  if (buf.length === 1) {
    return Number(buf) * 10 > spec.max ? { text: "0" + buf, done: true } : { text: buf, done: false };
  }
  const v = Number(buf);
  if (v > spec.max || v < spec.min) return typeDigit(spec, "", digit, true);
  return { text: buf, done: true };
}

/** 离开输入框时把没敲完的补整齐：两位段补 0，两位年当作 20xx。补不出来的原样保留（会标红）。 */
export function tidyParts(parts: string[], specs: SegSpec[]): string[] {
  return parts.map((p, i) => {
    const s = specs[i];
    if (!p) return p;
    if (s.len === 4) return p.length === 2 ? `20${p}` : p;
    return p.length === 1 ? "0" + p : p;
  });
}

/** 现在的各段（用在 Ctrl+; 和空段按上下键时） */
export function nowParts(kind: FieldKind, allow24 = false, now: Date = new Date()): string[] {
  const all: Record<SegId, string> = {
    y: String(now.getFullYear()).padStart(4, "0"),
    M: pad2(now.getMonth() + 1),
    d: pad2(now.getDate()),
    h: pad2(now.getHours()),
    m: pad2(now.getMinutes()),
  };
  return specsOf(kind, allow24).map((s) => all[s.id]);
}

/** 上下键调整某一段：空段先填成“现在”的对应值，其余按范围循环（年不循环，日按当月天数）。 */
export function stepPart(specs: SegSpec[], parts: string[], index: number, delta: number, now: Date = new Date()): string {
  const spec = specs[index];
  const today = nowParts("datetime", true, now);
  const nowOf: Record<SegId, number> = { y: +today[0], M: +today[1], d: +today[2], h: +today[3], m: +today[4] };
  if (!parts[index]) return String(nowOf[spec.id]).padStart(spec.len, "0");
  const cur = Number(parts[index]);
  if (spec.id === "y") return String(Math.min(9999, Math.max(1, cur + delta))).padStart(4, "0");
  let max = spec.max;
  if (spec.id === "d") {
    const yi = specs.findIndex((s) => s.id === "y");
    const mi = specs.findIndex((s) => s.id === "M");
    const y = yi >= 0 && parts[yi].length === 4 ? Number(parts[yi]) : nowOf.y;
    const m = mi >= 0 && parts[mi] ? Number(parts[mi]) : nowOf.M;
    max = daysIn(y, Math.min(12, Math.max(1, m)));
  }
  const range = max - spec.min + 1;
  const v = ((((cur + delta - spec.min) % range) + range) % range) + spec.min;
  return String(v).padStart(spec.len, "0");
}

/** 整段粘贴：借用宽松解析（916、9月16日、2026/9/16、9:30、0930……），解析不了返回 null。 */
export function partsFromPaste(text: string, kind: FieldKind, defaultYear: number, allow24 = false): string[] | null {
  const t = text.trim();
  if (kind === "date") {
    const d = normDate(t, defaultYear);
    return d ? partsFromValue(d, "date") : null;
  }
  if (kind === "time") {
    const v = normTime(t);
    return v && (allow24 || v !== "24:00") ? partsFromValue(v, "time", allow24) : null;
  }
  const [dText, tText] = t.split(/[\sT]+/);
  const d = normDate(dText ?? "", defaultYear);
  const v = normTime(tText ?? "");
  return d && v ? partsFromValue(`${d} ${v}`, "datetime", allow24) : null;
}
