import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock, Search, X } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SearchHistory as SearchHistoryType } from "../../shared/schemas/index";
import type { SearchHistoryUndo } from "../hooks/useSearchHistoryUndo";
import { Button } from "./ui/button";

/**
 * SearchHistory コンポーネントのProps
 */
interface SearchHistoryProps {
  /** 検索履歴の配列 */
  histories: SearchHistoryType[];
  /** 再検索時のコールバック */
  onReSearch?: (history: SearchHistoryType) => void;
  /** 削除と取り消しの操作・結果（未指定なら削除ボタンと取り消し欄を出さない） */
  undo?: SearchHistoryUndo;
  /** コンパクト表示モード（サイドバー用） */
  compact?: boolean;
  /**
   * 通知の live region を置く要素（未指定なら履歴欄の中）。
   * 履歴欄を折りたたんで隠す場合に、隠れない場所で読み上げるために使う
   */
  liveRegionContainer?: HTMLElement | null;
  /**
   * 削除・元に戻すの失敗も live region で通知するか。
   * 失敗は行内の alert で伝わるが、履歴欄が隠れている間は読まれないため
   */
  announceFailures?: boolean;
}

/** 操作を始めたときの情報（完了後の通知・フォーカス移動に使う） */
interface StartedOperation {
  query: string;
  /** 一覧上の位置（削除後に次の行を選ぶ） */
  index: number;
  /** 開始時にフォーカスが履歴欄の中にあったか */
  focusWasInside: boolean;
}

/** live region に残す通知の件数 */
const MAX_ANNOUNCEMENTS = 3;

const EMPTY_HISTORIES: SearchHistoryType[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_ERRORS: SearchHistoryUndo["historyErrors"] = {};

/**
 * SearchHistory - 検索履歴コンポーネント
 *
 * Design Docsに基づく機能:
 * - 検索履歴一覧を表示
 * - ワンタップで再検索
 * - 履歴の削除（削除後もこのセッション中は元に戻せる。失敗は行のそばに残し再試行できる）
 */
export const SearchHistory: FC<SearchHistoryProps> = ({
  histories,
  onReSearch,
  undo,
  compact = false,
  liveRegionContainer,
  announceFailures = false,
}) => {
  const deletedHistories = undo?.deletedHistories ?? EMPTY_HISTORIES;
  const historyErrors = undo?.historyErrors ?? EMPTY_ERRORS;
  const pendingHistoryIds = undo?.pendingHistoryIds ?? EMPTY_IDS;
  const restoreConflictIds = undo?.restoreConflictIds ?? EMPTY_IDS;

  /**
   * スクリーンリーダー向けの結果通知（直近の数件）
   * 置き換えではなく追加にして、連続した操作の通知が後の通知で上書きされないようにする
   */
  const [announcements, setAnnouncements] = useState<{ key: number; text: string }[]>([]);
  const announcementKeyRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /** 削除を始めた履歴（ID ごと。連続削除でも通知・フォーカスを取りこぼさない） */
  const deletingRef = useRef(new Map<string, StartedOperation>());
  /** 元に戻すを始めた履歴（ID ごと） */
  const restoringRef = useRef(new Map<string, StartedOperation>());
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const undoButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const discardButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  /** 開始時に履歴欄の中にあったフォーカスが、押したボタンが消えて外れたときだけ移す */
  const moveFocus = (operation: StartedOperation, target: HTMLElement | undefined) => {
    const active = document.activeElement;
    const focusLost = active === null || active === document.body || !active.isConnected;
    if (operation.focusWasInside && focusLost) target?.focus();
  };

  // 削除・元に戻すの完了を検知し、通知とフォーカス移動を行う。
  // 完了は undo の複数の値（処理中・退避・失敗・競合）と一覧の組み合わせで決まるため、依存配列を付けず毎描画で確かめる。
  // 追跡中の操作がなければ何もしない
  useEffect(() => {
    const messages: string[] = [];

    for (const [id, operation] of deletingRef.current) {
      if (pendingHistoryIds.includes(id)) continue;
      deletingRef.current.delete(id);
      // 失敗は行内の alert で伝わる（隠れている間は通知もする）。退避に入っていれば削除の成功
      if (!deletedHistories.some((h) => h.id === id)) {
        if (announceFailures && historyErrors[id]) {
          messages.push(
            `「${operation.query}」を削除できませんでした。検索履歴を開いて再試行できます。`
          );
        }
        continue;
      }
      messages.push(`「${operation.query}」を削除しました。再読み込みするまで元に戻せます。`);
      const next = histories[operation.index] ?? histories[operation.index - 1];
      moveFocus(
        operation,
        next ? rowButtonRefs.current.get(next.id) : undoButtonRefs.current.get(id)
      );
    }

    for (const [id, operation] of restoringRef.current) {
      if (pendingHistoryIds.includes(id)) continue;
      restoringRef.current.delete(id);
      if (historyErrors[id]) {
        if (announceFailures) {
          messages.push(
            `「${operation.query}」を元に戻せませんでした。検索履歴を開いて再試行できます。`
          );
        }
        continue;
      }
      if (deletedHistories.some((h) => h.id === id)) {
        // 退避に残っている: 同じクエリの新しい履歴と競合して中止した
        if (restoreConflictIds.includes(id)) {
          messages.push(
            `同じ検索語の新しい履歴があるため、「${operation.query}」を元に戻しませんでした。`
          );
          moveFocus(operation, discardButtonRefs.current.get(id));
        }
        continue;
      }
      if (histories.some((h) => h.id === id)) {
        messages.push(`「${operation.query}」を元に戻しました。`);
        moveFocus(operation, rowButtonRefs.current.get(id));
      } else {
        // 表示件数より古い履歴は一覧に出ないため、一覧の先頭へ移す
        messages.push(
          `「${operation.query}」を元に戻しました。古い履歴のため、この一覧には表示されません。`
        );
        const first = histories[0];
        moveFocus(operation, first ? rowButtonRefs.current.get(first.id) : undefined);
      }
    }

    if (messages.length > 0) {
      const added = messages.map((text) => {
        announcementKeyRef.current += 1;
        return { key: announcementKeyRef.current, text };
      });
      setAnnouncements((prev) => [...prev, ...added].slice(-MAX_ANNOUNCEMENTS));
    }
  });

  const isFocusInside = (): boolean => rootRef.current?.contains(document.activeElement) ?? false;

  const handleItemClick = (history: SearchHistoryType) => {
    onReSearch?.(history);
  };

  const handleDelete = (history: SearchHistoryType, index: number) => {
    if (!undo || pendingHistoryIds.includes(history.id)) return;
    deletingRef.current.set(history.id, {
      query: history.originalQuery,
      index,
      focusWasInside: isFocusInside(),
    });
    void undo.deleteHistory(history.id);
  };

  const handleRestore = (deleted: SearchHistoryType) => {
    if (!undo || pendingHistoryIds.includes(deleted.id)) return;
    restoringRef.current.set(deleted.id, {
      query: deleted.originalQuery,
      index: -1,
      focusWasInside: isFocusInside(),
    });
    void undo.restoreHistory(deleted.id);
  };

  const textSize = compact ? "text-xs" : "text-sm";

  const liveRegion = (
    <output aria-live="polite" className="sr-only">
      {announcements.map((a) => (
        <span key={a.key}>{a.text} </span>
      ))}
    </output>
  );

  return (
    <div ref={rootRef} className={compact ? "space-y-2" : "space-y-3"}>
      {liveRegionContainer ? createPortal(liveRegion, liveRegionContainer) : liveRegion}

      {deletedHistories.length > 0 && (
        <section aria-label="削除した検索履歴" className="space-y-1">
          <p className={`text-muted-foreground ${compact ? "text-[10px]" : "text-xs"}`}>
            削除した履歴は再読み込みするまで元に戻せます
          </p>
          <ul className="space-y-1">
            {deletedHistories.map((deleted) => {
              const isPending = pendingHistoryIds.includes(deleted.id);
              const error = historyErrors[deleted.id];
              const hasConflict = restoreConflictIds.includes(deleted.id);
              return (
                <li
                  key={deleted.id}
                  className={`rounded-lg border border-border/50 bg-muted/30 ${compact ? "p-2" : "p-3"} ${textSize}`}
                >
                  <p className="break-words">「{deleted.originalQuery}」を削除しました</p>
                  {hasConflict ? (
                    <div className="mt-1 space-y-1">
                      <p className="text-muted-foreground">
                        同じ検索語の新しい履歴があるため元に戻せません（新しい履歴は上書きしません）。
                      </p>
                      <Button
                        ref={(el) => {
                          if (el) discardButtonRefs.current.set(deleted.id, el);
                          else discardButtonRefs.current.delete(deleted.id);
                        }}
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={() => undo?.discardDeletedHistory(deleted.id)}
                      >
                        新しい履歴を残して取りやめる
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Button
                        ref={(el) => {
                          if (el) undoButtonRefs.current.set(deleted.id, el);
                          else undoButtonRefs.current.delete(deleted.id);
                        }}
                        variant="outline"
                        size="sm"
                        className="h-7"
                        aria-disabled={isPending}
                        aria-label={`「${deleted.originalQuery}」を${error ? "再度" : ""}元に戻す`}
                        onClick={() => handleRestore(deleted)}
                      >
                        {isPending ? "元に戻しています…" : error ? "再試行" : "元に戻す"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        aria-label={`「${deleted.originalQuery}」を元に戻すのをやめる`}
                        onClick={() => undo?.discardDeletedHistory(deleted.id)}
                      >
                        元に戻すのをやめる
                      </Button>
                    </div>
                  )}
                  {error?.kind === "restore" && (
                    <p role="alert" className="mt-1 text-destructive break-words">
                      元に戻せませんでした: {error.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {histories.length === 0 ? (
        // 履歴がない場合 - Super Centered パターン
        <div
          className={`flex flex-col items-center justify-center text-muted-foreground ${compact ? "h-full min-h-[100px]" : "min-h-[200px]"}`}
        >
          <div className="flex flex-col items-center gap-2">
            <div
              className={`rounded-full bg-muted/20 grid place-items-center ${compact ? "h-9 w-9" : "h-14 w-14"}`}
            >
              <Clock className={`${compact ? "h-4 w-4" : "h-6 w-6"} opacity-30`} />
            </div>
            <p className={`${compact ? "text-[11px]" : "text-sm"} text-muted-foreground/50`}>
              検索履歴がありません
            </p>
          </div>
        </div>
      ) : (
        <ul className={compact ? "space-y-1" : "space-y-2"}>
          {histories.map((history, index) => {
            const isPending = pendingHistoryIds.includes(history.id);
            const error = historyErrors[history.id];
            return (
              <li
                key={history.id}
                className={`group rounded-lg hover:bg-muted/50 transition-colors ${
                  compact ? "p-2" : "p-3 border border-border/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  {/* 左側: クエリ情報（クリック可能） */}
                  <button
                    ref={(el) => {
                      if (el) rowButtonRefs.current.set(history.id, el);
                      else rowButtonRefs.current.delete(history.id);
                    }}
                    type="button"
                    className={`flex items-center flex-1 min-w-0 text-left bg-transparent border-none cursor-pointer ${
                      compact ? "gap-2" : "gap-3"
                    }`}
                    onClick={() => handleItemClick(history)}
                  >
                    <Search
                      className={`text-muted-foreground flex-shrink-0 ${compact ? "h-3 w-3" : "h-4 w-4"}`}
                    />
                    <div className="min-w-0">
                      <p className={`truncate ${compact ? "text-sm" : ""}`}>
                        {history.originalQuery}
                      </p>
                      <p className={`text-muted-foreground ${compact ? "text-[10px]" : "text-xs"}`}>
                        {isPending
                          ? "削除しています…"
                          : `${history.resultCount}件 ・ ${formatDistanceToNow(history.createdAt, {
                              addSuffix: true,
                              locale: ja,
                            })}`}
                      </p>
                    </div>
                  </button>

                  {/* 右側: 削除ボタン（コンパクト時はホバーかキーボードフォーカスで表示。タッチ端末と失敗中は常に表示） */}
                  {undo && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`flex-shrink-0 ${
                        compact
                          ? `h-6 w-6 transition-opacity ${error ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"}`
                          : "h-8 w-8"
                      }`}
                      aria-disabled={isPending}
                      onClick={(e) => {
                        e.stopPropagation(); // 親のクリックイベントを止める
                        handleDelete(history, index);
                      }}
                      aria-label={`「${history.originalQuery}」を削除`}
                    >
                      <X className={compact ? "h-3 w-3" : "h-4 w-4"} />
                    </Button>
                  )}
                </div>

                {error?.kind === "delete" && (
                  <div role="alert" className={`mt-1 space-y-1 text-destructive ${textSize}`}>
                    <p className="break-words">削除できませんでした: {error.message}</p>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        aria-label={`「${history.originalQuery}」の削除を再試行`}
                        onClick={() => handleDelete(history, index)}
                      >
                        再試行
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        aria-label={`「${history.originalQuery}」の削除エラーを閉じる`}
                        onClick={() => undo?.dismissHistoryError(history.id)}
                      >
                        閉じる
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
