import type { FC } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis } from "recharts";
import type { DailyCountEntry } from "../../shared/schemas/index";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

/** 論文キャッシュの日別件数用チャート設定 */
const CHART_CONFIG = {
  count: {
    label: "件数",
    color: "hsl(var(--chart-1))",
  },
  countLow: {
    label: "少ない（中央値以下）",
    color: "hsl(var(--chart-3))",
  },
} satisfies ChartConfig;

/**
 * PaperCacheBarChart の Props
 */
interface PaperCacheBarChartProps {
  /** 日別件数データ（date: YYYY-MM-DD, count: 件数） */
  data: DailyCountEntry[];
  /** この値以下の件数を「少ない」とし別色で表示する。省略時は色分けしない */
  threshold?: number;
}

/**
 * PaperCacheBarChart - 論文キャッシュの公開日別件数を棒グラフで表示
 *
 * EvilCharts 風の Recharts + shadcn ChartContainer を使用。
 * 日付を X 軸、件数を Y 軸に表示。threshold を渡すと中央値以下の日を別色で表示する。
 */
export const PaperCacheBarChart: FC<PaperCacheBarChartProps> = ({ data, threshold }) => {
  const effectiveThreshold = threshold ?? Infinity;

  return (
    <div className="space-y-3">
      <ChartContainer config={CHART_CONFIG} className="h-[280px] w-full">
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ left: 12, right: 12, top: 8, bottom: 8 }}
        >
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            interval="preserveStartEnd"
            tickFormatter={(value: string) => {
              if (value.length <= 10) return value;
              return `${value.slice(0, 7)}…`;
            }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent nameKey="count" labelFormatter={(value) => String(value)} />
            }
          />
          {Number.isFinite(effectiveThreshold) && effectiveThreshold > 0 && (
            <ReferenceLine
              y={effectiveThreshold}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
            />
          )}
          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive>
            {data.map((entry) => (
              <Cell
                key={entry.date}
                fill={
                  entry.count <= effectiveThreshold ? "var(--color-countLow)" : "var(--color-count)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      {threshold !== undefined && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: "var(--color-count)" }}
              aria-hidden
            />
            通常
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: "var(--color-countLow)" }}
              aria-hidden
            />
            少ない（中央値以下）
          </span>
        </div>
      )}
    </div>
  );
};
