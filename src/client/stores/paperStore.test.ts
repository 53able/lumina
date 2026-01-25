import { parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../db/db";

/**
 * paperStore テスト
 *
 * Design Docsに基づく仕様:
 * - 論文データの管理（CRUD操作）
 * - IndexedDBへの永続化
 * - カテゴリフィルタリング
 */

// モックDB
let mockDb: LuminaDB;

// テスト用のサンプル論文データ
const createSamplePaper = (overrides: Partial<Paper> = {}): Paper => ({
  id: "2401.00001",
  title: "Sample Paper Title",
  abstract: "This is a sample abstract.",
  authors: ["Author A", "Author B"],
  categories: ["cs.AI", "cs.LG"],
  publishedAt: parseISO("2024-01-01"),
  updatedAt: parseISO("2024-01-02"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
  embedding: Array(1536).fill(0.1),
  ...overrides,
});

describe("paperStore", () => {
  let testDbCounter = 0;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`paperStore-test-${testDbCounter}`);
  });

  afterEach(async () => {
    await mockDb.delete();
    vi.resetAllMocks();
  });

  describe("初期化", () => {
    it("正常系: 空の状態で初期化される", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const state = usePaperStore.getState();

      expect(state.papers).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it("正常系: IndexedDBから既存データをロードする", async () => {
      // Arrange - DBに事前にデータを入れておく
      const existingPaper = createSamplePaper();
      await mockDb.papers.add(existingPaper);

      // Act
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const state = usePaperStore.getState();

      // Assert
      expect(state.papers).toHaveLength(1);
      expect(state.papers[0]?.id).toBe("2401.00001");
    });
  });

  describe("論文の追加", () => {
    it("正常系: 論文を追加できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const paper = createSamplePaper();

      // Act
      await usePaperStore.getState().addPaper(paper);

      // Assert - Store
      const state = usePaperStore.getState();
      expect(state.papers).toHaveLength(1);
      expect(state.papers[0]?.id).toBe("2401.00001");

      // Assert - IndexedDB永続化
      const dbPaper = await mockDb.papers.get("2401.00001");
      expect(dbPaper).toBeDefined();
      expect(dbPaper?.title).toBe("Sample Paper Title");
    });

    it("正常系: 複数の論文を一括追加できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const papers = [
        createSamplePaper({ id: "2401.00001" }),
        createSamplePaper({ id: "2401.00002", title: "Second Paper" }),
        createSamplePaper({ id: "2401.00003", title: "Third Paper" }),
      ];

      // Act
      await usePaperStore.getState().addPapers(papers);

      // Assert
      const state = usePaperStore.getState();
      expect(state.papers).toHaveLength(3);

      const dbPapers = await mockDb.papers.toArray();
      expect(dbPapers).toHaveLength(3);
    });

    it("正常系: 既存の論文を更新する（upsert）", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const paper = createSamplePaper();
      await usePaperStore.getState().addPaper(paper);

      // Act - 同じIDで更新
      const updatedPaper = createSamplePaper({ title: "Updated Title" });
      await usePaperStore.getState().addPaper(updatedPaper);

      // Assert
      const state = usePaperStore.getState();
      expect(state.papers).toHaveLength(1);
      expect(state.papers[0]?.title).toBe("Updated Title");
    });
  });

  describe("論文の取得", () => {
    it("正常系: IDで論文を取得できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const paper = createSamplePaper();
      await usePaperStore.getState().addPaper(paper);

      // Act
      const retrieved = usePaperStore.getState().getPaperById("2401.00001");

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("2401.00001");
    });

    it("正常系: 存在しないIDはundefinedを返す", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      // Act
      const retrieved = usePaperStore.getState().getPaperById("nonexistent");

      // Assert
      expect(retrieved).toBeUndefined();
    });
  });

  describe("論文の削除", () => {
    it("正常系: IDで論文を削除できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const paper = createSamplePaper();
      await usePaperStore.getState().addPaper(paper);

      // Act
      await usePaperStore.getState().deletePaper("2401.00001");

      // Assert - Store
      const state = usePaperStore.getState();
      expect(state.papers).toHaveLength(0);

      // Assert - IndexedDB
      const dbPaper = await mockDb.papers.get("2401.00001");
      expect(dbPaper).toBeUndefined();
    });
  });

  describe("全論文のクリア", () => {
    it("正常系: 全論文を削除できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      await usePaperStore
        .getState()
        .addPapers([
          createSamplePaper({ id: "2401.00001" }),
          createSamplePaper({ id: "2401.00002" }),
        ]);

      // Act
      await usePaperStore.getState().clearAllPapers();

      // Assert - Store
      const state = usePaperStore.getState();
      expect(state.papers).toHaveLength(0);

      // Assert - IndexedDB
      const dbPapers = await mockDb.papers.toArray();
      expect(dbPapers).toHaveLength(0);
    });
  });

  describe("論文のフィルタリング", () => {
    it("正常系: カテゴリでフィルタリングできる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      await usePaperStore
        .getState()
        .addPapers([
          createSamplePaper({ id: "2401.00001", categories: ["cs.AI"] }),
          createSamplePaper({ id: "2401.00002", categories: ["cs.LG"] }),
          createSamplePaper({ id: "2401.00003", categories: ["cs.AI", "cs.LG"] }),
        ]);

      // Act
      const aiPapers = usePaperStore.getState().getPapersByCategory("cs.AI");

      // Assert
      expect(aiPapers).toHaveLength(2);
      expect(aiPapers.map((p) => p.id)).toContain("2401.00001");
      expect(aiPapers.map((p) => p.id)).toContain("2401.00003");
    });
  });

  describe("論文数の取得", () => {
    it("正常系: 論文数を取得できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      await usePaperStore
        .getState()
        .addPapers([
          createSamplePaper({ id: "2401.00001" }),
          createSamplePaper({ id: "2401.00002" }),
        ]);

      // Act
      const count = usePaperStore.getState().getPaperCount();

      // Assert
      expect(count).toBe(2);
    });
  });
});
