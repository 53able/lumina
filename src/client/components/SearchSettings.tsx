import { Info } from "lucide-react";
import type { FC } from "react";
import { ScoreThresholdSlider } from "./ScoreThresholdSlider";
import { Label } from "./ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * SearchSettings - 検索設定コンポーネント（設定ダイアログ内）
 *
 * 機能: コサイン類似度のしきい値の変更。
 * この値未満の類似度の検索結果は表示しない。低くすると多く、高くすると厳しく表示される。
 * 検索結果の横のしきい値と同じ値で、表示中の検索結果にも再検索なしで反映される。
 */
export const SearchSettings: FC = () => {
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

        <ScoreThresholdSlider id="search-score-threshold" />
      </div>

      <p className="text-xs text-muted-foreground/70 border-t pt-4">
        表示中の検索結果にも再検索なしで反映されます。検索結果の横からも調整できます。
      </p>
    </div>
  );
};
