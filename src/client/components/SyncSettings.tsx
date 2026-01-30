import { Calendar, FileText, Info, Play, SearchX, Square } from "lucide-react";
import type { FC } from "react";
import { useCallback } from "react";
import type { SyncPeriod } from "../../shared/schemas/index";
import { useSyncPapers } from "../hooks/useSyncPapers";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSyncStore } from "../stores/syncStore";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** 同期期間オプションの定義 */
const SYNC_PERIOD_OPTIONS: {
  value: SyncPeriod;
  label: string;
  description: string;
}[] = [
  { value: "7", label: "7日", description: "過去1週間の論文を取得" },
  { value: "30", label: "30日", description: "過去1ヶ月の論文を取得" },
  { value: "90", label: "90日", description: "過去3ヶ月の論文を取得" },
  { value: "180", label: "180日", description: "過去半年の論文を取得" },
  { value: "365", label: "1年", description: "過去1年の論文を取得" },
];

/**
 * SyncSettings - 同期設定コンポーネント
 *
 * 機能:
 * - 同期期間の選択
 * - 最終同期日時の表示
 * - 同期期間内の未取得論文を順次取得（オブジェクト指向UI: 同期オブジェクトに対するアクション）
 */
export const SyncSettings: FC = () => {
  const { syncPeriodDays, setSyncPeriodDays, getLastSyncedAt, selectedCategories } =
    useSettingsStore();

  const lastSyncedAt = getLastSyncedAt();

  // 論文数と Embedding 未設定件数を取得
  const paperCount = usePaperStore((state) => state.getPaperCount());
  const papers = usePaperStore((state) => state.papers);
  const papersWithoutEmbeddingCount = papers.filter(
    (p) => !p.embedding || p.embedding.length === 0
  ).length;

  // syncStoreから同期状態を取得（グローバル状態管理）
  const { isIncrementalSyncing, progress, abortIncrementalSync } = useSyncStore();

  // 同期フックから順次取得関数を取得
  const { syncIncremental } = useSyncPapers(
    {
      categories: selectedCategories,
      period: syncPeriodDays,
    },
    {
      onError: (error) => {
        console.error("Incremental sync error:", error);
      },
    }
  );

  // 順次取得を開始（オブジェクト指向UI: 同期オブジェクトに対するアクション）
  const handleStartIncrementalSync = useCallback(async () => {
    await syncIncremental();
  }, [syncIncremental]);

  // 順次取得を中断（オブジェクト指向UI: 実行中のアクションを中断）
  const handleAbortIncrementalSync = useCallback(() => {
    abortIncrementalSync();
  }, [abortIncrementalSync]);

  return (
    <div className="space-y-6">
      {/* 同期期間セクション */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Label>同期期間</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[200px] text-xs">
              arXivから取得する論文の期間を指定します。期間が長いほど取得に時間がかかります。
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {SYNC_PERIOD_OPTIONS.map((option) => {
            const isSelected = syncPeriodDays === option.value;

            return (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setSyncPeriodDays(option.value)}
                    className={`
                      px-3 py-2 rounded-lg text-sm transition-all
                      border focus:outline-none focus:ring-2 focus:ring-primary/50
                      ${
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted border-border hover:border-muted-foreground/30"
                      }
                    `}
                  >
                    {option.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {option.description}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* 順次取得セクション（オブジェクト指向UI: 同期オブジェクトに対するアクション） */}
      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>順次取得</Label>
            <p className="text-xs text-muted-foreground/60 mt-1">
              同期期間内でまだ取得していない論文を順次取得します。レートリミットを考慮して自動的に実行されます。
            </p>
          </div>
        </div>

        {isIncrementalSyncing ? (
          <div className="space-y-3">
            {/* 進捗表示 */}
            {progress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">進捗</span>
                  <span className="font-medium">
                    {progress.fetched}件取得済み / 残り{progress.remaining}件
                  </span>
                </div>
                {progress.total > 0 && (
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (progress.fetched / progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* 中断ボタン */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAbortIncrementalSync}
              className="w-full"
            >
              <Square className="h-4 w-4 mr-2" />
              中断
            </Button>
          </div>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={handleStartIncrementalSync}
            className="w-full"
            disabled={selectedCategories.length === 0}
          >
            <Play className="h-4 w-4 mr-2" />
            順次取得を開始
          </Button>
        )}
      </div>

      {/* 最終同期日時と論文数 */}
      <div className="border-t pt-4 space-y-3">
        {/* 最終同期日時 */}
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
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
        <p className="text-xs text-muted-foreground/60 mt-1">
          24時間以上経過すると自動で同期が実行されます
        </p>

        {/* 取得済み論文数 */}
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">取得済み論文:</span>
          <span className="font-medium">{paperCount.toLocaleString("ja-JP")}件</span>
        </div>

        {/* Embedding 未設定件数（集約表示・重要情報の可視化） */}
        {papersWithoutEmbeddingCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <SearchX className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Embedding 未設定:</span>
            <span className="font-medium">{papersWithoutEmbeddingCount.toLocaleString("ja-JP")}件</span>
          </div>
        )}
      </div>
    </div>
  );
};
