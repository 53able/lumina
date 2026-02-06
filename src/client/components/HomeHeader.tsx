import { Settings, Sparkles } from "lucide-react";
import type { FC } from "react";
import { SyncButton } from "./SyncButton";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * HomeHeader のProps
 */
interface HomeHeaderProps {
  /** 設定ダイアログを開く */
  onOpenSettings: () => void;
  /** 同期中かどうか */
  isSyncing: boolean;
  /** 同期を実行する */
  onSync: () => void;
}

/**
 * HomeHeader - ホームページのヘッダーコンポーネント
 *
 * 責務:
 * - ロゴ・タイトルの表示
 * - 同期ボタン
 * - 設定ボタン
 */
export const HomeHeader: FC<HomeHeaderProps> = ({
  onOpenSettings,
  isSyncing,
  onSync,
}) => {
  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-md supports-backdrop-filter:bg-background/60">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-4 gap-4 sm:px-6">
        {/* 左側: 空（バランス用） */}
        <div className="flex items-center justify-start">
          {/* モバイルでは何も表示しない、デスクトップでも空 */}
        </div>

        {/* 中央: ロゴ・タイトル - グローエフェクト（スマホ時はサイズ縮小で省略なし・縦揃え） */}
        <div className="flex min-w-0 items-center justify-center gap-2 sm:gap-3 glow-effect">
          <div className="relative flex shrink-0 items-center justify-center">
            <Sparkles
              className="h-6 w-6 sm:h-8 sm:w-8 text-primary animate-glow"
              style={{ filter: "drop-shadow(0 0 8px hsl(var(--primary) / 0.6))" }}
            />
            <div className="absolute inset-0 blur-xl bg-primary/30 rounded-full animate-pulse-glow" />
          </div>
          <div className="flex min-w-0 items-baseline gap-2 sm:gap-3">
            <h1 className="min-w-0 shrink-0 text-lg font-bold leading-tight sm:text-2xl sm:leading-tight whitespace-nowrap">
              <span className="bg-linear-to-r from-primary via-primary/80 to-primary-light bg-clip-text text-transparent">
                Lumina
              </span>
            </h1>
            <span
              className="shrink-0 text-[10px] font-mono font-bold uppercase leading-none tracking-wider sm:text-xs"
              style={{
                color: "hsl(var(--primary-dark))",
                opacity: 0.8,
                letterSpacing: "0.15em",
              }}
            >
              BETA
            </span>
            <span
              className="hidden sm:inline text-sm font-mono text-rotate-slight font-bold"
              style={{ opacity: 0.7 }}
            >
              arXiv論文セマンティック検索
            </span>
          </div>
        </div>

        {/* 右側: 同期・設定ボタン（画面右端） */}
        <div className="flex items-center gap-2 justify-end">
          <SyncButton isSyncing={isSyncing} onSync={onSync} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenSettings}
                aria-label="設定"
                className="hover:bg-muted/50"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>設定</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
};
