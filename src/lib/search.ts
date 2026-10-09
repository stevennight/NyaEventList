import { polyphonic } from "pinyin-pro";

/**
 * 文字搜索：空格分隔的每个词都要命中。一个词命中，要么是原文里直接包含它，要么是能按拼音打出来：
 * 每个汉字可以敲全拼或者首字母，多音字哪个读音都行，最后一个字可以只敲一半。
 * 所以 `zs`、`zsyh`、`zhaoshang`、`zhaoshangyinhang` 都能搜到“招商银行”（行读 xing 或 hang）。
 * 算法和 NyaPassword 的搜索一致。
 */

/** 一个字符可以怎么敲：汉字是它的各个读音，字母数字是它自己（小写），空格标点可以跳过 */
type Unit = { han: string[] } | { other: string } | null;

const HAN = /[㐀-䶿一-鿿]/;

const readingsCache = new Map<string, string[]>();
function readings(c: string): string[] {
  let r = readingsCache.get(c);
  if (!r) {
    r = [...new Set((polyphonic(c, { toneType: "none", type: "array" })[0] ?? []).map((p) => p.toLowerCase()).filter((p) => /^[a-z]+$/.test(p)))];
    readingsCache.set(c, r);
  }
  return r;
}

function toUnits(s: string): Unit[] {
  const out: Unit[] = [];
  for (const c of s) {
    if (HAN.test(c)) {
      const r = readings(c);
      out.push(r.length ? { han: r } : null);
    } else if (/[\p{L}\p{N}]/u.test(c)) {
      for (const l of c.toLowerCase()) out.push({ other: l });
    } else out.push(null);
  }
  return out;
}

/** 下拉框每敲一个字都会把几百上千个选项过一遍：同一段文字的拼音只算一次 */
const unitsCache = new Map<string, Unit[] | false>();
function unitsOf(text: string): Unit[] | false {
  let u = unitsCache.get(text);
  if (u === undefined) {
    if (unitsCache.size > 20000) unitsCache.clear();
    u = HAN.test(text) ? toUnits(text) : false;
    unitsCache.set(text, u);
  }
  return u;
}

/** term 能不能从 units[start] 开始按拼音敲出来 */
function matchFrom(units: Unit[], start: number, term: string): boolean {
  // 失败过的 (位置, 已匹配长度) 记下来，免得多音字 × 全拼/首字母的组合把回溯放大成指数级
  const failed = new Set<number>();
  const go = (i: number, t: number): boolean => {
    if (t === term.length) return true;
    if (i >= units.length) return false;
    const key = i * (term.length + 1) + t;
    if (failed.has(key)) return false;
    const u = units[i];
    let ok: boolean;
    if (u === null) ok = go(i + 1, t);
    else if ("other" in u) ok = term.startsWith(u.other, t) && go(i + 1, t + u.other.length);
    else {
      const rest = term.slice(t);
      ok = u.han.some(
        (r) =>
          (rest.startsWith(r) && go(i + 1, t + r.length)) || // 全拼
          r.startsWith(rest) || // 最后一个字只敲了一半
          (rest[0] === r[0] && go(i + 1, t + 1)), // 首字母
      );
    }
    if (!ok) failed.add(key);
    return ok;
  };
  return go(start, 0);
}

function pinyinMatches(units: Unit[], term: string): boolean {
  return units.some((u, i) => u !== null && matchFrom(units, i, term));
}

const ASCII_WORD = /^[a-z0-9]+$/;

/** 空格分隔的多个词要同时命中，所以“订单 张三”能同时按标题和需求方收窄；每个词可以是原文，也可以是拼音/首字母 */
export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const text = haystack.toLowerCase();
  return tokens.every((tok) => {
    if (text.includes(tok)) return true;
    if (!ASCII_WORD.test(tok)) return false;
    const units = unitsOf(haystack);
    return !!units && pinyinMatches(units, tok);
  });
}
