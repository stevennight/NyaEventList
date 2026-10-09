import { describe, expect, it } from "vitest";
import { matchesQuery } from "./search";

describe("matchesQuery", () => {
  it("matches plain substrings, every space-separated word required", () => {
    expect(matchesQuery("订单导出优化 张三", "订单")).toBe(true);
    expect(matchesQuery("订单导出优化 张三", "订单 张三")).toBe(true);
    expect(matchesQuery("订单导出优化 张三", "订单 李四")).toBe(false);
    expect(matchesQuery("REQ-123 Export", "export")).toBe(true);
    expect(matchesQuery("任何东西", "  ")).toBe(true);
  });

  it("matches full pinyin, initials and a mix of both", () => {
    const t = "招商银行对账";
    for (const q of ["zs", "zsyh", "zhaoshang", "zhaoshangyinhang", "zhaosyh", "dz", "duizhang", "yhdz"]) expect(matchesQuery(t, q), q).toBe(true);
    expect(matchesQuery(t, "zx")).toBe(false);
  });

  it("accepts any reading of a polyphonic character", () => {
    expect(matchesQuery("招商银行", "yinhang")).toBe(true);
    expect(matchesQuery("招商银行", "yinxing")).toBe(true);
    expect(matchesQuery("重新导出", "cx")).toBe(true);
    expect(matchesQuery("重新导出", "zx")).toBe(true);
  });

  it("lets the last character be typed partially", () => {
    expect(matchesQuery("招商银行", "zhaosh")).toBe(true);
    expect(matchesQuery("招商银行", "zsyinh")).toBe(true);
  });

  it("skips spaces and punctuation, and mixes with latin letters and digits", () => {
    expect(matchesQuery("张 三", "zs")).toBe(true);
    expect(matchesQuery("OA系统·审批", "oaxt")).toBe(true);
    expect(matchesQuery("OA系统·审批", "xtsp")).toBe(true);
    expect(matchesQuery("2号楼巡检", "2hl")).toBe(true);
  });

  it("combines pinyin words with plain words", () => {
    const t = "订单导出优化 财务部 张三";
    expect(matchesQuery(t, "dd zs")).toBe(true);
    expect(matchesQuery(t, "订单 cwb")).toBe(true);
    expect(matchesQuery(t, "dd ls")).toBe(false);
  });

  it("does not try pinyin for non-latin words", () => {
    expect(matchesQuery("招商银行", "招行")).toBe(false);
  });
});
