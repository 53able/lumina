/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { useSummaryStore } from "./stores/summaryStore";

/**
 * テスト用のQueryClientラッパー
 */
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

/**
 * QueryClientProviderとMemoryRouterとInteractionProviderでラップしたレンダリングヘルパー
 */
const renderWithProviders = (ui: ReactNode) => {
  const testQueryClient = createTestQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={testQueryClient}>
        <InteractionProvider>{ui}</InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

// グローバルfetchのモック
const mockFetch = vi.fn().mockImplementation(() =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        papers: [],
        fetchedCount: 0,
        totalResults: 0,
        took: 0,
      }),
      { status: 200, headers: new Headers() }
    )
  )
);
vi.stubGlobal("fetch", mockFetch);

// interactionStoreのモック
const mockToggleLike = vi.fn();
const mockToggleBookmark = vi.fn();
let mockLikedPaperIds = new Set<string>();
let mockBookmarkedPaperIds = new Set<string>();

vi.mock("@/client/stores/interactionStore", () => ({
  useInteractionStore: vi.fn((selector) => {
    const state = {
      toggleLike: mockToggleLike,
      toggleBookmark: mockToggleBookmark,
      getLikedPaperIds: () => mockLikedPaperIds,
      getBookmarkedPaperIds: () => mockBookmarkedPaperIds,
    };
    return selector ? selector(state) : state;
  }),
}));

// searchHistoryStoreのモック
const mockSearchHistories = [
  {
    id: "history-1",
    originalQuery: "強化学習",
    expandedQuery: {
      original: "強化学習",
      english: "reinforcement learning",
      synonyms: ["RL"],
      searchText: "reinforcement learning RL",
    },
    resultCount: 42,
    createdAt: new Date("2026-01-17T10:00:00Z"),
  },
];
let mockHistories = mockSearchHistories;
const mockDeleteHistory = vi.fn();

vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: vi.fn((selector) => {
    const state = {
      histories: mockHistories,
      deleteHistory: mockDeleteHistory,
    };
    return selector ? selector(state) : state;
  }),
}));

// paperStoreのモック（テスト用の論文データを提供）
const mockPapers = [
  {
    id: "2401.00001",
    title: "Test Paper Title",
    abstract: "This is a test abstract for the paper.",
    authors: ["Author One", "Author Two"],
    categories: ["cs.AI"],
    publishedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    pdfUrl: "https://arxiv.org/pdf/2401.00001",
    arxivUrl: "https://arxiv.org/abs/2401.00001",
    embedding: [],
  },
];

vi.mock("@/client/stores/paperStore", () => {
  // mockPapers は vi.mock の巻き上げ後に初期化されるため、参照は呼び出し時に行う
  const getState = () => ({
    papers: mockPapers,
    addPapers: vi.fn(),
    loadStatus: "ready",
  });
  return {
    usePaperStore: Object.assign(
      vi.fn((selector) => {
        const state = getState();
        return selector ? selector(state) : state;
      }),
      { getState }
    ),
    whenPapersReady: () => Promise.resolve(),
  };
});

// usePaperFilterをモック（searchQuery: null で「検索未実行」にし、一覧表示になる）
vi.mock("@/client/hooks/usePaperFilter", () => ({
  usePaperFilter: () => ({
    searchQuery: null as string | null,
    setSearchQuery: vi.fn(),
    filterMode: "all" as const,
    selectedCategories: new Set<string>(),
    toggleFilterMode: vi.fn(),
    toggleCategory: vi.fn(),
    clearAllFilters: vi.fn(),
    clearSearchAndFilters: vi.fn(),
    filterPapers: (papers: unknown[]) => papers, // パススルー
  }),
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockLikedPaperIds = new Set<string>();
    mockBookmarkedPaperIds = new Set<string>();
    mockHistories = mockSearchHistories;
  });

  describe("レンダリング", () => {
    it("アプリのヘッダーが表示される", () => {
      renderWithProviders(<App />);

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lumina");
    });

    it("検索ボックスが表示される", () => {
      renderWithProviders(<App />);

      expect(screen.getByRole("searchbox")).toBeInTheDocument();
    });

    it("PaperExplorerセクションが表示される", () => {
      renderWithProviders(<App />);

      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("論文を探す");
    });
  });

  describe("レイアウト", () => {
    it("main要素が存在する", () => {
      renderWithProviders(<App />);

      expect(screen.getByRole("main")).toBeInTheDocument();
    });

    it("header要素が存在する", () => {
      renderWithProviders(<App />);

      expect(screen.getByRole("banner")).toBeInTheDocument();
    });
  });

  describe("いいね/ブックマーク機能", () => {
    beforeEach(() => {
      mockLikedPaperIds = new Set<string>();
      mockBookmarkedPaperIds = new Set<string>();
    });

    it("正常系: いいねボタンをクリックするとinteractionStoreのtoggleLikeが呼ばれる", async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);

      // 論文カードが表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
      });

      // いいねボタンをクリック
      const likeButton = screen.getByRole("button", { name: "いいね" });
      await user.click(likeButton);

      // interactionStoreのtoggleLikeが呼ばれることを確認
      expect(mockToggleLike).toHaveBeenCalledWith("2401.00001");
    });

    it("正常系: ブックマークボタンをクリックするとinteractionStoreのtoggleBookmarkが呼ばれる", async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);

      // 論文カードが表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
      });

      // ブックマークボタンをクリック
      const bookmarkButton = screen.getByRole("button", { name: "ブックマーク" });
      await user.click(bookmarkButton);

      // interactionStoreのtoggleBookmarkが呼ばれることを確認
      expect(mockToggleBookmark).toHaveBeenCalledWith("2401.00001");
    });

    it("正常系: いいね済みの論文はいいねボタンがアクティブ状態で表示される", async () => {
      // いいね済み状態をモック
      mockLikedPaperIds = new Set(["2401.00001"]);

      renderWithProviders(<App />);

      // 論文カードが表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
      });

      // いいねボタンがいいね済み状態であることを確認
      const likeButton = screen.getByRole("button", { name: "いいね" });
      expect(likeButton).toHaveAttribute("data-liked", "true");
    });

    it("正常系: ブックマーク済みの論文はブックマークボタンがアクティブ状態で表示される", async () => {
      // ブックマーク済み状態をモック
      mockBookmarkedPaperIds = new Set(["2401.00001"]);

      renderWithProviders(<App />);

      // 論文カードが表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
      });

      // ブックマークボタンがブックマーク済み状態であることを確認
      const bookmarkButton = screen.getByRole("button", { name: "ブックマーク" });
      expect(bookmarkButton).toHaveAttribute("data-bookmarked", "true");
    });
  });

  describe("検索履歴機能", () => {
    beforeEach(() => {
      mockHistories = mockSearchHistories;
    });

    // テスト環境の matchMedia はモバイル幅（lg未満）。履歴は検索欄の手前の折りたたみに出る
    it("正常系: 検索履歴セクションが表示される", () => {
      renderWithProviders(<App />);

      expect(screen.getByRole("button", { name: /^検索履歴/ })).toBeInTheDocument();
    });

    it("正常系: 検索履歴が表示される", async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);
      await user.click(screen.getByRole("button", { name: /^検索履歴/ }));

      expect(screen.getByRole("button", { name: /^強化学習/ })).toBeVisible();
    });

    it("正常系: 検索履歴の削除ボタンをクリックするとdeleteHistoryが呼ばれる", async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);
      await user.click(screen.getByRole("button", { name: /^検索履歴/ }));

      // 削除ボタンをクリック
      const deleteButton = screen.getByRole("button", { name: "「強化学習」を削除" });
      await user.click(deleteButton);

      expect(mockDeleteHistory).toHaveBeenCalledWith("history-1");
    });

    it("正常系: 10件より古い履歴も渡し、開閉ボタンに全件数を出して「さらに表示」で表示できる（#112）", async () => {
      const user = userEvent.setup();
      mockHistories = Array.from({ length: 11 }, (_, i) => ({
        ...mockSearchHistories[0],
        id: `history-${i + 1}`,
        originalQuery: `検索${i + 1}`,
        createdAt: new Date(Date.UTC(2026, 0, 20 - i)),
      }));

      renderWithProviders(<App />);
      const toggle = screen.getByRole("button", { name: /^検索履歴/ });
      expect(toggle).toHaveAccessibleName("検索履歴、全11件");
      await user.click(toggle);
      await user.click(screen.getByRole("button", { name: "さらに表示（残り1件）" }));

      expect(screen.getByRole("button", { name: /^検索11/ })).toBeVisible();
    });

    it("正常系: 検索履歴がない場合は空状態メッセージを表示する", async () => {
      const user = userEvent.setup();
      mockHistories = [];

      renderWithProviders(<App />);
      await user.click(screen.getByRole("button", { name: /^検索履歴/ }));

      expect(screen.getByText("検索履歴がありません")).toBeVisible();
    });
  });

  describe("キーボードの順序（デスクトップ、#68）", () => {
    const originalMatchMedia = window.matchMedia;

    beforeEach(() => {
      // デスクトップ幅（lg 以上）。サイドバー（同期・検索履歴）を表示する
      window.matchMedia = (query: string) => ({
        ...originalMatchMedia(query),
        matches: query.includes("min-width: 1024px"),
      });
    });

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it("最初の Tab はスキップリンク「検索へ移動」に届き、Enter で検索欄へ移る", async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);
      expect(screen.getByRole("complementary")).toBeInTheDocument();

      await user.tab();
      expect(screen.getByRole("link", { name: "検索へ移動" })).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(screen.getByRole("searchbox")).toHaveFocus();
    });

    it("2つ目の Tab は「論文一覧へ移動」に届き、Enter で一覧へ移って次の Tab は一覧の中に届く", async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);

      await user.tab();
      await user.tab();
      expect(screen.getByRole("link", { name: "論文一覧へ移動" })).toHaveFocus();

      await user.keyboard("{Enter}");
      const list = screen.getByRole("region", { name: "論文一覧" });
      expect(list).toHaveFocus();

      await user.tab();
      expect(list.contains(document.activeElement)).toBe(true);
    });

    it("スキップリンクを使わなければ、見た目の順（左のサイドバー → 右の検索欄）で Tab が進み、サイドバーの検索履歴にも届く", async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);
      const sidebar = screen.getByRole("complementary");
      const searchbox = screen.getByRole("searchbox");

      // 検索欄に届くまでに通った要素
      const visited: Element[] = [];
      for (let i = 0; i < 50 && document.activeElement !== searchbox; i++) {
        await user.tab();
        if (document.activeElement) visited.push(document.activeElement);
      }

      expect(searchbox).toHaveFocus();
      expect(visited).toContain(screen.getByRole("button", { name: /^強化学習/ }));
      // サイドバーの操作はすべて検索欄より前に通る（Tab の順と見た目の順が逆転しない）
      const sidebarControls = within(sidebar)
        .queryAllByRole("button")
        .filter((button) => !button.hasAttribute("disabled"));
      for (const control of sidebarControls) {
        expect(visited).toContain(control);
      }
    });
  });

  describe("一覧の読む理由", () => {
    afterEach(() => {
      useSummaryStore.setState({ summaries: [] });
    });

    it("正常系: 同じ論文に複数の版がある場合は、最新の版ではなく採用版の読む理由を表示する", async () => {
      const base = {
        paperId: "2401.00001",
        summary: "要約",
        keyPoints: [],
        language: "ja" as const,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      };
      useSummaryStore.setState({
        summaries: [
          { ...base, id: 1, whyRead: "採用版の読む理由", adopted: true },
          { ...base, id: 2, whyRead: "新しい版の読む理由", adopted: false },
        ],
      });

      renderWithProviders(<App />);

      expect(await screen.findByText("採用版の読む理由")).toBeInTheDocument();
      expect(screen.queryByText("新しい版の読む理由")).not.toBeInTheDocument();
    });
  });
});
