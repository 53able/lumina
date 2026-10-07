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
  /** 索引を検索する（signal で中止すると reject し、索引での計算も打ち切る） */
  search: (
    queryEmbedding: number[],
    scoreThreshold: number,
    limit: number,
    signal?: AbortSignal
  ) => Promise<PaperSearchMatches>;
}

/**
 * 論文が Embedding を持つか（セマンティック検索の対象か）。
 * 一覧用の論文（hasEmbedding）・Embedding 付きの論文・索引に登録する論文のどれでも判定できる。
 * 画面側（対象外の表示・件数）と索引（Web Worker）で同じ判定を使う。
 * Embedding 本体があれば本体（空でないか）で判定し、hasEmbedding より優先する
 * （hasEmbedding: true でも embedding: [] なら対象外。索引に空のベクトルを入れない）。
 */
export const hasPaperEmbedding = (paper: Paper | PaperListItem | PaperEmbeddingInput): boolean => {
  const embedding = (paper as Paper).embedding;
  if (embedding != null) return embedding.length > 0;
  return "hasEmbedding" in paper && paper.hasEmbedding === true;
};

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

/**
 * 類似度を計算する1チャンクの件数。
 * Web Worker はチャンクの合間に中止・後続の検索のメッセージを受け取る（#111）。
 */
export const SEARCH_CHUNK_SIZE = 2000;

/** 論文 Embedding の検索用索引 */
export interface PaperEmbeddingIndex {
  /** 索引の件数 */
  readonly size: number;
  /** 論文を登録・更新する（Embedding がない論文は索引から外す） */
  upsert: (papers: PaperEmbeddingInput[]) => void;
  /** 類似度が閾値以上の論文をスコア降順で返す */
  search: (queryEmbedding: number[], scoreThreshold: number, limit: number) => PaperSearchMatches;
  /**
   * search と同じ結果を、chunkSize 件の類似度を計算するごとに yield しながら求める。
   * 呼び出し側は yield の合間に next を呼ばないことで計算を打ち切れる。
   * 開始時点の索引を対象にし、計算中の upsert は結果に含めない（従来の同期の検索と同じ）。
   */
  searchInChunks: (
    queryEmbedding: number[],
    scoreThreshold: number,
    limit: number,
    chunkSize?: number
  ) => Generator<void, PaperSearchMatches, void>;
}

/**
 * snapshot の [start, end) の類似度を計算して scored へ追加する
 * （計算の本体。ジェネレーターの外に置き、最適化されやすくする）
 */
const scoreRange = (
  snapshot: [string, IndexEntry][],
  start: number,
  end: number,
  queryEmbedding: number[],
  queryNorm: number,
  scored: PaperSearchMatch[]
): void => {
  for (let index = start; index < end; index += 1) {
    const [id, { vector, norm }] = snapshot[index] as [string, IndexEntry];
    let score = 0;
    const denominator = queryNorm * norm;
    if (vector.length === queryEmbedding.length && denominator !== 0) {
      let dotProduct = 0;
      for (let i = 0; i < vector.length; i += 1) {
        dotProduct += (vector[i] as number) * (queryEmbedding[i] as number);
      }
      score = dotProduct / denominator;
    }
    // 不正な値（NaN・Infinity）を含む Embedding は並び順を壊すため 0 とみなす
    scored.push({ id, score: Number.isFinite(score) ? score : 0 });
  }
};

/**
 * 論文 Embedding の検索用索引を作る
 *
 * 類似度はコサイン類似度。次元が異なる・ゼロベクトルの場合は 0 とする（従来の画面側計算と同じ）。
 * Embedding は Float32Array で保持するため、従来の計算とはスコアに 1e-6 程度の差が出る。
 */
export const createPaperEmbeddingIndex = (): PaperEmbeddingIndex => {
  const entries = new Map<string, IndexEntry>();

  /**
   * 直前の検索の全件スコア（スコア降順）。
   * しきい値・件数だけを変えた再検索（#78）では類似度を計算し直さず、この一覧を切り出す。
   * 索引の更新で破棄する。
   */
  let lastScored: { queryEmbedding: number[]; sorted: PaperSearchMatch[] } | null = null;
  /** 索引の更新回数（チャンクに分けた計算の途中で更新されたかを判定する） */
  let version = 0;

  const upsert = (papers: PaperEmbeddingInput[]): void => {
    if (papers.length > 0) {
      lastScored = null;
      version += 1;
    }
    for (const paper of papers) {
      const embedding = paper.embedding;
      if (!embedding || !hasPaperEmbedding(paper)) {
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

  /**
   * 全件の類似度を chunkSize 件ずつ計算し（チャンクの合間に yield する）、スコア降順に並べる
   * （同点は索引の順を保つ）。開始時点の索引を対象にする。
   */
  function* scoreAll(
    queryEmbedding: number[],
    chunkSize: number
  ): Generator<void, PaperSearchMatch[], void> {
    let querySumOfSquares = 0;
    for (const q of queryEmbedding) querySumOfSquares += q * q;
    const queryNorm = Math.sqrt(querySumOfSquares);

    const snapshot = [...entries];
    const scored: PaperSearchMatch[] = [];
    for (let start = 0; start < snapshot.length; start += chunkSize) {
      if (start > 0) yield;
      scoreRange(
        snapshot,
        start,
        Math.min(snapshot.length, start + chunkSize),
        queryEmbedding,
        queryNorm,
        scored
      );
    }
    // 並べ替えの前にも中止を受け付ける
    if (scored.length > 0) yield;
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /** 直前の検索と同じクエリか（Worker へはコピーで届くため内容で比べる） */
  const isSameQuery = (a: number[], b: number[]): boolean =>
    a.length === b.length && a.every((value, i) => value === b[i]);

  function* searchInChunks(
    queryEmbedding: number[],
    scoreThreshold: number,
    limit: number,
    chunkSize = SEARCH_CHUNK_SIZE
  ): Generator<void, PaperSearchMatches, void> {
    if (queryEmbedding.length === 0) return { matches: [], totalMatchCount: 0 };

    let sorted: PaperSearchMatch[];
    if (lastScored !== null && isSameQuery(lastScored.queryEmbedding, queryEmbedding)) {
      sorted = lastScored.sorted;
    } else {
      const query = [...queryEmbedding];
      const startVersion = version;
      sorted = yield* scoreAll(query, chunkSize);
      // 計算中に索引が更新されたら、開始時点の索引で求めた一覧を後の検索に使い回さない
      if (version === startVersion) lastScored = { queryEmbedding: query, sorted };
    }

    // スコア降順なので、しきい値以上の一致は先頭からの連続した範囲になる
    let totalMatchCount = 0;
    while (
      totalMatchCount < sorted.length &&
      (sorted[totalMatchCount] as PaperSearchMatch).score >= scoreThreshold
    ) {
      totalMatchCount += 1;
    }
    return { matches: sorted.slice(0, Math.min(limit, totalMatchCount)), totalMatchCount };
  }

  const search = (
    queryEmbedding: number[],
    scoreThreshold: number,
    limit: number
  ): PaperSearchMatches => {
    const task = searchInChunks(queryEmbedding, scoreThreshold, limit, Number.POSITIVE_INFINITY);
    let step = task.next();
    while (!step.done) step = task.next();
    return step.value;
  };

  return {
    get size() {
      return entries.size;
    },
    upsert,
    search,
    searchInChunks,
  };
};
