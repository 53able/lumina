/**
 * paperStore・検索のテスト用ヘルパー
 *
 * 本物の paperStore を使うテストで、段階読み込みを経ずに「全件準備済み」の状態を作る。
 * 検索用索引は Worker を使わず同じスレッドで動かす。
 */
import type { Paper } from "../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { createInProcessPaperIndexClient } from "../lib/paperIndex/client";
import {
  createPaperEmbeddingIndex,
  type PaperSearchSource,
  toPaperListItem,
} from "../lib/paperIndex/core";
import { usePaperStore } from "../stores/paperStore";

/**
 * paperStore を全件準備済みの状態にする
 *
 * @param papers 一覧と検索用索引に入れる論文（一覧は渡した順のまま）
 * @param db addPaper / addPapers で保存する DB（省略時は保存できない）
 */
export const seedPaperStoreForTest = (papers: Paper[], db: LuminaDB | null = null): void => {
  usePaperStore.getState()._index?.dispose();
  const index = createInProcessPaperIndexClient(db ?? createLuminaDb("paper-store-test-seed"));
  index.upsert(papers);
  usePaperStore.setState({
    papers: papers.map(toPaperListItem),
    loadStatus: "ready",
    isLoading: false,
    loadedCount: papers.length,
    totalCount: papers.length,
    loadError: null,
    _db: db,
    _index: index,
  });
};

/**
 * paperStore を初期状態に戻す（索引も破棄する）
 */
export const resetPaperStoreForTest = (): void => {
  usePaperStore.getState()._index?.dispose();
  usePaperStore.setState({
    papers: [],
    loadStatus: "idle",
    isLoading: false,
    loadedCount: 0,
    totalCount: null,
    loadError: null,
    _db: null,
    _index: null,
  });
};

/**
 * 渡した論文だけを対象にする検索の実行元を作る（useSemanticSearch の searchSource 用）
 * 全件準備済みとして扱い、検索のたびに索引を作り直す。
 *
 * @param papers 検索対象の論文（Embedding 付き）
 */
export const createTestSearchSource = (papers: Paper[]): PaperSearchSource => ({
  isReady: () => true,
  whenReady: async () => {},
  search: async (queryEmbedding, scoreThreshold, limit) => {
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);
    return index.search(queryEmbedding, scoreThreshold, limit);
  },
});
