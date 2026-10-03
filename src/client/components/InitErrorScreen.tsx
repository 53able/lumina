import { ExternalLink, RotateCw } from "lucide-react";
import type { FC } from "react";
import { ARXIV_ID_PATTERN } from "../lib/arxivId";
import { Button } from "./ui/button";

interface InitErrorScreenProps {
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
 * エラーのメッセージやスタックは内部情報を含みうるため表示しない。
 * DB を使わない導線（論文詳細の arXiv リンク）だけを残す。
 */
export const InitErrorScreen: FC<InitErrorScreenProps> = ({ pathname, onReload }) => {
  const arxivId = getArxivIdFromPath(pathname);

  return (
    <main className="min-h-dvh bg-background bg-gradient-lumina">
      <div className="mx-auto max-w-2xl px-4 py-16 space-y-6">
        <h1 className="text-2xl font-bold">Lumina を起動できませんでした</h1>
        <p>
          このブラウザ内に保存したデータ（IndexedDB）を読み込めませんでした。ストレージの空き容量不足、プライベートブラウジングの制限、ブラウザのデータの破損などが考えられます。
        </p>
        <section aria-labelledby="init-error-data-heading" className="space-y-2">
          <h2 id="init-error-data-heading" className="text-lg font-bold">
            保存済みのデータについて
          </h2>
          <p className="text-sm text-muted-foreground">
            論文・要約・検索履歴などはこのブラウザ内に保存されています。この画面が出ても、Lumina
            がデータを削除することはありません。
          </p>
          <p className="text-sm text-muted-foreground">
            再読み込みで直らない場合は、ストレージの空きを確保するか、プライベートブラウジングではない通常のウィンドウで開いてください。ブラウザの設定でこのサイトのデータを削除すると直る場合がありますが、保存済みのデータはすべて失われます。
          </p>
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
