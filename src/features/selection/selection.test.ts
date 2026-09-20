import { describe, expect, it } from "vitest";
import { clickSelect, EMPTY_SELECTION, extendSelection, marqueeSelect, rangeIds, rectFromPoints, rectsIntersect, selectAll, type SelectionState } from "./selection";

const order = Array.from({ length: 40 }, (_, i) => `r${i + 1}`);
const plain = { shift: false, ctrl: false };
const ctrl = { shift: false, ctrl: true };
const shift = { shift: true, ctrl: false };
const both = { shift: true, ctrl: true };

describe("click selection", () => {
  it("selects one, and clicking the only selected one clears it", () => {
    const a = clickSelect(order, EMPTY_SELECTION, "r3", plain);
    expect(a).toEqual({ ids: ["r3"], anchor: "r3" });
    expect(clickSelect(order, a, "r3", plain)).toEqual(EMPTY_SELECTION);
    expect(clickSelect(order, a, "r5", plain)).toEqual({ ids: ["r5"], anchor: "r5" });
  });
  it("Ctrl toggles single items and moves the anchor", () => {
    let s = clickSelect(order, EMPTY_SELECTION, "r3", plain);
    s = clickSelect(order, s, "r10", ctrl);
    s = clickSelect(order, s, "r7", ctrl);
    expect(s.ids).toEqual(["r3", "r7", "r10"]);
    expect(s.anchor).toBe("r7");
    s = clickSelect(order, s, "r7", ctrl);
    expect(s.ids).toEqual(["r3", "r10"]);
  });
  it("selects 1 then Shift-click 30 as the range 1–30", () => {
    let s = clickSelect(order, EMPTY_SELECTION, "r1", plain);
    s = clickSelect(order, s, "r30", shift);
    expect(s.ids).toHaveLength(30);
    expect(s.ids[0]).toBe("r1");
    expect(s.ids[29]).toBe("r30");
    expect(s.anchor).toBe("r1"); // 锚点不动，再 Shift 点别处是重新从 1 起算
    s = clickSelect(order, s, "r5", shift);
    expect(s.ids).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });
  it("Shift works backwards too", () => {
    let s = clickSelect(order, EMPTY_SELECTION, "r10", plain);
    s = clickSelect(order, s, "r7", shift);
    expect(s.ids).toEqual(["r7", "r8", "r9", "r10"]);
  });
  it("Ctrl+Shift adds a range on top of what was already selected", () => {
    let s = clickSelect(order, EMPTY_SELECTION, "r1", plain);
    s = clickSelect(order, s, "r3", shift); // r1–r3
    s = clickSelect(order, s, "r20", ctrl); // + r20，锚点移到 r20
    s = clickSelect(order, s, "r23", both); // + r20–r23
    expect(s.ids).toEqual(["r1", "r2", "r3", "r20", "r21", "r22", "r23"]);
  });
  it("Shift without an anchor starts from the first selected item, or from the click itself", () => {
    expect(clickSelect(order, EMPTY_SELECTION, "r4", shift).ids).toEqual(["r4"]);
    expect(clickSelect(order, { ids: ["r2"], anchor: null }, "r4", shift).ids).toEqual(["r2", "r3", "r4"]);
  });
});

describe("marquee, keyboard and select all", () => {
  it("replaces the selection with what the box covers, or adds to it", () => {
    const base = { ids: ["r1"], anchor: "r1" };
    expect(marqueeSelect(order, base, ["r5", "r6"], false).ids).toEqual(["r5", "r6"]);
    expect(marqueeSelect(order, base, ["r6", "r5"], true).ids).toEqual(["r1", "r5", "r6"]);
    expect(marqueeSelect(order, base, [], false).ids).toEqual([]);
  });
  it("Shift+arrow grows and shrinks around the anchor", () => {
    let s: SelectionState = { ids: ["r5"], anchor: "r5" };
    let cursor = "r5";
    ({ state: s, cursor } = extendSelection(order, s, cursor, 1));
    ({ state: s, cursor } = extendSelection(order, s, cursor, 1));
    expect(s.ids).toEqual(["r5", "r6", "r7"]);
    ({ state: s, cursor } = extendSelection(order, s, cursor, -1));
    expect(s.ids).toEqual(["r5", "r6"]);
    ({ state: s, cursor } = extendSelection(order, s, cursor, -1));
    ({ state: s, cursor } = extendSelection(order, s, cursor, -1));
    expect(s.ids).toEqual(["r4", "r5"]); // 越过锚点向上继续扩
    expect(cursor).toBe("r4");
  });
  it("starts from the focused row when nothing is selected, and stops at the ends", () => {
    expect(extendSelection(order, EMPTY_SELECTION, "r1", 1).state.ids).toEqual(["r1", "r2"]);
    expect(extendSelection(order, EMPTY_SELECTION, "r1", -1).state.ids).toEqual(["r1"]);
    expect(extendSelection(order, EMPTY_SELECTION, "r40", 1).state.ids).toEqual(["r40"]);
  });
  it("selects all", () => {
    expect(selectAll(order).ids).toHaveLength(40);
    expect(selectAll([])).toEqual(EMPTY_SELECTION);
  });
  it("ranges ignore unknown ids", () => {
    expect(rangeIds(order, "nope", "r3")).toEqual(["r3"]);
    expect(rangeIds(order, "r3", "nope")).toEqual([]);
  });
});

describe("rectangles", () => {
  it("normalises dragged points and tests overlap (touching edges do not count)", () => {
    const r = rectFromPoints(50, 80, 10, 20);
    expect(r).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
    expect(rectsIntersect(r, { left: 40, top: 70, right: 90, bottom: 120 })).toBe(true);
    expect(rectsIntersect(r, { left: 50, top: 20, right: 90, bottom: 80 })).toBe(false);
    expect(rectsIntersect(r, { left: 60, top: 100, right: 90, bottom: 120 })).toBe(false);
  });
});
