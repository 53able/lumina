// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractPaperAffiliations } from "./extractPaperAffiliations";

const block = (text: string) =>
  `<span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation: </span>${text}</span>`;
describe("arXiv HTML affiliation evidence", () => {
  it("extracts structured institution text and deduplicates without assigning authors", () => {
    expect(
      extractPaperAffiliations(
        `<div class="ltx_authors">${block("Squirrel AI, Bellevue, WA, USA")}${block("Michigan State <b>University</b>, USA")}${block("Squirrel AI, Bellevue, WA, USA")}${block("DeepSeek-AI")}</div>`,
        ["Alice"]
      )
    ).toEqual(["Squirrel AI, Bellevue, WA, USA", "Michigan State University, USA", "DeepSeek-AI"]);
  });
  it("rejects contributor notes, author names, email and unrelated body institutions", () => {
    expect(
      extractPaperAffiliations(
        `<div class="ltx_authors">${block("A detailed contributor list can be found in the appendix of this paper.")}${block("Alice Research, Bob Smith")}${block("person@university.edu")}${block("Equal contribution, University")}</div>${block("Other University")}`,
        ["Alice Research", "Bob Smith"]
      )
    ).toEqual([]);
  });
  it("does not infer from unstructured author text or execute HTML", () => {
    expect(
      extractPaperAffiliations(
        '<div class="ltx_authors"><span class="ltx_personname">Alice, Example University</span><script>throw new Error()</script></div>',
        ["Alice"]
      )
    ).toEqual([]);
  });
});
