/**
 * @vitest-environment jsdom
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../testing/testUtils";
import { StatsPage } from "./StatsPage";

const mockSyncFromDate = vi.fn();
const mockStopSync = vi.fn();
let mockIsSyncingFromDate = false;

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../hooks/useSyncPapers", () => ({
  useSyncPapers: () => ({
    syncFromDate: mockSyncFromDate,
    stopSync: mockStopSync,
    isSyncingFromDate: mockIsSyncingFromDate,
  }),
}));

const mockPapers = Array.from({ length: 10 }, (_, index) => ({
  id: `paper-${index + 1}`,
  title: `Paper ${index + 1}`,
  abstract: "test abstract",
  authors: ["Test Author"],
  categories: ["cs.AI"],
  publishedAt: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  updatedAt: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  pdfUrl: `https://arxiv.org/pdf/test-${index + 1}.pdf`,
  arxivUrl: `https://arxiv.org/abs/test-${index + 1}`,
  embedding: [],
}));

vi.mock("../stores/paperStore", () => ({
  usePaperStore: () => ({
    papers: mockPapers,
    isLoading: false,
  }),
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: () => ({
    selectedCategories: ["cs.AI"],
    syncPeriodDays: "3",
  }),
}));

vi.mock("../components/PaperCacheBarChart", () => ({
  PaperCacheBarChart: () => <div data-testid="paper-cache-bar-chart" />,
}));

describe("StatsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSyncingFromDate = false;
    mockSyncFromDate.mockResolvedValue({
      addedCount: 0,
      totalFetched: 0,
      wasAborted: false,
    });
  });

  it("隠れている少ない日を展開してクリックできる", async () => {
    const user = userEvent.setup();

    renderWithRouter(<StatsPage />);

    expect(
      screen.queryByRole("button", { name: "2026-01-09から同期する" })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "他2日を表示" }));
    await user.click(screen.getByRole("button", { name: "2026-01-09から同期する" }));

    expect(mockSyncFromDate).toHaveBeenCalledWith("2026-01-09");
  });

  it("新規論文が追加されたとき成功トーストを表示する", async () => {
    const user = userEvent.setup();
    mockSyncFromDate.mockResolvedValue({
      addedCount: 3,
      totalFetched: 5,
      wasAborted: false,
    });

    renderWithRouter(<StatsPage />);

    await user.click(screen.getByRole("button", { name: "2026-01-01から同期する" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("同期完了", {
        description: "3件の論文をキャッシュしました",
      });
    });
  });

  it("既存論文のみだったとき info トーストを表示する", async () => {
    const user = userEvent.setup();
    mockSyncFromDate.mockResolvedValue({
      addedCount: 0,
      totalFetched: 4,
      wasAborted: false,
    });

    renderWithRouter(<StatsPage />);

    await user.click(screen.getByRole("button", { name: "2026-01-01から同期する" }));

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith("この期間の論文はすでにキャッシュに含まれています", {
        description: "4件を確認しました",
      });
    });
  });

  it("取得件数が0件のとき info トーストを表示する", async () => {
    const user = userEvent.setup();
    renderWithRouter(<StatsPage />);

    await user.click(screen.getByRole("button", { name: "2026-01-01から同期する" }));

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith("追加する論文はありませんでした");
    });
  });

  it("同期エラー時に error トーストを表示する", async () => {
    const user = userEvent.setup();
    mockSyncFromDate.mockRejectedValue(new Error("DB write failed"));

    renderWithRouter(<StatsPage />);

    await user.click(screen.getByRole("button", { name: "2026-01-01から同期する" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("同期エラー", {
        description: "DB write failed",
      });
    });
  });

  it("同期中は日付ボタンを押せない", () => {
    mockIsSyncingFromDate = true;

    renderWithRouter(<StatsPage />);

    expect(screen.getByRole("button", { name: "2026-01-01から同期する" })).toBeDisabled();
  });

  it("同期中は停止ボタンを表示して stopSync を呼べる", async () => {
    const user = userEvent.setup();
    mockIsSyncingFromDate = true;

    renderWithRouter(<StatsPage />);

    await user.click(screen.getByRole("button", { name: "取得を停止" }));

    expect(mockStopSync).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("取得を停止しています");
  });
});
