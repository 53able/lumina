import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLuminaDb, type LuminaDB } from "../db/db";
import type { PaperSummary } from "../../shared/schemas";
import { now } from "../../shared/utils/dateTime";

/**
 * summaryStore テスト
 *
 * Design Docsに基づく仕様:
 * - 論文要約の管理（CRUD操作）
 * - IndexedDBへの永続化
 * - 言語別の要約取得
 */

// モックDB
let mockDb: LuminaDB;

// テスト用のサンプル要約データ
const createSampleSummary = (overrides: Partial<PaperSummary> = {}): PaperSummary => ({
  paperId: "2401.00001",
  summary: "この論文は強化学習の新しいアプローチを提案しています。",
  keyPoints: ["新しいアルゴリズム", "高い性能", "実用的な応用"],
  language: "ja",
  createdAt: now(),
  ...overrides,
});

describe("summaryStore", () => {
  let testDbCounter = 0;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`summaryStore-test-${testDbCounter}`);
  });

  afterEach(async () => {
    await mockDb.delete();
    vi.resetAllMocks();
  });

  describe("初期化", () => {
    it("正常系: 空の状態で初期化される", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const state = useSummaryStore.getState();

      expect(state.summaries).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it("正常系: IndexedDBから既存データをロードする", async () => {
      // Arrange - DBに事前にデータを入れておく
      const existingSummary = createSampleSummary();
      await mockDb.paperSummaries.add(existingSummary);

      // Act
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const state = useSummaryStore.getState();

      // Assert
      expect(state.summaries).toHaveLength(1);
      expect(state.summaries[0].paperId).toBe("2401.00001");
    });
  });

  describe("要約の追加", () => {
    it("正常系: 要約を追加できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const summary = createSampleSummary();

      // Act
      await useSummaryStore.getState().addSummary(summary);

      // Assert - Store
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(1);
      expect(state.summaries[0].summary).toContain("強化学習");

      // Assert - IndexedDB永続化
      const dbSummaries = await mockDb.paperSummaries
        .where("paperId")
        .equals("2401.00001")
        .toArray();
      expect(dbSummaries).toHaveLength(1);
    });

    it("正常系: 同じ論文の異なる言語の要約を追加できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const summaryJa = createSampleSummary({ language: "ja" });
      const summaryEn = createSampleSummary({
        language: "en",
        summary: "This paper proposes a new approach to reinforcement learning.",
      });

      // Act
      await useSummaryStore.getState().addSummary(summaryJa);
      await useSummaryStore.getState().addSummary(summaryEn);

      // Assert
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(2);
    });
  });

  describe("要約の取得", () => {
    it("正常系: 論文IDと言語で要約を取得できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const summaryJa = createSampleSummary({ language: "ja" });
      const summaryEn = createSampleSummary({
        language: "en",
        summary: "English summary",
      });

      await useSummaryStore.getState().addSummary(summaryJa);
      await useSummaryStore.getState().addSummary(summaryEn);

      // Act
      const retrievedJa = useSummaryStore
        .getState()
        .getSummaryByPaperIdAndLanguage("2401.00001", "ja");
      const retrievedEn = useSummaryStore
        .getState()
        .getSummaryByPaperIdAndLanguage("2401.00001", "en");

      // Assert
      expect(retrievedJa).toBeDefined();
      expect(retrievedJa?.summary).toContain("強化学習");
      expect(retrievedEn).toBeDefined();
      expect(retrievedEn?.summary).toBe("English summary");
    });

    it("正常系: 存在しない論文IDはundefinedを返す", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      // Act
      const retrieved = useSummaryStore
        .getState()
        .getSummaryByPaperIdAndLanguage("nonexistent", "ja");

      // Assert
      expect(retrieved).toBeUndefined();
    });

    it("正常系: 論文IDで全言語の要約を取得できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore.getState().addSummary(createSampleSummary({ language: "ja" }));
      await useSummaryStore.getState().addSummary(createSampleSummary({ language: "en" }));

      // Act
      const summaries = useSummaryStore.getState().getSummariesByPaperId("2401.00001");

      // Assert
      expect(summaries).toHaveLength(2);
    });
  });

  describe("要約の削除", () => {
    it("正常系: 論文IDで要約を削除できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore.getState().addSummary(createSampleSummary({ language: "ja" }));
      await useSummaryStore.getState().addSummary(createSampleSummary({ language: "en" }));

      // Act
      await useSummaryStore.getState().deleteSummariesByPaperId("2401.00001");

      // Assert - Store
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(0);

      // Assert - IndexedDB
      const dbSummaries = await mockDb.paperSummaries.toArray();
      expect(dbSummaries).toHaveLength(0);
    });
  });

  describe("全要約のクリア", () => {
    it("正常系: 全要約を削除できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore.getState().addSummary(createSampleSummary({ paperId: "paper1" }));
      await useSummaryStore.getState().addSummary(createSampleSummary({ paperId: "paper2" }));

      // Act
      await useSummaryStore.getState().clearAllSummaries();

      // Assert - Store
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(0);

      // Assert - IndexedDB
      const dbSummaries = await mockDb.paperSummaries.toArray();
      expect(dbSummaries).toHaveLength(0);
    });
  });

  describe("要約の存在確認", () => {
    it("正常系: 要約が存在するか確認できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore
        .getState()
        .addSummary(createSampleSummary({ paperId: "2401.00001", language: "ja" }));

      // Act
      const hasJa = useSummaryStore.getState().hasSummary("2401.00001", "ja");
      const hasEn = useSummaryStore.getState().hasSummary("2401.00001", "en");
      const hasOther = useSummaryStore.getState().hasSummary("other", "ja");

      // Assert
      expect(hasJa).toBe(true);
      expect(hasEn).toBe(false);
      expect(hasOther).toBe(false);
    });
  });
});
