/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";

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
let mockRecentHistories = mockSearchHistories;
const mockDeleteHistory = vi.fn();

vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: vi.fn((selector) => {
    const state = {
      histories: mockSearchHistories,
      getRecentHistories: () => mockRecentHistories,
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

vi.mock("@/client/stores/paperStore", () => ({
  usePaperStore: vi.fn((selector) => {
    const state = {
      papers: mockPapers,
      addPapers: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

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
    filterPapers: (papers: unknown[]) => papers, // パススルー
  }),
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockLikedPaperIds = new Set<string>();
    mockBookmarkedPaperIds = new Set<string>();
    mockRecentHistories = mockSearchHistories;
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
      mockRecentHistories = mockSearchHistories;
    });

    it("正常系: 検索履歴セクションが表示される", () => {
      renderWithProviders(<App />);

      expect(screen.getByText("検索履歴")).toBeInTheDocument();
    });

    it("正常系: 検索履歴が表示される", () => {
      renderWithProviders(<App />);

      expect(screen.getByText("強化学習")).toBeInTheDocument();
    });

    it("正常系: 検索履歴の削除ボタンをクリックするとdeleteHistoryが呼ばれる", async () => {
      const user = userEvent.setup();
      renderWithProviders(<App />);

      // 削除ボタンをクリック
      const deleteButton = screen.getByRole("button", { name: "削除" });
      await user.click(deleteButton);

      expect(mockDeleteHistory).toHaveBeenCalledWith("history-1");
    });

    it("正常系: 検索履歴がない場合は空状態メッセージを表示する", () => {
      mockRecentHistories = [];

      renderWithProviders(<App />);

      expect(screen.getByText("検索履歴がありません")).toBeInTheDocument();
    });
  });
});
