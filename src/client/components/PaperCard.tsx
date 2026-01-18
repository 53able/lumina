import { format } from "date-fns";
import { Bookmark, Heart } from "lucide-react";
import type { FC } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { getCategoryDescription } from "@/client/lib/categoryDescriptions";
import type { Paper } from "@/shared/schemas";

/**
 * PaperCard コンポーネントのProps
 */
interface PaperCardProps {
  /** 論文データ */
  paper: Paper;
  /** カードクリック時のコールバック */
  onClick?: (paper: Paper) => void;
  /** いいねボタンクリック時のコールバック */
  onLike?: (paperId: string) => void;
  /** ブックマークボタンクリック時のコールバック */
  onBookmark?: (paperId: string) => void;
  /** いいね済みフラグ */
  isLiked?: boolean;
  /** ブックマーク済みフラグ */
  isBookmarked?: boolean;
  /** なぜ読むべきか（1行キャッチコピー） */
  whyRead?: string;
  /** 展開中フラグ */
  isExpanded?: boolean;
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
  onLike,
  onBookmark,
  isLiked = false,
  isBookmarked = false,
  whyRead,
  isExpanded = false,
}) => {
  const handleCardClick = () => {
    onClick?.(paper);
  };

  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onLike?.(paper.id);
  };

  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onBookmark?.(paper.id);
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
        <CardTitle className="line-clamp-2 text-lg">{paper.title}</CardTitle>
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
