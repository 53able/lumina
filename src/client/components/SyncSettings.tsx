import { Info } from "lucide-react";
import type { FC } from "react";
import type { SyncPeriod } from "../../shared/schemas/index";
import { useSettingsStore } from "../stores/settingsStore";
import { Label } from "./ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** 同期期間オプションの定義 */
const SYNC_PERIOD_OPTIONS: {
  value: SyncPeriod;
  label: string;
  description: string;
}[] = [
  { value: "3", label: "3日", description: "過去3日間の論文を取得" },
  { value: "7", label: "7日", description: "過去1週間の論文を取得" },
  { value: "30", label: "30日", description: "過去1ヶ月の論文を取得" },
  { value: "90", label: "90日", description: "過去3ヶ月の論文を取得" },
  { value: "180", label: "180日", description: "過去半年の論文を取得" },
  { value: "365", label: "1年", description: "過去1年の論文を取得" },
];

/**
 * SyncSettings - 同期設定コンポーネント（設定ダイアログ内）
 *
 * 機能: 同期期間の選択のみ。
 * 最終同期・論文数・Embedding未設定はメイン画面の SyncStatusBar で表示・操作する。
 */
export const SyncSettings: FC = () => {
  const { syncPeriodDays, setSyncPeriodDays } = useSettingsStore();

  return (
    <div className="space-y-6">
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

        <div className="grid grid-cols-6 gap-2">
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

      <p className="text-xs text-muted-foreground/70 border-t pt-4">
        同期ステータス（最終同期・論文数・Embedding未設定）はメイン画面で確認・実行できます。
      </p>
    </div>
  );
};
