import { describe, expect, it } from "vitest";
import type { ExpandedQuery } from "../../shared/schemas/index";
import {
  buildSearchText,
  isEditedSearchText,
  isExcludedTerm,
  parseSelectedTerms,
  uniqueTerms,
} from "./searchTextTerms";

describe("searchTextTerms（#31, #72）", () => {
  describe("uniqueTerms", () => {
    it("大文字小文字を区別せずに重複を除き、最初の表記を残す", () => {
      expect(uniqueTerms(["Graph", "RL", "graph", "GRAPH", "rl"])).toEqual(["Graph", "RL"]);
    });
  });

  describe("buildSearchText", () => {
    it("英訳と選んだ関連語を空白1つでつなぐ（前後の空白・空の語は除く）", () => {
      expect(buildSearchText("deep learning", ["neural network", "RL"])).toBe(
        "deep learning neural network RL"
      );
      expect(buildSearchText(" deep learning ", ["", "  RL "])).toBe("deep learning RL");
      expect(buildSearchText("deep learning", [])).toBe("deep learning");
    });
  });

  describe("parseSelectedTerms", () => {
    const synonyms = ["neural network", "RL", "graph"];

    it("英訳 + 関連語（synonyms の順）の形そのものなら、その選択を返す", () => {
      expect(parseSelectedTerms("deep learning RL", "deep learning", synonyms)).toEqual(["RL"]);
      expect(parseSelectedTerms("deep learning", "deep learning", synonyms)).toEqual([]);
      expect(
        parseSelectedTerms("deep learning neural network RL graph", "deep learning", synonyms)
      ).toEqual(synonyms);
    });

    it("部分一致（複数形・語の一部）は選択とみなさない", () => {
      expect(parseSelectedTerms("deep learning neural networks", "deep learning", synonyms)).toBe(
        null
      );
      expect(parseSelectedTerms("deep learning RLHF", "deep learning", synonyms)).toBe(null);
      expect(parseSelectedTerms("deep learning graphs", "deep learning", synonyms)).toBe(null);
    });

    it("語順を入れ替えた文・言い換えを含む文は選択の形とみなさない", () => {
      expect(parseSelectedTerms("deep learning RL neural network", "deep learning", synonyms)).toBe(
        null
      );
      expect(parseSelectedTerms("RL deep learning", "deep learning", synonyms)).toBe(null);
      expect(
        parseSelectedTerms("deep learning neural network models RL", "deep learning", synonyms)
      ).toBe(null);
    });

    it("前方一致する関連語どうし（graph と graph neural network）を取り違えない", () => {
      const terms = ["graph", "graph neural network"];
      expect(parseSelectedTerms("gnn graph neural network", "gnn", terms)).toEqual([
        "graph neural network",
      ]);
      expect(parseSelectedTerms("gnn graph graph neural network", "gnn", terms)).toEqual(terms);
      expect(parseSelectedTerms("gnn graph", "gnn", terms)).toEqual(["graph"]);
    });

    it("複数の選択が同じ文になる場合は選択を決められないので null（自由編集として扱う）", () => {
      const terms = ["neural network", "neural", "network"];
      expect(parseSelectedTerms("dl neural network", "dl", terms)).toBe(null);
      // 一意に決まる部分は従来どおり
      expect(parseSelectedTerms("dl neural", "dl", terms)).toEqual(["neural"]);
      expect(parseSelectedTerms("dl network", "dl", terms)).toEqual(["network"]);
    });
  });

  describe("編集済み・除外の判定", () => {
    const query: ExpandedQuery = {
      original: "深層学習",
      english: "deep learning",
      synonyms: ["neural network", "RL", "graph"],
      searchText: "deep learning RL",
      originalSearchText: "deep learning neural network RL",
    };

    it("元の検索文と異なれば編集済み", () => {
      expect(isEditedSearchText(query)).toBe(true);
      expect(isEditedSearchText({ ...query, searchText: query.originalSearchText ?? "" })).toBe(
        false
      );
      expect(isEditedSearchText({ ...query, originalSearchText: undefined })).toBe(false);
    });

    it("関連語の選択から作った検索文では、選ばなかった関連語を除外とする", () => {
      expect(isExcludedTerm(query, "neural network")).toBe(true);
      expect(isExcludedTerm(query, "graph")).toBe(true);
      expect(isExcludedTerm(query, "RL")).toBe(false);
    });

    it("編集していない検索では除外としない", () => {
      expect(isExcludedTerm({ ...query, originalSearchText: undefined }, "graph")).toBe(false);
    });

    it("自由編集した検索文では、語が完全一致しなくても除外としない", () => {
      const freeEdited = { ...query, searchText: "deep learning neural networks for RL" };
      expect(isExcludedTerm(freeEdited, "neural network")).toBe(false);
      expect(isExcludedTerm(freeEdited, "graph")).toBe(false);
    });
  });
});
