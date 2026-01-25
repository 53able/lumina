import { format } from "date-fns";
import { Bookmark, ExternalLink, Heart } from "lucide-react";
import type { FC } from "react";
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

  const handleCardClick = () => {
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

  // 著者の表示（3人以上の場合は省略）
  const authorsDisplay =
    paper.authors.length > 3
      ? `${paper.authors.slice(0, 3).join(", ")} et al.`
      : paper.authors.join(", ");

  return (
    <Card
      role="article"
      className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
        isExpanded ? "ring-2 ring-primary/50 shadow-lg bg-card/90" : ""
      }`}
      onClick={handleCardClick}
      data-expanded={isExpanded}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2">
          {index !== undefined && (
            <span className="shrink-0 inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-full bg-muted text-xs font-mono font-medium text-muted-foreground">
              #{index + 1}
            </span>
          )}
          <CardTitle className="line-clamp-2 text-lg">{paper.title}</CardTitle>
        </div>
        {whyRead && (
          <p className="text-sm text-primary/80 line-clamp-2 mt-1 font-medium">{whyRead}</p>
        )}
        <p className="text-sm text-muted-foreground">{authorsDisplay}</p>
      </CardHeader>
      <CardContent>
        {/* カテゴリバッジ（ツールチップ付き） */}
        <div className="mb-3 flex flex-wrap gap-1">
          {paper.categories.map((category) => {
            const description = getCategoryDescription(category);
            return description ? (
              <Tooltip key={category}>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="cursor-help">
                    {category}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p>{description}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Badge key={category} variant="secondary">
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
              className="h-8 w-8"
              onClick={handleLikeClick}
              aria-label="いいね"
              data-liked={isLiked}
            >
              <Heart className={`h-4 w-4 ${isLiked ? "fill-current text-red-500" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleBookmarkClick}
              aria-label="ブックマーク"
              data-bookmarked={isBookmarked}
            >
              <Bookmark
                className={`h-4 w-4 ${isBookmarked ? "fill-current text-yellow-500" : ""}`}
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
    </Card>
  );
};
