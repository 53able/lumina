import { describe, expect, it } from "vitest";
import { computeMasonryLayout } from "./useMasonryVirtualizer";

interface Item {
  id: string;
  height: number;
}

const items: Item[] = [
  { id: "a", height: 100 },
  { id: "b", height: 200 },
  { id: "c", height: 50 },
  { id: "d", height: 80 },
];

const baseOptions = {
  items,
  getItemId: (item: Item) => item.id,
  expandedItemId: null,
  columnCount: 2,
  itemWidth: 100,
  fullWidth: 216,
  rowGap: 16,
  columnGap: 16,
  estimatedExpandedHeight: 300,
  estimateItemHeight: (item: Item) => item.height + 24,
};

describe("computeMasonryLayout", () => {
  it("places normal cards into the shortest column with deterministic tie-break", () => {
    const result = computeMasonryLayout(baseOptions);

    expect(result.entries).toMatchObject([
      { kind: "card", index: 0, columnIndex: 0, top: 0, left: 0, height: 124 },
      { kind: "card", index: 1, columnIndex: 1, top: 0, left: 116, height: 224 },
      { kind: "card", index: 2, columnIndex: 0, top: 140, left: 0, height: 74 },
      { kind: "card", index: 3, columnIndex: 0, top: 230, left: 0, height: 104 },
    ]);
    expect(result.totalSize).toBe(334);
  });

  it("stacks cards in source order in one-column mode", () => {
    const result = computeMasonryLayout({ ...baseOptions, columnCount: 1, fullWidth: 100 });

    expect(result.entries.map((entry) => entry.top)).toEqual([0, 140, 380, 470]);
    expect(result.entries.every((entry) => entry.kind === "card" && entry.columnIndex === 0)).toBe(
      true
    );
    expect(result.totalSize).toBe(574);
  });

  it("treats expanded item as a full-width interrupt and resumes cards below it", () => {
    const result = computeMasonryLayout({
      ...baseOptions,
      expandedItemId: "c",
      expandedHeight: 320,
    });

    expect(result.entries).toMatchObject([
      { kind: "card", index: 0, columnIndex: 0, top: 0 },
      { kind: "card", index: 1, columnIndex: 1, top: 0 },
      { kind: "expanded", index: 2, top: 240, left: 0, width: 216, height: 320 },
      { kind: "card", index: 3, columnIndex: 0, top: 576 },
    ]);
    expect(result.totalSize).toBe(680);
  });

  it("uses estimated expanded height before measurement", () => {
    const result = computeMasonryLayout({ ...baseOptions, expandedItemId: "a" });

    expect(result.entries[0]).toMatchObject({ kind: "expanded", top: 0, height: 300 });
    expect(result.entries[1]).toMatchObject({ kind: "card", top: 316 });
  });
});
