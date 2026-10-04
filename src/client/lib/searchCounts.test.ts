import { describe, expect, it } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { toPaperListItem } from "./paperIndex/core";
import {
  describeHistoryResultCount,
  formatHistoryResultCount,
  formatSearchResultBreakdown,
  formatSearchScope,
  formatSearchScopeSummary,
  summarizeSearchScope,
} from "./searchCounts";

const createPaper = (
  id: string,
  {
    embedding,
    categories = ["cs.AI"],
    publishedAt = "2024-01-15T12:00:00Z",
  }: {
    embedding?: number[];
    categories?: string[];
    publishedAt?: string;
  } = {}
): Paper => ({
  id,
  title: `Paper ${id}`,
  abstract: "",
  authors: [],
  categories,
  publishedAt: new Date(publishedAt),
  updatedAt: new Date(publishedAt),
  pdfUrl: `https://arxiv.org/pdf/${id}`,
  arxivUrl: `https://arxiv.org/abs/${id}`,
  ...(embedding ? { embedding } : {}),
});

describe("summarizeSearchScope", () => {
  it("一覧用の論文（Embedding本体なし・hasEmbedding）も索引と同じ判定で検索対象・対象外に数える", () => {
    const scope = summarizeSearchScope([
      toPaperListItem(createPaper("a", { embedding: [1, 0] })),
      toPaperListItem(createPaper("b", { embedding: [] })),
      toPaperListItem(createPaper("c")),
    ]);
    expect(scope).toMatchObject({ fetchedCount: 3, searchableCount: 1, excludedCount: 2 });
  });

  it("論文が0件なら範囲を出さない", () => {
    expect(summarizeSearchScope([])).toBeNull();
  });

  it("取得済み・検索対象・対象外の件数と、実データの公開日の範囲・カテゴリ（多い順）を集計する", () => {
    const scope = summarizeSearchScope([
      createPaper("1", {
        embedding: [1],
        categories: ["cs.CL", "cs.AI"],
        publishedAt: "2024-03-31T12:00:00Z",
      }),
      createPaper("2", {
        embedding: [1],
        categories: ["cs.AI"],
        publishedAt: "2024-01-01T12:00:00Z",
      }),
      createPaper("3", { categories: ["stat.ML"], publishedAt: "2024-02-10T12:00:00Z" }),
    ]);
    expect(scope).toEqual({
      fetchedCount: 3,
      searchableCount: 2,
      excludedCount: 1,
      oldestPublishedAt: new Date("2024-01-01T12:00:00Z"),
      newestPublishedAt: new Date("2024-03-31T12:00:00Z"),
      categories: ["cs.AI", "cs.CL", "stat.ML"],
    });
  });

  it("公開日を読めない論文は期間の算出から外す", () => {
    const scope = summarizeSearchScope([createPaper("1", { publishedAt: "invalid" })]);
    expect(scope?.oldestPublishedAt).toBeNull();
    expect(scope?.newestPublishedAt).toBeNull();
    expect(scope && formatSearchScope(scope)).toBe(
      "取得済み 1件（カテゴリ cs.AI）・検索対象 0件・対象外 1件（Embedding未設定）"
    );
  });
});

describe("formatSearchScope", () => {
  it("取得済みの期間・カテゴリ・検索対象・対象外を1行で表す。カテゴリは3つまで名前を出す", () => {
    const scope = summarizeSearchScope([
      createPaper("1", {
        embedding: [1],
        categories: ["cs.AI", "cs.CL", "cs.LG", "stat.ML", "cs.CV"],
        publishedAt: "2024-01-01T12:00:00Z",
      }),
      createPaper("2", { categories: ["cs.AI"], publishedAt: "2024-03-31T12:00:00Z" }),
    ]);
    expect(scope && formatSearchScope(scope)).toBe(
      "取得済み 2件（公開日 最古 2024/01/01・最新 2024/03/31・カテゴリ cs.AI・cs.CL・cs.CV ほか2種）・検索対象 1件・対象外 1件（Embedding未設定）"
    );
  });

  it("対象外が0件なら対象外を出さない。公開日は網羅範囲に見えないよう最古・最新で書く", () => {
    const scope = summarizeSearchScope([createPaper("1", { embedding: [1] })]);
    expect(scope && formatSearchScope(scope)).toBe(
      "取得済み 1件（公開日 最古 2024/01/15・最新 2024/01/15・カテゴリ cs.AI）・検索対象 1件"
    );
  });
});

describe("formatSearchScopeSummary", () => {
  it("取得済みと対象外だけの短縮形にする（対象外が0件なら取得済みだけ）", () => {
    const scope = summarizeSearchScope([createPaper("1", { embedding: [1] }), createPaper("2")]);
    expect(scope && formatSearchScopeSummary(scope)).toBe("取得済み 2件・対象外 1件");
    const allSearchable = summarizeSearchScope([createPaper("1", { embedding: [1] })]);
    expect(allSearchable && formatSearchScopeSummary(allSearchable)).toBe("取得済み 1件");
  });
});

describe("formatSearchResultBreakdown", () => {
  it("表示上限で省略したときは「候補 X件のうち上位 Y件」と書く", () => {
    expect(
      formatSearchResultBreakdown({ candidateCount: 214, topCount: 20, excludedCount: 0 }, 0)
    ).toBe("候補 214件のうち上位 20件");
  });

  it("表示上限で省略していなければ候補の件数だけを書く（0件も同じ）", () => {
    expect(
      formatSearchResultBreakdown({ candidateCount: 5, topCount: 5, excludedCount: 0 }, 0)
    ).toBe("候補 5件");
    expect(
      formatSearchResultBreakdown({ candidateCount: 0, topCount: 0, excludedCount: 0 }, 0)
    ).toBe("候補 0件");
  });

  it("対象外と、絞り込みで外した件数を表示上限とは別の項目として書き分ける", () => {
    expect(
      formatSearchResultBreakdown({ candidateCount: 1234, topCount: 20, excludedCount: 3 }, 8)
    ).toBe(
      "候補 1,234件のうち上位 20件・対象外 3件（Embedding未設定・末尾に表示）・絞り込みで 8件を非表示"
    );
  });
});

describe("formatHistoryResultCount", () => {
  it("履歴の resultCount は検索時点の候補として表す", () => {
    const createdAt = new Date("2026-10-03T10:00:00Z");
    expect(formatHistoryResultCount(214, createdAt)).toBe("検索時の候補 214件");
    expect(describeHistoryResultCount(createdAt)).toMatch(/しきい値以上/);
  });

  it("候補を保存する前（232aa17・2026-02-01 より前）の履歴は表示上限後の件数なので「候補」と書かない", () => {
    const createdAt = new Date("2026-02-01T10:00:00+09:00");
    expect(formatHistoryResultCount(20, createdAt)).toBe("20件");
    expect(describeHistoryResultCount(createdAt)).toMatch(/表示上限の適用後/);
  });
});
