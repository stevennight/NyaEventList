import { describe, expect, it } from "vitest";
import { dueLabel, dueState } from "./due";

describe("dueState", () => {
  const today = "2026-09-20";
  it("ignores tasks without a target date or already finished", () => {
    expect(dueState(null, today, 3)).toEqual({ kind: "none" });
    expect(dueState("2026-09-01", today, 3, true)).toEqual({ kind: "none" });
  });
  it("marks overdue, due-soon (inclusive of the threshold day) and ok", () => {
    expect(dueState("2026-09-19", today, 3)).toEqual({ kind: "late", days: -1 });
    expect(dueState("2026-09-20", today, 3)).toEqual({ kind: "soon", days: 0 });
    expect(dueState("2026-09-23", today, 3)).toEqual({ kind: "soon", days: 3 });
    expect(dueState("2026-09-24", today, 3)).toEqual({ kind: "ok", days: 4 });
  });
  it("respects a custom threshold", () => {
    expect(dueState("2026-09-27", today, 7).kind).toBe("soon");
    expect(dueState("2026-09-27", today, 3).kind).toBe("ok");
  });
  it("crosses month and year boundaries", () => {
    expect(dueState("2027-01-02", "2026-12-31", 3)).toEqual({ kind: "soon", days: 2 });
  });
  it("labels", () => {
    expect(dueLabel(dueState("2026-09-18", today, 3), "2026-09-18")).toBe("超期 2 天");
    expect(dueLabel(dueState("2026-09-20", today, 3), "2026-09-20")).toBe("今天截止");
    expect(dueLabel(dueState("2026-09-22", today, 3), "2026-09-22")).toBe("09-22（2 天后）");
    expect(dueLabel({ kind: "none" }, null)).toBe("");
  });
});
