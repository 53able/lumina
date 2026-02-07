import { Calendar, FileText, SearchX, StopCircle } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import { SyncRateLimitError } from "../lib/api";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSyncStore } from "../stores/syncStore";
import { Button } from "./ui/button";

/**
 * SyncStatusBar の Props
 *
 * 同期の表示状態（isSyncing, isSyncingAll, 進捗, エラー）は syncStore から取得する。
 */
interface SyncStatusBarProps {
  /** モバイル向けコンパクト表示（論文一覧までの距離を短くする） */
  compact?: boolean;
  /** まだ取得可能な論文があるか（同期期間内の残り） */
  hasMore?: boolean;
  /** 同期期間の論文をすべて取得する（「すべて取得」ボタンから呼ぶ） */
  onSyncAll?: () => void | Promise<void>;
  /** Embedding 未設定の論文を手動で補完する（「Embeddingを補完」ボタンから呼ぶ） */
  onRunEmbeddingBackfill?: () => void | Promise<void>;
  /** 同期を停止する（取得中のみ有効） */
  onStopSync?: () => void;
}

/**
 * SyncStatusBar - メイン画面用の同期ステータスバー
 *
 * オブジェクト指向UI: 論文コレクションの状態とアクションを一覧画面のそばに表示する。
 * - 最終同期日時
 * - 取得済み論文数
 * - Embedding 未設定件数（取得中は「Embedding取得中」表示）
 */
export const SyncStatusBar: FC<SyncStatusBarProps> = ({
  compact = false,
  hasMore = false,
  onSyncAll,
  onRunEmbeddingBackfill,
  onStopSync,
}) => {
  const { getLastSyncedAt } = useSettingsStore();
  const lastSyncedAt = getLastSyncedAt();

  const isFetching = useSyncStore((s) => s.isFetching);
  const isLoadingMore = useSyncStore((s) => s.isLoadingMore);
  const isSyncingAll = useSyncStore((s) => s.isSyncingAll);
  const syncAllProgress = useSyncStore((s) => s.syncAllProgress);
  const isEmbeddingBackfilling = useSyncStore((s) => s.isEmbeddingBackfilling);
  const embeddingBackfillProgress = useSyncStore((s) => s.embeddingBackfillProgress);
  const lastSyncError = useSyncStore((s) => s.lastSyncError);

  const isSyncing = isFetching || isLoadingMore;
  const syncRateLimitError = lastSyncError instanceof SyncRateLimitError ? lastSyncError : null;

  /** 停止クリック直後のフィードバック用（二重送信防止・「停止中」表示） */
  const [isStopping, setIsStopping] = useState(false);

  useEffect(() => {
    if (!isSyncing && !isSyncingAll) setIsStopping(false);
  }, [isSyncing, isSyncingAll]);

  /** 停止ボタンを表示する条件（同期中または停止処理中で、停止ハンドラがあるとき） */
  const showStopButton = (isSyncing || isSyncingAll || isStopping) && Boolean(onStopSync);

  const paperCount = usePaperStore((state) => state.papers.length);
  const papersWithoutEmbeddingCount = usePaperStore(
    (state) => state.papers.filter((p) => !p.embedding || p.embedding.length === 0).length
  );

  return (
    <div
      className={
        compact
          ? "mb-3 min-w-0 rounded-lg border border-border/50 bg-muted/15 px-3 py-2 backdrop-blur-sm overflow-hidden"
          : "mb-6 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 backdrop-blur-sm"
      }
    >
      {/* 429 レート制限: 何が起きたか・どうするかを明示（ペルソナ5流: メインカラーで主張、視線を誘導） */}
      {syncRateLimitError ? (
        <div
          className={
            compact
              ? "mb-2 rounded-lg border-2 border-primary/60 bg-primary/10 px-3 py-2"
              : "mb-3 rounded-xl border-2 border-primary/70 bg-primary/15 px-4 py-3"
          }
          role="alert"
          aria-live="assertive"
        >
          <p
            className={
              compact
                ? "text-xs font-bold text-primary opacity-[1]"
                : "text-sm font-bold text-primary opacity-[1]"
            }
          >
            {syncRateLimitError.message}
          </p>
          <p
            className={
              compact
                ? "mt-1 text-[10px] text-muted-foreground opacity-[0.85]"
                : "mt-1.5 text-xs text-muted-foreground opacity-[0.85]"
            }
          >
            再度「同期」または「同期期間の論文をすべて取得」を押すと再試行できます。
          </p>
        </div>
      ) : null}
      <div
        className={
          compact
            ? "flex flex-wrap items-center gap-x-4 gap-y-2"
            : "flex flex-wrap items-center gap-x-6 gap-y-3"
        }
      >
        {/* ステータス群: オブジェクト（名詞）ごとにブロック分割し、各ブロックに紐づくアクション（動詞）を隣接配置 */}
        <div
          className={
            compact
              ? "flex flex-wrap items-center content-start gap-x-2 gap-y-2"
              : "flex flex-wrap items-center content-start gap-x-4 gap-y-2"
          }
        >
          {/* 最終同期（1ブロック） */}
          <div
            className={
              compact
                ? "flex items-center gap-1.5 text-xs shrink-0"
                : "flex items-center gap-2 text-sm shrink-0"
            }
          >
            <Calendar
              className={
                compact
                  ? "h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  : "h-4 w-4 shrink-0 text-muted-foreground"
              }
            />
            <span className="text-muted-foreground shrink-0">
              {compact ? "同期:" : "最終同期:"}
            </span>
            <span className={compact ? "whitespace-nowrap" : "truncate"}>
              {lastSyncedAt
                ? compact
                  ? `${lastSyncedAt.getMonth() + 1}/${lastSyncedAt.getDate()} ${lastSyncedAt.getHours().toString().padStart(2, "0")}:${lastSyncedAt.getMinutes().toString().padStart(2, "0")}`
                  : lastSyncedAt.toLocaleString("ja-JP", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                : "未同期"}
            </span>
          </div>

          {/* 取得済み論文数 ＋ 同期期間の残りをすべて取得（対象: 論文コレクション／取得可能残り）。レイアウト: ブロック境界で視線を誘導。 */}
          <div
            className={
              compact
                ? "flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs shrink-0 pl-2 border-l border-border/50"
                : "flex flex-wrap items-center gap-x-2 gap-y-2 text-sm shrink-0 pl-3 border-l border-border/50"
            }
          >
            <FileText
              className={
                compact
                  ? "h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  : "h-4 w-4 shrink-0 text-muted-foreground"
              }
            />
            <span className="text-muted-foreground shrink-0">{compact ? "" : "取得済み:"}</span>
            <span className="font-bold">{paperCount.toLocaleString("ja-JP")}件</span>
            {hasMore && onSyncAll ? (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={onSyncAll}
                  disabled={isSyncingAll || isSyncing}
                  aria-label="同期期間の論文をすべて取得"
                  className={
                    compact
                      ? "min-h-[44px] min-w-[44px] h-auto px-2 py-1.5 text-xs"
                      : "min-h-[48px] min-w-[48px] h-auto px-3 py-2"
                  }
                >
                  {isSyncingAll && syncAllProgress
                    ? `取得中 ${syncAllProgress.fetched.toLocaleString("ja-JP")} / ${syncAllProgress.total.toLocaleString("ja-JP")} 件`
                    : "同期期間の論文をすべて取得"}
                </Button>
                {showStopButton ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (isStopping || !onStopSync) return;
                      setIsStopping(true);
                      onStopSync();
                    }}
                    disabled={isStopping}
                    aria-label={isStopping ? "停止しています" : "同期を停止"}
                    aria-busy={isStopping}
                    className={
                      compact
                        ? "min-h-[44px] min-w-[44px] h-auto px-2 py-1.5 text-xs"
                        : "min-h-[48px] min-w-[48px] h-auto px-3 py-2"
                    }
                  >
                    <StopCircle
                      className={compact ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4 shrink-0"}
                      aria-hidden
                    />
                    {compact ? "" : isStopping ? "停止中…" : "停止"}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>

          {/* Embedding 未設定件数 ＋ 補完（対象: Embedding未設定の論文）。レイアウト: 同上、境界線でブロックを分離。 */}
          <div
            className={
              compact
                ? "flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs shrink-0 pl-2 border-l border-border/50"
                : "flex flex-wrap items-center gap-x-2 gap-y-2 text-sm shrink-0 pl-3 border-l border-border/50"
            }
          >
            <SearchX
              className={
                compact
                  ? "h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  : "h-4 w-4 shrink-0 text-muted-foreground"
              }
            />
            {!compact && <span className="text-muted-foreground">Embedding未設定:</span>}
            <span className="font-bold">
              {papersWithoutEmbeddingCount.toLocaleString("ja-JP")}件
            </span>
            {isEmbeddingBackfilling && (
              <span
                className={
                  compact ? "text-[10px] text-muted-foreground" : "text-muted-foreground text-xs"
                }
                aria-live="polite"
              >
                （取得中
                {embeddingBackfillProgress &&
                  ` ${embeddingBackfillProgress.completed}/${embeddingBackfillProgress.total}`}
                ）
              </span>
            )}
            {onRunEmbeddingBackfill &&
              papersWithoutEmbeddingCount > 0 &&
              !isEmbeddingBackfilling && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRunEmbeddingBackfill}
                  aria-label="Embedding未設定の論文を補完"
                  className={
                    compact
                      ? "min-h-[44px] min-w-[44px] h-auto px-2 py-1.5 text-xs"
                      : "min-h-[48px] min-w-[48px] h-auto px-3 py-2"
                  }
                >
                  Embeddingを補完
                </Button>
              )}
          </div>
        </div>
      </div>
      {!compact && (
        <p className="mt-2 text-xs text-muted-foreground/70">
          24時間以上経過すると自動で同期が実行されます
        </p>
      )}
    </div>
  );
};
