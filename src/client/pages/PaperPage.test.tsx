/**
 * @vitest-environment jsdom
 *
 * 論文詳細ページの状態表示（Issue #67）
 * ロード中・このデバイスに未保存・無効ID・有効IDを区別して表示する。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { parseISO } from "date-fns";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { InteractionProvider } from "../contexts/InteractionContext";
import type { LuminaDB } from "../db/db";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSummaryStore } from "../stores/summaryStore";
import { PaperPage } from "./PaperPage";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const paper: Paper = {
  id: "2512.18131",
  title: "Evaluating LLM Code Generation",
  abstract: "We evaluate code generation...",
  authors: ["Alice"],
  categories: ["cs.SE"],
  publishedAt: parseISO("2025-12-20"),
  updatedAt: parseISO("2025-12-20"),
  pdfUrl: "https://arxiv.org/pdf/2512.18131",
  arxivUrl: "https://arxiv.org/abs/2512.18131",
};

/** ストア初期化済みを表すダミーDB（PaperPage は参照しない） */
const dummyDb = {} as LuminaDB;

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <InteractionProvider>
          <Routes>
            <Route path="/papers/:id" element={<PaperPage />} />
          </Routes>
        </InteractionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("PaperPage の状態表示", () => {
  beforeEach(() => {
    useSettingsStore.setState({ autoGenerateSummary: false, apiEnabled: false });
    useSummaryStore.setState({ summaries: [] });
  });

  afterEach(() => {
    cleanup();
    usePaperStore.setState({ papers: [], isLoading: false, _db: null });
  });

  it("ストアのロード中は「見つからない」ではなくロード中を表示し、ロード完了後に論文を表示する", () => {
    usePaperStore.setState({ papers: [], isLoading: true, _db: dummyDb });
    renderAt(`/papers/${paper.id}`);

    expect(screen.getByRole("status")).toHaveTextContent("論文を読み込み中");
    expect(
      screen.queryByText("この論文はこのデバイスに保存されていません")
    ).not.toBeInTheDocument();

    act(() => {
      usePaperStore.setState({ papers: [paper], isLoading: false });
    });
    expect(screen.getByText(paper.title)).toBeInTheDocument();
  });

  it("ストア未初期化（DB未設定）の間もロード中を表示する", () => {
    usePaperStore.setState({ papers: [], isLoading: false, _db: null });
    renderAt(`/papers/${paper.id}`);

    expect(screen.getByRole("status")).toHaveTextContent("論文を読み込み中");
  });

  it("有効なIDでストアにある論文は詳細を表示する", () => {
    usePaperStore.setState({ papers: [paper], isLoading: false, _db: dummyDb });
    renderAt(`/papers/${paper.id}`);

    expect(screen.getByText(paper.title)).toBeInTheDocument();
    expect(screen.queryByText("論文を読み込み中...")).not.toBeInTheDocument();
  });

  it("有効なIDでもこのデバイスに無い論文は、arXiv への回復導線と一覧への導線を表示する", () => {
    usePaperStore.setState({ papers: [], isLoading: false, _db: dummyDb });
    renderAt("/papers/2512.18131v2");

    expect(
      screen.getByRole("heading", { name: "この論文はこのデバイスに保存されていません" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /arXiv で開く/ })).toHaveAttribute(
      "href",
      "https://arxiv.org/abs/2512.18131v2"
    );
    expect(screen.getByRole("link", { name: /PDF を開く/ })).toHaveAttribute(
      "href",
      "https://arxiv.org/pdf/2512.18131v2"
    );
    expect(screen.getByRole("link", { name: "論文一覧を見る" })).toHaveAttribute("href", "/");
  });

  it("旧形式の arXiv ID も有効IDとして扱う", () => {
    usePaperStore.setState({ papers: [], isLoading: false, _db: dummyDb });
    renderAt(`/papers/${encodeURIComponent("hep-th/9901001")}`);

    expect(screen.getByRole("link", { name: /arXiv で開く/ })).toHaveAttribute(
      "href",
      "https://arxiv.org/abs/hep-th/9901001"
    );
  });

  it("arXiv ID の形式でないIDは、無効IDとして説明し arXiv へのリンクを出さない", () => {
    usePaperStore.setState({ papers: [], isLoading: false, _db: dummyDb });
    renderAt("/papers/not-a-paper");

    expect(
      screen.getByRole("heading", { name: "論文IDの形式が正しくありません" })
    ).toBeInTheDocument();
    expect(screen.getByText(/2512\.18131/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /arXiv で開く/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "論文一覧を見る" })).toHaveAttribute("href", "/");
  });
});
