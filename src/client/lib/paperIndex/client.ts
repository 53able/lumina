import type { Paper } from "../../../shared/schemas/index";
import type { LuminaDB } from "../../db/schema";
import type { PaperListItem, PaperSearchMatches } from "./core";
import { createPaperIndexHost } from "./host";
import type { PaperIndexRequest, PaperIndexResponse } from "./protocol";

/** 先頭バッチの件数（最新の論文を先に表示する） */
const FIRST_BATCH_SIZE = 100;

/** 2回目以降のバッチの件数 */
const BATCH_SIZE = 2000;

/**
 * 保存済み論文の読み込み・検索用データの失敗
 * （IndexedDB の読み込み失敗、Worker の起動失敗・異常終了）
 */
export class PaperLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperLoadError";
  }
}

/** 中止した検索の reject に使うエラー */
const createAbortError = (): DOMException => new DOMException("検索を中止しました", "AbortError");

/** 読み込みの進捗と結果を受け取るハンドラー */
export interface PaperIndexLoadHandlers {
  /** 総件数が分かったとき */
  onProgress: (total: number) => void;
  /** 一覧用の論文のバッチが届いたとき（loadedCount はこのバッチまでの累計件数） */
  onBatch: (papers: PaperListItem[], loadedCount: number) => void;
  /** 全件の準備が完了したとき */
  onLoaded: (loadedCount: number) => void;
  /** 読み込みに失敗したとき・完了後に索引が使えなくなったとき */
  onError: (error: PaperLoadError) => void;
}

/** 論文索引のクライアント（画面側から使う） */
export interface PaperIndexClient {
  /** 保存済みの論文を読み込む（1つのクライアントで1回だけ呼ぶ） */
  load: (handlers: PaperIndexLoadHandlers) => void;
  /** 保存した論文の Embedding を索引へ反映する（新規・更新分だけを送る） */
  upsert: (papers: Paper[]) => void;
  /**
   * 索引を検索する。
   * signal で中止すると AbortError で reject し、索引へ中止を送って類似度の計算を打ち切る。
   */
  search: (
    queryEmbedding: number[],
    scoreThreshold: number,
    limit: number,
    signal?: AbortSignal
  ) => Promise<PaperSearchMatches>;
  /** 索引を破棄する（実行中の検索は reject する） */
  dispose: () => void;
}

/** 索引とのメッセージ経路 */
interface PaperIndexChannel {
  send: (request: PaperIndexRequest) => void;
  close: () => void;
}

/**
 * メッセージ経路の上に論文索引のクライアントを作る
 *
 * @param dbName 読み込む IndexedDB の名前
 * @param connect 経路を開く。receive に応答を、fail に経路自体の失敗を渡す
 */
const createPaperIndexClient = (
  dbName: string,
  connect: (
    receive: (response: PaperIndexResponse) => void,
    fail: (error: PaperLoadError) => void
  ) => PaperIndexChannel
): PaperIndexClient => {
  let handlers: PaperIndexLoadHandlers | null = null;
  const pendingSearches = new Map<
    number,
    { resolve: (matches: PaperSearchMatches) => void; reject: (error: Error) => void }
  >();
  let nextRequestId = 0;
  /** 索引が使えなくなった理由（以降の検索はこのエラーで reject する） */
  let failure: PaperLoadError | null = null;
  let disposed = false;

  const rejectPendingSearches = (error: Error) => {
    for (const pending of pendingSearches.values()) pending.reject(error);
    pendingSearches.clear();
  };

  const fail = (error: PaperLoadError) => {
    if (disposed || failure) return;
    failure = error;
    rejectPendingSearches(error);
    handlers?.onError(error);
  };

  const receive = (response: PaperIndexResponse) => {
    if (disposed) return;
    switch (response.type) {
      case "progress":
        handlers?.onProgress(response.total);
        return;
      case "batch":
        handlers?.onBatch(response.papers, response.loadedCount);
        return;
      case "loaded":
        handlers?.onLoaded(response.loadedCount);
        return;
      case "loadError":
        fail(new PaperLoadError(`保存済みの論文を読み込めませんでした: ${response.message}`));
        return;
      case "searchResult":
      case "searchError": {
        const pending = pendingSearches.get(response.requestId);
        if (!pending) return;
        pendingSearches.delete(response.requestId);
        if (response.type === "searchResult") {
          pending.resolve({
            matches: response.matches,
            totalMatchCount: response.totalMatchCount,
          });
        } else {
          pending.reject(new Error(response.message));
        }
        return;
      }
    }
  };

  const channel = connect(receive, fail);

  return {
    load: (loadHandlers) => {
      handlers = loadHandlers;
      channel.send({
        type: "load",
        dbName,
        firstBatchSize: FIRST_BATCH_SIZE,
        batchSize: BATCH_SIZE,
      });
    },
    upsert: (papers) => {
      if (disposed || failure || papers.length === 0) return;
      channel.send({
        type: "upsert",
        papers: papers.map((paper) => ({ id: paper.id, embedding: paper.embedding })),
      });
    },
    search: (queryEmbedding, scoreThreshold, limit, signal) => {
      if (disposed) return Promise.reject(new PaperLoadError("検索用データは破棄されました"));
      if (failure) return Promise.reject(failure);
      if (signal?.aborted) return Promise.reject(createAbortError());
      nextRequestId += 1;
      const requestId = nextRequestId;
      return new Promise<PaperSearchMatches>((resolve, reject) => {
        const onAbort = () => {
          if (!pendingSearches.delete(requestId)) return;
          channel.send({ type: "cancelSearch", requestId });
          reject(createAbortError());
        };
        pendingSearches.set(requestId, {
          resolve: (matches) => {
            signal?.removeEventListener("abort", onAbort);
            resolve(matches);
          },
          reject: (error) => {
            signal?.removeEventListener("abort", onAbort);
            reject(error);
          },
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        channel.send({ type: "search", requestId, queryEmbedding, scoreThreshold, limit });
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      rejectPendingSearches(new PaperLoadError("検索用データは破棄されました"));
      channel.close();
    },
  };
};

/**
 * Dedicated Web Worker で読み込み・検索するクライアントを作る
 *
 * Worker は同一オリジンの別ファイルとして出力される（CSP の script-src 'self' を満たす）。
 * Worker の起動失敗・異常終了は onError と実行中の検索の reject に変換する。
 *
 * @param onStartupError 指定すると、Worker から応答が1つも届く前の失敗
 *   （スクリプトの取得失敗・CSP によるブロック・モジュール Worker 非対応）を onError ではなくこちらへ渡す
 */
export const createWorkerPaperIndexClient = (
  dbName: string,
  onStartupError?: (error: PaperLoadError) => void
): PaperIndexClient =>
  createPaperIndexClient(dbName, (receive, fail) => {
    const worker = new Worker(new URL("../../workers/paperIndex.worker.ts", import.meta.url), {
      type: "module",
    });
    /** Worker から応答が届いたか（届いた後の失敗は起動失敗として扱わない） */
    let hasResponded = false;
    worker.addEventListener("message", (event: MessageEvent<PaperIndexResponse>) => {
      hasResponded = true;
      receive(event.data);
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      const error = new PaperLoadError(
        `検索用データの処理が停止しました。再読み込みしてください${event.message ? `（${event.message}）` : ""}`
      );
      if (!hasResponded && onStartupError) {
        onStartupError(error);
        return;
      }
      fail(error);
    });
    worker.addEventListener("messageerror", () => {
      fail(new PaperLoadError("検索用データを受け取れませんでした。再読み込みしてください"));
    });
    return {
      send: (request) => worker.postMessage(request),
      close: () => worker.terminate(),
    };
  });

/**
 * 画面と同じスレッドで読み込み・検索するクライアントを作る
 * （Worker を使えない環境・テスト用。処理内容は Worker 版と同じ）
 *
 * @param db 読み込む DB（読み込み後も閉じない）
 */
export const createInProcessPaperIndexClient = (db: LuminaDB): PaperIndexClient =>
  createPaperIndexClient(db.name, (receive) => {
    let closed = false;
    const host = createPaperIndexHost({
      post: (response) => {
        if (!closed) receive(response);
      },
      openDb: () => ({ db, release: () => {} }),
    });
    return {
      send: (request) => host.handle(request),
      close: () => {
        closed = true;
      },
    };
  });

/**
 * 実行環境に合う論文索引のクライアントを作る
 * Worker を使えない・起動できない場合は同じスレッドで処理する。
 * Worker から応答が届く前に失敗した場合も、同じスレッドの処理へ切り替えて読み込みを続ける。
 *
 * @param db 読み込む DB
 */
export const createDefaultPaperIndexClient = (db: LuminaDB): PaperIndexClient => {
  if (typeof Worker === "undefined") return createInProcessPaperIndexClient(db);

  let fallback: PaperIndexClient | null = null;
  let loadHandlers: PaperIndexLoadHandlers | null = null;
  let disposed = false;
  let worker: PaperIndexClient;
  try {
    worker = createWorkerPaperIndexClient(db.name, (error) => {
      if (disposed || fallback) return;
      console.error("Paper index worker failed to start; falling back to main thread:", error);
      worker.dispose();
      fallback = createInProcessPaperIndexClient(db);
      if (loadHandlers) fallback.load(loadHandlers);
    });
  } catch (error) {
    console.error("Failed to start paper index worker:", error);
    return createInProcessPaperIndexClient(db);
  }
  const current = (): PaperIndexClient => fallback ?? worker;

  return {
    load: (handlers) => {
      loadHandlers = handlers;
      current().load(handlers);
    },
    upsert: (papers) => current().upsert(papers),
    search: (queryEmbedding, scoreThreshold, limit, signal) =>
      current().search(queryEmbedding, scoreThreshold, limit, signal),
    dispose: () => {
      disposed = true;
      current().dispose();
    },
  };
};
