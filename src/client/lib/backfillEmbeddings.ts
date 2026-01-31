/**
 * Embedding が無い論文をバックグラウンドで Embedding API で補完する処理
 *
 * 並列数は RateLimit-Remaining に応じて 1〜10 でオートスケールする。
 * 429 が出た時点で新規の取得を止め、完了した分だけ addPaper する。残りは次回「Embeddingを補完」で続きから再開する。
 */
import { Mutex } from "async-mutex";
import type { Paper } from "../../shared/schemas/index";
import { EmbeddingRateLimitError, getRecommendedConcurrency as getApiRecommendedConcurrency } from "./api";

/** 並列取得のポーリング間隔（ms） */
const POLL_INTERVAL_MS = 100;

/** runBackfillEmbeddings の依存（テストで注入可能） */
export interface BackfillEmbeddingsDeps {
  /** テキストから Embedding を取得する関数 */
  fetchEmbedding: (text: string) => Promise<number[]>;
  /** 論文をストアに保存する関数（既存は上書き） */
  addPaper: (paper: Paper) => Promise<void>;
  /** 推奨並列数（1〜10）。省略時は api の getRecommendedConcurrency を使用。1 で逐次実行（少しずつ UX） */
  getRecommendedConcurrency?: () => number;
  /** 1件完了するたびに呼ばれる（進捗表示用） */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Embedding が無い論文に対して fetchEmbedding を並列で呼び、addPaper で更新する。
 * 429 が出たら新規取得を止め、完了した分だけ保存して resolve。残りは次回再開。
 *
 * @param papers 対象の論文配列（embedding が無いものだけ処理する）
 * @param deps fetchEmbedding / addPaper / getRecommendedConcurrency
 */
export const runBackfillEmbeddings = async (
  papers: Paper[],
  deps: BackfillEmbeddingsDeps
): Promise<void> => {
  const toProcess = papers.filter((p) => !p.embedding || p.embedding.length === 0);
  if (toProcess.length === 0) return;

  const { fetchEmbedding, addPaper, onProgress } = deps;
  const getRecommendedConcurrency = deps.getRecommendedConcurrency ?? getApiRecommendedConcurrency;
  const mutex = new Mutex();
  let currentRunning = 0;
  let completedCount = 0;
  const total = toProcess.length;
  /** 429 が一度でも出たら true。新規の fetchEmbedding は行わず、次回再開に回す */
  let rateLimitHit = false;

  const acquireSlot = async (): Promise<void> => {
    for (;;) {
      if (rateLimitHit) return;
      const acquired = await mutex.runExclusive((): boolean => {
        if (rateLimitHit) return false;
        const limit = getRecommendedConcurrency();
        if (currentRunning < limit) {
          currentRunning += 1;
          return true;
        }
        return false;
      });
      if (acquired) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  const releaseSlot = (): Promise<void> =>
    mutex.runExclusive(() => {
      currentRunning -= 1;
    });

  const results = await Promise.allSettled(
    toProcess.map((paper) =>
      (async () => {
        await acquireSlot();
        if (rateLimitHit) return;
        try {
          const text = `${paper.title}\n\n${paper.abstract}`;
          const embedding = await fetchEmbedding(text);
          await addPaper({ ...paper, embedding });
          completedCount += 1;
          onProgress?.(completedCount, total);
        } catch (e) {
          if (e instanceof EmbeddingRateLimitError) {
            rateLimitHit = true;
          }
          throw e;
        } finally {
          await releaseSlot();
        }
      })()
    )
  );

  const firstRejection = results.find((r) => r.status === "rejected");
  if (firstRejection?.status === "rejected") {
    const reason = firstRejection.reason;
    if (reason instanceof EmbeddingRateLimitError) {
      return;
    }
    throw reason;
  }
};
