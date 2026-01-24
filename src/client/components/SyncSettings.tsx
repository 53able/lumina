import { Calendar, Info } from "lucide-react";
import type { FC } from "react";
import { Label } from "./ui/label.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";
import { useSettingsStore } from "../stores/settingsStore.js";
import type { SyncPeriod } from "../../shared/schemas/index.js";

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
 */
export const SyncSettings: FC = () => {
  const { syncPeriodDays, setSyncPeriodDays, getLastSyncedAt } = useSettingsStore();

  const lastSyncedAt = getLastSyncedAt();

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
                      px-3 py-2 rounded-lg text-sm font-medium transition-all
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

      {/* 最終同期日時 */}
      <div className="border-t pt-4">
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">最終同期:</span>
          <span className="font-medium">
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
      </div>
    </div>
  );
};
