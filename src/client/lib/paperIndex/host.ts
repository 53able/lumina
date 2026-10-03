import type { LuminaDB } from "../../db/schema";
import { createPaperEmbeddingIndex, toPaperListItem } from "./core";
import { streamPapers } from "./loader";
import type { PaperIndexRequest, PaperIndexResponse } from "./protocol";

/** 索引側で開く DB と、読み込み後の後始末 */
export interface PaperIndexDbHandle {
  db: LuminaDB;
  /** 全件の読み込み後に呼ぶ（Worker は DB を閉じ、以降の更新は索引だけに反映する） */
  release: () => void;
}

/** createPaperIndexHost の依存 */
interface PaperIndexHostDeps {
  /** 画面へ応答を送る */
  post: (response: PaperIndexResponse) => void;
  /** 読み込む DB を開く */
  openDb: (dbName: string) => PaperIndexDbHandle;
}

/** 例外からメッセージを取り出す */
const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 論文索引の処理本体（Web Worker と、Worker を使えない環境の同一スレッド版で共有する）
 *
 * - load: 保存済みの論文をバッチで読み込み、Embedding は索引へ、一覧用の論文は画面へ送る
 * - upsert: 画面側で保存した論文の Embedding を索引へ反映する
 * - search: 索引を検索して一致した論文 ID とスコアを返す
 */
export const createPaperIndexHost = ({ post, openDb }: PaperIndexHostDeps) => {
  const index = createPaperEmbeddingIndex();

  const load = async (request: Extract<PaperIndexRequest, { type: "load" }>): Promise<void> => {
    let dbHandle: PaperIndexDbHandle | null = null;
    try {
      dbHandle = openDb(request.dbName);
      const loadedCount = await streamPapers(dbHandle.db, {
        firstBatchSize: request.firstBatchSize,
        batchSize: request.batchSize,
        onTotal: (total) => post({ type: "progress", total }),
        onBatch: (papers, count) => {
          index.upsert(papers);
          post({ type: "batch", papers: papers.map(toPaperListItem), loadedCount: count });
        },
      });
      post({ type: "loaded", loadedCount });
    } catch (error) {
      post({ type: "loadError", message: toMessage(error) });
    } finally {
      dbHandle?.release();
    }
  };

  const handle = (request: PaperIndexRequest): void => {
    switch (request.type) {
      case "load":
        void load(request);
        return;
      case "upsert":
        index.upsert(request.papers);
        return;
      case "search":
        try {
          const { matches, totalMatchCount } = index.search(
            request.queryEmbedding,
            request.scoreThreshold,
            request.limit
          );
          post({ type: "searchResult", requestId: request.requestId, matches, totalMatchCount });
        } catch (error) {
          post({ type: "searchError", requestId: request.requestId, message: toMessage(error) });
        }
        return;
    }
  };

  return { handle };
};
