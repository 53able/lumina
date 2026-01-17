import { format } from "date-fns";
import { Bookmark, ExternalLink, FileText, Heart } from "lucide-react";
import type { FC } from "react";
import { type GenerateTarget, PaperSummary } from "@/client/components/PaperSummary";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import type { Paper, PaperSummary as PaperSummaryType } from "@/shared/schemas";

/**
 * PaperDetail コンポーネントのProps
 */
interface PaperDetailProps {
  /** 論文データ */
  paper: Paper;
  /** いいねボタンクリック時のコールバック */
  onLike?: (paperId: string) => void;
  /** ブックマークボタンクリック時のコールバック */
  onBookmark?: (paperId: string) => void;
  /** いいね済みフラグ */
  isLiked?: boolean;
  /** ブックマーク済みフラグ */
  isBookmarked?: boolean;
  /** 論文要約データ */
  summary?: PaperSummaryType;
  /** 要約生成時のコールバック（target: 生成対象） */
  onGenerateSummary?: (paperId: string, language: "ja" | "en", target: GenerateTarget) => void;
  /** 要約ローディング状態 */
  isSummaryLoading?: boolean;
  /** 選択中の言語 */
  selectedSummaryLanguage?: "ja" | "en";
  /** 言語切替時のコールバック */
  onSummaryLanguageChange?: (language: "ja" | "en") => void;
  /** 自動要約生成が有効か */
  autoGenerateSummary?: boolean;
}

/**
 * PaperDetail - 論文詳細コンポーネント
 *
 * Design Docsに基づく機能:
 * - 論文の詳細情報（タイトル、著者全員、アブストラクト全文）
 * - カテゴリ、公開日、更新日
 * - PDF/arXivへのリンク
 * - いいね/ブックマークボタン
 * - 閉じるボタン
 */
export const PaperDetail: FC<PaperDetailProps> = ({
  paper,
  onLike,
  onBookmark,
  isLiked = false,
  isBookmarked = false,
  summary,
  onGenerateSummary,
  isSummaryLoading = false,
  selectedSummaryLanguage = "ja",
  onSummaryLanguageChange,
  autoGenerateSummary = false,
}) => {
  const handleLikeClick = () => {
    onLike?.(paper.id);
  };

  const handleBookmarkClick = () => {
    onBookmark?.(paper.id);
  };

  return (
    <div className="p-6 space-y-6">
      {/* ヘッダー */}
      <header>
        {/* タイトル */}
        <h2 className="text-xl font-semibold leading-tight">{paper.title}</h2>

        {/* 著者（全員表示） */}
        <p className="mt-2 text-sm text-muted-foreground">{paper.authors.join(", ")}</p>

        {/* カテゴリバッジ */}
        <div className="flex flex-wrap gap-1 mt-3">
          {paper.categories.map((category) => (
            <Badge key={category} variant="secondary">
              {category}
            </Badge>
          ))}
        </div>
      </header>

      {/* コンテンツ */}
      <div className="space-y-4">
        {/* アブストラクト */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Abstract</h3>
          <p className="text-sm leading-relaxed">{paper.abstract}</p>
        </div>

        {/* AI要約セクション */}
        <div className="border-t pt-4">
          <PaperSummary
            paperId={paper.id}
            summary={summary}
            selectedLanguage={selectedSummaryLanguage}
            isLoading={isSummaryLoading}
            onGenerate={onGenerateSummary}
            onLanguageChange={onSummaryLanguageChange}
            autoGenerate={autoGenerateSummary}
          />
        </div>

        {/* 日付情報 */}
        <div className="flex gap-6 text-sm text-muted-foreground">
          <span>公開日: {format(paper.publishedAt, "yyyy-MM-dd")}</span>
          <span>更新日: {format(paper.updatedAt, "yyyy-MM-dd")}</span>
        </div>

        {/* アクションボタン */}
        <div className="flex items-center justify-between border-t pt-4">
          {/* リンク */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={paper.pdfUrl} target="_blank" rel="noopener noreferrer">
                <FileText className="mr-1 h-4 w-4" />
                PDF
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={paper.arxivUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" />
                arXiv
              </a>
            </Button>
          </div>

          {/* いいね/ブックマーク */}
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLikeClick}
              aria-label="いいね"
              data-liked={isLiked}
            >
              <Heart className={`h-5 w-5 ${isLiked ? "fill-current text-red-500" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBookmarkClick}
              aria-label="ブックマーク"
              data-bookmarked={isBookmarked}
            >
              <Bookmark
                className={`h-5 w-5 ${isBookmarked ? "fill-current text-yellow-500" : ""}`}
              />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
