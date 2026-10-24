import { useEffect, useRef, useState } from "react";
import type { Paper } from "../../shared/schemas/paper";
import { isValidAuthorAffiliations } from "../../shared/utils/authorAffiliations";
import { ARXIV_ID_PATTERN } from "../lib/arxivId";
import { loadPaperAffiliations } from "../lib/loadPaperAffiliations";
import { usePaperStore } from "../stores/paperStore";

/** HTML evidence is paper-level; never manufacture an author/institution correspondence. */
export const PaperAffiliationEvidence = ({ paper }: { paper: Paper }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    evidence?: NonNullable<Paper["paperAffiliationEvidence"]>;
    status: "loading" | "done" | "error";
  }>();
  const key = JSON.stringify([paper.id, paper.updatedAt, paper.authors]);
  const evidence =
    (result?.key === key ? result.evidence : undefined) ?? paper.paperAffiliationEvidence;
  const complete =
    isValidAuthorAffiliations(paper.authors, paper.authorAffiliations) &&
    paper.authorAffiliations.every((row) => row.some((value) => value.trim()));
  const fresh = evidence && Date.now() - new Date(evidence.checkedAt).getTime() < 86_400_000;
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: key captures source metadata; retry explicitly restarts failures
  useEffect(() => {
    if (!visible || complete || !ARXIV_ID_PATTERN.test(paper.id) || fresh) return;
    let active = true;
    setResult({ key, status: "loading" });
    void loadPaperAffiliations(paper, () => active)
      .then(async (loaded) => {
        if (!active || !loaded) return;
        setResult({ key, evidence: loaded, status: "done" });
        // Saving can be unavailable in an isolated detail; the fetched evidence remains visible.
        await usePaperStore
          .getState()
          .savePaperAffiliationEvidence(paper.id, paper.authors, paper.updatedAt, loaded)
          .catch(() => undefined);
      })
      .catch(() => {
        if (active) setResult({ key, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [key, visible, complete, fresh, retry]);

  return (
    <div ref={ref} className="text-xs text-muted-foreground break-words">
      {evidence?.organizations.length ? (
        <>
          <p>本文記載の所属: {evidence.organizations.join(" · ")}</p>
          <a
            onClick={(event) => event.stopPropagation()}
            className="underline"
            href={`https://arxiv.org/html/${paper.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            出典: arXiv本文
          </a>
          <span>（著者との対応は未確認）</span>
        </>
      ) : complete ? null : current?.status === "loading" ? (
        <output>本文から所属を確認中…</output>
      ) : evidence && current?.status !== "error" ? (
        <>
          <span>本文から所属を確認できませんでした。 </span>
          <a
            onClick={(event) => event.stopPropagation()}
            className="underline"
            href={paper.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            PDFで確認
          </a>
        </>
      ) : (
        <button
          type="button"
          className="underline"
          onClick={(event) => {
            event.stopPropagation();
            setVisible(true);
            setRetry((value) => value + 1);
          }}
        >
          {current?.status === "error" ? "所属の取得を再試行" : "本文から所属を取得"}
        </button>
      )}
    </div>
  );
};
