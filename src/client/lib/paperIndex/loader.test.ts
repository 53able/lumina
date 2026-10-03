import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Paper } from "../../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../../db/db";
import { streamPapers } from "./loader";

const createPaper = (index: number): Paper => {
  // 公開日は index が大きいほど新しい
  const publishedAt = new Date(Date.UTC(2024, 0, 1) + index * 60_000);
  return {
    id: `paper-${String(index).padStart(4, "0")}`,
    title: `Title ${index}`,
    abstract: "Abstract",
    authors: ["Author"],
    categories: ["cs.AI"],
    publishedAt,
    updatedAt: publishedAt,
    pdfUrl: "https://arxiv.org/pdf/paper.pdf",
    arxivUrl: "https://arxiv.org/abs/paper",
    embedding: [index, 1],
  };
};

describe("streamPapers", () => {
  let db: LuminaDB;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    db = createLuminaDb(`loader-test-${counter}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  const collect = async (firstBatchSize: number, batchSize: number) => {
    const totals: number[] = [];
    const batches: { ids: string[]; loadedCount: number }[] = [];
    const loaded = await streamPapers(db, {
      firstBatchSize,
      batchSize,
      onTotal: (total) => totals.push(total),
      onBatch: (papers, loadedCount) => batches.push({ ids: papers.map((p) => p.id), loadedCount }),
    });
    return { totals, batches, loaded };
  };

  it("空のDBでは総件数0でバッチを送らない", async () => {
    const { totals, batches, loaded } = await collect(100, 2000);

    expect(totals).toEqual([0]);
    expect(batches).toEqual([]);
    expect(loaded).toBe(0);
  });

  it("少量なら先頭バッチだけで全件を送る", async () => {
    await db.papers.bulkAdd([createPaper(0), createPaper(2), createPaper(1)]);

    const { totals, batches, loaded } = await collect(100, 2000);

    expect(totals).toEqual([3]);
    expect(batches).toEqual([{ ids: ["paper-0002", "paper-0001", "paper-0000"], loadedCount: 3 }]);
    expect(loaded).toBe(3);
  });

  it("先頭バッチは firstBatchSize 件、以降は batchSize 件ごとに公開日の降順で送る", async () => {
    await db.papers.bulkAdd(Array.from({ length: 23 }, (_, i) => createPaper(i)));

    const { totals, batches, loaded } = await collect(5, 8);

    expect(totals).toEqual([23]);
    expect(batches.map((b) => b.ids.length)).toEqual([5, 8, 8, 2]);
    expect(batches.map((b) => b.loadedCount)).toEqual([5, 13, 21, 23]);
    const ids = batches.flatMap((b) => b.ids);
    expect(ids).toEqual(
      Array.from({ length: 23 }, (_, i) => `paper-${String(22 - i).padStart(4, "0")}`)
    );
    expect(loaded).toBe(23);
  });

  it("先頭バッチを総件数より先に送る（件数の取得で先頭の論文の表示を待たせない）", async () => {
    await db.papers.bulkAdd(Array.from({ length: 23 }, (_, i) => createPaper(i)));

    const events: string[] = [];
    await streamPapers(db, {
      firstBatchSize: 5,
      batchSize: 8,
      onTotal: (total) => events.push(`total:${total}`),
      onBatch: (_papers, loadedCount) => events.push(`batch:${loadedCount}`),
    });

    expect(events[0]).toBe("batch:5");
    expect(events).toContain("total:23");
  });

  it("バッチ境界ちょうどの件数でも空のバッチを送らない", async () => {
    await db.papers.bulkAdd(Array.from({ length: 13 }, (_, i) => createPaper(i)));

    const { batches } = await collect(5, 8);

    expect(batches.map((b) => b.ids.length)).toEqual([5, 8]);
  });

  it("従来の全件読み込み（toArray）と同じ順序・内容になる", async () => {
    await db.papers.bulkAdd(Array.from({ length: 40 }, (_, i) => createPaper((i * 7) % 40)));
    const expected = await db.papers.orderBy("publishedAt").reverse().toArray();

    const received: Paper[] = [];
    await streamPapers(db, {
      firstBatchSize: 3,
      batchSize: 10,
      onTotal: () => {},
      onBatch: (papers) => received.push(...papers),
    });

    expect(received).toEqual(expected);
  });
});
