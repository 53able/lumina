import { ExternalLink, RotateCw } from "lucide-react";
import type { FC } from "react";
import { ARXIV_ID_PATTERN } from "../lib/arxivId";
import { Button } from "./ui/button";

/**
 * 画面を出す理由
 * - failed: 初期化が失敗した（Issue #87）
 * - blocked: 他のタブの接続が DB の更新（upgrade）を妨げている（Issue #110）
 * - slow: 一定時間たっても初期化が終わらない（Issue #110）
 */
export type InitScreenReason = "failed" | "blocked" | "slow";

const MESSAGES: Record<InitScreenReason, { heading: string; description: string }> = {
  failed: {
    heading: "Lumina を起動できませんでした",
    description:
      "このブラウザ内に保存したデータ（IndexedDB）を読み込めませんでした。ストレージの空き容量不足、プライベートブラウジングの制限、ブラウザのデータの破損などが考えられます。",
  },
  blocked: {
    heading: "他のタブを閉じてください",
    description:
      "別のタブやウィンドウで開いている Lumina が、このブラウザ内に保存したデータ（IndexedDB）の更新を妨げています。Lumina を開いている他のタブをすべて閉じてください。閉じると起動が続きます。続かない場合は再読み込みしてください。",
  },
  slow: {
    heading: "Lumina の起動に時間がかかっています",
    description:
      "このブラウザ内に保存したデータ（IndexedDB）の読み込みが終わっていません。終わり次第、自動で起動します。Lumina を開いている他のタブがあれば閉じてから、再読み込みしてください。",
  },
};

interface InitErrorScreenProps {
  /** 画面を出す理由（既定は failed） */
  reason?: InitScreenReason;
  /** 開いていたURLのパス（論文詳細なら arXiv への導線を出す） */
  pathname: string;
  /** 再読み込み */
  onReload: () => void;
}

/** パスが論文詳細（/papers/:id）で、IDが arXiv の形式なら ID を返す */
const getArxivIdFromPath = (pathname: string): string | null => {
  const match = /^\/papers\/(.+?)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return ARXIV_ID_PATTERN.test(id) ? id : null;
  } catch {
    return null;
  }
};

/**
 * InitErrorScreen - 起動時にブラウザ内のデータ（IndexedDB）を読み込めなかったときの画面（Issue #87）
 *
 * 読み込みが終わらないとき（他のタブによる blocked、時間切れ）の待機中の表示にも使う（Issue #110）。
 *
 * エラーのメッセージやスタックは内部情報を含みうるため表示しない。
 * DB を使わない導線（論文詳細の arXiv リンク）だけを残す。
 */
export const InitErrorScreen: FC<InitErrorScreenProps> = ({
  reason = "failed",
  pathname,
  onReload,
}) => {
  const arxivId = getArxivIdFromPath(pathname);
  const { heading, description } = MESSAGES[reason];
  const isFailed = reason === "failed";

  return (
    <main className="min-h-dvh bg-background bg-gradient-lumina">
      <div className="mx-auto max-w-2xl px-4 py-16 space-y-6">
        {/* 待機中（blocked / slow）は起動中に切り替わる表示なので、支援技術に変化を伝える。failed は画面全体として読まれるため付けない */}
        <div role={isFailed ? undefined : "status"} className="space-y-6">
          <h1 className="text-2xl font-bold">{heading}</h1>
          <p>{description}</p>
        </div>
        <section aria-labelledby="init-error-data-heading" className="space-y-2">
          <h2 id="init-error-data-heading" className="text-lg font-bold">
            保存済みのデータについて
          </h2>
          <p className="text-sm text-muted-foreground">
            論文・要約・検索履歴などはこのブラウザ内に保存されています。この画面が出ても、Lumina
            がデータを削除することはありません。
          </p>
          {/* サイトデータの削除は元に戻せないため、失敗が確定したときだけ案内する（待機中は待てば直る場合がある） */}
          {isFailed && (
            <p className="text-sm text-muted-foreground">
              再読み込みで直らない場合は、ストレージの空きを確保するか、プライベートブラウジングではない通常のウィンドウで開いてください。ブラウザの設定でこのサイトのデータを削除すると直る場合がありますが、保存済みのデータはすべて失われます。
            </p>
          )}
        </section>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={onReload}>
            <RotateCw className="h-4 w-4" />
            再読み込み
          </Button>
          {arxivId && (
            <Button asChild variant="outline">
              <a
                href={`https://arxiv.org/abs/${arxivId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
                arXiv で開く
              </a>
            </Button>
          )}
        </div>
      </div>
    </main>
  );
};
