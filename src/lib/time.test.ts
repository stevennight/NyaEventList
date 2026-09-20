import { describe, expect, it } from "vitest";
import {
  addDays,
  clockToHours,
  durationHours,
  fmtDate,
  hoursToClock,
  normDate,
  normTime,
  parseISODate,
  weekStartOf,
} from "./time";

describe("normTime", () => {
  it("accepts the loose spellings used when typing fast", () => {
    expect(normTime("930")).toBe("09:30");
    expect(normTime("0930")).toBe("09:30");
    expect(normTime("9:30")).toBe("09:30");
    expect(normTime("1805")).toBe("18:05");
    expect(normTime("9")).toBe("09:00");
    expect(normTime("14")).toBe("14:00");
    expect(normTime("9:30:00")).toBe("09:30");
  });
  it("allows 24:00 only as an exact end-of-day", () => {
    expect(normTime("24:00")).toBe("24:00");
    expect(normTime("2400")).toBe("24:00");
    expect(normTime("24:30")).toBeNull();
    expect(normTime("25:00")).toBeNull();
  });
  it("rejects garbage and empty input", () => {
    expect(normTime("")).toBeNull();
    expect(normTime(null)).toBeNull();
    expect(normTime("9:75")).toBeNull();
    expect(normTime("abc")).toBeNull();
  });
});

describe("normDate", () => {
  it("fills in the year for short forms", () => {
    expect(normDate("9-16", 2026)).toBe("2026-09-16");
    expect(normDate("0916", 2026)).toBe("2026-09-16");
    expect(normDate("9/6", 2026)).toBe("2026-09-06");
  });
  it("handles full and Excel-style values", () => {
    expect(normDate("2026-09-16", 2000)).toBe("2026-09-16");
    expect(normDate("2026/9/6", 2000)).toBe("2026-09-06");
    expect(normDate("2025-01-02 00:00:00", 2000)).toBe("2025-01-02");
  });
  it("rejects dates that do not exist", () => {
    expect(normDate("2-30", 2026)).toBeNull();
    expect(normDate("13-01", 2026)).toBeNull();
    expect(normDate("", 2026)).toBeNull();
  });
});

describe("hours helpers", () => {
  it("round-trips clock and hours", () => {
    expect(clockToHours("09:30")).toBe(9.5);
    expect(hoursToClock(9.5)).toBe("09:30");
    expect(hoursToClock(16.0833333)).toBe("16:05");
  });
  it("computes durations and clamps non-positive ones to 0", () => {
    expect(durationHours("09:30", "11:00")).toBe(1.5);
    expect(durationHours("15:30", "16:01")).toBe(0.52);
    expect(durationHours("11:00", "09:00")).toBe(0);
  });
});

describe("date helpers", () => {
  it("parses ISO dates as local time, not UTC", () => {
    expect(fmtDate(parseISODate("2026-09-16"))).toBe("2026-09-16");
  });
  it("finds the Monday of a week, including Sundays", () => {
    expect(fmtDate(weekStartOf(parseISODate("2026-09-16")))).toBe("2026-09-14"); // Wed
    expect(fmtDate(weekStartOf(parseISODate("2026-09-20")))).toBe("2026-09-14"); // Sun
    expect(fmtDate(weekStartOf(parseISODate("2026-09-14")))).toBe("2026-09-14"); // Mon
  });
  it("adds days across month boundaries", () => {
    expect(fmtDate(addDays(parseISODate("2026-09-30"), 1))).toBe("2026-10-01");
  });
});

describe("extra date spellings", () => {
  it("parses 916, 20260916 and 9月16日", () => {
    expect(normDate("916", 2026)).toBe("2026-09-16");
    expect(normDate("20260916", 2000)).toBe("2026-09-16");
    expect(normDate("9月16日", 2026)).toBe("2026-09-16");
    expect(normDate("999", 2026)).toBeNull();
  });
});
