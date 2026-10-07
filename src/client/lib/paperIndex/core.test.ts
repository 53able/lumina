import { describe, expect, it, vi } from "vitest";
import type { Paper } from "../../../shared/schemas/index";
import {
  createPaperEmbeddingIndex,
  hasPaperEmbedding,
  mergePapersDesc,
  type PaperListItem,
  type PaperSearchMatches,
  toPaperListItem,
  toStoredPaper,
} from "./core";

/** 再現可能な疑似乱数（線形合同法） */
const createRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296 - 0.5;
  };
};

const createPaper = (id: string, publishedAt: string, embedding?: number[]): Paper => ({
  id,
  title: `Title ${id}`,
  abstract: "Abstract",
  authors: ["Author"],
  categories: ["cs.AI"],
  publishedAt: new Date(publishedAt),
  updatedAt: new Date(publishedAt),
  pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
  arxivUrl: `https://arxiv.org/abs/${id}`,
  ...(embedding ? { embedding } : {}),
});

/**
 * 変更前（#65 以前）に画面側で行っていた検索計算（比較用の参照実装）
 */
const legacyComputeSearchResults = (
  papers: Paper[],
  queryEmbedding: number[],
  scoreThreshold: number,
  limit: number
) => {
  const cosineSimilarity = (a: number[], b: number[]): number => {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  };
  const matched: { id: string; score: number }[] = [];
  for (const paper of papers) {
    if (!paper.embedding || paper.embedding.length === 0) continue;
    if (queryEmbedding.length === 0) continue;
    const score = cosineSimilarity(queryEmbedding, paper.embedding);
    if (score >= scoreThreshold) matched.push({ id: paper.id, score });
  }
  matched.sort((a, b) => b.score - a.score);
  return { matches: matched.slice(0, limit), totalMatchCount: matched.length };
};

describe("createPaperEmbeddingIndex", () => {
  it("1536次元で従来の画面側計算と同じ順位・件数になり、スコア差は 1e-6 以内", () => {
    const random = createRandom(42);
    const dims = 1536;
    const randomVector = () => Array.from({ length: dims }, () => random());
    const query = randomVector();
    const papers = Array.from({ length: 300 }, (_, i) =>
      createPaper(
        `p${i}`,
        "2024-01-01",
        // 一部はクエリに寄せて閾値を超えるようにする
        i % 3 === 0 ? query.map((q) => q + random() * 0.8) : randomVector()
      )
    );
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);

    for (const [threshold, limit] of [
      [0.3, 20],
      [0.5, 5],
      [-1, 1000],
    ] as const) {
      const expected = legacyComputeSearchResults(papers, query, threshold, limit);
      const actual = index.search(query, threshold, limit);

      expect(actual.totalMatchCount).toBe(expected.totalMatchCount);
      expect(actual.matches.map((m) => m.id)).toEqual(expected.matches.map((m) => m.id));
      actual.matches.forEach((match, i) => {
        expect(Math.abs(match.score - (expected.matches[i]?.score ?? Number.NaN))).toBeLessThan(
          1e-6
        );
      });
    }
  });

  it("同じクエリでしきい値・件数だけを変えた再検索も、従来の計算と一致する（直前のスコアを使い回す）", () => {
    const random = createRandom(11);
    const dims = 64;
    const query = Array.from({ length: dims }, () => random());
    const papers = Array.from({ length: 200 }, (_, i) =>
      createPaper(
        `p${i}`,
        "2024-01-01",
        query.map((q) => q + random() * (i % 4))
      )
    );
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);
    for (const [threshold, limit] of [
      [0.9, 20],
      [0.3, 20],
      [0.6, 5],
      [0.95, 100],
    ] as const) {
      const expected = legacyComputeSearchResults(papers, query, threshold, limit);
      // Worker へはコピーで届くため、内容が同じ別の配列で検索する
      const actual = index.search([...query], threshold, limit);
      expect(actual.totalMatchCount).toBe(expected.totalMatchCount);
      expect(actual.matches.map((m) => m.id)).toEqual(expected.matches.map((m) => m.id));
    }
  });

  it("不正な値（NaN）を含む Embedding があっても、しきい値以上の一致を取りこぼさない", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert([
      { id: "nan", embedding: [Number.NaN, 1] },
      { id: "a", embedding: [1, 0] },
      { id: "b", embedding: [0.9, 0.1] },
    ]);
    const result = index.search([1, 0], 0.5, 10);
    expect(result.matches.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result.totalMatchCount).toBe(2);
  });

  it("索引を更新すると、同じクエリの再検索でも追加した論文を含める", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert([{ id: "a", embedding: [1, 0] }]);
    expect(index.search([1, 0], 0.5, 10).matches.map((m) => m.id)).toEqual(["a"]);

    index.upsert([{ id: "b", embedding: [1, 0.1] }]);
    const result = index.search([1, 0], 0.5, 10);
    expect(result.matches.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result.totalMatchCount).toBe(2);
  });

  it("limit は適用後の一致だけを返し、totalMatchCount は適用前の件数", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert([
      { id: "a", embedding: [1, 0] },
      { id: "b", embedding: [0.9, 0.1] },
      { id: "c", embedding: [0.8, 0.2] },
    ]);

    const result = index.search([1, 0], 0.5, 2);

    expect(result.matches.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result.totalMatchCount).toBe(3);
  });

  it("次元が異なる・ゼロベクトルの論文はスコア 0 として閾値と比べる（従来と同じ）", () => {
    const papers = [
      createPaper("mismatch", "2024-01-01", [1, 0, 0]),
      createPaper("zero", "2024-01-01", [0, 0]),
      createPaper("same", "2024-01-01", [1, 0]),
    ];
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);

    for (const threshold of [0, 0.1]) {
      const expected = legacyComputeSearchResults(papers, [1, 0], threshold, 10);
      const actual = index.search([1, 0], threshold, 10);
      expect(actual.totalMatchCount).toBe(expected.totalMatchCount);
      expect(actual.matches.map((m) => m.id).sort()).toEqual(
        expected.matches.map((m) => m.id).sort()
      );
    }
  });

  it("Embedding がない・空の論文は索引に入れず、更新で Embedding が外れたら索引から外す", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert([
      { id: "none" },
      { id: "empty", embedding: [] },
      { id: "has", embedding: [1, 0] },
    ]);
    expect(index.size).toBe(1);

    index.upsert([{ id: "has", embedding: [] }]);
    expect(index.size).toBe(0);
    expect(index.search([1, 0], -1, 10)).toEqual({ matches: [], totalMatchCount: 0 });
  });

  it("空のクエリでは何も一致しない", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert([{ id: "a", embedding: [1, 0] }]);

    expect(index.search([], -1, 10)).toEqual({ matches: [], totalMatchCount: 0 });
  });
});

describe("createPaperEmbeddingIndex の searchInChunks（#111）", () => {
  const random = createRandom(111);
  const papers = Array.from({ length: 25 }, (_, i) => ({
    id: `p${i}`,
    embedding: Array.from({ length: 8 }, () => random()),
  }));
  const query = Array.from({ length: 8 }, () => random());

  /** 最後まで進めて結果と yield の回数を返す */
  const runToEnd = (task: Generator<void, PaperSearchMatches, void>) => {
    let yields = 0;
    let step = task.next();
    while (!step.done) {
      yields += 1;
      step = task.next();
    }
    return { result: step.value, yields };
  };

  it("チャンクごとに yield し、結果は search と一致する", () => {
    const chunked = createPaperEmbeddingIndex();
    chunked.upsert(papers);
    const plain = createPaperEmbeddingIndex();
    plain.upsert(papers);

    const { result, yields } = runToEnd(chunked.searchInChunks(query, -1, 10, 10));

    // 10件ごとの合間（2回）と並べ替えの前（1回）
    expect(yields).toBe(3);
    expect(result).toEqual(plain.search(query, -1, 10));
  });

  it("途中で打ち切った計算は、同じクエリ・同じ索引の次の検索が続きから進める", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);
    const plain = createPaperEmbeddingIndex();
    plain.upsert(papers);

    const aborted = index.searchInChunks(query, -1, 10, 10);
    aborted.next();
    aborted.next();

    const { result, yields } = runToEnd(index.searchInChunks(query, -1, 10, 10));
    expect(yields).toBe(1);
    expect(result).toEqual(plain.search(query, -1, 10));
  });

  it("中止→同じクエリで再検索を1チャンクごとに繰り返しても、計算は最初からやり直さずに完了する", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);
    const plain = createPaperEmbeddingIndex();
    plain.upsert(papers);

    // しきい値を連続で変えたときのように、各検索は1チャンク進んだところで中止される
    const thresholds = [0.9, 0.8, 0.7, 0.6, 0.5];
    let finished: { threshold: number; result: PaperSearchMatches } | null = null;
    for (const threshold of thresholds) {
      const step = index.searchInChunks(query, threshold, 10, 10).next();
      if (step.done) {
        finished = { threshold, result: step.value };
        break;
      }
    }

    expect(finished).not.toBeNull();
    expect(finished?.result).toEqual(plain.search(query, finished?.threshold ?? 0, 10));
    // 完了後の再検索は直前のスコアを使い、yield しない
    expect(runToEnd(index.searchInChunks(query, 0, 5, 10)).yields).toBe(0);
  });

  it("計算が例外で終わっても共有を解除し、同じクエリの再検索は最初から計算し直す", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);
    const plain = createPaperEmbeddingIndex();
    plain.upsert(papers);

    // 同じ計算を共有している2つの検索のうち、一方で並べ替えが例外を投げる
    const waiting = index.searchInChunks(query, -1, 10, 10);
    waiting.next();
    const sort = vi.spyOn(Array.prototype, "sort").mockImplementationOnce(() => {
      throw new Error("sort failed");
    });
    try {
      expect(() => runToEnd(index.searchInChunks(query, -1, 10, 10))).toThrow("sort failed");
    } finally {
      sort.mockRestore();
    }

    // 共有していたもう一方の検索は結果がないため失敗し、undefined を結果にしない
    expect(() => runToEnd(waiting)).toThrow("類似度の計算が中断されました");
    // 同じクエリの再検索は最初から計算し直して、正しい結果を返す
    const { result, yields } = runToEnd(index.searchInChunks(query, -1, 10, 10));
    expect(yields).toBe(3);
    expect(result).toEqual(plain.search(query, -1, 10));
  });

  it("索引が更新されたら、打ち切られた計算を共有せず最初から計算する", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);

    const aborted = index.searchInChunks(query, -1, 100, 10);
    aborted.next();
    index.upsert([{ id: "added", embedding: query }]);

    const { result, yields } = runToEnd(index.searchInChunks(query, -1, 100, 10));
    expect(yields).toBe(3);
    expect(result.matches[0]?.id).toBe("added");
    expect(result.totalMatchCount).toBe(papers.length + 1);
  });

  it("計算中に索引を更新しても開始時点の索引で計算し、その結果を後の検索に使い回さない", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);
    const before = createPaperEmbeddingIndex();
    before.upsert(papers);

    const task = index.searchInChunks(query, -1, 100, 10);
    task.next();
    index.upsert([{ id: "added", embedding: query }]);
    const { result } = runToEnd(task);

    expect(result).toEqual(before.search(query, -1, 100));
    const next = index.search(query, -1, 100);
    expect(next.matches[0]?.id).toBe("added");
    expect(next.totalMatchCount).toBe(papers.length + 1);
  });

  it("同じクエリの再検索は直前のスコアを使い、yield しない", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert(papers);
    runToEnd(index.searchInChunks(query, -1, 10, 10));

    const { result, yields } = runToEnd(index.searchInChunks(query, 0, 5, 10));
    expect(yields).toBe(0);
    expect(result).toEqual(index.search(query, 0, 5));
  });
});

describe("一覧用の論文", () => {
  it("toPaperListItem は Embedding 本体を除き、有無だけを残す", () => {
    const item = toPaperListItem(createPaper("a", "2024-01-01", [0.1, 0.2]));

    expect("embedding" in item).toBe(false);
    expect(item.hasEmbedding).toBe(true);
    expect(toPaperListItem(createPaper("b", "2024-01-01")).hasEmbedding).toBe(false);
    // 一覧用の論文を変換し直しても有無を保つ
    expect(toPaperListItem(item).hasEmbedding).toBe(true);
  });

  it("hasPaperEmbedding は一覧用・Embedding 付きの論文のどちらでも判定できる", () => {
    const item = toPaperListItem(createPaper("a", "2024-01-01", [0.1]));

    expect(hasPaperEmbedding(item)).toBe(true);
    expect(hasPaperEmbedding(createPaper("b", "2024-01-01", [0.1]))).toBe(true);
    expect(hasPaperEmbedding(createPaper("c", "2024-01-01", []))).toBe(false);
    expect(hasPaperEmbedding({ ...toPaperListItem(createPaper("d", "2024-01-01")) })).toBe(false);
    // 一覧用の論文に Embedding を付けた更新（補完）は Embedding ありとして扱う
    expect(
      hasPaperEmbedding({ ...toPaperListItem(createPaper("e", "2024-01-01")), embedding: [1] })
    ).toBe(true);
    // Embedding 本体があれば本体で判定する（hasEmbedding: true でも空なら対象外）
    expect(
      hasPaperEmbedding({ ...toPaperListItem(createPaper("f", "2024-01-01", [1])), embedding: [] })
    ).toBe(false);
  });

  it("hasEmbedding: true でも embedding が空の論文は索引に入れない", () => {
    const index = createPaperEmbeddingIndex();
    index.upsert([
      { ...toPaperListItem(createPaper("a", "2024-01-01", [1])), embedding: [] },
      createPaper("b", "2024-01-01", [1, 0]),
    ]);

    expect(index.size).toBe(1);
    expect(index.search([1, 0], 0, 10).matches.map(({ id }) => id)).toEqual(["b"]);
  });

  it("toStoredPaper は画面用のフィールド hasEmbedding を除く", () => {
    const stored = toStoredPaper({
      ...toPaperListItem(createPaper("a", "2024-01-01")),
      embedding: [0.1],
    } as Paper);

    expect("hasEmbedding" in stored).toBe(false);
    expect(stored.embedding).toEqual([0.1]);
  });
});

describe("mergePapersDesc", () => {
  const item = (id: string, publishedAt: string, title = `Title ${id}`): PaperListItem => ({
    ...toPaperListItem(createPaper(id, publishedAt)),
    title,
  });

  /** 従来の統合（既存の後ろに追加し、公開日の降順で安定ソート） */
  const legacyMerge = (existing: PaperListItem[], incoming: PaperListItem[]) => {
    const map = new Map(existing.map((p) => [p.id, p]));
    for (const p of incoming) map.set(p.id, p);
    return [...map.values()].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  };

  it("公開日の降順を保って統合し、同日時は既存を先に置く", () => {
    const existing = [item("e3", "2024-01-03"), item("e2", "2024-01-02"), item("e1", "2024-01-01")];
    const incoming = [item("n4", "2024-01-04"), item("n2", "2024-01-02"), item("n0", "2023-12-31")];

    const merged = mergePapersDesc(existing, incoming);

    expect(merged.map((p) => p.id)).toEqual(["n4", "e3", "e2", "n2", "e1", "n0"]);
    expect(merged).toEqual(legacyMerge(existing, incoming));
  });

  it("同じ ID は incoming で置き換え、件数を増やさない", () => {
    const existing = [item("a", "2024-01-02"), item("b", "2024-01-01")];

    const merged = mergePapersDesc(existing, [item("b", "2024-01-01", "Updated")]);

    expect(merged.map((p) => p.id)).toEqual(["a", "b"]);
    expect(merged[1]?.title).toBe("Updated");
  });

  it("公開日が変わった更新は新しい位置へ移す", () => {
    const existing = [item("a", "2024-01-03"), item("b", "2024-01-02"), item("c", "2024-01-01")];

    const merged = mergePapersDesc(existing, [item("c", "2024-01-04")]);

    expect(merged.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("ランダムな入力でも従来の統合（全件ソート）と一致する", () => {
    const random = createRandom(7);
    const day = () => `2024-01-${String(1 + Math.floor((random() + 0.5) * 20)).padStart(2, "0")}`;
    const existing = legacyMerge(
      [],
      Array.from({ length: 200 }, (_, i) => item(`p${i}`, day()))
    );
    const incoming = Array.from({ length: 80 }, (_, i) => {
      const id = `p${Math.floor((random() + 0.5) * 300)}`;
      const existed = existing.find((p) => p.id === id);
      // 既存の更新は公開日を保つ（同期・補完の更新と同じ）
      return existed ? { ...existed, title: `Updated ${i}` } : item(id, day());
    });
    const uniqueIncoming = [...new Map(incoming.map((p) => [p.id, p])).values()];

    expect(mergePapersDesc(existing, uniqueIncoming)).toEqual(
      legacyMerge(existing, uniqueIncoming)
    );
  });

  it("incoming が空なら既存の配列をそのまま返す", () => {
    const existing = [item("a", "2024-01-01")];
    expect(mergePapersDesc(existing, [])).toBe(existing);
  });
});
