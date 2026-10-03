import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock, Search, X } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { SearchHistory as SearchHistoryType } from "../../shared/schemas/index";
import { useSearchHistoryStore } from "../stores/searchHistoryStore";
import { Button } from "./ui/button";

/**
 * SearchHistory コンポーネントのProps
 */
interface SearchHistoryProps {
  /** 検索履歴の配列 */
  histories: SearchHistoryType[];
  /** 再検索時のコールバック */
  onReSearch?: (history: SearchHistoryType) => void;
  /** 削除時のコールバック（結果は searchHistoryStore の状態で受け取る） */
  onDelete?: (id: string) => void;
  /** コンパクト表示モード（サイドバー用） */
  compact?: boolean;
}

/** フォーカスが外れている（削除・復元で押したボタンが消えた）か */
const isFocusLost = (): boolean =>
  document.activeElement === null ||
  document.activeElement === document.body ||
  !document.activeElement.isConnected;

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
  onDelete,
  compact = false,
}) => {
  const {
    allHistories,
    deletedHistories,
    pendingHistoryIds,
    historyErrors,
    restoreHistory,
    discardDeletedHistory,
    dismissHistoryError,
  } = useSearchHistoryStore(
    useShallow((state) => ({
      allHistories: state.histories,
      deletedHistories: state.deletedHistories,
      pendingHistoryIds: state.pendingHistoryIds,
      historyErrors: state.historyErrors,
      restoreHistory: state.restoreHistory,
      discardDeletedHistory: state.discardDeletedHistory,
      dismissHistoryError: state.dismissHistoryError,
    }))
  );

  /** スクリーンリーダー向けの結果通知 */
  const [announcement, setAnnouncement] = useState("");
  /** 削除を始めた行（成功したら次の行へフォーカスを移す） */
  const deletingRef = useRef<{ id: string; index: number } | null>(null);
  /** 復元を始めた履歴（成功したら復元した行へフォーカスを戻す） */
  const restoringIdRef = useRef<string | null>(null);
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const undoButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  // 削除の成功（退避に入った）を検知し、通知とフォーカス移動を行う
  useEffect(() => {
    const deleting = deletingRef.current;
    if (!deleting) return;
    if (historyErrors[deleting.id]) {
      deletingRef.current = null;
      return;
    }
    const deleted = deletedHistories.find((h) => h.id === deleting.id);
    if (!deleted) return;
    deletingRef.current = null;
    setAnnouncement(`「${deleted.originalQuery}」を削除しました。再読み込みするまで元に戻せます。`);
    if (!isFocusLost()) return;
    const next = histories[deleting.index] ?? histories[deleting.index - 1];
    const target = next
      ? rowButtonRefs.current.get(next.id)
      : undoButtonRefs.current.get(deleting.id);
    target?.focus();
  }, [histories, deletedHistories, historyErrors]);

  // 復元の成功（履歴に戻った）を検知し、通知とフォーカス移動を行う
  useEffect(() => {
    const restoringId = restoringIdRef.current;
    if (!restoringId) return;
    if (historyErrors[restoringId]) {
      restoringIdRef.current = null;
      return;
    }
    const restored = allHistories.find((h) => h.id === restoringId);
    if (!restored) return;
    restoringIdRef.current = null;
    setAnnouncement(`「${restored.originalQuery}」を元に戻しました。`);
    if (isFocusLost()) {
      rowButtonRefs.current.get(restoringId)?.focus();
    }
  }, [allHistories, historyErrors]);

  const handleItemClick = (history: SearchHistoryType) => {
    onReSearch?.(history);
  };

  const handleDelete = (id: string, index: number) => {
    if (pendingHistoryIds.includes(id)) return;
    deletingRef.current = { id, index };
    onDelete?.(id);
  };

  const handleRestore = (id: string) => {
    if (pendingHistoryIds.includes(id)) return;
    restoringIdRef.current = id;
    void restoreHistory(id);
  };

  const textSize = compact ? "text-xs" : "text-sm";

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

      {deletedHistories.length > 0 && (
        <section aria-label="削除した検索履歴" className="space-y-1">
          <p className={`text-muted-foreground ${compact ? "text-[10px]" : "text-xs"}`}>
            削除した履歴は再読み込みするまで元に戻せます
          </p>
          <ul className="space-y-1">
            {deletedHistories.map((deleted) => {
              const isPending = pendingHistoryIds.includes(deleted.id);
              const error = historyErrors[deleted.id];
              const hasConflict = allHistories.some(
                (h) => h.id !== deleted.id && h.originalQuery === deleted.originalQuery
              );
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
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={() => discardDeletedHistory(deleted.id)}
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
                        onClick={() => handleRestore(deleted.id)}
                      >
                        {isPending ? "元に戻しています…" : error ? "再試行" : "元に戻す"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        aria-label={`「${deleted.originalQuery}」の取り消しを閉じる`}
                        onClick={() => discardDeletedHistory(deleted.id)}
                      >
                        閉じる
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

                  {/* 右側: 削除ボタン（コンパクト時はホバーかキーボードフォーカスで表示。失敗中は常に表示） */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`flex-shrink-0 ${
                      compact
                        ? `h-6 w-6 transition-opacity ${error ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"}`
                        : "h-8 w-8"
                    }`}
                    aria-disabled={isPending}
                    onClick={(e) => {
                      e.stopPropagation(); // 親のクリックイベントを止める
                      handleDelete(history.id, index);
                    }}
                    aria-label={`「${history.originalQuery}」を削除`}
                  >
                    <X className={compact ? "h-3 w-3" : "h-4 w-4"} />
                  </Button>
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
                        onClick={() => handleDelete(history.id, index)}
                      >
                        再試行
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        aria-label={`「${history.originalQuery}」の削除エラーを閉じる`}
                        onClick={() => dismissHistoryError(history.id)}
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
