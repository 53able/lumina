/** arXiv HTML is converted from LaTeX: even affiliation classes can contain author notes. */
export const extractPaperAffiliations = (html: string, authors: string[]): string[] => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const authorNames = authors.map((name) => normalize(name).toLocaleLowerCase());
  const candidates = Array.from(
    document.querySelectorAll(".ltx_authors .ltx_contact.ltx_role_affiliation")
  ).map((element) => {
    const copy = element.cloneNode(true) as Element;
    for (const label of copy.querySelectorAll(".ltx_contact_name, script, style, sup"))
      label.remove();
    return normalize(copy.textContent ?? "");
  });
  return [
    ...new Set(
      candidates.filter((text) => {
        if (
          !text ||
          text.length > 240 ||
          /@|https?:|contribut|appendix|equal(?:ly)?|correspond|supported by/i.test(text)
        )
          return false;
        if (authorNames.some((name) => name && text.toLocaleLowerCase().includes(name)))
          return false;
        // Fail closed for ambiguous author lists/notes. Unrecognized organizations remain unconfirmed.
        return /\b(?:university|universit[äé]|institute|institution|college|school|laborator(?:y|ies)|labs?|research|academy|centre|center|inc|corp|ltd|AI)\b|OpenAI|DeepSeek|Google|Microsoft|Meta\b|NVIDIA|Anthropic|大学|研究所/i.test(
          text
        );
      })
    ),
  ].slice(0, 30);
};
