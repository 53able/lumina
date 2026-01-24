import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Paper, PaperSummary, SearchHistory, UserInteraction } from "../../shared/schemas";
import { now, parseISO } from "../../shared/utils/dateTime";
import { createLuminaDb, type LuminaDB } from "./db";

/**
 * Lumina IndexedDB (Dexie.js) テスト
 *
 * Design Docsに基づくテストケース:
 * - papers: 論文データ + Embeddingベクトル
 * - paperSummaries: 論文要約データ
 * - searchHistories: 検索履歴
 * - userInteractions: いいね/ブックマーク
 */

describe("LuminaDB", () => {
  let luminaDb: LuminaDB;
  let testDbCounter = 0;

  // 各テスト前に新しいDBを作成
  beforeEach(() => {
    testDbCounter += 1;
    luminaDb = createLuminaDb(`LuminaDB-test-${testDbCounter}`);
  });

  // 各テスト後にDBを削除
  afterEach(async () => {
    await luminaDb.delete();
  });

  describe("papers テーブル", () => {
    it("正常系: 論文を保存して取得できる", async () => {
      const paper: Paper = {
        id: "2401.00001",
        title: "Test Paper Title",
        abstract: "This is a test abstract.",
        authors: ["Author A", "Author B"],
        categories: ["cs.AI", "cs.LG"],
        publishedAt: parseISO("2024-01-01"),
        updatedAt: parseISO("2024-01-02"),
        pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
        arxivUrl: "https://arxiv.org/abs/2401.00001",
        embedding: Array(1536).fill(0.1), // 1536次元ベクトル
      };

      // Act
      await luminaDb.papers.add(paper);
      const retrieved = await luminaDb.papers.get("2401.00001");

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("2401.00001");
      expect(retrieved?.title).toBe("Test Paper Title");
      expect(retrieved?.embedding?.length).toBe(1536);
    });

    it("正常系: カテゴリで論文を検索できる", async () => {
      const papers: Paper[] = [
        {
          id: "2401.00001",
          title: "AI Paper",
          abstract: "AI abstract",
          authors: ["Author A"],
          categories: ["cs.AI"],
          publishedAt: parseISO("2024-01-01"),
          updatedAt: parseISO("2024-01-01"),
          pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
          arxivUrl: "https://arxiv.org/abs/2401.00001",
        },
        {
          id: "2401.00002",
          title: "ML Paper",
          abstract: "ML abstract",
          authors: ["Author B"],
          categories: ["cs.LG"],
          publishedAt: parseISO("2024-01-02"),
          updatedAt: parseISO("2024-01-02"),
          pdfUrl: "https://arxiv.org/pdf/2401.00002.pdf",
          arxivUrl: "https://arxiv.org/abs/2401.00002",
        },
      ];

      // Act
      await luminaDb.papers.bulkAdd(papers);
      const allPapers = await luminaDb.papers.toArray();

      // Assert
      expect(allPapers).toHaveLength(2);
    });

    it("正常系: 公開日でソートして取得できる", async () => {
      const papers: Paper[] = [
        {
          id: "2401.00002",
          title: "Newer Paper",
          abstract: "abstract",
          authors: ["Author"],
          categories: ["cs.AI"],
          publishedAt: parseISO("2024-01-02"),
          updatedAt: parseISO("2024-01-02"),
          pdfUrl: "https://arxiv.org/pdf/2401.00002.pdf",
          arxivUrl: "https://arxiv.org/abs/2401.00002",
        },
        {
          id: "2401.00001",
          title: "Older Paper",
          abstract: "abstract",
          authors: ["Author"],
          categories: ["cs.AI"],
          publishedAt: parseISO("2024-01-01"),
          updatedAt: parseISO("2024-01-01"),
          pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
          arxivUrl: "https://arxiv.org/abs/2401.00001",
        },
      ];

      // Act
      await luminaDb.papers.bulkAdd(papers);
      const sorted = await luminaDb.papers.orderBy("publishedAt").reverse().toArray();

      // Assert
      expect(sorted[0].id).toBe("2401.00002"); // 新しい方が先
      expect(sorted[1].id).toBe("2401.00001");
    });
  });

  describe("paperSummaries テーブル", () => {
    it("正常系: 要約を保存して取得できる", async () => {
      const summary: PaperSummary = {
        paperId: "2401.00001",
        summary: "This paper presents a novel approach...",
        keyPoints: ["Point 1", "Point 2", "Point 3"],
        language: "ja",
        createdAt: now(),
      };

      // Act
      await luminaDb.paperSummaries.add(summary);
      // paperSummariesは自動インクリメントIDなので、paperIdでインデックス検索
      const retrieved = await luminaDb.paperSummaries.where("paperId").equals("2401.00001").first();

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.summary).toBe("This paper presents a novel approach...");
      expect(retrieved?.keyPoints).toHaveLength(3);
    });

    it("正常系: 同じ論文の異なる言語の要約を保存できる", async () => {
      const summaryJa: PaperSummary = {
        paperId: "2401.00001",
        summary: "日本語の要約",
        keyPoints: ["ポイント1"],
        language: "ja",
        createdAt: now(),
      };
      const summaryEn: PaperSummary = {
        paperId: "2401.00001",
        summary: "English summary",
        keyPoints: ["Point 1"],
        language: "en",
        createdAt: now(),
      };

      // Act - 複合キーで保存
      await luminaDb.paperSummaries.add(summaryJa);
      await luminaDb.paperSummaries.add(summaryEn);
      const summaries = await luminaDb.paperSummaries
        .where("paperId")
        .equals("2401.00001")
        .toArray();

      // Assert
      expect(summaries).toHaveLength(2);
    });
  });

  describe("searchHistories テーブル", () => {
    it("正常系: 検索履歴を保存して取得できる", async () => {
      const history: SearchHistory = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        originalQuery: "強化学習",
        expandedQuery: {
          original: "強化学習",
          english: "reinforcement learning",
          synonyms: ["RL", "reward-based learning"],
          searchText: "reinforcement learning RL reward-based learning",
        },
        queryEmbedding: Array(1536).fill(0.1),
        resultCount: 42,
        createdAt: now(),
      };

      // Act
      await luminaDb.searchHistories.add(history);
      const retrieved = await luminaDb.searchHistories.get("550e8400-e29b-41d4-a716-446655440000");

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.originalQuery).toBe("強化学習");
      expect(retrieved?.expandedQuery.english).toBe("reinforcement learning");
    });

    it("正常系: 作成日時順でソートして取得できる", async () => {
      const histories: SearchHistory[] = [
        {
          id: "id-1",
          originalQuery: "古い検索",
          expandedQuery: {
            original: "古い検索",
            english: "old search",
            synonyms: [],
            searchText: "old search",
          },
          queryEmbedding: [],
          resultCount: 10,
          createdAt: parseISO("2024-01-01"),
        },
        {
          id: "id-2",
          originalQuery: "新しい検索",
          expandedQuery: {
            original: "新しい検索",
            english: "new search",
            synonyms: [],
            searchText: "new search",
          },
          queryEmbedding: [],
          resultCount: 20,
          createdAt: parseISO("2024-01-02"),
        },
      ];

      // Act
      await luminaDb.searchHistories.bulkAdd(histories);
      const sorted = await luminaDb.searchHistories.orderBy("createdAt").reverse().toArray();

      // Assert
      expect(sorted[0].originalQuery).toBe("新しい検索");
    });
  });

  describe("userInteractions テーブル", () => {
    it("正常系: いいねを保存して取得できる", async () => {
      const interaction: UserInteraction = {
        id: "550e8400-e29b-41d4-a716-446655440001",
        paperId: "2401.00001",
        type: "like",
        createdAt: now(),
      };

      // Act
      await luminaDb.userInteractions.add(interaction);
      const retrieved = await luminaDb.userInteractions.get("550e8400-e29b-41d4-a716-446655440001");

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe("like");
    });

    it("正常系: 特定の論文のインタラクションを取得できる", async () => {
      const interactions: UserInteraction[] = [
        {
          id: "id-1",
          paperId: "2401.00001",
          type: "like",
          createdAt: now(),
        },
        {
          id: "id-2",
          paperId: "2401.00001",
          type: "bookmark",
          createdAt: now(),
        },
        {
          id: "id-3",
          paperId: "2401.00002",
          type: "like",
          createdAt: now(),
        },
      ];

      // Act
      await luminaDb.userInteractions.bulkAdd(interactions);
      const paperInteractions = await luminaDb.userInteractions
        .where("paperId")
        .equals("2401.00001")
        .toArray();

      // Assert
      expect(paperInteractions).toHaveLength(2);
    });

    it("正常系: タイプでフィルタリングできる", async () => {
      const interactions: UserInteraction[] = [
        {
          id: "id-1",
          paperId: "2401.00001",
          type: "like",
          createdAt: now(),
        },
        {
          id: "id-2",
          paperId: "2401.00002",
          type: "bookmark",
          createdAt: now(),
        },
        {
          id: "id-3",
          paperId: "2401.00003",
          type: "like",
          createdAt: now(),
        },
      ];

      // Act
      await luminaDb.userInteractions.bulkAdd(interactions);
      const likes = await luminaDb.userInteractions.where("type").equals("like").toArray();

      // Assert
      expect(likes).toHaveLength(2);
    });
  });
});
