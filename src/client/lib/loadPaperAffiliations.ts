import type { Paper } from "../../shared/schemas/paper";
import { extractPaperAffiliations } from "./extractPaperAffiliations";

type Evidence = NonNullable<Paper["paperAffiliationEvidence"]>;
let tail: Promise<unknown> = Promise.resolve();
let nextStart = 0;
const pending = new Map<
  string,
  { promise: Promise<Evidence | null>; consumers: Set<() => boolean> }
>();

/** Only visible papers enter this serial queue; duplicate card/detail requests share work. */
export const loadPaperAffiliations = (
  paper: Paper,
  isNeeded: () => boolean
): Promise<Evidence | null> => {
  const key = JSON.stringify([paper.id, paper.updatedAt, paper.authors]);
  const existing = pending.get(key);
  if (existing) {
    existing.consumers.add(isNeeded);
    return existing.promise;
  }
  const consumers = new Set([isNeeded]);
  const needed = () => [...consumers].some((consumer) => consumer());
  const task = tail
    .catch(() => undefined)
    .then(async () => {
      if (!needed()) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextStart - Date.now())));
      if (!needed()) return null;
      const sourceUrl = `https://arxiv.org/html/${paper.id}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        nextStart = Date.now() + 3100;
        const response = await fetch(
          `/api/v1/affiliations?paperId=${encodeURIComponent(paper.id)}`,
          {
            signal: AbortSignal.timeout(20_000),
          }
        );
        if (response.status === 429 && attempt === 0) {
          const delay = Number(response.headers.get("Retry-After")) || 3;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(15, Math.max(3, delay)) * 1000)
          );
          if (!needed()) return null;
          continue;
        }
        if (response.status === 404) return { organizations: [], sourceUrl, checkedAt: new Date() };
        if (!response.ok) throw new Error("所属情報を取得できませんでした");
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          !("html" in data) ||
          typeof data.html !== "string"
        ) {
          throw new Error("所属情報の応答を確認できませんでした");
        }
        return {
          organizations: extractPaperAffiliations(data.html, paper.authors),
          sourceUrl,
          checkedAt: new Date(),
        };
      }
      throw new Error("所属情報を取得できませんでした");
    });
  pending.set(key, { promise: task, consumers });
  tail = task;
  void task.finally(() => pending.delete(key)).catch(() => undefined);
  return task;
};
