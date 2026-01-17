/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperExplorer } from "./PaperExplorer";

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

describe("PaperExplorer", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  describe("初期表示", () => {
    it("検索ボックスが表示される", () => {
      render(<PaperExplorer />);

      expect(screen.getByRole("searchbox")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /検索/i })).toBeInTheDocument();
    });

    it("論文がない場合は空メッセージが表示される", () => {
      render(<PaperExplorer />);

      expect(screen.getByText(/論文が見つかりません/i)).toBeInTheDocument();
    });

    it("論文がある場合はリストが表示される", () => {
      render(<PaperExplorer initialPapers={mockPapers} />);

      expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      expect(
        screen.getByText("BERT: Pre-training of Deep Bidirectional Transformers")
      ).toBeInTheDocument();
    });
  });

  describe("検索機能", () => {
    it("検索実行中はローディング状態になる", async () => {
      // 検索が解決するまで長めに待機させる（テスト間の干渉を防ぐ）
      const mockOnSearch = vi
        .fn()
        .mockReturnValue(new Promise((resolve) => setTimeout(() => resolve(mockPapers), 500)));

      render(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup();
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      // Reactの状態更新を待つ
      await waitFor(() => {
        expect(screen.getByTestId("paper-list-loading")).toBeInTheDocument();
      });
    });

    it("検索するとonSearchコールバックが呼ばれる", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      render(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup();
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      expect(mockOnSearch).toHaveBeenCalledWith("transformer");
    });

    it("検索完了後、結果が表示される", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      render(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup();
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      await waitFor(() => {
        expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      });
    });

    it("検索結果件数が表示される", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      render(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup();
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
    it("いいねボタンをクリックするとonLikeコールバックが呼ばれる", async () => {
      const mockOnLike = vi.fn();

      render(<PaperExplorer initialPapers={mockPapers} onLike={mockOnLike} />);

      const user = userEvent.setup();
      const likeButtons = screen.getAllByRole("button", { name: /いいね/i });
      await user.click(likeButtons[0]);

      expect(mockOnLike).toHaveBeenCalledWith("2401.00001");
    });

    it("ブックマークボタンをクリックするとonBookmarkコールバックが呼ばれる", async () => {
      const mockOnBookmark = vi.fn();

      render(<PaperExplorer initialPapers={mockPapers} onBookmark={mockOnBookmark} />);

      const user = userEvent.setup();
      const bookmarkButtons = screen.getAllByRole("button", { name: /ブックマーク/i });
      await user.click(bookmarkButtons[0]);

      expect(mockOnBookmark).toHaveBeenCalledWith("2401.00001");
    });

    it("論文カードをクリックするとonPaperClickコールバックが呼ばれる", async () => {
      const mockOnPaperClick = vi.fn();

      render(<PaperExplorer initialPapers={mockPapers} onPaperClick={mockOnPaperClick} />);

      const user = userEvent.setup();
      const articles = screen.getAllByRole("article");
      await user.click(articles[0]);

      expect(mockOnPaperClick).toHaveBeenCalledWith(mockPapers[0]);
    });
  });

  describe("タイトル表示", () => {
    it("検索前はデフォルトのタイトルが表示される", () => {
      render(<PaperExplorer />);

      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("論文を探す");
    });

    it("検索後は検索クエリが含まれたタイトルが表示される", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      render(<PaperExplorer onSearch={mockOnSearch} />);

      const user = userEvent.setup();
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
