import { describe, expect, it } from "vitest";
import { isValidAuthorAffiliations } from "./authorAffiliations";

describe("isValidAuthorAffiliations", () => {
  it("accepts aligned string rows, including empty rows", () => {
    expect(isValidAuthorAffiliations(["A", "A"], [[], ["Google", "OpenAI"]])).toBe(true);
    expect(isValidAuthorAffiliations([], [])).toBe(true);
  });
  it.each(
    [undefined, null, {}, [], [["Google"]], [[], [], []], ["Google", []], [[1], []]].map(
      (value) => [value]
    )
  )("rejects missing, mismatched or malformed rows %j", (value) => {
    expect(isValidAuthorAffiliations(["A", "B"], value)).toBe(false);
  });
  it("rejects sparse author rows and sparse affiliation entries", () => {
    expect(isValidAuthorAffiliations(["A"], Array(1))).toBe(false);
    expect(isValidAuthorAffiliations(["A"], [Array(1)])).toBe(false);
  });
  it("does not mutate its arguments", () => {
    const authors = Object.freeze(["A"]);
    const value = Object.freeze([Object.freeze([" Google "])]);
    expect(isValidAuthorAffiliations(authors, value)).toBe(true);
    expect(value).toEqual([[" Google "]]);
  });
});
