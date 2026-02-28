"use client";

import * as React from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "../../lib/utils";

/**
 * チャートのデータ系列ごとの設定（ラベル・色など）
 */
export type ChartConfig = {
  [k: string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType<{ className?: string }>;
  } & ({ color?: string; theme?: never } | { color?: never; theme: Record<string, string> });
};

interface ChartContextValue {
  config: ChartConfig;
  chartId: string;
}

const ChartContext = React.createContext<ChartContextValue | null>(null);

/**
 * ChartContainer 内でチャート設定を取得する
 */
export function useChart(): ChartContextValue {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a ChartContainer");
  }
  return context;
}

interface ChartContainerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  config: ChartConfig;
  /** Recharts のチャート要素（例: BarChart）を 1 つ渡す */
  children: React.ReactElement;
}

/**
 * チャートをラップし、config をコンテキストで提供しつつ ResponsiveContainer で表示する
 */
/**
 * config の color を CSS 変数オブジェクトに変換する
 */
function getChartStyleVars(config: ChartConfig): Record<string, string> {
  const entries = Object.entries(config).filter(
    ([, c]) => c.theme !== undefined || c.color !== undefined
  );
  const vars: Record<string, string> = {};
  for (const [key, itemConfig] of entries) {
    const color =
      (itemConfig as { color?: string }).color ??
      (itemConfig as { theme?: Record<string, string> }).theme?.light;
    if (color) {
      vars[`--color-${key}`] = color;
    }
  }
  return vars;
}

const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ id, className, children, config, ...props }, ref) => {
    const uniqueId = React.useId();
    const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
    const value = React.useMemo(() => ({ config, chartId }), [config, chartId]);
    const styleVars = React.useMemo(() => getChartStyleVars(config), [config]);

    return (
      <ChartContext.Provider value={value}>
        <div
          ref={ref}
          className={cn("w-full", className)}
          data-chart={chartId}
          style={styleVars as React.CSSProperties}
          {...props}
        >
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      </ChartContext.Provider>
    );
  }
);
ChartContainer.displayName = "ChartContainer";

/** Recharts の Tooltip をそのままラップ（ChartTooltipContent と組み合わせて使う） */
export const ChartTooltip = Tooltip;

interface ChartTooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean;
  payload?: unknown[];
  label?: unknown;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  nameKey?: string;
  labelKey?: string;
  labelFormatter?: (value: unknown, payload: unknown[]) => React.ReactNode;
  formatter?: (
    value: unknown,
    name: string,
    item: unknown,
    index: number,
    payload: unknown
  ) => React.ReactNode;
}

/**
 * ツールチップの内容。useChart() で config を参照しラベル・色を表示する
 */
export const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  function ChartTooltipContent(
    {
      active,
      payload,
      className,
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      formatter,
      nameKey,
      labelKey,
      ...props
    },
    ref
  ) {
    const { config } = useChart();

    if (!active || !payload?.length) {
      return null;
    }

    const [item] = payload as {
      name?: string;
      dataKey?: string;
      value?: number;
      payload?: Record<string, unknown>;
      color?: string;
      fill?: string;
    }[];
    const key = String(nameKey ?? item?.dataKey ?? item?.name ?? "value");
    const itemConfig = config[key];
    const displayLabel = (itemConfig?.label as string) ?? item?.name ?? key;

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg border border-border/50 bg-background px-3 py-2 text-sm shadow-md",
          className
        )}
        {...props}
      >
        {!hideLabel && (
          <div className="mb-1 font-medium text-muted-foreground">
            {labelFormatter && label !== undefined ? labelFormatter(label, payload) : displayLabel}
          </div>
        )}
        {payload.map((p, index) => {
          const pk = String(
            nameKey ??
              (p as { name?: string }).name ??
              (p as { dataKey?: string }).dataKey ??
              "value"
          );
          const pc = config[pk];
          const pLabel = (pc?.label as string) ?? (p as { name?: string }).name ?? pk;
          const pValue = (p as { value?: number }).value;
          const pColor = (p as { fill?: string }).fill ?? (p as { color?: string }).color;
          return (
            <div key={pk} className="flex items-center gap-2">
              {!hideIndicator && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: pColor ?? `var(--color-${pk})` }}
                />
              )}
              <span>{pLabel}</span>
              {pValue !== undefined && (
                <span className="font-mono font-medium tabular-nums">
                  {formatter
                    ? formatter(pValue, pk, p, index, (p as { payload?: unknown }).payload)
                    : pValue.toLocaleString()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }
);

export { ChartContainer };
