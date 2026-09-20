import { describe, expect, it } from "vitest";
import { layoutDay } from "./layout";

describe("layoutDay", () => {
  it("gives a lone block the full width", () => {
    expect(layoutDay([{ id: "a", start: 9, end: 10 }])).toEqual({ a: { col: 0, cols: 1 } });
  });
  it("keeps back-to-back blocks in one column", () => {
    const l = layoutDay([
      { id: "a", start: 9, end: 10 },
      { id: "b", start: 10, end: 11 },
    ]);
    expect(l.a).toEqual({ col: 0, cols: 1 });
    expect(l.b).toEqual({ col: 0, cols: 1 });
  });
  it("puts overlapping blocks side by side with the same column count", () => {
    const l = layoutDay([
      { id: "a", start: 9, end: 11 },
      { id: "b", start: 10, end: 12 },
      { id: "c", start: 10.5, end: 11 },
    ]);
    expect(l.a).toEqual({ col: 0, cols: 3 });
    expect(l.b).toEqual({ col: 1, cols: 3 });
    expect(l.c).toEqual({ col: 2, cols: 3 });
  });
  it("reuses a freed column and sizes each cluster on its own", () => {
    const l = layoutDay([
      { id: "a", start: 9, end: 10 },
      { id: "b", start: 9.5, end: 11 },
      { id: "c", start: 10, end: 10.5 },
      { id: "far", start: 14, end: 15 },
    ]);
    expect(l.c).toEqual({ col: 0, cols: 2 }); // 顶掉 a 空出来的第一列
    expect(l.far).toEqual({ col: 0, cols: 1 });
  });
});
