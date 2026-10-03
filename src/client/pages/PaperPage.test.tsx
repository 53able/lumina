/**
 * @vitest-environment jsdom
 *
 * 論文詳細への直接アクセス（#65）: 保存済み論文の読み込み中に未読み込みの論文を
 * 「論文が見つかりません」と誤判定しない
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { usePaperStore } from "../stores/paperStore";
import { resetPaperStoreForTest, seedPaperStoreForTest } from "../testing/paperStoreTestUtils";
import { PaperPage } from "./PaperPage";

vi.mock("../components/PaperDetail", () => ({
  PaperDetail: ({ paper }: { paper: Paper }) => <h1>{paper.title}</h1>,
}));

vi.mock("../hooks/usePaperSummary", () => ({
  usePaperSummary: () => ({
    summary: undefined,
    summaryLanguage: "ja",
    setSummaryLanguage: vi.fn(),
    isLoading: false,
    error: null,
    failedTarget: null,
    generateSummary: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const paper: Paper = {
  id: "2401.00001",
  title: "Attention Is All You Need",
  abstract: "The dominant sequence transduction models...",
  authors: ["Ashish Vaswani"],
  categories: ["cs.CL"],
  publishedAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
  embedding: [0.1, 0.2],
};

const renderPaperPage = (id = paper.id) =>
  render(
    <MemoryRouter initialEntries={[`/papers/${id}`]}>
      <Routes>
        <Route path="/papers/:id" element={<PaperPage />} />
      </Routes>
    </MemoryRouter>
  );

describe("PaperPage", () => {
  let db: LuminaDB;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    db = createLuminaDb(`paper-page-test-${counter}`);
  });

  afterEach(async () => {
    cleanup();
    resetPaperStoreForTest();
    await db.delete();
  });

  it("一覧に読み込み済みの論文はそのまま表示する", () => {
    seedPaperStoreForTest([paper], db);
    renderPaperPage();

    expect(screen.getByRole("heading", { name: paper.title })).toBeInTheDocument();
  });

  it("読み込み中に一覧にまだない論文は、DB から1件読んで表示する（見つからないと表示しない）", async () => {
    await db.papers.add(paper);
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true, _db: db });
    renderPaperPage();

    expect(screen.queryByText("論文が見つかりません")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: paper.title })).toBeInTheDocument();
    expect(screen.queryByText("論文が見つかりません")).not.toBeInTheDocument();
  });

  it("DB の準備前（読み込み開始前）は読み込み中を表示し、見つからないと表示しない", () => {
    usePaperStore.setState({ papers: [], loadStatus: "idle", _db: null });
    renderPaperPage();

    expect(screen.getByTestId("paper-page-loading")).toBeInTheDocument();
    expect(screen.queryByText("論文が見つかりません")).not.toBeInTheDocument();
  });

  it("DB にもない論文は「論文が見つかりません」と表示する", async () => {
    seedPaperStoreForTest([paper], db);
    renderPaperPage("9999.99999");

    expect(await screen.findByText("論文が見つかりません")).toBeInTheDocument();
  });

  it("読み込み中でも DB にない論文は「論文が見つかりません」と表示する", async () => {
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true, _db: db });
    renderPaperPage("9999.99999");

    expect(await screen.findByText("論文が見つかりません")).toBeInTheDocument();
  });
});
