import { FileQuestion } from "lucide-react";
import type { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { BackToListLink } from "../components/BackToListLink";
import { PaperDetail } from "../components/PaperDetail";
import { Button } from "../components/ui/button";
import { usePaperSummary } from "../hooks/usePaperSummary";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * PaperPage - 論文単一ページ
 *
 * URLパラメータから論文IDを取得し、詳細を表示する。
 * オブジェクト指向UIの「シングルビュー」パターン。
 */
export const PaperPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const { getPaperById } = usePaperStore();
  const { autoGenerateSummary } = useSettingsStore();

  // 論文を取得
  const paper = id ? getPaperById(id) : undefined;

  // サマリー管理（カスタムフックに責務を委譲）
  const { summary, summaryLanguage, setSummaryLanguage, isLoading, generateSummary } =
    usePaperSummary({
      paperId: paper?.id ?? "",
      abstract: paper?.abstract ?? "",
      onError: (err) => {
        console.error("Summary generation error:", err);
        toast.error("要約生成エラー", {
          description: err.message,
        });
      },
    });

  // 論文が見つからない場合
  if (!paper) {
    return (
      <div className="min-h-dvh bg-background bg-gradient-lumina">
        <div className="mx-auto max-w-3xl px-4 py-8">
          {/* 戻るリンク */}
          <BackToListLink className="mb-8" />

          {/* 404メッセージ */}
          <div className="flex flex-col items-center justify-center gap-6 py-16">
            <div className="rounded-full bg-muted/50 p-6">
              <FileQuestion className="h-12 w-12 text-muted-foreground" />
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">論文が見つかりません</h1>
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
        <BackToListLink className="mb-4" />

        {/* 論文詳細カード */}
        <div className="rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm shadow-sm">
          <PaperDetail
            paper={paper}
            summary={summary}
            onGenerateSummary={(_paperId, language, target) => generateSummary(language, target)}
            isSummaryLoading={isLoading}
            selectedSummaryLanguage={summaryLanguage}
            onSummaryLanguageChange={setSummaryLanguage}
            autoGenerateSummary={autoGenerateSummary}
          />
        </div>
      </div>
    </div>
  );
};
