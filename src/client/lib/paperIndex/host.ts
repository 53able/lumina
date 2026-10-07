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
 * 処理中のメッセージ（中止・後続の検索など）を先に受け取れるよう、イベントループへ処理を返す。
 * setTimeout(0) の最短間隔の制限（入れ子で 4ms）を避けるため MessageChannel を使う。
 */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });

/**
 * 論文索引の処理本体（Web Worker と、Worker を使えない環境の同一スレッド版で共有する）
 *
 * - load: 保存済みの論文をバッチで読み込み、Embedding は索引へ、一覧用の論文は画面へ送る
 * - upsert: 画面側で保存した論文の Embedding を索引へ反映する
 * - search: 索引を検索して一致した論文 ID とスコアを返す。類似度はチャンクに分けて計算し、
 *   チャンクの合間に届いた cancelSearch で打ち切る（結果は返さない。後続の検索を待たせない）
 * - cancelSearch: 実行中の検索を中止する
 */
export const createPaperIndexHost = ({ post, openDb }: PaperIndexHostDeps) => {
  const index = createPaperEmbeddingIndex();
  /** 実行中の検索の requestId（中止された検索はここから外し、チャンクの合間に打ち切る） */
  const runningSearches = new Set<number>();

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

  const search = async (request: Extract<PaperIndexRequest, { type: "search" }>): Promise<void> => {
    const { requestId } = request;
    runningSearches.add(requestId);
    try {
      const task = index.searchInChunks(
        request.queryEmbedding,
        request.scoreThreshold,
        request.limit
      );
      let step = task.next();
      while (!step.done) {
        await yieldToEventLoop();
        if (!runningSearches.has(requestId)) return;
        step = task.next();
      }
      const { matches, totalMatchCount } = step.value;
      post({ type: "searchResult", requestId, matches, totalMatchCount });
    } catch (error) {
      post({ type: "searchError", requestId, message: toMessage(error) });
    } finally {
      runningSearches.delete(requestId);
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
        void search(request);
        return;
      case "cancelSearch":
        runningSearches.delete(request.requestId);
        return;
    }
  };

  return { handle };
};
