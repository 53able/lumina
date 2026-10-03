import { type FC, useId, useState } from "react";
import { ScoreThresholdSlider } from "./ScoreThresholdSlider";

/**
 * SearchThresholdControl のProps
 */
interface SearchThresholdControlProps {
  /** 現在表示している検索結果の件数 */
  resultCount: number;
}

/**
 * SearchThresholdControl - 検索結果の横で類似度しきい値を調整する
 *
 * 設定ダイアログを開かずに結果を見ながらしきい値を変えられる。値は設定ダイアログと同じ store に保存し、
 * 結果は保存済みの queryEmbedding から再計算される（検索APIは呼ばない）。
 * 調整後の件数は live region で控えめに通知する（検索直後などの調整前は通知しない）。
 */
export const SearchThresholdControl: FC<SearchThresholdControlProps> = ({ resultCount }) => {
  const sliderId = useId();
  const [hasAdjusted, setHasAdjusted] = useState(false);

  return (
    <div className="mt-3 text-sm">
      <label htmlFor={sliderId} className="text-xs font-bold text-primary-light">
        類似度のしきい値
      </label>
      <ScoreThresholdSlider id={sliderId} onUserChange={() => setHasAdjusted(true)} />
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {hasAdjusted ? `${resultCount}件を表示` : ""}
      </output>
    </div>
  );
};
