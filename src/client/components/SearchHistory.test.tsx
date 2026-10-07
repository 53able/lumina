/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FC } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchHistory as SearchHistoryType } from "../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { type SearchHistoryUndo, useSearchHistoryUndo } from "../hooks/useSearchHistoryUndo";
import { initializeSearchHistoryStore, useSearchHistoryStore } from "../stores/searchHistoryStore";
import { SearchHistory } from "./SearchHistory";

/**
 * SearchHistory コンポーネントテスト
 *
 * Design Docsに基づく仕様:
 * - 検索履歴一覧を表示
 * - 各履歴には元のクエリ、結果件数、日時が表示される
 * - クリックで再検索（ワンタップ再検索）
 * - 履歴を削除できる
 */

// テスト用のサンプル検索履歴データ
const createSampleHistory = (overrides: Partial<SearchHistoryType> = {}): SearchHistoryType => ({
  id: crypto.randomUUID(),
  originalQuery: "強化学習",
  expandedQuery: {
    original: "強化学習",
    english: "reinforcement learning",
    synonyms: ["RL", "reward-based learning"],
    searchText: "reinforcement learning RL reward-based learning",
  },
  resultCount: 42,
  createdAt: new Date("2026-01-17T10:00:00Z"),
  ...overrides,
});

/** 削除・取り消しの操作をモックした undo */
const createUndo = (overrides: Partial<SearchHistoryUndo> = {}): SearchHistoryUndo => ({
  deletedHistories: [],
  historyErrors: {},
  pendingHistoryIds: [],
  restoreConflictIds: [],
  deleteHistory: vi.fn(() => Promise.resolve()),
  restoreHistory: vi.fn(() => Promise.resolve()),
  discardDeletedHistory: vi.fn(),
  dismissHistoryError: vi.fn(),
  ...overrides,
});

describe("SearchHistory", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("レンダリング", () => {
    it("正常系: 検索履歴がない場合は空状態メッセージを表示する", () => {
      render(<SearchHistory histories={[]} />);

      expect(screen.getByText("検索履歴がありません")).toBeInTheDocument();
    });

    it("正常系: 検索履歴が表示される", () => {
      const histories = [createSampleHistory({ originalQuery: "強化学習" })];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByText("強化学習")).toBeInTheDocument();
    });

    it("正常系: 検索結果件数を、一覧の内訳と同じ「候補」の名前で検索時点の値として表示する（#69）", () => {
      const histories = [
        createSampleHistory({ resultCount: 42, createdAt: new Date("2026-10-03T10:00:00Z") }),
      ];

      render(<SearchHistory histories={histories} />);

      const count = screen.getByText("検索時の候補 42件");
      expect(count).toHaveAttribute(
        "title",
        "検索した時点で類似度がしきい値以上だった論文の件数です。その後のしきい値の変更や論文の追加は反映していません"
      );
    });

    it("正常系: 候補を保存する前（2026-02-01 より前）の履歴は「候補」と書かずに件数だけを表示する（#69）", () => {
      // それ以前の resultCount は表示上限（20件）を適用した後の件数
      const histories = [createSampleHistory({ resultCount: 20 })];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByText("20件")).toBeInTheDocument();
      expect(screen.queryByText(/候補/)).not.toBeInTheDocument();
    });

    it("正常系: 複数の検索履歴が表示される", () => {
      const histories = [
        createSampleHistory({ originalQuery: "強化学習" }),
        createSampleHistory({ originalQuery: "自然言語処理" }),
        createSampleHistory({ originalQuery: "コンピュータビジョン" }),
      ];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByText("強化学習")).toBeInTheDocument();
      expect(screen.getByText("自然言語処理")).toBeInTheDocument();
      expect(screen.getByText("コンピュータビジョン")).toBeInTheDocument();
    });

    it("正常系: 履歴ごとに削除ボタンが表示される", () => {
      const histories = [createSampleHistory()];

      render(<SearchHistory histories={histories} undo={createUndo()} />);

      expect(screen.getByRole("button", { name: "「強化学習」を削除" })).toBeInTheDocument();
    });
  });

  describe("再検索機能", () => {
    it("正常系: 履歴をクリックするとonReSearchが呼ばれる", async () => {
      const user = userEvent.setup();
      const mockOnReSearch = vi.fn();
      const history = createSampleHistory({ originalQuery: "強化学習" });

      render(<SearchHistory histories={[history]} onReSearch={mockOnReSearch} />);

      // 履歴項目をクリック
      await user.click(screen.getByText("強化学習"));

      expect(mockOnReSearch).toHaveBeenCalledWith(history);
    });

    it("正常系: 再検索時に履歴の全情報が渡される", async () => {
      const user = userEvent.setup();
      const mockOnReSearch = vi.fn();
      const history = createSampleHistory({
        originalQuery: "強化学習",
        expandedQuery: {
          original: "強化学習",
          english: "reinforcement learning",
          synonyms: ["RL"],
          searchText: "reinforcement learning RL",
        },
      });

      render(<SearchHistory histories={[history]} onReSearch={mockOnReSearch} />);

      await user.click(screen.getByText("強化学習"));

      expect(mockOnReSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          originalQuery: "強化学習",
          expandedQuery: expect.objectContaining({
            english: "reinforcement learning",
          }),
        })
      );
    });
  });

  describe("表示件数（#112）", () => {
    const createHistories = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        createSampleHistory({
          originalQuery: `検索${i + 1}`,
          createdAt: new Date(Date.UTC(2026, 0, 30 - i)),
        })
      );

    it("正常系: 10件以下なら「さらに表示」を出さない", () => {
      render(<SearchHistory histories={createHistories(10)} />);

      expect(screen.getAllByRole("listitem")).toHaveLength(10);
      expect(screen.queryByRole("button", { name: /^さらに表示/ })).not.toBeInTheDocument();
    });

    it("正常系: 直近10件を表示し、「さらに表示」で次の10件を表示して先頭の行へフォーカスを移す", async () => {
      const user = userEvent.setup();
      render(<SearchHistory histories={createHistories(25)} />);

      expect(screen.getAllByRole("listitem")).toHaveLength(10);
      await user.click(screen.getByRole("button", { name: "さらに表示（残り15件）" }));

      expect(screen.getAllByRole("listitem")).toHaveLength(20);
      expect(screen.getByRole("button", { name: /^検索11/ })).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "さらに表示（残り5件）" }));

      expect(screen.getAllByRole("listitem")).toHaveLength(25);
      expect(screen.getByRole("button", { name: /^検索21/ })).toHaveFocus();
      expect(screen.queryByRole("button", { name: /^さらに表示/ })).not.toBeInTheDocument();
    });

    it("正常系: 11件目以降の履歴から再検索・削除できる", async () => {
      const user = userEvent.setup();
      const histories = createHistories(12);
      const onReSearch = vi.fn();
      const undo = createUndo();
      render(<SearchHistory histories={histories} onReSearch={onReSearch} undo={undo} />);
      await user.click(screen.getByRole("button", { name: "さらに表示（残り2件）" }));

      await user.click(screen.getByRole("button", { name: /^検索12/ }));
      await user.click(screen.getByRole("button", { name: "「検索11」を削除" }));

      expect(onReSearch).toHaveBeenCalledWith(histories[11]);
      expect(undo.deleteHistory).toHaveBeenCalledWith(histories[10].id);
    });
  });

  describe("削除機能", () => {
    it("正常系: 削除と取り消しを渡さない場合は削除ボタンを出さない", () => {
      render(<SearchHistory histories={[createSampleHistory()]} />);

      expect(screen.queryByRole("button", { name: "「強化学習」を削除" })).not.toBeInTheDocument();
    });

    it("正常系: 削除ボタンをクリックするとundo.deleteHistoryが呼ばれる", async () => {
      const user = userEvent.setup();
      const mockOnDelete = vi.fn(() => Promise.resolve());
      const history = createSampleHistory();

      render(
        <SearchHistory histories={[history]} undo={createUndo({ deleteHistory: mockOnDelete })} />
      );

      // 削除ボタンをクリック
      await user.click(screen.getByRole("button", { name: "「強化学習」を削除" }));

      expect(mockOnDelete).toHaveBeenCalledWith(history.id);
    });

    it("正常系: 削除ボタンクリック時に再検索は呼ばれない", async () => {
      const user = userEvent.setup();
      const mockOnReSearch = vi.fn();
      const mockOnDelete = vi.fn(() => Promise.resolve());
      const history = createSampleHistory();

      render(
        <SearchHistory
          histories={[history]}
          onReSearch={mockOnReSearch}
          undo={createUndo({ deleteHistory: mockOnDelete })}
        />
      );

      // 削除ボタンをクリック
      await user.click(screen.getByRole("button", { name: "「強化学習」を削除" }));

      // 削除は呼ばれるが、再検索は呼ばれない
      expect(mockOnDelete).toHaveBeenCalled();
      expect(mockOnReSearch).not.toHaveBeenCalled();
    });
  });

  describe("アクセシビリティ", () => {
    it("正常系: 検索履歴リストはlist roleを持つ", () => {
      const histories = [createSampleHistory()];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByRole("list")).toBeInTheDocument();
    });

    it("正常系: 各履歴項目はlistitem roleを持つ", () => {
      const histories = [createSampleHistory(), createSampleHistory()];

      render(<SearchHistory histories={histories} />);

      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
  });

  describe("削除の取り消しと失敗表示（searchHistoryStore と接続）", () => {
    let db: LuminaDB;
    let dbCounter = 0;

    /** HomeMain と同じく、ストアの履歴と deleteHistory を渡す */
    /** App と同じく、すべての履歴と useSearchHistoryUndo の削除と結果を渡す（pageSize は最初に表示する件数） */
    const ConnectedHistory: FC<{ pageSize?: number }> = ({ pageSize }) => {
      const histories = useSearchHistoryStore((s) => s.histories);
      const undo = useSearchHistoryUndo();
      return (
        <>
          <input aria-label="検索" />
          <SearchHistory histories={histories} undo={undo} pageSize={pageSize} compact />
        </>
      );
    };

    /** 次の db.transaction（元に戻すの書き込み）を、返り値の関数を呼ぶまで保留する */
    const holdNextTransaction = (): (() => void) => {
      let release: () => void = () => {};
      const realTransaction = db.transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
      vi.spyOn(db, "transaction").mockImplementationOnce(
        ((...args: unknown[]) =>
          new Promise((resolve, reject) => {
            release = () => {
              realTransaction(...args).then(resolve, reject);
            };
          })) as typeof db.transaction
      );
      return () => release();
    };

    const seed = async (queries: string[]) => {
      dbCounter += 1;
      db = createLuminaDb(`SearchHistory-component-test-${dbCounter}`);
      await initializeSearchHistoryStore(db);
      // 先頭ほど新しい
      for (const [i, query] of queries.entries()) {
        await useSearchHistoryStore.getState().addHistory(
          createSampleHistory({
            originalQuery: query,
            createdAt: new Date(Date.UTC(2026, 0, 20 - i)),
          })
        );
      }
    };

    afterEach(async () => {
      vi.restoreAllMocks();
      await db?.delete();
    });

    it("削除するとUndoを表示・通知し、フォーカスを次の行へ移す。Undoで同じ位置に戻り、フォーカスも戻る", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索", "C検索"]);
      render(<ConnectedHistory />);

      await user.click(screen.getByRole("button", { name: "「B検索」を削除" }));

      const undo = await screen.findByRole("button", { name: "「B検索」を元に戻す" });
      expect(screen.queryByRole("button", { name: "「B検索」を削除" })).not.toBeInTheDocument();
      expect(screen.getByText("削除した履歴は再読み込みするまで元に戻せます")).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「B検索」を削除しました")
      );
      await waitFor(() => expect(screen.getByRole("button", { name: /^C検索/ })).toHaveFocus());

      await user.click(undo);

      // フォーカス移動は完了検知の effect 内で即時、通知はその後の再描画で出るため、通知を待ってからフォーカスを確かめる
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「B検索」を元に戻しました")
      );
      expect(screen.getByRole("button", { name: /^B検索/ })).toHaveFocus();
      expect(screen.queryByRole("button", { name: "「B検索」を元に戻す" })).not.toBeInTheDocument();
      const rows = within(screen.getAllByRole("list").at(-1) as HTMLElement).getAllByRole(
        "listitem"
      );
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("A検索"),
        expect.stringContaining("B検索"),
        expect.stringContaining("C検索"),
      ]);
    });

    it("最後の行を削除すると前の行、唯一の行を削除すると元に戻すボタンへフォーカスを移す", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHistory />);

      await user.click(screen.getByRole("button", { name: "「B検索」を削除" }));
      await waitFor(() => expect(screen.getByRole("button", { name: /^A検索/ })).toHaveFocus());

      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "「A検索」を元に戻す" })).toHaveFocus()
      );
    });

    it("削除後に別の場所（検索欄）へフォーカスがあれば奪わない", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索"]);
      let resolveDelete: () => void = () => {};
      const realDelete = db.searchHistories.delete.bind(db.searchHistories);
      vi.spyOn(db.searchHistories, "delete").mockImplementationOnce(
        (key) =>
          new Promise<void>((resolve) => {
            resolveDelete = () => {
              void realDelete(key).then(() => resolve());
            };
          })
      );
      render(<ConnectedHistory />);

      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      await user.click(screen.getByRole("textbox", { name: "検索" }));
      resolveDelete();

      await screen.findByRole("button", { name: "「A検索」を元に戻す" });
      expect(screen.getByRole("textbox", { name: "検索" })).toHaveFocus();
    });

    it("削除に失敗すると行のそばにエラーを残し、再試行で削除できる", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      vi.spyOn(db.searchHistories, "delete").mockRejectedValueOnce(new Error("DB書き込み失敗"));
      render(<ConnectedHistory />);

      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("削除できませんでした: DB書き込み失敗");
      // 行は残り、フォーカスも削除ボタンに残る
      expect(screen.getByRole("button", { name: "「A検索」を削除" })).toHaveFocus();
      // 時間が経っても消えない
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByRole("alert")).toHaveTextContent("削除できませんでした");

      await user.click(screen.getByRole("button", { name: "「A検索」の削除を再試行" }));

      await screen.findByRole("button", { name: "「A検索」を元に戻す" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("元に戻すのに失敗するとエラーを残し、再試行で復元できる", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      render(<ConnectedHistory />);
      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      vi.spyOn(db.searchHistories, "add").mockRejectedValueOnce(new Error("DB closed"));

      await user.click(await screen.findByRole("button", { name: "「A検索」を元に戻す" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("元に戻せませんでした: DB closed");
      await user.click(screen.getByRole("button", { name: "「A検索」を再度元に戻す" }));

      await screen.findByRole("button", { name: "「A検索」を削除" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("削除後に同じクエリで再検索された場合は元に戻すを出さず、新しい履歴を残して取りやめられる", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      render(<ConnectedHistory />);
      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      await screen.findByRole("button", { name: "「A検索」を元に戻す" });

      await act(async () => {
        await useSearchHistoryStore
          .getState()
          .addHistory(createSampleHistory({ originalQuery: "A検索", resultCount: 5 }));
      });

      expect(screen.queryByRole("button", { name: "「A検索」を元に戻す" })).not.toBeInTheDocument();
      expect(
        screen.getByText(/同じ検索語の新しい履歴があるため元に戻せません/)
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "新しい履歴を残して取りやめる" }));

      expect(screen.queryByRole("region", { name: "削除した検索履歴" })).not.toBeInTheDocument();
      expect(screen.getByText(/5件/)).toBeInTheDocument();
    });

    it("元に戻す途中で検索欄へ移ったフォーカスを奪わない", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHistory />);
      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      const release = holdNextTransaction();

      await user.click(await screen.findByRole("button", { name: "「A検索」を元に戻す" }));
      await user.click(screen.getByRole("textbox", { name: "検索" }));
      release();

      await screen.findByRole("button", { name: "「A検索」を削除" });
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「A検索」を元に戻しました")
      );
      expect(screen.getByRole("textbox", { name: "検索" })).toHaveFocus();
    });

    it("元に戻す途中で同じクエリが再検索されたら中止を通知し、フォーカスを「取りやめる」へ移す", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHistory />);
      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      const release = holdNextTransaction();

      await user.click(await screen.findByRole("button", { name: "「A検索」を元に戻す" }));
      await act(async () => {
        await useSearchHistoryStore
          .getState()
          .addHistory(createSampleHistory({ originalQuery: "A検索", resultCount: 5 }));
      });
      release();

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "同じ検索語の新しい履歴があるため、「A検索」を元に戻しませんでした"
        )
      );
      expect(screen.getByRole("button", { name: "新しい履歴を残して取りやめる" })).toHaveFocus();
      expect(await db.searchHistories.toArray()).toHaveLength(2);
      expect(
        (await db.searchHistories.toArray()).filter((h) => h.originalQuery === "A検索")
      ).toHaveLength(1);
    });

    it("表示件数より古い位置に戻った履歴は、その旨を通知し一覧の先頭へフォーカスを移す。「さらに表示」で表示できる", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHistory pageSize={2} />);
      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      const undo = await screen.findByRole("button", { name: "「A検索」を元に戻す" });
      await act(async () => {
        for (const query of ["D検索", "E検索"]) {
          await useSearchHistoryStore
            .getState()
            .addHistory(createSampleHistory({ originalQuery: query, createdAt: new Date() }));
        }
      });

      await user.click(undo);

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "「A検索」を元に戻しました。古い履歴のため、「さらに表示」で表示できます。"
        )
      );
      expect(screen.getByRole("button", { name: /^E検索/ })).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "さらに表示（残り2件）" }));
      expect(screen.getByRole("button", { name: /^A検索/ })).toBeInTheDocument();
    });

    it("11件目以降は「さらに表示」で表示し、削除と元に戻すができる（#112）", async () => {
      const user = userEvent.setup();
      await seed(Array.from({ length: 12 }, (_, i) => `検索${i + 1}`));
      render(<ConnectedHistory />);
      await user.click(screen.getByRole("button", { name: "さらに表示（残り2件）" }));

      await user.click(screen.getByRole("button", { name: "「検索11」を削除" }));

      const undo = await screen.findByRole("button", { name: "「検索11」を元に戻す" });
      await waitFor(() => expect(screen.getByRole("button", { name: /^検索12/ })).toHaveFocus());
      expect(await db.searchHistories.count()).toBe(11);

      await user.click(undo);

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「検索11」を元に戻しました。")
      );
      expect(screen.getByRole("button", { name: /^検索11/ })).toHaveFocus();
      expect(await db.searchHistories.count()).toBe(12);
    });

    it("連続で削除しても、それぞれの削除を通知する", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索", "C検索"]);
      const releases: Array<() => void> = [];
      const realDelete = db.searchHistories.delete.bind(db.searchHistories);
      vi.spyOn(db.searchHistories, "delete").mockImplementation(
        (key) =>
          new Promise<void>((resolve) => {
            releases.push(() => {
              void realDelete(key).then(() => resolve());
            });
          })
      );
      render(<ConnectedHistory />);

      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      await user.click(screen.getByRole("button", { name: "「B検索」を削除" }));
      await act(async () => {
        for (const release of releases) release();
      });

      await screen.findByRole("button", { name: "「B検索」を元に戻す" });
      await waitFor(() => {
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent("「A検索」を削除しました");
        expect(status).toHaveTextContent("「B検索」を削除しました");
      });
    });

    it("開始時にフォーカスが履歴欄の外（body）にあれば、削除後もフォーカスを移さない", async () => {
      await seed(["A検索", "B検索"]);
      render(<ConnectedHistory />);
      expect(document.activeElement).toBe(document.body);

      // フォーカスを動かさずにクリックする
      fireEvent.click(screen.getByRole("button", { name: "「A検索」を削除" }));

      await screen.findByRole("button", { name: "「A検索」を元に戻す" });
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「A検索」を削除しました")
      );
      expect(document.activeElement).toBe(document.body);
    });

    it("一覧に出ていない同じクエリの履歴が DB にあれば、元に戻さず一覧へ反映して競合を通知する", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHistory />);
      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      // 別タブなどで DB にだけ同じクエリの履歴ができた状態
      const other = createSampleHistory({ originalQuery: "A検索", resultCount: 7 });
      await db.searchHistories.add(other);

      await user.click(await screen.findByRole("button", { name: "「A検索」を元に戻す" }));

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "同じ検索語の新しい履歴があるため、「A検索」を元に戻しませんでした"
        )
      );
      expect(screen.getByRole("button", { name: "新しい履歴を残して取りやめる" })).toHaveFocus();
      expect(screen.getByText(/7件/)).toBeInTheDocument();
      expect(await db.searchHistories.where("originalQuery").equals("A検索").toArray()).toEqual([
        other,
      ]);
    });
  });
});
