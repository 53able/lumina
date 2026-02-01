/**
 * Embedding が無い論文をバックグラウンドで Embedding API で補完する処理
 *
 * 並列数は Semaphore で制限する（開始時に getRecommendedConcurrency で 1〜10 を取得）。
 * 429 が出た時点で新規の取得を止め、完了した分だけ addPaper する。残りは次回「Embeddingを補完」で続きから再開する。
 *
 * ## async-mutex 利用指針（今後の設計）
 * - **共有リソースへの同時アクセスを防ぎたい** → Mutex で排他する。
 * - **同時実行数を N に厳密に制限したい** → Semaphore(N) でスロット取得・解放に統一する。
 * - 独立タスクの並列実行だけなら Promise.all のままでよい（async-mutex は不要）。
 */
import { Semaphore } from "async-mutex";
import type { Paper } from "../../shared/schemas/index";
import { EmbeddingRateLimitError, getRecommendedConcurrency as getApiRecommendedConcurrency } from "./api";

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
  /** 並列数制限。開始時の推奨値で Semaphore を初期化（実行中の動的変更はしない） */
  const limit = Math.max(1, getRecommendedConcurrency());
  const semaphore = new Semaphore(limit);
  let completedCount = 0;
  const total = toProcess.length;
  /** 429 が一度でも出たら true。新規の fetchEmbedding は行わず、次回再開に回す */
  let rateLimitHit = false;

  const results = await Promise.allSettled(
    toProcess.map((paper) =>
      (async () => {
        const [, release] = await semaphore.acquire(1);
        if (rateLimitHit) {
          release();
          return;
        }
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
          release();
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
