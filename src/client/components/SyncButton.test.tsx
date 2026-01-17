/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * SyncButton テスト
 *
 * React Query の useMutation と連携して使用する前提:
 * - isSyncing: 外部から渡されるローディング状態
 * - onSync: クリック時に呼ばれるハンドラー
 */
describe("SyncButton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("表示", () => {
    it("同期ボタンが表示される", async () => {
      const { SyncButton } = await import("./SyncButton");
      render(<SyncButton isSyncing={false} onSync={vi.fn()} />);

      expect(screen.getByRole("button", { name: /同期|sync/i })).toBeInTheDocument();
    });

    it("isSyncing=false の場合は「同期」と表示される", async () => {
      const { SyncButton } = await import("./SyncButton");
      render(<SyncButton isSyncing={false} onSync={vi.fn()} />);

      expect(screen.getByText("同期")).toBeInTheDocument();
    });
  });

  describe("同期処理", () => {
    it("ボタンをクリックするとonSyncが呼ばれる", async () => {
      const { SyncButton } = await import("./SyncButton");
      const user = userEvent.setup();
      const handleSync = vi.fn();
      render(<SyncButton isSyncing={false} onSync={handleSync} />);

      const syncButton = screen.getByRole("button", { name: /同期|sync/i });
      await user.click(syncButton);

      expect(handleSync).toHaveBeenCalled();
    });

    it("isSyncing=true の場合はボタンが無効化される", async () => {
      const { SyncButton } = await import("./SyncButton");
      render(<SyncButton isSyncing={true} onSync={vi.fn()} />);

      const syncButton = screen.getByRole("button", { name: /同期中/i });
      expect(syncButton).toBeDisabled();
    });

    it("isSyncing=true の場合は「同期中」と表示される", async () => {
      const { SyncButton } = await import("./SyncButton");
      render(<SyncButton isSyncing={true} onSync={vi.fn()} />);

      expect(screen.getByText("同期中")).toBeInTheDocument();
    });
  });
});
