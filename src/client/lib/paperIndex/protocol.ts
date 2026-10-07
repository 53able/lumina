/**
 * 画面と論文索引（Web Worker）のメッセージ型
 *
 * 画面へ送る論文は一覧用（PaperListItem）だけで、Embedding 本体は送らない。
 */
import type { PaperEmbeddingInput, PaperListItem, PaperSearchMatch } from "./core";

/** 画面 → 索引 */
export type PaperIndexRequest =
  | {
      type: "load";
      /** 読み込む IndexedDB の名前 */
      dbName: string;
      firstBatchSize: number;
      batchSize: number;
    }
  | {
      /** 新規・更新した論文だけを索引へ反映する（全件は再送しない） */
      type: "upsert";
      papers: PaperEmbeddingInput[];
    }
  | {
      type: "search";
      requestId: number;
      queryEmbedding: number[];
      scoreThreshold: number;
      limit: number;
    }
  | {
      /**
       * 実行中の検索を中止する。索引は類似度の計算をチャンクの合間で打ち切り、結果を返さない。
       * 終了済み・未知の requestId は無視する。
       */
      type: "cancelSearch";
      requestId: number;
    };

/** 索引 → 画面 */
export type PaperIndexResponse =
  | { type: "progress"; total: number }
  | { type: "batch"; papers: PaperListItem[]; loadedCount: number }
  | { type: "loaded"; loadedCount: number }
  | { type: "loadError"; message: string }
  | {
      type: "searchResult";
      requestId: number;
      matches: PaperSearchMatch[];
      totalMatchCount: number;
    }
  | { type: "searchError"; requestId: number; message: string };
