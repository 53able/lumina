/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PaperExplorer } from "./PaperExplorer.js";

// InteractionContextをモック
const mockToggleLike = vi.fn();
const mockToggleBookmark = vi.fn();

vi.mock("@/client/contexts/InteractionContext", () => ({
  useInteractionContext: () => ({
    likedPaperIds: new Set<string>(),
    bookmarkedPaperIds: new Set<string>(),
    toggleLike: mockToggleLike,
    toggleBookmark: mockToggleBookmark,
  }),
  useInteraction: (paperId: string) => ({
    isLiked: false,
    isBookmarked: false,
    toggleLike: () => mockToggleLike(paperId),
    toggleBookmark: () => mockToggleBookmark(paperId),
  }),
}));

// usePaperFilterをモック
const mockClearAllFilters = vi.fn();
const mockToggleFilterMode = vi.fn();
const mockToggleCategory = vi.fn();

vi.mock("@/client/hooks/usePaperFilter", () => ({
  usePaperFilter: () => ({
    filterMode: "all" as const,
    selectedCategories: new Set<string>(),
    toggleFilterMode: mockToggleFilterMode,
    toggleCategory: mockToggleCategory,
    clearAllFilters: mockClearAllFilters,
    filterPapers: (papers: unknown[]) => papers, // パススルー
  }),
}));

// モック用の論文データ
const mockPapers = [
  {
    id: "2401.00001",
    title: "Attention Is All You Need",
    abstract:
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    categories: ["cs.CL", "cs.LG"],
    publishedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
    arxivUrl: "https://arxiv.org/abs/2401.00001",
  },
  {
    id: "2401.00002",
    title: "BERT: Pre-training of Deep Bidirectional Transformers",
    abstract: "We introduce a new language representation model called BERT...",
    authors: ["Jacob Devlin", "Ming-Wei Chang"],
    categories: ["cs.CL"],
    publishedAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02"),
    pdfUrl: "https://arxiv.org/pdf/2401.00002.pdf",
    arxivUrl: "https://arxiv.org/abs/2401.00002",
  },
];

/**
 * MemoryRouterでラップしたレンダリングヘルパー
 */
const renderWithRouter = (ui: ReactNode) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe("PaperExplorer", () => {
  describe("初期表示", () => {
    it("検索ボックスが表示される", () => {
      renderWithRouter(<PaperExplorer />);

      expect(screen.getByRole("searchbox")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /検索/i })).toBeInTheDocument();
    });

    it("論文がない場合は空メッセージが表示される", () => {
      renderWithRouter(<PaperExplorer />);

      expect(screen.getByText(/論文が見つかりません/i)).toBeInTheDocument();
    });

    it("論文がある場合はリストが表示される", () => {
      renderWithRouter(<PaperExplorer initialPapers={mockPapers} />);

      expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      expect(
        screen.getByText("BERT: Pre-training of Deep Bidirectional Transformers")
      ).toBeInTheDocument();
    });
  });

  describe("検索機能", () => {
    it("検索実行中はローディング状態になる", async () => {
      // Promiseを手動で制御できるようにする
      let resolveSearch: (value: typeof mockPapers) => void;
      const mockOnSearch = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveSearch = resolve;
        })
      );

      renderWithRouter(<PaperExplorer onSearch={mockOnSearch} />);

      // delay: null で高速化
      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "test");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      // ローディング状態を確認
      expect(screen.getByTestId("paper-list-loading")).toBeInTheDocument();

      // クリーンアップ: Promiseを解決して完了を待つ
      resolveSearch!(mockPapers);
      await waitFor(() => {
        expect(screen.queryByTestId("paper-list-loading")).not.toBeInTheDocument();
      });
    });

    it("検索するとonSearchコールバックが呼ばれる", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      renderWithRouter(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      expect(mockOnSearch).toHaveBeenCalledWith("transformer");
    });

    it("検索完了後、結果が表示される", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      renderWithRouter(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      await waitFor(() => {
        expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      });
    });

    it("検索結果件数が表示される", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      renderWithRouter(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      await waitFor(() => {
        // 件数と「件の論文」が表示されていることを確認
        expect(screen.getByText("2")).toBeInTheDocument();
        expect(screen.getByText(/件の論文/i)).toBeInTheDocument();
      });
    });
  });

  describe("ユーザーインタラクション", () => {
    it("いいねボタンをクリックするとtoggleLikeが呼ばれる", async () => {
      renderWithRouter(<PaperExplorer initialPapers={mockPapers} />);

      const user = userEvent.setup({ delay: null });
      const likeButtons = screen.getAllByRole("button", { name: /いいね/i });
      expect(likeButtons[0]).toBeDefined();
      await user.click(likeButtons[0]!);

      expect(mockToggleLike).toHaveBeenCalledWith("2401.00001");
    });

    it("ブックマークボタンをクリックするとtoggleBookmarkが呼ばれる", async () => {
      renderWithRouter(<PaperExplorer initialPapers={mockPapers} />);

      const user = userEvent.setup({ delay: null });
      const bookmarkButtons = screen.getAllByRole("button", { name: /ブックマーク/i });
      expect(bookmarkButtons[0]).toBeDefined();
      await user.click(bookmarkButtons[0]!);

      expect(mockToggleBookmark).toHaveBeenCalledWith("2401.00001");
    });

    it("論文カードをクリックするとonPaperClickコールバックが呼ばれる", async () => {
      const mockOnPaperClick = vi.fn();

      renderWithRouter(
        <PaperExplorer initialPapers={mockPapers} onPaperClick={mockOnPaperClick} />
      );

      const user = userEvent.setup({ delay: null });
      const articles = screen.getAllByRole("article");
      expect(articles[0]).toBeDefined();
      await user.click(articles[0]!);

      expect(mockOnPaperClick).toHaveBeenCalledWith(mockPapers[0]);
    });
  });

  describe("タイトル表示", () => {
    it("検索前はデフォルトのタイトルが表示される", () => {
      renderWithRouter(<PaperExplorer />);

      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("論文を探す");
    });

    it("検索後は検索クエリが含まれたタイトルが表示される", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      renderWithRouter(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      await waitFor(() => {
        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
          '"transformer" の検索結果'
        );
      });
    });
  });
});
