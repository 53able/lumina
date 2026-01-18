import { ArrowLeft, FileQuestion } from "lucide-react";
import { type FC, useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PaperDetail } from "@/client/components/PaperDetail";
import { Button } from "@/client/components/ui/button";
import { summaryApi } from "@/client/lib/api";
import { useInteractionStore } from "@/client/stores/interactionStore";
import { usePaperStore } from "@/client/stores/paperStore";
import { useSettingsStore } from "@/client/stores/settingsStore";
import { useSummaryStore } from "@/client/stores/summaryStore";
import type { PaperSummary } from "@/shared/schemas";

/**
 * PaperPage - 論文単一ページ
 *
 * URLパラメータから論文IDを取得し、詳細を表示する。
 * オブジェクト指向UIの「シングルビュー」パターン。
 */
export const PaperPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const { getPaperById } = usePaperStore();
  const { apiKey, autoGenerateSummary } = useSettingsStore();

  // 論文を取得
  const paper = id ? getPaperById(id) : undefined;

  // サマリー関連
  const [summaryLanguage, setSummaryLanguage] = useState<"ja" | "en">("ja");
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const { getSummaryByPaperIdAndLanguage, addSummary } = useSummaryStore();

  // いいね/ブックマーク
  const { toggleLike, toggleBookmark, getLikedPaperIds, getBookmarkedPaperIds } =
    useInteractionStore();
  const likedPaperIds = getLikedPaperIds();
  const bookmarkedPaperIds = getBookmarkedPaperIds();

  // 現在の論文のサマリー
  const currentSummary: PaperSummary | undefined = paper
    ? getSummaryByPaperIdAndLanguage(paper.id, summaryLanguage)
    : undefined;

  // いいねハンドラー
  const handleLike = useCallback(
    (paperId: string) => {
      toggleLike(paperId);
    },
    [toggleLike]
  );

  // ブックマークハンドラー
  const handleBookmark = useCallback(
    (paperId: string) => {
      toggleBookmark(paperId);
    },
    [toggleBookmark]
  );

  // サマリー言語切替
  const handleSummaryLanguageChange = useCallback((language: "ja" | "en") => {
    setSummaryLanguage(language);
  }, []);

  // サマリー生成ハンドラー
  const handleGenerateSummary = useCallback(
    async (
      paperId: string,
      language: "ja" | "en",
      target: "summary" | "explanation" | "both" = "summary"
    ) => {
      if (!paper) return;

      setIsSummaryLoading(true);
      try {
        const newData = await summaryApi(
          paperId,
          { language, abstract: paper.abstract, generateTarget: target },
          { apiKey: apiKey ?? undefined }
        );

        // APIレスポンスの日付を正規化
        const normalizedData: PaperSummary = {
          paperId: newData.paperId,
          summary: newData.summary,
          keyPoints: newData.keyPoints,
          language: newData.language,
          createdAt: new Date(newData.createdAt as unknown as string),
          explanation:
            "explanation" in newData && typeof newData.explanation === "string"
              ? newData.explanation
              : undefined,
          targetAudience:
            "targetAudience" in newData && typeof newData.targetAudience === "string"
              ? newData.targetAudience
              : undefined,
          whyRead:
            "whyRead" in newData && typeof newData.whyRead === "string" ? newData.whyRead : undefined,
        };

        // 説明文のみ生成の場合、既存の要約を維持してマージ
        const existingSummary = getSummaryByPaperIdAndLanguage(paperId, language);
        const mergedSummary: PaperSummary =
          target === "explanation" && existingSummary
            ? {
                ...existingSummary,
                explanation: normalizedData.explanation,
                targetAudience: normalizedData.targetAudience,
                whyRead: normalizedData.whyRead,
              }
            : normalizedData;

        await addSummary(mergedSummary);
      } catch (error) {
        console.error("Summary generation error:", error);
        const message = error instanceof Error ? error.message : "要約の生成に失敗しました";
        toast.error("要約生成エラー", {
          description: message,
        });
      } finally {
        setIsSummaryLoading(false);
      }
    },
    [paper, apiKey, addSummary, getSummaryByPaperIdAndLanguage]
  );

  // 論文が見つからない場合
  if (!paper) {
    return (
      <div className="min-h-dvh bg-background bg-gradient-lumina">
        <div className="mx-auto max-w-3xl px-4 py-8">
          {/* 戻るリンク */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="h-4 w-4" />
            論文一覧へ戻る
          </Link>

          {/* 404メッセージ */}
          <div className="flex flex-col items-center justify-center gap-6 py-16">
            <div className="rounded-full bg-muted/50 p-6">
              <FileQuestion className="h-12 w-12 text-muted-foreground" />
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-semibold">論文が見つかりません</h1>
              <p className="text-muted-foreground">
                ID: <code className="text-xs bg-muted px-2 py-1 rounded">{id}</code>
              </p>
              <p className="text-sm text-muted-foreground mt-4">
                この論文はキャッシュに存在しないか、削除された可能性があります。
              </p>
            </div>
            <Button asChild>
              <Link to="/">論文一覧を見る</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background bg-gradient-lumina">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* 戻るリンク */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          論文一覧へ戻る
        </Link>

        {/* 論文詳細カード */}
        <div className="rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm shadow-sm">
          <PaperDetail
            paper={paper}
            onLike={handleLike}
            onBookmark={handleBookmark}
            isLiked={likedPaperIds.has(paper.id)}
            isBookmarked={bookmarkedPaperIds.has(paper.id)}
            summary={currentSummary}
            onGenerateSummary={handleGenerateSummary}
            isSummaryLoading={isSummaryLoading}
            selectedSummaryLanguage={summaryLanguage}
            onSummaryLanguageChange={handleSummaryLanguageChange}
            autoGenerateSummary={autoGenerateSummary}
          />
        </div>
      </div>
    </div>
  );
};
