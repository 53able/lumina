// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/paper";
import { loadPaperAffiliations } from "../lib/loadPaperAffiliations";
import { PaperAffiliationEvidence } from "./PaperAffiliationEvidence";

const { save } = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/loadPaperAffiliations", () => ({ loadPaperAffiliations: vi.fn() }));
vi.mock("../stores/paperStore", () => ({
  usePaperStore: { getState: () => ({ savePaperAffiliationEvidence: save }) },
}));
const paper: Paper = {
  id: "2403.17281",
  title: "Title",
  abstract: "",
  authors: ["Alice"],
  categories: [],
  publishedAt: new Date("2024-03-01"),
  updatedAt: new Date("2024-03-01"),
  arxivUrl: "https://arxiv.org/abs/2403.17281",
  pdfUrl: "https://arxiv.org/pdf/2403.17281",
};
const evidence = {
  organizations: ["Squirrel AI"],
  sourceUrl: "https://arxiv.org/html/2403.17281",
  checkedAt: new Date(),
};
describe("paper-level affiliation enrichment", () => {
  beforeEach(() => {
    vi.mocked(loadPaperAffiliations).mockReset();
    save.mockClear();
  });
  afterEach(cleanup);
  it("waits for visibility or explicit action, displays and saves sourced evidence", async () => {
    vi.mocked(loadPaperAffiliations).mockResolvedValue(evidence);
    const parentClick = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: emulates the existing clickable card container
      <div onClick={parentClick} role="presentation">
        <PaperAffiliationEvidence paper={paper} />
      </div>
    );
    expect(loadPaperAffiliations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("本文から所属を取得"));
    expect(await screen.findByText("本文記載の所属: Squirrel AI")).toBeInTheDocument();
    expect(screen.getByText("（著者との対応は未確認）")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", evidence.sourceUrl);
    expect(save).toHaveBeenCalledWith(paper.id, paper.authors, paper.updatedAt, evidence);
    expect(parentClick).not.toHaveBeenCalled();
  });
  it("offers retry after errors and PDF when no structured affiliation exists", async () => {
    vi.mocked(loadPaperAffiliations)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...evidence, organizations: [] });
    render(<PaperAffiliationEvidence paper={paper} />);
    fireEvent.click(screen.getByText("本文から所属を取得"));
    fireEvent.click(await screen.findByText("所属の取得を再試行"));
    expect(await screen.findByText("PDFで確認")).toHaveAttribute("href", paper.pdfUrl);
  });
  it("keeps retry available when refreshing old empty evidence fails", async () => {
    let notify: IntersectionObserverCallback | undefined;
    const original = globalThis.IntersectionObserver;
    vi.stubGlobal(
      "IntersectionObserver",
      class extends original {
        constructor(callback: IntersectionObserverCallback) {
          super(callback);
          notify = callback;
        }
      }
    );
    try {
      vi.mocked(loadPaperAffiliations).mockRejectedValue(new Error("offline"));
      render(
        <PaperAffiliationEvidence
          paper={{
            ...paper,
            paperAffiliationEvidence: { ...evidence, organizations: [], checkedAt: new Date(0) },
          }}
        />
      );
      act(() =>
        notify?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      );
      expect(await screen.findByText("所属の取得を再試行")).toBeInTheDocument();
    } finally {
      vi.stubGlobal("IntersectionObserver", original);
    }
  });
  it("uses cached evidence without fetching and keeps author metadata untouched", () => {
    render(<PaperAffiliationEvidence paper={{ ...paper, paperAffiliationEvidence: evidence }} />);
    expect(screen.getByText("本文記載の所属: Squirrel AI")).toBeInTheDocument();
    expect(loadPaperAffiliations).not.toHaveBeenCalled();
    expect(paper.authorAffiliations).toBeUndefined();
  });
  it("does not display a previous paper's late response after switching papers", async () => {
    let resolve!: (value: typeof evidence) => void;
    vi.mocked(loadPaperAffiliations)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      )
      .mockResolvedValueOnce({ ...evidence, organizations: [] });
    const { rerender } = render(<PaperAffiliationEvidence paper={paper} />);
    fireEvent.click(screen.getByText("本文から所属を取得"));
    rerender(<PaperAffiliationEvidence paper={{ ...paper, id: "2401.02954" }} />);
    await act(async () => resolve(evidence));
    await waitFor(() =>
      expect(screen.queryByText("本文記載の所属: Squirrel AI")).not.toBeInTheDocument()
    );
    expect(save).not.toHaveBeenCalledWith(paper.id, expect.anything(), expect.anything(), evidence);
  });
});
