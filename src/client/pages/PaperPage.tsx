import { ExternalLink, FileQuestion, FileText, Loader2 } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BackToListLink } from "../components/BackToListLink";
import { PaperDetail } from "../components/PaperDetail";
import { Button } from "../components/ui/button";
import { usePaperSummary } from "../hooks/usePaperSummary";
import { ARXIV_ID_PATTERN } from "../lib/arxivId";
import { subscribeDbChanges, subscribeResume } from "../lib/dbChangeChannel";
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
 * （保存済み論文の全件読み込みを待たず、未読み込みを「保存されていない」と誤判定しない）。
 * DB にも無い場合は、無効IDと未保存IDを区別して表示する（Issue #67）。
 */
export const PaperPage: FC = () => {
  // 旧形式の ID（math.GT/0309136）はスラッシュを含むため、ルート /papers/:id/* の後続セグメントをつなぐ（Issue #108）
  // 末尾のスラッシュ（/papers/2512.18131/ や、%2F が / に戻った /papers/2512.18131%2F）は ID に含めない
  const { id: head, "*": rest } = useParams();
  const id = (head !== undefined && rest ? `${head}/${rest}` : head)?.replace(/\/+$/, "");
  // 保存時に版番号 vN を除いているため、検索時だけ除く（arXiv へのリンクは元の id を使う）
  const storedId = id?.replace(/v\d+$/, "");
  const storePaper = usePaperStore((s) =>
    storedId ? s.papers.find((p) => p.id === storedId) : undefined
  );
  const db = usePaperStore((s) => s._db);
  // API利用OFF中は自動要約を発火させない（設定値は保持し、ONに戻すと再開する）
  const autoGenerateSummary = useSettingsStore((s) => s.autoGenerateSummary && s.apiEnabled);

  const [lookup, setLookup] = useState<StoredPaperLookup | null>(null);
  /** IndexedDB からの読み直し回数（失敗時の再試行用） */
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const needsLookup = storedId !== undefined && storePaper === undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: lookupAttempt は再試行で読み直すための依存
  useEffect(() => {
    if (!needsLookup || !db) return;
    let cancelled = false;
    setLookup({ id: storedId, status: "loading" });
    db.papers
      .get(storedId)
      .then((stored) => {
        if (cancelled) return;
        setLookup(
          stored
            ? { id: storedId, status: "found", paper: toPaperListItem(stored) }
            : { id: storedId, status: "not-found" }
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLookup({
          id: storedId,
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [needsLookup, db, storedId, lookupAttempt]);

  // 読み込みに失敗している間も、別タブでこの論文が保存されたら読み直す（Issue #127）
  // 一覧の読み込みも失敗している場合、別タブの保存は一覧に反映されないため
  const lookupFailed = lookup !== null && lookup.id === storedId && lookup.status === "error";
  useEffect(() => {
    if (!lookupFailed || !db || storedId === undefined) return;
    const unsubscribeChanges = subscribeDbChanges(db, "papers", ({ paperIds }) => {
      if (paperIds.includes(storedId)) setLookupAttempt((n) => n + 1);
    });
    // bfcache・長く背面にいた間は通知が届かないことがあるため、復帰時にもこの1件を読み直す
    const unsubscribeResume = subscribeResume(() => setLookupAttempt((n) => n + 1));
    return () => {
      unsubscribeChanges();
      unsubscribeResume();
    };
  }, [lookupFailed, db, storedId]);

  // 現在の ID に対する読み込み結果だけを使う
  const currentLookup = lookup !== null && lookup.id === storedId ? lookup : null;
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
    versions,
    adoptVersion,
    discardVersion,
    saveCorrection,
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
            onSaveSummaryCorrection={saveCorrection}
          />
        </div>
      </div>
    </div>
  );
};
