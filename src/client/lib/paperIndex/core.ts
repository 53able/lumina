/**
 * 論文一覧と検索用索引の純粋ロジック（画面側・Web Worker 側で共有する）
 *
 * - 画面側は Embedding を持たない一覧用の論文（PaperListItem）だけを保持する
 * - Embedding は検索用索引（PaperEmbeddingIndex）にだけ置き、全件を画面側へ送り直さない
 */
import type { Paper } from "../../../shared/schemas/index";

/**
 * 一覧表示用の論文。Embedding 本体の代わりに有無だけを持つ。
 * embedding は optional のため Paper を受け取るコンポーネントにそのまま渡せる。
 */
export type PaperListItem = Omit<Paper, "embedding"> & {
  /** Embedding を持つか（セマンティック検索の対象か） */
  hasEmbedding: boolean;
};

/** 索引検索で一致した論文 */
export interface PaperSearchMatch {
  /** 論文ID */
  id: string;
  /** 類似度スコア（コサイン類似度） */
  score: number;
}

/** 索引検索の結果 */
export interface PaperSearchMatches {
  /** スコア降順・limit 適用後の一致 */
  matches: PaperSearchMatch[];
  /** 閾値以上の一致の総数（limit 適用前） */
  totalMatchCount: number;
}

/**
 * 検索の実行元（useSemanticSearch が使う）。
 * 全件の準備を待ってから索引を検索し、読み込み途中の部分集合を確定結果にしない。
 */
export interface PaperSearchSource {
  /** 全件の準備が完了しているか */
  isReady: () => boolean;
  /** 全件の準備完了を待つ（読み込みに失敗したら reject） */
  whenReady: () => Promise<void>;
  /** 索引を検索する */
  search: (
    queryEmbedding: number[],
    scoreThreshold: number,
    limit: number
  ) => Promise<PaperSearchMatches>;
}

/**
 * 論文が Embedding を持つか。
 * 一覧用の論文（hasEmbedding）と Embedding 付きの論文のどちらでも判定できる。
 */
export const hasPaperEmbedding = (paper: Paper | PaperListItem): boolean =>
  ((paper as Paper).embedding?.length ?? 0) > 0 ||
  ("hasEmbedding" in paper && paper.hasEmbedding === true);

/**
 * 論文から一覧用の論文を作る（Embedding 本体は含めない）
 */
export const toPaperListItem = (paper: Paper | PaperListItem): PaperListItem => {
  const { embedding: _embedding, ...rest } = paper as Paper & { hasEmbedding?: boolean };
  return { ...rest, hasEmbedding: hasPaperEmbedding(paper) };
};

/**
 * 一覧用の論文から IndexedDB に保存する論文を作る（画面用のフィールド hasEmbedding を除く）
 */
export const toStoredPaper = (paper: Paper | PaperListItem): Paper => {
  const { hasEmbedding: _hasEmbedding, ...rest } = paper as Paper & { hasEmbedding?: boolean };
  return rest;
};

/** 公開日の時刻値（降順の比較用） */
const publishedTime = (paper: Pick<Paper, "publishedAt">): number =>
  paper.publishedAt instanceof Date
    ? paper.publishedAt.getTime()
    : new Date(paper.publishedAt).getTime();

/**
 * 公開日の降順に並んだ一覧へ論文を統合する。
 *
 * - 既存と同じ ID は incoming で置き換える（公開日が同じなら位置を保つ）
 * - 新規の論文は公開日の降順（同日時は incoming の順）で差し込み、同日時は既存を先に置く
 *
 * 既存一覧の全件ソートを避け、O(n + m log m) で統合する。
 * 結果は「既存の後ろに incoming を足して公開日の降順で安定ソート」したものと一致する。
 *
 * @param existing 公開日の降順に並んだ既存の一覧
 * @param incoming 追加・更新する論文
 * @returns 統合後の一覧（公開日の降順）
 */
export const mergePapersDesc = (
  existing: PaperListItem[],
  incoming: PaperListItem[]
): PaperListItem[] => {
  if (incoming.length === 0) return existing;

  const incomingById = new Map(incoming.map((paper) => [paper.id, paper]));
  const kept: PaperListItem[] = [];
  for (const paper of existing) {
    const replacement = incomingById.get(paper.id);
    if (!replacement) {
      kept.push(paper);
      continue;
    }
    if (publishedTime(replacement) === publishedTime(paper)) {
      // 公開日が変わらない更新は位置を保つ
      kept.push(replacement);
      incomingById.delete(paper.id);
    }
    // 公開日が変わった更新は既存の位置から外し、新規と同じく差し込む
  }

  const added = [...incomingById.values()].sort((a, b) => publishedTime(b) - publishedTime(a));
  if (added.length === 0) return kept;

  const merged: PaperListItem[] = [];
  let i = 0;
  let j = 0;
  while (i < kept.length && j < added.length) {
    const keptPaper = kept[i] as PaperListItem;
    const addedPaper = added[j] as PaperListItem;
    if (publishedTime(keptPaper) >= publishedTime(addedPaper)) {
      merged.push(keptPaper);
      i += 1;
    } else {
      merged.push(addedPaper);
      j += 1;
    }
  }
  while (i < kept.length) merged.push(kept[i++] as PaperListItem);
  while (j < added.length) merged.push(added[j++] as PaperListItem);
  return merged;
};

/** 索引に登録する論文（ID と Embedding だけを使う） */
export interface PaperEmbeddingInput {
  id: string;
  embedding?: number[];
}

/** 索引の1件分（Float32Array で保持し、ノルムは登録時に計算する） */
interface IndexEntry {
  vector: Float32Array;
  norm: number;
}

/** 論文 Embedding の検索用索引 */
export interface PaperEmbeddingIndex {
  /** 索引の件数 */
  readonly size: number;
  /** 論文を登録・更新する（Embedding がない論文は索引から外す） */
  upsert: (papers: PaperEmbeddingInput[]) => void;
  /** 類似度が閾値以上の論文をスコア降順で返す */
  search: (queryEmbedding: number[], scoreThreshold: number, limit: number) => PaperSearchMatches;
}

/**
 * 論文 Embedding の検索用索引を作る
 *
 * 類似度はコサイン類似度。次元が異なる・ゼロベクトルの場合は 0 とする（従来の画面側計算と同じ）。
 * Embedding は Float32Array で保持するため、従来の計算とはスコアに 1e-6 程度の差が出る。
 */
export const createPaperEmbeddingIndex = (): PaperEmbeddingIndex => {
  const entries = new Map<string, IndexEntry>();

  const upsert = (papers: PaperEmbeddingInput[]): void => {
    for (const paper of papers) {
      const embedding = paper.embedding;
      if (!embedding || embedding.length === 0) {
        entries.delete(paper.id);
        continue;
      }
      const vector = Float32Array.from(embedding);
      let sumOfSquares = 0;
      for (let i = 0; i < vector.length; i += 1) {
        const v = vector[i] as number;
        sumOfSquares += v * v;
      }
      entries.set(paper.id, { vector, norm: Math.sqrt(sumOfSquares) });
    }
  };

  const search = (
    queryEmbedding: number[],
    scoreThreshold: number,
    limit: number
  ): PaperSearchMatches => {
    if (queryEmbedding.length === 0) return { matches: [], totalMatchCount: 0 };

    let querySumOfSquares = 0;
    for (const q of queryEmbedding) querySumOfSquares += q * q;
    const queryNorm = Math.sqrt(querySumOfSquares);

    const matched: PaperSearchMatch[] = [];
    for (const [id, { vector, norm }] of entries) {
      let score = 0;
      const denominator = queryNorm * norm;
      if (vector.length === queryEmbedding.length && denominator !== 0) {
        let dotProduct = 0;
        for (let i = 0; i < vector.length; i += 1) {
          dotProduct += (vector[i] as number) * (queryEmbedding[i] as number);
        }
        score = dotProduct / denominator;
      }
      if (score >= scoreThreshold) {
        matched.push({ id, score });
      }
    }

    matched.sort((a, b) => b.score - a.score);
    return { matches: matched.slice(0, limit), totalMatchCount: matched.length };
  };

  return {
    get size() {
      return entries.size;
    },
    upsert,
    search,
  };
};
