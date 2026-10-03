/**
 * 論文索引の Dedicated Web Worker
 *
 * IndexedDB からの全件読み込みと Embedding の類似度計算を画面のスレッドから切り離す。
 * Embedding はこの Worker にだけ保持し、画面へは一覧用の論文・進捗・検索結果だけを送る。
 */
import { LuminaDB } from "../db/schema";
import { createPaperIndexHost } from "../lib/paperIndex/host";
import type { PaperIndexRequest, PaperIndexResponse } from "../lib/paperIndex/protocol";

/** この Worker で使うグローバルスコープ（DOM の型定義には Worker スコープがないため最小限を宣言する） */
const workerScope = self as unknown as {
  postMessage: (message: PaperIndexResponse) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<PaperIndexRequest>) => void
  ) => void;
};

const host = createPaperIndexHost({
  post: (response) => workerScope.postMessage(response),
  openDb: (dbName) => {
    const db = new LuminaDB(dbName);
    return { db, release: () => db.close() };
  },
});

workerScope.addEventListener("message", (event) => host.handle(event.data));
