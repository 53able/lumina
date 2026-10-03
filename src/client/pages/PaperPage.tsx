import { FileQuestion, Loader2 } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BackToListLink } from "../components/BackToListLink";
import { PaperDetail } from "../components/PaperDetail";
import { Button } from "../components/ui/button";
import { usePaperSummary } from "../hooks/usePaperSummary";
import { type PaperListItem, toPaperListItem } from "../lib/paperIndex/core";
import { showSummaryErrorToast } from "../lib/summaryErrors";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";

/** IndexedDB から1件を読む状態（一覧にまだ読み込まれていない論文用） */
type StoredPaperLookup =
  | { id: string; status: "loading" }
  | { id: string; status: "found"; paper: PaperListItem }
  | { id: string; status: "not-found" }
  | { id: string; status: "error"; error: Error };

/**
 * PaperPage - 論文単一ページ
 *
 * URLパラメータから論文IDを取得し、詳細を表示する。
 * オブジェクト指向UIの「シングルビュー」パターン。
 *
 * 一覧（paperStore）にまだ読み込まれていない論文は IndexedDB から1件だけ読む
 * （保存済み論文の全件読み込みを待たず、未読み込みを「論文が見つかりません」と誤判定しない）。
 */
export const PaperPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const storePaper = usePaperStore((s) => (id ? s.papers.find((p) => p.id === id) : undefined));
  const db = usePaperStore((s) => s._db);
  // API利用OFF中は自動要約を発火させない（設定値は保持し、ONに戻すと再開する）
  const autoGenerateSummary = useSettingsStore((s) => s.autoGenerateSummary && s.apiEnabled);

  const [lookup, setLookup] = useState<StoredPaperLookup | null>(null);
  /** IndexedDB からの読み直し回数（失敗時の再試行用） */
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const needsLookup = id !== undefined && storePaper === undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: lookupAttempt は再試行で読み直すための依存
  useEffect(() => {
    if (!needsLookup || !db) return;
    let cancelled = false;
    setLookup({ id, status: "loading" });
    db.papers
      .get(id)
      .then((stored) => {
        if (cancelled) return;
        setLookup(
          stored
            ? { id, status: "found", paper: toPaperListItem(stored) }
            : { id, status: "not-found" }
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLookup({
          id,
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [needsLookup, db, id, lookupAttempt]);

  // 現在の ID に対する読み込み結果だけを使う
  const currentLookup = lookup !== null && lookup.id === id ? lookup : null;
  const paper: PaperListItem | undefined =
    storePaper ?? (currentLookup?.status === "found" ? currentLookup.paper : undefined);
  // DB 未初期化・読み込み中は「見つからない」と判定しない
  const isLookingUp =
    paper === undefined &&
    id !== undefined &&
    (db === null || currentLookup === null || currentLookup.status === "loading");

  // サマリー管理（カスタムフックに責務を委譲）
  const {
    summary,
    summaryLanguage,
    setSummaryLanguage,
    isLoading,
    error,
    failedTarget,
    generateSummary,
  } = usePaperSummary({
    paperId: paper?.id ?? "",
    abstract: paper?.abstract ?? "",
    onError: (err, paperId, target) => {
      console.error("Summary generation error:", err);
      // 生成中に別の論文へ移動している場合があるため、どの論文の失敗かを示す
      const title =
        usePaperStore.getState().getPaperById(paperId)?.title ??
        (paper?.id === paperId ? paper.title : undefined);
      showSummaryErrorToast(err, title, target);
    },
  });

  // 一覧に未読み込みの論文を IndexedDB から読んでいる間
  if (isLookingUp) {
    return (
      <div className="min-h-dvh bg-background bg-gradient-lumina">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <BackToListLink className="mb-8" />
          <output
            className="flex flex-col items-center justify-center gap-3 py-16"
            aria-live="polite"
            data-testid="paper-page-loading"
          >
            <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />
            <span className="text-sm font-bold text-muted-foreground">論文を読み込み中...</span>
          </output>
        </div>
      </div>
    );
  }

  // IndexedDB から読めなかった場合（見つからないとは区別し、再試行できるようにする）
  if (!paper && currentLookup?.status === "error") {
    return (
      <div className="min-h-dvh bg-background bg-gradient-lumina">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <BackToListLink className="mb-8" />
          <div className="flex flex-col items-center justify-center gap-6 py-16" role="alert">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">論文を読み込めませんでした</h1>
              <p className="break-all text-sm text-muted-foreground">
                詳細: {currentLookup.error.message}
              </p>
            </div>
            <Button onClick={() => setLookupAttempt((n) => n + 1)}>再試行</Button>
          </div>
        </div>
      </div>
    );
  }

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
            summaryError={error}
            summaryFailedTarget={failedTarget}
            selectedSummaryLanguage={summaryLanguage}
            onSummaryLanguageChange={setSummaryLanguage}
            autoGenerateSummary={autoGenerateSummary}
          />
        </div>
      </div>
    </div>
  );
};
