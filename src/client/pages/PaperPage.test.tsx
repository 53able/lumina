/**
 * @vitest-environment jsdom
 *
 * 論文詳細ページの状態表示
 * - Issue #67: ロード中・このデバイスに未保存・無効ID・有効IDを区別して表示する
 * - Issue #65: 保存済み論文の読み込み中に、一覧に未読み込みの論文を DB から1件読み、
 *   「保存されていない」と誤判定しない
 * - Issue #108: 旧形式の ID（math.GT/0309136）はスラッシュを含んでも開ける
 * - Issue #127: 読み込めなかったことを表示している間も、別タブでその論文が保存されたり、
 *   タブが復帰したりしたら読み直す
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { parseISO } from "date-fns";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { InteractionProvider } from "../contexts/InteractionContext";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { DB_CHANGE_CHANNEL_NAME, type DbChangeMessage } from "../lib/dbChangeChannel";
import { toPaperListItem } from "../lib/paperIndex/core";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSummaryStore } from "../stores/summaryStore";
import { resetPaperStoreForTest, seedPaperStoreForTest } from "../testing/paperStoreTestUtils";
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
  embedding: [0.1, 0.2],
};

/** 旧形式の arXiv ID の論文（2007年以前） */
const legacyPaper: Paper = {
  ...paper,
  id: "math.GT/0309136",
  title: "Legacy Topology Paper",
  categories: ["math.GT"],
  pdfUrl: "https://arxiv.org/pdf/math.GT/0309136",
  arxivUrl: "https://arxiv.org/abs/math.GT/0309136",
};

const NOT_SAVED_HEADING = {
  name: "この論文はこのデバイスに保存されていません",
} as const;

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <InteractionProvider>
          <Routes>
            <Route path="/papers/:id/*" element={<PaperPage />} />
          </Routes>
        </InteractionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

let db: LuminaDB;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = createLuminaDb(`paper-page-test-${Date.now()}-${counter}`);
  useSettingsStore.setState({ autoGenerateSummary: false, apiEnabled: false });
  useSummaryStore.setState({ summaries: [] });
});

afterEach(async () => {
  cleanup();
  resetPaperStoreForTest();
  await db.delete();
});

describe("PaperPage の状態表示", () => {
  it("ストアのロード中は「見つからない」ではなくロード中を表示し、ロード完了後に論文を表示する", () => {
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true, _db: db });
    renderAt(`/papers/${paper.id}`);

    expect(screen.getByRole("status")).toHaveTextContent("論文を読み込み中");
    expect(screen.queryByRole("heading", NOT_SAVED_HEADING)).not.toBeInTheDocument();

    act(() => {
      usePaperStore.setState({
        papers: [toPaperListItem(paper)],
        loadStatus: "ready",
        isLoading: false,
      });
    });
    expect(screen.getByText(paper.title)).toBeInTheDocument();
  });

  it("ストア未初期化（DB未設定）の間もロード中を表示する", () => {
    usePaperStore.setState({ papers: [], loadStatus: "idle", isLoading: false, _db: null });
    renderAt(`/papers/${paper.id}`);

    expect(screen.getByRole("status")).toHaveTextContent("論文を読み込み中");
    expect(screen.getByTestId("paper-page-loading")).toBeInTheDocument();
    expect(screen.queryByRole("heading", NOT_SAVED_HEADING)).not.toBeInTheDocument();
  });

  it("有効なIDでストアにある論文は詳細を表示する", () => {
    seedPaperStoreForTest([paper], db);
    renderAt(`/papers/${paper.id}`);

    expect(screen.getByText(paper.title)).toBeInTheDocument();
    expect(screen.queryByText("論文を読み込み中...")).not.toBeInTheDocument();
  });

  it("版番号付きURL（v2）でも、版番号なしで保存済みの論文の詳細を表示する", () => {
    seedPaperStoreForTest([paper], db);
    renderAt(`/papers/${paper.id}v2`);

    expect(screen.getByText(paper.title)).toBeInTheDocument();
    expect(screen.queryByRole("heading", NOT_SAVED_HEADING)).not.toBeInTheDocument();
  });

  it.each([
    ["スラッシュ", `/papers/${paper.id}/`],
    ["%2F", `/papers/${paper.id}%2F`],
  ])("新形式のIDは末尾に%sが付いても同じ論文を表示する", (_label, path) => {
    seedPaperStoreForTest([paper], db);
    renderAt(path);

    expect(screen.getByText(paper.title)).toBeInTheDocument();
  });

  it.each([
    ["スラッシュのまま", `/papers/${legacyPaper.id}`],
    ["スラッシュをエンコード", `/papers/${encodeURIComponent(legacyPaper.id)}`],
    ["版番号付き", `/papers/${legacyPaper.id}v1`],
    ["末尾スラッシュ付き", `/papers/${legacyPaper.id}/`],
    ["末尾に %2F 付き", `/papers/${legacyPaper.id}%2F`],
  ])("旧形式のIDの論文を表示する（%s）", (_label, path) => {
    seedPaperStoreForTest([paper, legacyPaper], db);
    renderAt(path);

    expect(screen.getByText(legacyPaper.title)).toBeInTheDocument();
    expect(screen.queryByRole("heading", NOT_SAVED_HEADING)).not.toBeInTheDocument();
  });

  it("旧形式のIDで読み込み中に一覧にまだない論文は、DB から1件読んで表示する", async () => {
    await db.papers.add(legacyPaper);
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true, _db: db });
    renderAt(`/papers/${legacyPaper.id}`);

    expect(await screen.findByText(legacyPaper.title)).toBeInTheDocument();
  });

  it("旧形式のIDでこのデバイスに無い論文は、スラッシュを含むIDで arXiv へのリンクを出す", async () => {
    seedPaperStoreForTest([], db);
    renderAt("/papers/math.GT/0309136");

    expect(await screen.findByRole("heading", NOT_SAVED_HEADING)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /arXiv で開く/ })).toHaveAttribute(
      "href",
      "https://arxiv.org/abs/math.GT/0309136"
    );
  });

  it("スラッシュの後ろが余分なIDは、無効IDとして扱う", async () => {
    seedPaperStoreForTest([], db);
    renderAt("/papers/2512.18131/extra");

    expect(
      await screen.findByRole("heading", { name: "論文IDの形式が正しくありません" })
    ).toBeInTheDocument();
  });

  it("有効なIDでもこのデバイスに無い論文は、arXiv への回復導線と一覧への導線を表示する", async () => {
    seedPaperStoreForTest([], db);
    renderAt("/papers/2512.18131v2");

    expect(await screen.findByRole("heading", NOT_SAVED_HEADING)).toBeInTheDocument();
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

  it("旧形式の arXiv ID も有効IDとして扱う", async () => {
    seedPaperStoreForTest([], db);
    renderAt(`/papers/${encodeURIComponent("hep-th/9901001")}`);

    expect(await screen.findByRole("link", { name: /arXiv で開く/ })).toHaveAttribute(
      "href",
      "https://arxiv.org/abs/hep-th/9901001"
    );
  });

  it("arXiv ID の形式でないIDは、無効IDとして説明し arXiv へのリンクを出さない", async () => {
    seedPaperStoreForTest([], db);
    renderAt("/papers/not-a-paper");

    expect(
      await screen.findByRole("heading", { name: "論文IDの形式が正しくありません" })
    ).toBeInTheDocument();
    expect(screen.getByText(/2512\.18131/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /arXiv で開く/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "論文一覧を見る" })).toHaveAttribute("href", "/");
  });
});

describe("PaperPage の DB からの1件読み込み（保存済み論文の段階読み込み中）", () => {
  it("読み込み中に一覧にまだない論文は、DB から1件読んで表示する（保存されていないと表示しない）", async () => {
    await db.papers.add(paper);
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true, _db: db });
    renderAt(`/papers/${paper.id}`);

    expect(screen.queryByRole("heading", NOT_SAVED_HEADING)).not.toBeInTheDocument();
    expect(await screen.findByText(paper.title)).toBeInTheDocument();
    expect(screen.queryByRole("heading", NOT_SAVED_HEADING)).not.toBeInTheDocument();
  });

  it("版番号付きURL（v2）でも、読み込み中に DB から版番号なしの論文を読んで表示する", async () => {
    await db.papers.add(paper);
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true, _db: db });
    renderAt(`/papers/${paper.id}v2`);

    expect(await screen.findByText(paper.title)).toBeInTheDocument();
    expect(screen.queryByRole("heading", NOT_SAVED_HEADING)).not.toBeInTheDocument();
  });

  it("読み込み中でも DB にない論文は「保存されていない」と表示する", async () => {
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true, _db: db });
    renderAt("/papers/2401.99999");

    expect(await screen.findByRole("heading", NOT_SAVED_HEADING)).toBeInTheDocument();
  });

  it("DB から読めなかったときは「保存されていない」と区別し、再試行で読み直す", async () => {
    await db.papers.add(paper);
    const get = vi.spyOn(db.papers, "get").mockRejectedValueOnce(new Error("read failed"));
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true, _db: db });
    renderAt(`/papers/${paper.id}`);

    expect(
      await screen.findByRole("heading", { name: "論文を読み込めませんでした" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", NOT_SAVED_HEADING)).not.toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "再試行" }).click();
    });
    expect(await screen.findByText(paper.title)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: "版番号なしのURL", target: paper, path: `/papers/${paper.id}` },
    { label: "版番号付きURL（v2）", target: paper, path: `/papers/${paper.id}v2` },
    { label: "旧形式のID", target: legacyPaper, path: `/papers/${legacyPaper.id}` },
  ])("$label: 読めなかったことを表示している間に別タブでその論文が保存されたら、読み直して詳細を表示する（Issue #127）", async ({
    target,
    path,
  }) => {
    vi.spyOn(db.papers, "get").mockRejectedValueOnce(new Error("read failed"));
    usePaperStore.setState({ papers: [], loadStatus: "error", isLoading: false, _db: db });
    renderAt(path);
    expect(
      await screen.findByRole("heading", { name: "論文を読み込めませんでした" })
    ).toBeInTheDocument();

    const otherTab = new BroadcastChannel(DB_CHANGE_CHANNEL_NAME);
    try {
      // 別の論文の変更では読み直さない
      otherTab.postMessage({
        dbName: db.name,
        table: "papers",
        paperIds: ["2401.99999"],
      } satisfies DbChangeMessage);
      await db.papers.add(target);
      otherTab.postMessage({
        dbName: db.name,
        table: "papers",
        paperIds: [target.id],
      } satisfies DbChangeMessage);

      expect(await screen.findByText(target.title)).toBeInTheDocument();
      expect(db.papers.get).toHaveBeenCalledTimes(2);
      expect(db.papers.get).toHaveBeenLastCalledWith(target.id);
    } finally {
      otherTab.close();
    }
  });

  it("読めなかったことを表示している間に bfcache から復帰したら、その1件を読み直して詳細を表示する（Issue #127）", async () => {
    vi.spyOn(db.papers, "get").mockRejectedValueOnce(new Error("read failed"));
    usePaperStore.setState({ papers: [], loadStatus: "error", isLoading: false, _db: db });
    renderAt(`/papers/${paper.id}`);
    expect(
      await screen.findByRole("heading", { name: "論文を読み込めませんでした" })
    ).toBeInTheDocument();

    // 通知が届かなかった別タブの保存
    await db.papers.add(paper);
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });

    expect(await screen.findByText(paper.title)).toBeInTheDocument();
    expect(db.papers.get).toHaveBeenCalledTimes(2);
  });
});
