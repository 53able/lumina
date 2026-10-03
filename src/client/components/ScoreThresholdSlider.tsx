import type { FC } from "react";
import { useSettingsStore } from "../stores/settingsStore";

/** しきい値のステップ（スライダー・入力の刻み） */
const THRESHOLD_STEP = 0.05;

/** しきい値の最小・最大 */
const THRESHOLD_MIN = 0;
const THRESHOLD_MAX = 1;

/**
 * ScoreThresholdSlider のProps
 */
interface ScoreThresholdSliderProps {
  /** input の id（ラベルの htmlFor と対応させる） */
  id: string;
  /** 利用者がスライダーを操作したときに呼ぶ（store の更新後） */
  onUserChange?: () => void;
}

/**
 * ScoreThresholdSlider - 類似度しきい値のスライダーと現在値
 *
 * 設定ダイアログと検索結果の横で同じ store 値（searchScoreThreshold）を読み書きする。
 * 検索結果は useSemanticSearch がこの値から導出し直すため、変更は検索APIを呼ばずに即時反映される。
 */
export const ScoreThresholdSlider: FC<ScoreThresholdSliderProps> = ({ id, onUserChange }) => {
  const { searchScoreThreshold, setSearchScoreThreshold } = useSettingsStore();
  const displayValue = searchScoreThreshold.toFixed(2);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.valueAsNumber;
    if (!Number.isNaN(value)) {
      setSearchScoreThreshold(value);
      onUserChange?.();
    }
  };

  return (
    <div className="flex items-center gap-4">
      <input
        id={id}
        type="range"
        min={THRESHOLD_MIN}
        max={THRESHOLD_MAX}
        step={THRESHOLD_STEP}
        value={searchScoreThreshold}
        onChange={handleChange}
        className="flex-1 h-2 rounded-lg appearance-none bg-muted accent-primary cursor-pointer"
        aria-valuetext={displayValue}
      />
      <span className="min-w-[3ch] text-sm font-medium tabular-nums" aria-hidden="true">
        {displayValue}
      </span>
    </div>
  );
};
