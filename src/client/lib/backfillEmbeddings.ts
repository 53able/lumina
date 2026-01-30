/**
 * Embedding が無い論文をバックグラウンドで Embedding API で補完する処理
 *
 * 並列数は concurrency で制限し、レートリミットを考慮する。
 */
import type { Paper } from "../../shared/schemas/index";

/** デフォルトの同時実行数 */
const DEFAULT_CONCURRENCY = 3;

/** runBackfillEmbeddings の依存（テストで注入可能） */
export interface BackfillEmbeddingsDeps {
  /** テキストから Embedding を取得する関数 */
  fetchEmbedding: (text: string) => Promise<number[]>;
  /** 論文をストアに保存する関数（既存は上書き） */
  addPaper: (paper: Paper) => Promise<void>;
  /** 同時実行数（省略時は DEFAULT_CONCURRENCY） */
  concurrency?: number;
}

/**
 * Embedding が無い論文に対して fetchEmbedding を並列で呼び、addPaper で更新する。
 *
 * @param papers 対象の論文配列（embedding が無いものだけ処理する）
 * @param deps fetchEmbedding / addPaper / concurrency
 */
export const runBackfillEmbeddings = async (
  papers: Paper[],
  deps: BackfillEmbeddingsDeps
): Promise<void> => {
  const toProcess = papers.filter((p) => !p.embedding || p.embedding.length === 0);
  if (toProcess.length === 0) return;

  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const { fetchEmbedding, addPaper } = deps;

  for (let i = 0; i < toProcess.length; i += concurrency) {
    const chunk = toProcess.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (paper) => {
        const text = `${paper.title}\n\n${paper.abstract}`;
        const embedding = await fetchEmbedding(text);
        await addPaper({ ...paper, embedding });
      })
    );
  }
};
