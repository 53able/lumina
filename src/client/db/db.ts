import Dexie, { type EntityTable } from "dexie";
import type { Paper, PaperSummary, SearchHistory, UserInteraction } from "@/shared/schemas";

/**
 * Lumina IndexedDB スキーマ定義
 *
 * Design Docsに基づくテーブル構成:
 * - papers: arXiv論文のメタデータとEmbeddingベクトル
 * - paperSummaries: LLMが生成した論文要約とキーポイント
 * - searchHistories: 検索クエリと拡張結果、再検索用ベクトル
 * - userInteractions: ユーザーのいいね・ブックマーク・閲覧履歴
 */
export class LuminaDB extends Dexie {
  /** arXiv論文テーブル */
  papers!: EntityTable<Paper, "id">;

  /** 論文要約テーブル（複合インデックス: paperId + language） */
  paperSummaries!: EntityTable<PaperSummary, "paperId">;

  /** 検索履歴テーブル */
  searchHistories!: EntityTable<SearchHistory, "id">;

  /** ユーザーインタラクションテーブル */
  userInteractions!: EntityTable<UserInteraction, "id">;

  constructor(name = "LuminaDB") {
    super(name);

    this.version(1).stores({
      // papers: id（プライマリキー）, publishedAt（ソート用）, categories（フィルタ用）
      papers: "id, publishedAt, *categories",

      // paperSummaries: 自動ID, paperId（検索用）, language（フィルタ用）
      // 複合インデックスで同じ論文の異なる言語の要約を許可
      paperSummaries: "++, paperId, language, [paperId+language]",

      // searchHistories: id（UUID）, createdAt（ソート用）
      searchHistories: "id, createdAt",

      // userInteractions: id（UUID）, paperId（検索用）, type（フィルタ用）
      userInteractions: "id, paperId, type",
    });
  }

  /**
   * 全テーブルのデータをクリアする
   * テスト用途に使用
   */
  async clearAll(): Promise<void> {
    await this.papers.clear();
    await this.paperSummaries.clear();
    await this.searchHistories.clear();
    await this.userInteractions.clear();
  }
}

/**
 * テスト用のDB生成関数
 * @param name DBの名前（テストごとにユニークにする）
 */
export const createLuminaDb = (name = "LuminaDB"): LuminaDB => {
  return new LuminaDB(name);
};

/**
 * Lumina DBのシングルトンインスタンス
 */
export const luminaDb = new LuminaDB();
