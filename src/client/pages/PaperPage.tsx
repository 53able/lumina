import { ExternalLink, FileQuestion, FileText } from "lucide-react";
import type { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { BackToListLink } from "../components/BackToListLink";
import { PaperDetail } from "../components/PaperDetail";
import { Button } from "../components/ui/button";
import { usePaperSummary } from "../hooks/usePaperSummary";
import { ARXIV_ID_PATTERN } from "../lib/arxivId";
import { showSummaryErrorToast } from "../lib/summaryErrors";
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
  // ストア初期化（IndexedDB からのロード）完了前は「見つからない」と判定しない
  const isPaperStoreReady = usePaperStore((s) => !s.isLoading && s._db !== null);
  // API利用OFF中は自動要約を発火させない（設定値は保持し、ONに戻すと再開する）
  const autoGenerateSummary = useSettingsStore((s) => s.autoGenerateSummary && s.apiEnabled);

  // 論文を取得（保存時に版番号 vN を除いているため、検索時だけ除く。arXiv へのリンクは元の id を使う）
  const paper = id ? getPaperById(id.replace(/v\d+$/, "")) : undefined;

  // サマリー管理（カスタムフックに責務を委譲）
  const {
    summary,
    versions,
    adoptVersion,
    discardVersion,
    summaryLanguage,
    setSummaryLanguage,
    isLoading,
    error,
    failedTarget,
    generatingTarget,
    generateSummary,
  } = usePaperSummary({
    paperId: paper?.id ?? "",
    abstract: paper?.abstract ?? "",
    onError: (err, paperId, target) => {
      console.error("Summary generation error:", err);
      // 生成中に別の論文へ移動している場合があるため、どの論文の失敗かを示す
      showSummaryErrorToast(err, getPaperById(paperId)?.title, target);
    },
  });

  // ストアのロード中
  if (!paper && !isPaperStoreReady) {
    return (
      <output className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 animate-loading-bold rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground font-bold">論文を読み込み中...</p>
        </div>
      </output>
    );
  }

  // 論文がこのデバイスに無い場合（無効IDと未保存IDを区別する）
  if (!paper) {
    const isValidId = id !== undefined && ARXIV_ID_PATTERN.test(id);
    return (
      <div className="min-h-dvh bg-background bg-gradient-lumina">
        <div className="mx-auto max-w-3xl px-4 py-8">
          {/* 戻るリンク */}
          <BackToListLink className="mb-8" />

          <div className="flex flex-col items-center justify-center gap-6 py-16">
            <div className="rounded-full bg-muted/50 p-6">
              <FileQuestion className="h-12 w-12 text-muted-foreground" />
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">
                {isValidId
                  ? "この論文はこのデバイスに保存されていません"
                  : "論文IDの形式が正しくありません"}
              </h1>
              <p className="text-muted-foreground">
                ID: <code className="text-xs bg-muted px-2 py-1 rounded">{id}</code>
              </p>
              <p className="text-sm text-muted-foreground mt-4">
                {isValidId
                  ? "Lumina は論文をこのブラウザ内に保存します。別の端末やブラウザで開いた場合や、キャッシュを削除した場合は表示できません。原文は arXiv で読めます。"
                  : "arXiv の論文ID（例: 2512.18131）を含むURLを指定してください。"}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {isValidId && (
                <>
                  <Button asChild variant="outline">
                    <a
                      href={`https://arxiv.org/abs/${id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                      arXiv で開く
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <a
                      href={`https://arxiv.org/pdf/${id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FileText className="h-4 w-4" />
                      PDF を開く
                    </a>
                  </Button>
                </>
              )}
              <Button asChild>
                <Link to="/">論文一覧を見る</Link>
              </Button>
            </div>
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
            summaryError={error}
            summaryFailedTarget={failedTarget}
            summaryGeneratingTarget={generatingTarget}
            selectedSummaryLanguage={summaryLanguage}
            onSummaryLanguageChange={setSummaryLanguage}
            autoGenerateSummary={autoGenerateSummary}
            summaryVersions={versions}
            onAdoptSummaryVersion={adoptVersion}
            onDiscardSummaryVersion={discardVersion}
          />
        </div>
      </div>
    </div>
  );
};
