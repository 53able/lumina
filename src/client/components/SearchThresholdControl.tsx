import { ChevronDown } from "lucide-react";
import { type FC, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { useSettingsStore } from "../stores/settingsStore";
import { ScoreThresholdSlider } from "./ScoreThresholdSlider";
import { Button } from "./ui/button";

/** 件数通知を更新するまでの待ち時間（スライダーのドラッグ中に読み上げを連発させない） */
const ANNOUNCE_DELAY_MS = 400;

/**
 * SearchThresholdControl のProps
 */
interface SearchThresholdControlProps {
  /** 一覧に表示している論文の件数（「N件の論文」と同じ値） */
  displayedCount: number;
  /** しきい値を適用できるか（クエリのEmbeddingがない検索では適用できない） */
  canApply: boolean;
  /**
   * 最初に開いた状態で表示するか（モバイルは閉じて一覧を優先する）。
   * マウント時の1回だけ反映し、以降の画面幅の変化では開閉状態を変えない（利用者の開閉を優先する）。
   */
  defaultOpen: boolean;
}

/**
 * SearchThresholdControl - 検索結果の件数の隣で類似度しきい値を調整する
 *
 * 設定ダイアログを開かずに結果を見ながらしきい値を変えられる。値は設定ダイアログと同じ store に保存し、
 * 結果は保存済みの queryEmbedding から再計算される（検索APIは呼ばない）。
 * 開閉トグルにも現在のしきい値を出し、閉じていても適用中の値がわかるようにする。
 * 調整後の件数は、このスライダーを操作してから落ち着いた時点の件数だけを live region で控えめに通知する。
 * 同期・Embedding補完・絞り込み・設定ダイアログでの変更による件数の変化は通知しない。
 * 検索が変わったら親が key を変えて再マウントし、通知状態をリセットする。
 */
export const SearchThresholdControl: FC<SearchThresholdControlProps> = ({
  displayedCount,
  canApply,
  defaultOpen,
}) => {
  const sliderId = useId();
  const panelId = useId();
  const descriptionId = useId();
  const scoreThreshold = useSettingsStore((s) => s.searchScoreThreshold);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [announcement, setAnnouncement] = useState("");
  const displayThreshold = scoreThreshold.toFixed(2);

  // 通知の発火時点（操作から ANNOUNCE_DELAY_MS 後）の件数・しきい値を読むための参照
  const latestRef = useRef({ displayedCount, displayThreshold });
  latestRef.current = { displayedCount, displayThreshold };
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    },
    []
  );

  /** スライダー操作のたびに通知を先送りし、操作が落ち着いた時点の件数を1回だけ通知する */
  const handleUserChange = () => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => {
      const { displayedCount: count, displayThreshold: threshold } = latestRef.current;
      // しきい値を含めて毎回文言を変え、表示件数が変わらない調整でも適用を伝える
      setAnnouncement(`しきい値 ${threshold}: ${count}件の論文を表示`);
    }, ANNOUNCE_DELAY_MS);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        しきい値 <span className="tabular-nums">{displayThreshold}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </Button>
      <div id={panelId} hidden={!isOpen} className="basis-full space-y-1 text-sm">
        <label htmlFor={sliderId} className="text-xs font-bold text-primary-light">
          類似度のしきい値
        </label>
        <ScoreThresholdSlider
          id={sliderId}
          describedBy={descriptionId}
          disabled={!canApply}
          onUserChange={handleUserChange}
        />
        <p id={descriptionId} className="text-xs text-muted-foreground/70">
          {canApply
            ? "この値未満の類似度の論文は表示しません。変更はすぐに結果へ反映され、再検索はしません。"
            : "この検索では類似度を計算できないため（APIキー未設定など）、しきい値を適用できません。設定でAPIキーを入力して再検索すると調整できます。"}
        </p>
      </div>
      <output
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        aria-label="しきい値の調整結果"
      >
        {announcement}
      </output>
    </>
  );
};
