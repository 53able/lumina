import { Info } from "lucide-react";
import type { FC } from "react";
import type { SyncPeriod } from "../../shared/schemas/index";
import { useSettingsStore } from "../stores/settingsStore";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** 同期期間オプションの定義（index 0〜6 が Slider の値に対応） */
const SYNC_PERIOD_OPTIONS: {
  value: SyncPeriod;
  label: string;
  description: string;
}[] = [
  { value: "1", label: "1日", description: "過去1日間の論文を取得" },
  { value: "3", label: "3日", description: "過去3日間の論文を取得" },
  { value: "7", label: "7日", description: "過去1週間の論文を取得" },
  { value: "30", label: "30日", description: "過去1ヶ月の論文を取得" },
  { value: "90", label: "90日", description: "過去3ヶ月の論文を取得" },
  { value: "180", label: "180日", description: "過去半年の論文を取得" },
  { value: "365", label: "1年", description: "過去1年の論文を取得" },
];

const SYNC_PERIOD_INDEX_MAX = SYNC_PERIOD_OPTIONS.length - 1;

/**
 * syncPeriodDays を Slider の index（0〜6）に変換する。
 * 未定義や不正値の場合は 0 を返す。
 */
const syncPeriodToIndex = (period: SyncPeriod): number => {
  const index = SYNC_PERIOD_OPTIONS.findIndex((o) => o.value === period);
  return index >= 0 ? index : 0;
};

/**
 * SyncSettings - 同期設定コンポーネント（設定ダイアログ内）
 *
 * 機能: 同期期間の選択のみ（Slider で 1日〜1年）。
 * 最終同期・論文数・Embedding未設定はメイン画面の SyncStatusBar で表示・操作する。
 */
export const SyncSettings: FC = () => {
  const { syncPeriodDays, setSyncPeriodDays } = useSettingsStore();
  const currentIndex = syncPeriodToIndex(syncPeriodDays);
  const currentOption = SYNC_PERIOD_OPTIONS[currentIndex];

  const applySliderValue = (valueOrArray: number | number[]) => {
    const raw = Array.isArray(valueOrArray) ? valueOrArray[0] : valueOrArray;
    const index = Math.min(SYNC_PERIOD_INDEX_MAX, Math.max(0, Number(raw) ?? 0));
    const next = SYNC_PERIOD_OPTIONS[index];
    if (next) setSyncPeriodDays(next.value);
  };

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

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium tabular-nums" aria-live="polite">
              同期期間: {currentOption.label}
            </span>
          </div>
          <div className="w-full">
            <Slider
              aria-label="同期期間（日数）"
              min={0}
              max={SYNC_PERIOD_INDEX_MAX}
              step={1}
              value={[currentIndex]}
              onValueChange={applySliderValue}
              onValueCommit={applySliderValue}
            />
          </div>
          <p className="text-xs text-muted-foreground/80">{currentOption.description}</p>
          <div className="flex justify-between text-[10px] text-muted-foreground/80 px-0.5">
            {SYNC_PERIOD_OPTIONS.map((opt) => (
              <span key={opt.value}>{opt.label}</span>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground/70 border-t pt-4">
        同期ステータス（最終同期・論文数・Embedding未設定）はメイン画面で確認・実行できます。
      </p>
    </div>
  );
};
