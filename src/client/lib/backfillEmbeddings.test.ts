/**
 * runBackfillEmbeddings のユニットテスト
 *
 * 対象: Embedding が無い論文に対して並列上限付きで Embedding を取得し addPaper で更新する処理
 */
import { parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { EmbeddingRateLimitError } from "./api";
import { runBackfillEmbeddings } from "./backfillEmbeddings";

/** 日付ヘルパー */
const date = (s: string) => parseISO(s);

/** Embedding なしの論文を1件つくる */
const createPaperWithoutEmbedding = (id: string, title: string, abstract: string): Paper => ({
  id,
  title,
  abstract,
  authors: ["Author"],
  categories: ["cs.AI"],
  publishedAt: date("2024-01-01"),
  updatedAt: date("2024-01-01"),
  pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
  arxivUrl: `https://arxiv.org/abs/${id}`,
});

/** Embedding ありの論文を1件つくる */
const createPaperWithEmbedding = (id: string, title: string, abstract: string): Paper => ({
  ...createPaperWithoutEmbedding(id, title, abstract),
  embedding: Array(1536).fill(0.1),
});

describe("runBackfillEmbeddings", () => {
  const mockFetchEmbedding = vi.fn();
  const mockAddPaper = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchEmbedding.mockResolvedValue(Array(1536).fill(0.1));
    mockAddPaper.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正常系: Embeddingが無い論文が複数あるとき、各論文でfetchEmbeddingとaddPaperが1回ずつ呼ばれる", async () => {
    const papers: Paper[] = [
      createPaperWithoutEmbedding("2401.00001", "Title One", "Abstract One"),
      createPaperWithoutEmbedding("2401.00002", "Title Two", "Abstract Two"),
    ];

    await runBackfillEmbeddings(papers, {
      fetchEmbedding: mockFetchEmbedding,
      addPaper: mockAddPaper,
      getRecommendedConcurrency: () => 3,
    });

    expect(mockFetchEmbedding).toHaveBeenCalledTimes(2);
    expect(mockFetchEmbedding).toHaveBeenNthCalledWith(1, "Title One\n\nAbstract One");
    expect(mockFetchEmbedding).toHaveBeenNthCalledWith(2, "Title Two\n\nAbstract Two");

    expect(mockAddPaper).toHaveBeenCalledTimes(2);
    expect(mockAddPaper).toHaveBeenNthCalledWith(1, {
      ...papers[0],
      embedding: expect.any(Array),
    });
    expect(mockAddPaper).toHaveBeenNthCalledWith(2, {
      ...papers[1],
      embedding: expect.any(Array),
    });
  });

  it("対象なし: 全ての論文に既にembeddingがあるとき、fetchEmbeddingもaddPaperも呼ばれない", async () => {
    const papers: Paper[] = [
      createPaperWithEmbedding("2401.00001", "Title One", "Abstract One"),
      createPaperWithEmbedding("2401.00002", "Title Two", "Abstract Two"),
    ];

    await runBackfillEmbeddings(papers, {
      fetchEmbedding: mockFetchEmbedding,
      addPaper: mockAddPaper,
      getRecommendedConcurrency: () => 2,
    });

    expect(mockFetchEmbedding).not.toHaveBeenCalled();
    expect(mockAddPaper).not.toHaveBeenCalled();
  });

  it("並列上限: getRecommendedConcurrency で 2 を返すとき同時実行数が2を超えない", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;
    mockFetchEmbedding.mockImplementation(async () => {
      concurrentCount += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCount -= 1;
      return Array(1536).fill(0.1);
    });

    const papers: Paper[] = Array.from({ length: 5 }, (_, i) =>
      createPaperWithoutEmbedding(`2401.0000${i}`, `Title ${i}`, `Abstract ${i}`)
    );

    await runBackfillEmbeddings(papers, {
      fetchEmbedding: mockFetchEmbedding,
      addPaper: mockAddPaper,
      getRecommendedConcurrency: () => 2,
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(mockAddPaper).toHaveBeenCalledTimes(5);
  });

  it("getRecommendedConcurrency で 5 を返すとき同時実行数が5を超えない", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;
    mockFetchEmbedding.mockImplementation(async () => {
      concurrentCount += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCount -= 1;
      return Array(1536).fill(0.1);
    });

    const papers: Paper[] = Array.from({ length: 12 }, (_, i) =>
      createPaperWithoutEmbedding(`2401.0000${i}`, `Title ${i}`, `Abstract ${i}`)
    );

    await runBackfillEmbeddings(papers, {
      fetchEmbedding: mockFetchEmbedding,
      addPaper: mockAddPaper,
      getRecommendedConcurrency: () => 5,
    });

    expect(maxConcurrent).toBeLessThanOrEqual(5);
    expect(mockAddPaper).toHaveBeenCalledTimes(12);
  });

  it("対象が0件（空配列）のとき、fetchEmbeddingもaddPaperも呼ばれない", async () => {
    await runBackfillEmbeddings([], {
      fetchEmbedding: mockFetchEmbedding,
      addPaper: mockAddPaper,
      getRecommendedConcurrency: () => 1,
    });

    expect(mockFetchEmbedding).not.toHaveBeenCalled();
    expect(mockAddPaper).not.toHaveBeenCalled();
  });

  it("embeddingが空配列の論文は対象になる", async () => {
    const paper = createPaperWithoutEmbedding("2401.00001", "Title", "Abstract");
    (paper as Paper).embedding = [];

    await runBackfillEmbeddings([paper], {
      fetchEmbedding: mockFetchEmbedding,
      addPaper: mockAddPaper,
      getRecommendedConcurrency: () => 1,
    });

    expect(mockFetchEmbedding).toHaveBeenCalledTimes(1);
    expect(mockFetchEmbedding).toHaveBeenCalledWith("Title\n\nAbstract");
    expect(mockAddPaper).toHaveBeenCalledTimes(1);
  });

  it("429 が出た時点で新規取得を止め、完了分だけ保存して resolve する（次回再開）", async () => {
    const papers: Paper[] = [
      createPaperWithoutEmbedding("2401.00001", "Title One", "Abstract One"),
      createPaperWithoutEmbedding("2401.00002", "Title Two", "Abstract Two"),
      createPaperWithoutEmbedding("2401.00003", "Title Three", "Abstract Three"),
    ];
    mockFetchEmbedding
      .mockResolvedValueOnce(Array(1536).fill(0.1))
      .mockRejectedValueOnce(new EmbeddingRateLimitError());

    await runBackfillEmbeddings(papers, {
      fetchEmbedding: mockFetchEmbedding,
      addPaper: mockAddPaper,
      getRecommendedConcurrency: () => 2,
    });

    expect(mockFetchEmbedding).toHaveBeenCalledTimes(2);
    expect(mockFetchEmbedding).toHaveBeenNthCalledWith(1, "Title One\n\nAbstract One");
    expect(mockFetchEmbedding).toHaveBeenNthCalledWith(2, "Title Two\n\nAbstract Two");
    expect(mockAddPaper).toHaveBeenCalledTimes(1);
    expect(mockAddPaper).toHaveBeenCalledWith({
      ...papers[0],
      embedding: expect.any(Array),
    });
  });
});
