/** 日期一律是 `YYYY-MM-DD`，时间一律是 `HH:MM`（24:00 只允许做结束时间）。 */

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 解析 `YYYY-MM-DD` 为本地时间的 Date（不能用 new Date(str)，那是按 UTC 解析，会差一天）。 */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 所在周的周一 */
export function weekStartOf(d: Date): Date {
  const day = d.getDay();
  return addDays(d, day === 0 ? -6 : 1 - day);
}

/**
 * 宽松解析时间输入：`930` / `0930` / `9:30` / `9:30:00` / `9` → `09:30`。
 * 小时 0–24，24 时分钟必须为 0；解析失败返回 null。
 */
export function normTime(input: string | null | undefined): string | null {
  const str = (input ?? "").trim();
  if (!str) return null;
  let m = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) m = str.match(/^(\d{1,2})(\d{2})$/);
  if (!m) {
    const only = str.match(/^(\d{1,2})$/);
    if (only) m = [only[0], only[1], "00"] as unknown as RegExpMatchArray;
  }
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (mi > 59 || h > 24 || (h === 24 && mi > 0)) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

/**
 * 宽松解析日期输入：`2026-09-16` / `2026/9/16` / `9-16` / `0916` / 带时分秒（Excel 粘贴）→ `YYYY-MM-DD`。
 * 缺年份时用 `defaultYear`；日期不存在（如 2-30）返回 null。
 */
export function normDate(input: string | null | undefined, defaultYear: number): string | null {
  const first = (input ?? "").trim().split(/\s+/)[0] ?? "";
  const str = first.replace(/[/.]/g, "-");
  let y = defaultYear;
  let mo: number;
  let d: number;
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  } else if ((m = str.match(/^(\d{1,2})-(\d{1,2})$/))) {
    mo = +m[1];
    d = +m[2];
  } else if ((m = str.match(/^(\d{2})(\d{2})$/))) {
    mo = +m[1];
    d = +m[2];
  } else if ((m = str.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  } else if ((m = str.match(/^(\d)(\d{2})$/))) {
    // 916 → 9 月 16 日；月份取 1 位，剩下两位当日
    mo = +m[1];
    d = +m[2];
  } else if ((m = str.match(/^(\d{1,2})月(\d{1,2})日?$/))) {
    mo = +m[1];
    d = +m[2];
  } else {
    return null;
  }
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return fmtDate(dt);
}

/** `HH:MM` → 小时数（含小数），如 `09:30` → 9.5 */
export function clockToHours(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

/** 小时数 → `HH:MM`（按分钟四舍五入） */
export function hoursToClock(hours: number): string {
  const total = Math.round(hours * 60);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** 两个 `HH:MM` 之间的时长（小时，保留 2 位）；结束不晚于开始返回 0。 */
export function durationHours(start: string, end: string): number {
  const d = clockToHours(end) - clockToHours(start);
  return d > 0 ? Math.round(d * 100) / 100 : 0;
}

export function nowClock(now: Date = new Date()): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}
