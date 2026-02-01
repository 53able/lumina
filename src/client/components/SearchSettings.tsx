import { Info } from "lucide-react";
import type { FC } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { Label } from "./ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** しきい値のステップ（スライダー・入力の刻み） */
const THRESHOLD_STEP = 0.05;

/** しきい値の最小・最大 */
const THRESHOLD_MIN = 0;
const THRESHOLD_MAX = 1;

/**
 * SearchSettings - 検索設定コンポーネント（設定ダイアログ内）
 *
 * 機能: コサイン類似度のしきい値の変更。
 * この値未満の類似度の検索結果は表示しない。低くすると多く、高くすると厳しく表示される。
 */
export const SearchSettings: FC = () => {
  const { searchScoreThreshold, setSearchScoreThreshold } = useSettingsStore();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.valueAsNumber;
    if (!Number.isNaN(value)) {
      setSearchScoreThreshold(value);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="search-score-threshold">類似度のしきい値</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px] text-xs">
              この値未満の類似度の検索結果は表示しません。低くすると多く、高くすると厳しく表示されます。
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-4">
          <input
            id="search-score-threshold"
            type="range"
            min={THRESHOLD_MIN}
            max={THRESHOLD_MAX}
            step={THRESHOLD_STEP}
            value={searchScoreThreshold}
            onChange={handleChange}
            className="flex-1 h-2 rounded-lg appearance-none bg-muted accent-primary cursor-pointer"
            aria-valuemin={THRESHOLD_MIN}
            aria-valuemax={THRESHOLD_MAX}
            aria-valuenow={searchScoreThreshold}
            aria-valuetext={`${searchScoreThreshold}`}
          />
          <span className="min-w-[3ch] text-sm font-medium tabular-nums">
            {searchScoreThreshold.toFixed(2)}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground/70 border-t pt-4">
        検索時のみ適用されます。既に表示中の検索結果には再検索まで反映されません。
      </p>
    </div>
  );
};
