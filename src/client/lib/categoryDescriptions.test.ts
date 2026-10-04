import { describe, expect, it } from "vitest";
import { CATEGORY_DESCRIPTIONS, getCategoryName } from "./categoryDescriptions";

describe("getCategoryName", () => {
  it("説明の先頭文が分野名でない cs・stat は対訳の分野名を返す", () => {
    expect(getCategoryName("cs.LG")).toBe("機械学習");
    expect(getCategoryName("cs.CV")).toBe("コンピュータビジョン");
    expect(getCategoryName("stat.ML")).toBe("機械学習（統計）");
  });

  it("それ以外は説明の先頭文（「。」まで）を分野名にする", () => {
    expect(getCategoryName("cs.CL")).toBe("自然言語処理");
    expect(getCategoryName("astro-ph.CO")).toBe("宇宙論と銀河系外天体物理学");
    expect(getCategoryName("math.CO")).toBe("組み合わせ論");
  });

  it("説明のないカテゴリは undefined を返す", () => {
    expect(getCategoryName("unknown.XX")).toBeUndefined();
  });

  it("説明のあるすべてのカテゴリに、短い分野名がある（説明文そのものを名前にしない）", () => {
    for (const category of Object.keys(CATEGORY_DESCRIPTIONS)) {
      const name = getCategoryName(category);
      expect(name, category).toBeTruthy();
      expect(name?.length ?? 0, `${category}: ${name}`).toBeLessThanOrEqual(24);
    }
  });
});
