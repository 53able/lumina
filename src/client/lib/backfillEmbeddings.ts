/**
 * Embedding が無い論文をバックグラウンドで Embedding API で補完する処理
 *
 * fetchEmbeddingBatch が渡された場合はバッチ API でチャンク単位に取得（HTTP 往復削減）。
 * 渡されない場合は従来どおり Semaphore で並列数制限し 1 件ずつ fetchEmbedding。
 * 429 が出た時点で新規の取得を止め、完了した分だけ addPaper する。残りは次回「Embeddingを補完」で続きから再開する。
 *
 * ## async-mutex 利用指針（今後の設計）
 * - **共有リソースへの同時アクセスを防ぎたい** → Mutex で排他する。
 * - **同時実行数を N に厳密に制限したい** → Semaphore(N) でスロット取得・解放に統一する。
 * - 独立タスクの並列実行だけなら Promise.all のままでよい（async-mutex は不要）。
 */
import { Semaphore } from "async-mutex";
import type { Paper } from "../../shared/schemas/index";
import { EMBEDDING_BATCH_MAX_SIZE } from "../../shared/schemas/index";
import {
  EmbeddingRateLimitError,
  getRecommendedConcurrency as getApiRecommendedConcurrency,
} from "./api";

/** runBackfillEmbeddings の依存（テストで注入可能） */
export interface BackfillEmbeddingsDeps {
  /** テキストから Embedding を取得する関数（バッチ未使用時） */
  fetchEmbedding: (text: string) => Promise<number[]>;
  /** 論文をストアに保存する関数（既存は上書き） */
  addPaper: (paper: Paper) => Promise<void>;
  /** 推奨並列数（1〜10）。省略時は api の getRecommendedConcurrency を使用。1 で逐次実行（少しずつ UX） */
  getRecommendedConcurrency?: () => number;
  /** 1件完了するたびに呼ばれる（進捗表示用） */
  onProgress?: (completed: number, total: number) => void;
  /**
   * 複数テキストを1リクエストで Embedding に変換する関数。
   * 渡すとバッチ API でチャンク単位に取得し、HTTP 往復と待機回数を削減する。
   */
  fetchEmbeddingBatch?: (texts: string[]) => Promise<number[][]>;
}

/**
 * Embedding が無い論文に対して fetchEmbedding / fetchEmbeddingBatch で取得し、addPaper で更新する。
 * 429 が出たら新規取得を止め、完了した分だけ保存して resolve。残りは次回再開。
 *
 * @param papers 対象の論文配列（embedding が無いものだけ処理する）
 * @param deps fetchEmbedding / addPaper / getRecommendedConcurrency / 任意で fetchEmbeddingBatch
 */
export const runBackfillEmbeddings = async (
  papers: Paper[],
  deps: BackfillEmbeddingsDeps
): Promise<void> => {
  const toProcess = papers.filter((p) => !p.embedding || p.embedding.length === 0);
  if (toProcess.length === 0) return;

  const { fetchEmbedding, addPaper, onProgress, fetchEmbeddingBatch } = deps;

  if (fetchEmbeddingBatch) {
    await runBackfillEmbeddingsBatch(toProcess, {
      fetchEmbeddingBatch,
      addPaper,
      onProgress,
    });
    return;
  }

  const getRecommendedConcurrency = deps.getRecommendedConcurrency ?? getApiRecommendedConcurrency;
  const limit = Math.max(1, getRecommendedConcurrency());
  const semaphore = new Semaphore(limit);
  let completedCount = 0;
  const total = toProcess.length;
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

/** バッチ用: チャンク単位で fetchEmbeddingBatch を呼び、addPaper で保存。429 で打ち切り。 */
const runBackfillEmbeddingsBatch = async (
  toProcess: Paper[],
  deps: {
    fetchEmbeddingBatch: (texts: string[]) => Promise<number[][]>;
    addPaper: (paper: Paper) => Promise<void>;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<void> => {
  const total = toProcess.length;
  let completedCount = 0;

  for (let i = 0; i < toProcess.length; i += EMBEDDING_BATCH_MAX_SIZE) {
    const chunk = toProcess.slice(i, i + EMBEDDING_BATCH_MAX_SIZE);
    const texts = chunk.map((p) => `${p.title}\n\n${p.abstract}`);

    try {
      const embeddings = await deps.fetchEmbeddingBatch(texts);
      for (let j = 0; j < chunk.length; j += 1) {
        const paper = chunk[j];
        const embedding = embeddings[j];
        if (embedding) {
          await deps.addPaper({ ...paper, embedding });
          completedCount += 1;
          deps.onProgress?.(completedCount, total);
        }
      }
    } catch (e) {
      if (e instanceof EmbeddingRateLimitError) {
        return;
      }
      throw e;
    }
  }
};
