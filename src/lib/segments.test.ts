import { describe, expect, it } from "vitest";
import { nowParts, partsFromPaste, partsFromValue, specsOf, stepPart, tidyParts, typeDigit, valueFromParts } from "./segments";

const [Y, M, D] = specsOf("date");
const [H, I] = specsOf("time");

describe("value <-> parts", () => {
  it("round-trips date, time and datetime", () => {
    expect(partsFromValue("2026-09-16", "date")).toEqual(["2026", "09", "16"]);
    expect(valueFromParts(["2026", "09", "16"], "date")).toBe("2026-09-16");
    expect(valueFromParts(["09", "30"], "time")).toBe("09:30");
    expect(valueFromParts(["2026", "09", "16", "09", "30"], "datetime")).toBe("2026-09-16 09:30");
    expect(partsFromValue("2026-09-16 09:30", "datetime")).toEqual(["2026", "09", "16", "09", "30"]);
  });
  it("is empty for anything incomplete or impossible", () => {
    expect(valueFromParts(["2026", "0", "16"], "date")).toBe("");
    expect(valueFromParts(["2026", "02", "30"], "date")).toBe("");
    expect(valueFromParts(["2026", "13", "01"], "date")).toBe("");
    expect(valueFromParts(["24", "30"], "time", true)).toBe("");
    expect(partsFromValue("", "date")).toEqual(["", "", ""]);
    expect(partsFromValue("garbage", "time")).toEqual(["", ""]);
  });
  it("allows 24:00 only when asked", () => {
    expect(valueFromParts(["24", "00"], "time")).toBe("");
    expect(valueFromParts(["24", "00"], "time", true)).toBe("24:00");
  });
});

describe("typing digits into a segment", () => {
  it("fills a year over four digits and then says done", () => {
    let r = typeDigit(Y, "", "2", true);
    expect(r).toEqual({ text: "2", done: false });
    r = typeDigit(Y, r.text, "0", false);
    r = typeDigit(Y, r.text, "2", false);
    r = typeDigit(Y, r.text, "6", false);
    expect(r).toEqual({ text: "2026", done: true });
  });
  it("pads and advances when a second digit is impossible", () => {
    expect(typeDigit(M, "", "2", true)).toEqual({ text: "02", done: true });
    expect(typeDigit(M, "", "1", true)).toEqual({ text: "1", done: false });
    expect(typeDigit(D, "", "4", true)).toEqual({ text: "04", done: true });
    expect(typeDigit(D, "", "3", true)).toEqual({ text: "3", done: false });
    expect(typeDigit(H, "", "3", true)).toEqual({ text: "03", done: true });
    expect(typeDigit(H, "", "2", true)).toEqual({ text: "2", done: false });
    expect(typeDigit(I, "", "6", true)).toEqual({ text: "06", done: true });
    expect(typeDigit(I, "", "5", true)).toEqual({ text: "5", done: false });
  });
  it("completes a two-digit value when it is in range", () => {
    expect(typeDigit(M, "1", "2", false)).toEqual({ text: "12", done: true });
    expect(typeDigit(D, "3", "1", false)).toEqual({ text: "31", done: true });
    expect(typeDigit(M, "0", "9", false)).toEqual({ text: "09", done: true });
  });
  it("restarts with the new digit when the pair is out of range", () => {
    expect(typeDigit(M, "1", "3", false)).toEqual({ text: "03", done: true });
    expect(typeDigit(D, "3", "5", false)).toEqual({ text: "05", done: true });
    expect(typeDigit(M, "0", "0", false)).toEqual({ text: "0", done: false });
  });
  it("replaces the whole segment when it was just selected", () => {
    expect(typeDigit(M, "09", "1", true)).toEqual({ text: "1", done: false });
  });
  it("starts over when typing into an already full segment", () => {
    expect(typeDigit(Y, "2026", "1", false)).toEqual({ text: "1", done: false });
  });
  it("lets hour reach 24 only for end times", () => {
    const [H24] = specsOf("time", true);
    expect(typeDigit(H24, "2", "4", false)).toEqual({ text: "24", done: true });
    expect(typeDigit(H, "2", "4", false)).toEqual({ text: "04", done: true });
  });
});

describe("tidying and stepping", () => {
  it("pads short segments and expands a two-digit year", () => {
    const specs = specsOf("date");
    expect(tidyParts(["26", "9", "1"], specs)).toEqual(["2026", "09", "01"]);
    expect(tidyParts(["2", "", ""], specs)).toEqual(["2", "", ""]);
  });
  it("steps with wrap-around and month-aware days", () => {
    const specs = specsOf("date");
    expect(stepPart(specs, ["2026", "12", "05"], 1, 1)).toBe("01");
    expect(stepPart(specs, ["2026", "01", "05"], 1, -1)).toBe("12");
    expect(stepPart(specs, ["2026", "02", "28"], 2, 1)).toBe("01"); // 2026 年 2 月只有 28 天
    expect(stepPart(specs, ["2024", "02", "28"], 2, 1)).toBe("29");
    expect(stepPart(specs, ["2026", "09", "16"], 0, 1)).toBe("2027");
    expect(stepPart(specsOf("time"), ["09", "59"], 1, 1)).toBe("00");
    expect(stepPart(specsOf("time"), ["23", "00"], 0, 1)).toBe("00");
  });
  it("fills an empty segment with today's part", () => {
    const now = new Date(2026, 8, 20, 14, 5);
    expect(stepPart(specsOf("date"), ["", "", ""], 1, 1, now)).toBe("09");
    expect(stepPart(specsOf("time"), ["", ""], 1, 1, now)).toBe("05");
  });
  it("gives now for each kind", () => {
    const now = new Date(2026, 8, 20, 14, 5);
    expect(nowParts("date", false, now)).toEqual(["2026", "09", "20"]);
    expect(nowParts("time", false, now)).toEqual(["14", "05"]);
    expect(nowParts("datetime", false, now)).toEqual(["2026", "09", "20", "14", "05"]);
  });
});

describe("pasting a whole value", () => {
  it("accepts the loose spellings", () => {
    expect(partsFromPaste("916", "date", 2026)).toEqual(["2026", "09", "16"]);
    expect(partsFromPaste("2025/1/2 00:00:00", "date", 2026)).toEqual(["2025", "01", "02"]);
    expect(partsFromPaste("930", "time", 2026)).toEqual(["09", "30"]);
    expect(partsFromPaste("9-16 9:30", "datetime", 2026)).toEqual(["2026", "09", "16", "09", "30"]);
  });
  it("rejects nonsense, and 24:00 unless allowed", () => {
    expect(partsFromPaste("hello", "date", 2026)).toBeNull();
    expect(partsFromPaste("24:00", "time", 2026)).toBeNull();
    expect(partsFromPaste("24:00", "time", 2026, true)).toEqual(["24", "00"]);
  });
});
