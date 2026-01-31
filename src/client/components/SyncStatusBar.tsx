import { Calendar, FileText, Play, SearchX, Square } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect } from "react";
import { getDecryptedApiKey } from "../lib/api";
import { useSyncPapers } from "../hooks/useSyncPapers";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSyncStore } from "../stores/syncStore";
import { Button } from "./ui/button";

/**
 * SyncStatusBar の Props
 */
interface SyncStatusBarProps {
  /** Embedding バックフィル実行中か（App の useSyncPapers から渡す。取得中は「Embedding取得中」を表示） */
  isEmbeddingBackfilling?: boolean;
  /** Embedding バックフィル進捗（取得中のみ。「N/M件」表示） */
  embeddingBackfillProgress?: { completed: number; total: number } | null;
  /** Embedding 未設定の論文を手動で補完する（「Embeddingを補完」ボタンから呼ぶ） */
  onRunEmbeddingBackfill?: () => void | Promise<void>;
}

/**
 * SyncStatusBar - メイン画面用の同期ステータスバー
 *
 * オブジェクト指向UI: 論文コレクションの状態とアクションを一覧画面のそばに表示する。
 * - 最終同期日時
 * - 取得済み論文数
 * - Embedding 未設定件数（取得中は「Embedding取得中」表示）
 * - 順次取得を開始 / 進捗・中断
 */
export const SyncStatusBar: FC<SyncStatusBarProps> = ({
  isEmbeddingBackfilling = false,
  embeddingBackfillProgress = null,
  onRunEmbeddingBackfill,
}) => {
  const { getLastSyncedAt, selectedCategories, syncPeriodDays } = useSettingsStore();
  const lastSyncedAt = getLastSyncedAt();

  const paperCount = usePaperStore((state) => state.papers.length);
  const papersWithoutEmbeddingCount = usePaperStore(
    (state) => state.papers.filter((p) => !p.embedding || p.embedding.length === 0).length
  );

  const { isIncrementalSyncing, progress, abortIncrementalSync } = useSyncStore();
  const { syncIncremental } = useSyncPapers(
    { categories: selectedCategories, period: syncPeriodDays },
    {
      onError: (error) => {
        console.error("Incremental sync error:", error);
      },
    }
  );

  const handleStartIncrementalSync = useCallback(async () => {
    await syncIncremental();
  }, [syncIncremental]);

  const handleAbortIncrementalSync = useCallback(() => {
    abortIncrementalSync();
  }, [abortIncrementalSync]);

  // 「Embeddingを補完」ボタンが表示されている間、API キーを事前復号（ウォームアップ）しておく
  // クリック時の getDecryptedApiKey() がキャッシュヒットし、リクエストがすぐ始まる
  const shouldWarmupApiKey =
    Boolean(onRunEmbeddingBackfill) &&
    papersWithoutEmbeddingCount > 0 &&
    !isEmbeddingBackfilling;
  useEffect(() => {
    if (!shouldWarmupApiKey) return;
    getDecryptedApiKey().catch(() => {});
  }, [shouldWarmupApiKey]);

  return (
    <div className="mb-6 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* 最終同期 */}
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">最終同期:</span>
          <span>
            {lastSyncedAt
              ? lastSyncedAt.toLocaleString("ja-JP", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "未同期"}
          </span>
        </div>

        {/* 取得済み論文数 */}
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">取得済み:</span>
          <span className="font-medium">{paperCount.toLocaleString("ja-JP")}件</span>
        </div>

        {/* Embedding 未設定件数（取得中は「Embedding取得中」。手動で「Embeddingを補完」可能） */}
        <div className="flex items-center gap-2 text-sm">
          <SearchX className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">Embedding未設定:</span>
          <span className="font-medium">
            {papersWithoutEmbeddingCount.toLocaleString("ja-JP")}件
          </span>
          {isEmbeddingBackfilling && (
            <span className="text-muted-foreground text-xs" aria-live="polite">
              （Embedding取得中
              {embeddingBackfillProgress &&
                ` ${embeddingBackfillProgress.completed}/${embeddingBackfillProgress.total}件`}
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
              >
                Embeddingを補完
              </Button>
            )}
        </div>

        {/* 順次取得: ボタン or 進捗・中断 */}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {isIncrementalSyncing ? (
            <>
              {progress && (
                <div
                  className="flex items-center gap-2 text-sm"
                  title="件数は選択カテゴリ全体です。実際の取得は同期期間内のみです。"
                >
                  <span className="text-muted-foreground">進捗</span>
                  <span className="font-medium">
                    {progress.fetched}件 / 残り{progress.remaining}件
                    <span className="text-muted-foreground font-normal">（カテゴリ全体）</span>
                  </span>
                  {progress.total > 0 && (
                    <div className="w-24 bg-muted rounded-full h-1.5">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (progress.fetched / progress.total) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleAbortIncrementalSync}
                aria-label="順次取得を中断"
              >
                <Square className="h-4 w-4 mr-1.5" />
                中断
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={handleStartIncrementalSync}
              disabled={selectedCategories.length === 0}
              aria-label="同期期間内の未取得論文を順次取得"
            >
              <Play className="h-4 w-4 mr-1.5" />
              順次取得を開始
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground/70">
        24時間以上経過すると自動で同期が実行されます
      </p>
    </div>
  );
};
