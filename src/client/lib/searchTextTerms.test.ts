import { describe, expect, it } from "vitest";
import type { ExpandedQuery } from "../../shared/schemas/index";
import {
  appendTerm,
  includesTerm,
  isEditedSearchText,
  isExcludedTerm,
  removeTerm,
} from "./searchTextTerms";

describe("searchTextTerms（#31）", () => {
  describe("includesTerm", () => {
    it("単語境界つきの完全一致だけを含むとみなす（大文字小文字は区別しない）", () => {
      expect(includesTerm("deep RL agents", "rl")).toBe(true);
      expect(includesTerm("real world robotics", "RL")).toBe(false);
      expect(includesTerm("curl command", "RL")).toBe(false);
      expect(includesTerm("neural networks", "neural network")).toBe(false);
    });

    it("英訳の内側にある語句は関連語として数えない", () => {
      expect(includesTerm("deep learning models", "learning", "deep learning")).toBe(false);
      expect(
        includesTerm("deep learning representation learning", "learning", "deep learning")
      ).toBe(true);
    });

    it("正規表現の特殊文字を含む語句も文字どおりに扱う", () => {
      expect(includesTerm("C++ compiler", "C++")).toBe(true);
      expect(includesTerm("Cxx compiler", "C.x")).toBe(false);
    });
  });

  describe("removeTerm", () => {
    it("RL を除いても world の rl は消さない", () => {
      expect(removeTerm("RL in the real world RL", "RL")).toBe("in the real world");
    });

    it("curl のような語の一部は消さない", () => {
      expect(removeTerm("curl RL", "RL")).toBe("curl");
    });

    it("複数形（neural networks）は完全一致でないので残す", () => {
      expect(removeTerm("neural network and neural networks", "neural network")).toBe(
        "and neural networks"
      );
    });

    it("英訳の内側にある同じ語は消さない", () => {
      expect(removeTerm("deep learning representation learning", "learning", "deep learning")).toBe(
        "deep learning representation"
      );
    });

    it("取り除いた箇所以外の改行・空白は保つ", () => {
      expect(removeTerm("deep learning\nneural network  attention", "neural network")).toBe(
        "deep learning\nattention"
      );
      expect(removeTerm("a  b RL c", "RL")).toBe("a  b c");
    });
  });

  describe("appendTerm", () => {
    it("末尾に空白1つで追加し、空なら語句だけにする", () => {
      expect(appendTerm("deep learning  ", "RL")).toBe("deep learning RL");
      expect(appendTerm("", "RL")).toBe("RL");
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

    it("元の検索文にあって編集後にない関連語だけを除外とする", () => {
      expect(isExcludedTerm(query, "neural network")).toBe(true);
      expect(isExcludedTerm(query, "RL")).toBe(false);
      // 元から含まれていない語は除外ではない
      expect(isExcludedTerm(query, "graph")).toBe(false);
    });
  });
});
