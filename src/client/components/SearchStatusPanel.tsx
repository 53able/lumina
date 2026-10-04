import { type FC, useEffect, useState } from "react";
import {
  describeSearchFailure,
  RECOMPUTE_FAILURE_MESSAGES,
  RECOMPUTE_FAILURE_TITLE,
} from "../lib/searchErrors";
import { focusPaperSearchInput } from "./PaperSearch";
import { Button } from "./ui/button";

/** 理由と対処を一覧に出している失敗で、検索欄の近くに出す文 */
export const SEARCH_FAILURE_EXPLAINED_IN_LIST = "理由と対処は検索結果の欄に表示しています。";

/** 経過時間を表示し始めるまでの秒数（短い検索では出さない） */
export const ELAPSED_TIME_VISIBLE_AFTER_SEC = 3;

interface SearchStatusPanelProps {
  /** 実行中・失敗した検索のクエリ */
  query: string;
  /** 検索中か */
  isLoading: boolean;
  /** 検索の失敗（失敗していなければ null） */
  error: Error | null;
  /** 表示中の前回の結果のクエリ（前回の結果がなければ null） */
  previousQuery: string | null;
  /**
   * error が確定した結果（query の結果）の再計算の失敗か。新しい検索の失敗と区別し、
   * 表示中の結果は前回の結果ではなく更新できなかった現在の結果として案内する（前結果を見る・条件を編集は出さない）
   */
  isRecomputeFailure?: boolean;
  /** 検索を中止する・前回の結果に戻る（再計算の失敗では使わない） */
  onCancel?: () => void;
  /** 同じ条件で再試行する */
  onRetry: () => void;
  /** 設定を開く（設定を直すと解決する失敗で案内する） */
  onOpenSettings?: () => void;
}

/**
 * 検索中の経過時間（秒）。マウント中だけ数える（検索のたびにマウントし直す）。
 * 進捗率は取得できないため出さない。
 */
const ElapsedTime: FC = () => {
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (elapsedSec < ELAPSED_TIME_VISIBLE_AFTER_SEC) return null;
  // 毎秒の読み上げを避けるため live region の外に置く
  return <span className="text-xs text-muted-foreground">経過 {elapsedSec}秒</span>;
};

/**
 * SearchStatusPanel - 検索欄の近くに検索の実行中・失敗を示し、中止・再試行・条件の編集・前回の結果に戻る操作を置く
 *
 * - 実行中: 検索中のクエリ、前回の結果を表示していること、一定時間後に経過時間、中止
 * - 失敗: 理由（消えるトーストに依存せず残す）と、同じ条件で再試行・条件を編集・前結果を見る（・設定を開く）
 * - 再計算の失敗: 表示中の結果を更新できなかったことと、再計算だけをやり直す再試行
 *
 * 検索中も検索欄はフォーカスを保ち（readOnly）、中止ボタンへは Tab で移れる。フォーカスを自動では動かさない。
 * 再試行は利用者の操作でのみ行う。設定を直さない限り失敗する分類（API利用OFF・認証・キー復号）では再試行を出さず、設定を案内する。
 * サーバーエラー（5xx）は上流の認証失敗も含むため、再試行と設定の両方を出す。
 */
export const SearchStatusPanel: FC<SearchStatusPanelProps> = ({
  query,
  isLoading,
  error,
  previousQuery,
  isRecomputeFailure = false,
  onCancel,
  onRetry,
  onOpenSettings,
}) => {
  /** 中止・前回の結果に戻った後は、押したボタンが消えるため検索欄へフォーカスを戻す */
  const handleCancel = () => {
    onCancel?.();
    focusPaperSearchInput();
  };

  /** 再試行すると失敗の表示（押したボタン）が消えるため、検索欄へフォーカスを戻す */
  const handleRetry = () => {
    onRetry();
    focusPaperSearchInput();
  };

  const previousNote =
    previousQuery !== null ? `表示中は前回の結果（"${previousQuery}"）です。` : "";

  if (isLoading) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
        <output aria-live="polite" className="min-w-0">
          「{query}」を検索中… {previousNote}
        </output>
        <ElapsedTime />
        <Button variant="outline" size="sm" onClick={handleCancel}>
          {previousQuery !== null ? "中止して前回の結果に戻る" : "検索を中止"}
        </Button>
      </div>
    );
  }

  if (error === null) return null;

  const failure = describeSearchFailure(error);

  if (isRecomputeFailure) {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
        <div role="alert">
          <p className="font-bold">{RECOMPUTE_FAILURE_TITLE}</p>
          <p>
            {failure.kind === "paper_load"
              ? RECOMPUTE_FAILURE_MESSAGES.paper_load
              : RECOMPUTE_FAILURE_MESSAGES.compute}
          </p>
          <p className="text-muted-foreground">表示中の結果: "{query}"</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleRetry} aria-label="結果の更新を再試行">
            再試行
          </Button>
        </div>
      </div>
    );
  }

  const needsSettings = failure.suggestSettings && onOpenSettings !== undefined;
  // 前回の結果がなく、理由と対処を一覧の0件表示に出す失敗（キー復号・論文の読み込み）は、ここで同じ説明を繰り返さない
  const isExplainedInList = previousQuery === null && failure.explainedInList;

  return (
    <div className="space-y-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
      <div role="alert">
        <p className="font-bold">「{query}」を検索できませんでした</p>
        <p>{isExplainedInList ? SEARCH_FAILURE_EXPLAINED_IN_LIST : failure.message}</p>
        {previousNote ? <p className="text-muted-foreground">{previousNote}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {failure.canRetry ? (
          <Button variant="outline" size="sm" onClick={handleRetry}>
            同じ条件で再試行
          </Button>
        ) : null}
        {needsSettings ? (
          <Button variant="outline" size="sm" onClick={onOpenSettings}>
            設定を開く
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={focusPaperSearchInput}>
          条件を編集
        </Button>
        {previousQuery !== null ? (
          <Button variant="outline" size="sm" onClick={handleCancel}>
            前結果を見る
          </Button>
        ) : null}
      </div>
    </div>
  );
};
