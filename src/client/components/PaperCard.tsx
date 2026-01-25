import { format } from "date-fns";
import { Bookmark, ExternalLink, Heart } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Paper } from "../../shared/schemas/index";
import { useInteraction } from "../contexts/InteractionContext";
import { getCategoryDescription } from "../lib/categoryDescriptions";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * PaperCard コンポーネントのProps
 */
interface PaperCardProps {
  /** 論文データ */
  paper: Paper;
  /** カードクリック時のコールバック */
  onClick?: (paper: Paper) => void;
  /** なぜ読むべきか（1行キャッチコピー） */
  whyRead?: string;
  /** 展開中フラグ */
  isExpanded?: boolean;
  /** カードのインデックス番号（デバッグ/確認用） */
  index?: number;
}

/**
 * PaperCard - 論文カードコンポーネント
 *
 * Design Docsに基づく機能:
 * - 論文タイトル、著者、カテゴリ、公開日の表示
 * - いいね/ブックマークボタン
 */
export const PaperCard: FC<PaperCardProps> = ({
  paper,
  onClick,
  whyRead,
  isExpanded = false,
  index,
}) => {
  // Context経由でいいね/ブックマーク状態を取得
  const { isLiked, isBookmarked, toggleLike, toggleBookmark } = useInteraction(paper.id);
  
  // アニメーション用の状態
  const [isClicking, setIsClicking] = useState(false);
  const [ripplePosition, setRipplePosition] = useState<{ x: number; y: number } | null>(null);

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setRipplePosition({ x, y });
    setIsClicking(true);
    setTimeout(() => {
      setIsClicking(false);
      setRipplePosition(null);
    }, 600);
    onClick?.(paper);
  };

  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleLike();
  };

  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleBookmark();
  };
  
  // いいね/ブックマーク時の大胆なエフェクト用の状態
  const [isLiking, setIsLiking] = useState(false);
  const [isBookmarking, setIsBookmarking] = useState(false);
  
  const handleLikeClickWithEffect = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLiking(true);
    setTimeout(() => setIsLiking(false), 600);
    toggleLike();
  };
  
  const handleBookmarkClickWithEffect = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBookmarking(true);
    setTimeout(() => setIsBookmarking(false), 600);
    toggleBookmark();
  };

  // 著者の表示（3人以上の場合は省略）
  const authorsDisplay =
    paper.authors.length > 3
      ? `${paper.authors.slice(0, 3).join(", ")} et al.`
      : paper.authors.join(", ");

  return (
    <Card
      role="article"
      className={`cursor-pointer card-3d card-glow card-accent-line transition-all duration-300 relative overflow-hidden ${
        isExpanded 
          ? "card-expanded-border shadow-2xl bg-card/90 rotate-0" 
          : "hover:shadow-xl hover:shadow-primary/20 rotate-[-0.5deg] hover:animate-card-flip"
      } ${isClicking ? "scale-105 animate-button-press" : ""}`}
      onClick={handleCardClick}
      data-expanded={isExpanded}
      style={{
        transformStyle: "preserve-3d",
        willChange: "transform, box-shadow",
      }}
    >
      {/* リップルエフェクト */}
      {ripplePosition && (
        <span
          className="animate-ripple absolute rounded-full bg-primary/30 pointer-events-none"
          style={{
            left: `${ripplePosition.x}px`,
            top: `${ripplePosition.y}px`,
            width: "20px",
            height: "20px",
            transform: "translate(-50%, -50%)",
          }}
        />
      )}
      <div className="card-3d-inner">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2">
          {index !== undefined && (
            <span 
              className="shrink-0 inline-flex items-center justify-center h-8 min-w-8 px-2 rounded-md bg-primary/20 text-primary font-mono font-bold text-sm text-dense"
              style={{
                transform: "rotate(-2deg)",
                boxShadow: "0 2px 8px hsl(var(--primary) / 0.3)",
              }}
            >
              #{index + 1}
            </span>
          )}
          <CardTitle className="line-clamp-2 text-lg font-bold text-tight-bold">{paper.title}</CardTitle>
        </div>
        {whyRead && (
          <p className="text-sm line-clamp-2 mt-1 font-medium" style={{ color: "hsl(var(--primary-light))" }}>
            {whyRead}
          </p>
        )}
        <p className="text-sm" style={{ opacity: 0.7 }}>{authorsDisplay}</p>
      </CardHeader>
      <CardContent>
        {/* カテゴリバッジ（ツールチップ付き） - 大胆なスタイリング */}
        <div className="mb-3 flex flex-wrap gap-2">
          {paper.categories.map((category) => {
            const description = getCategoryDescription(category);
            return description ? (
              <Tooltip key={category}>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="secondary" 
                    className="cursor-help font-bold text-xs px-3 py-1 rounded-md border-2 border-primary/30 bg-primary/10 hover:bg-primary/20 transition-all duration-200"
                  >
                    {category}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p>{description}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Badge 
                key={category} 
                variant="secondary"
                className="font-bold text-xs px-3 py-1 rounded-md border-2 border-primary/30 bg-primary/10"
              >
                {category}
              </Badge>
            );
          })}
        </div>

        {/* 公開日とアクションボタン */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {format(paper.publishedAt, "yyyy-MM-dd")}
          </span>

          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 transition-all duration-300 hover:scale-125 active:scale-90 relative ${
                isLiking ? "animate-pulse-glow" : ""
              }`}
              onClick={handleLikeClickWithEffect}
              aria-label="いいね"
              data-liked={isLiked}
            >
              <Heart
                className={`h-4 w-4 transition-all duration-300 ${
                  isLiked 
                    ? "fill-current text-primary scale-125" 
                    : isLiking
                    ? "scale-150 text-primary"
                    : ""
                }`}
                style={{
                  transform: isLiking ? "scale(1.5) rotate(15deg)" : undefined,
                }}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 transition-all duration-300 hover:scale-125 active:scale-90 relative ${
                isBookmarking ? "animate-pulse-glow" : ""
              }`}
              onClick={handleBookmarkClickWithEffect}
              aria-label="ブックマーク"
              data-bookmarked={isBookmarked}
            >
              <Bookmark
                className={`h-4 w-4 transition-all duration-300 ${
                  isBookmarked 
                    ? "fill-current text-primary scale-125" 
                    : isBookmarking
                    ? "scale-150 text-primary"
                    : ""
                }`}
                style={{
                  transform: isBookmarking ? "scale(1.5) rotate(-15deg)" : undefined,
                }}
              />
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  asChild
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link to={`/papers/${paper.id}`} aria-label="詳細ページを開く">
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>詳細ページを開く</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
      </div>
    </Card>
  );
};
