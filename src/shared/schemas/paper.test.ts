import { describe, expect, it } from "vitest";
import { PaperSchema } from "./paper";

const legacyPaper = {
  id: "2401.00001",
  title: "Paper",
  abstract: "Abstract",
  authors: ["A", "B"],
  categories: ["cs.AI"],
  publishedAt: "2024-01-01",
  updatedAt: "2024-01-01",
  pdfUrl: "https://arxiv.org/pdf/2401.00001",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
};

describe("PaperSchema affiliations", () => {
  it("accepts legacy papers without affiliations", () => {
    expect(PaperSchema.safeParse(legacyPaper).success).toBe(true);
  });
  it("accepts paper-level evidence independently of author correspondence and coerces its date", () => {
    const evidence = {
      organizations: ["OpenAI", "University"],
      sourceUrl: "https://arxiv.org/html/2401.00001v1",
      checkedAt: "2024-01-03T12:00:00.000Z",
    };
    expect(
      PaperSchema.parse({ ...legacyPaper, paperAffiliationEvidence: evidence })
        .paperAffiliationEvidence
    ).toEqual({ ...evidence, checkedAt: new Date(evidence.checkedAt) });
  });
  it.each([
    { organizations: [1], sourceUrl: "https://arxiv.org/html/2401.00001", checkedAt: "2024-01-03" },
    { organizations: [], sourceUrl: "invalid", checkedAt: "2024-01-03" },
    { organizations: [], sourceUrl: "https://arxiv.org/html/2401.00001", checkedAt: "invalid" },
  ])("rejects malformed paper-level evidence %j", (paperAffiliationEvidence) => {
    expect(PaperSchema.safeParse({ ...legacyPaper, paperAffiliationEvidence }).success).toBe(false);
  });
  it("accepts aligned empty and multiple affiliation rows", () => {
    expect(
      PaperSchema.parse({ ...legacyPaper, authorAffiliations: [[], ["OpenAI", "Google"]] })
        .authorAffiliations
    ).toEqual([[], ["OpenAI", "Google"]]);
  });
  it.each(
    [[[]], [["OpenAI"], [], []], ["OpenAI", []], [[1], []], null].map((value) => [value])
  )("rejects malformed affiliations %j", (authorAffiliations) => {
    expect(PaperSchema.safeParse({ ...legacyPaper, authorAffiliations }).success).toBe(false);
  });
});
