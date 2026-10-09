import { describe, expect, it } from "vitest";
import { describeDraftStep, draftKey, draftKeyLabel, parseDraftKey, persistableDrafts, restoreDrafts } from "./drafts";
import type { Draft } from "./logModel";

const blank: Draft = { taskId: "", type: "", content: "", date: "2026-10-09", start: "09:00", end: "" };

describe("draft keys", () => {
  it("round-trips and labels day and week keys", () => {
    expect(parseDraftKey(draftKey("day", "2026-10-09"))).toEqual({ view: "day", date: "2026-10-09" });
    expect(parseDraftKey("week:2026-10-05")).toEqual({ view: "week", date: "2026-10-05" });
    expect(parseDraftKey("nonsense")).toBeNull();
    expect(draftKeyLabel("day:2026-10-09")).toBe("10月9日");
    expect(draftKeyLabel("week:2026-10-05")).toBe("10月5日那一周");
  });
});

describe("describeDraftStep", () => {
  it("names the changed cells and where the draft is", () => {
    const step = describeDraftStep("day:2026-10-09", blank, { ...blank, taskId: "t1", content: "写了点东西" })!;
    expect(step.label).toBe("修改草稿的任务、具体内容");
    expect(step.undoMessage).toBe("已撤销：修改草稿的任务、具体内容（10月9日）");
    expect(step.redoMessage).toBe("已重做：修改草稿的任务、具体内容（10月9日）");
  });

  it("uses a given label, and returns null when nothing changed", () => {
    expect(describeDraftStep("day:2026-10-09", { ...blank, content: "x" }, blank, "清空草稿")!.label).toBe("清空草稿");
    expect(describeDraftStep("day:2026-10-09", blank, { ...blank })).toBeNull();
  });
});

describe("draft persistence", () => {
  it("only keeps drafts the user touched and that have a task or content", () => {
    const saved = persistableDrafts({
      "day:2026-10-09": { draft: { ...blank, content: "写到一半" }, touched: true },
      "day:2026-10-08": { draft: { ...blank, taskId: "t1" }, touched: false }, // 自动预填的
      "day:2026-10-07": { draft: { ...blank, start: "10:00" }, touched: true }, // 只改了时间
    });
    expect(Object.keys(saved)).toEqual(["day:2026-10-09"]);
  });

  it("restores saved drafts as touched and drops malformed ones", () => {
    const restored = restoreDrafts({
      "day:2026-10-09": { ...blank, content: "写到一半" },
      "week:2026-10-05": { taskId: "t1", content: 42 },
      "bad-key": { ...blank, content: "x" },
      "day:2026-10-08": "not an object",
      "day:2026-10-07": { ...blank },
    });
    expect(restored["day:2026-10-09"]).toEqual({ draft: { ...blank, content: "写到一半" }, touched: true });
    expect(restored["week:2026-10-05"].draft).toEqual({ taskId: "t1", type: "", content: "", date: "", start: "", end: "" });
    expect(Object.keys(restored).sort()).toEqual(["day:2026-10-09", "week:2026-10-05"]);
    expect(restoreDrafts(null)).toEqual({});
  });
});
