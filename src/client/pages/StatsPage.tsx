import { BarChart3, TrendingDown } from "lucide-react";
import type { FC } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { DailyCountEntry } from "../../shared/schemas/index";
import {
  aggregatePapersByDay,
  getLowDayEntries,
  getMedianCount,
} from "../../shared/utils/paperStats";
import { BackToListLink } from "../components/BackToListLink";
import { PaperCacheBarChart } from "../components/PaperCacheBarChart";
import { Button } from "../components/ui/button";
import { useSyncPapers } from "../hooks/useSyncPapers";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";

/** 少ない日を一覧表示するときの最大表示件数（超えた分は「他N日」） */
const LOW_DAYS_PREVIEW_MAX = 8;

/**
 * 日別件数配列と閾値から棒グラフ用の説明文を生成する（アクセシビリティ用）
 */
const describeChart = (entries: DailyCountEntry[], threshold?: number): string => {
  if (entries.length === 0) return "表示するデータがありません。";
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const maxEntry = entries.reduce((a, b) => (a.count >= b.count ? a : b));
  const base = `論文キャッシュの公開日別件数。全${total}件。最も多い日は${maxEntry.date}の${maxEntry.count}件。`;
  if (threshold === undefined) return base;
  const lowDays = entries.filter((e) => e.count <= threshold).length;
  return `${base} 中央値以下は${lowDays}日。少ない日は濃い色で表示。`;
};

/**
 * StatsPage - キャッシュが少ない日を確認する
 *
 * 論文キャッシュを公開日別に集計し、棒が低い日（＝その日の論文が少ない）を把握する。
 * 中央値以下の日は別色で表示し、必要に応じてその期間を追加同期できる。
 */
export const StatsPage: FC = () => {
  const { papers, isLoading } = usePaperStore();
  const { selectedCategories, syncPeriodDays } = useSettingsStore();
  const { syncFromDate, isSyncingFromDate } = useSyncPapers(
    { categories: selectedCategories, period: syncPeriodDays },
    {
      onSyncFromDateSuccess: (addedCount, totalFetched) => {
        if (addedCount > 0) {
          toast.success("同期完了", {
            description: `${addedCount}件の論文をキャッシュしました（最大200件まで）`,
          });
        } else if ((totalFetched ?? 0) > 0) {
          toast.info("この期間の論文はすでにキャッシュに含まれています", {
            description: `${totalFetched}件を確認しました`,
          });
        } else {
          toast.info("追加する論文はありませんでした");
        }
      },
      onSyncFromDateError: (error) => {
        toast.error("同期エラー", { description: error.message });
      },
    }
  );

  const dailyCounts = aggregatePapersByDay(papers);
  const threshold = dailyCounts.length > 0 ? getMedianCount(dailyCounts) : undefined;
  const lowDayEntries = threshold !== undefined ? getLowDayEntries(dailyCounts, threshold) : [];
  const emptyState = papers.length === 0 && !isLoading;

  return (
    <div className="min-h-dvh bg-background bg-gradient-lumina">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <BackToListLink className="mb-6" />

        <div className="rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm shadow-sm p-6">
          <h1 className="text-xl font-bold text-foreground mb-1">キャッシュが少ない日</h1>
          <p className="text-sm text-muted-foreground mb-6">
            公開日別の件数。棒が低い日＝キャッシュが少ない日。グラフ下の線は中央値。
          </p>

          {!isLoading && !emptyState && dailyCounts.length > 0 && lowDayEntries.length > 0 && (
            <section
              className="mb-6 rounded-lg border border-border/60 bg-muted/30 p-4"
              aria-label="キャッシュが少ない日の一覧"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <TrendingDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  少ない日
                </span>
                <span className="rounded-md bg-primary/15 px-2 py-0.5 font-mono text-sm font-semibold tabular-nums text-primary">
                  {lowDayEntries.length}日
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {lowDayEntries.slice(0, LOW_DAYS_PREVIEW_MAX).map((e) => (
                  <Button
                    key={e.date}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto rounded border border-border/50 bg-background/80 px-2 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted/50"
                    onClick={() => syncFromDate(e.date)}
                    disabled={isSyncingFromDate}
                    aria-label={`${e.date}から同期する`}
                    aria-busy={isSyncingFromDate}
                  >
                    {e.date}
                    <span className="ml-1 text-muted-foreground/70">({e.count})</span>
                  </Button>
                ))}
                {lowDayEntries.length > LOW_DAYS_PREVIEW_MAX && (
                  <span className="px-2 py-0.5 text-xs text-muted-foreground">
                    他{lowDayEntries.length - LOW_DAYS_PREVIEW_MAX}日
                  </span>
                )}
              </div>
              <div className="mt-3">
                <Button asChild variant="outline" size="sm">
                  <Link to="/">ホームで同期</Link>
                </Button>
              </div>
            </section>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              読み込み中...
            </div>
          )}

          {!isLoading && emptyState && (
            <div className="flex flex-col items-center justify-center gap-6 py-12">
              <div className="rounded-full bg-muted/50 p-6">
                <BarChart3 className="h-12 w-12 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-center">
                キャッシュに論文がありません。同期すると表示されます。
              </p>
              <Button asChild>
                <Link to="/">ホームへ</Link>
              </Button>
            </div>
          )}

          {!isLoading && !emptyState && dailyCounts.length > 0 && (
            <figure
              className="min-w-0"
              role="img"
              aria-label={describeChart(dailyCounts, threshold)}
            >
              <div className="overflow-x-auto">
                <PaperCacheBarChart data={dailyCounts} threshold={threshold} />
              </div>
              <figcaption className="sr-only">{describeChart(dailyCounts, threshold)}</figcaption>
            </figure>
          )}

          {!isLoading && !emptyState && dailyCounts.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">集計結果がありません。</p>
          )}
        </div>
      </div>
    </div>
  );
};
