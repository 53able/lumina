import type { FC, MouseEvent } from "react";
import { PAPER_LIST_ID } from "./PaperList";
import { PAPER_SEARCH_INPUT_ID } from "./PaperSearch";

/** スキップリンクの移動先（id と表示名） */
const SKIP_TARGETS = [
  { id: PAPER_SEARCH_INPUT_ID, label: "検索へ移動" },
  { id: PAPER_LIST_ID, label: "論文一覧へ移動" },
] as const;

/**
 * 移動先にフォーカスする。
 * フラグメントへの移動だけでは、フォーカスできない要素（一覧の領域）へフォーカスが移らないブラウザがあり、
 * URL の # も検索クエリ（?q=）と一緒に履歴へ残るため、既定の動作を止めて直接フォーカスする。
 * 移動先がない場合（描画前など）も既定の動作は止め、何もしない（# を付けて React Router の location とずらさない）。
 */
const focusTarget = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
  event.preventDefault();
  document.getElementById(id)?.focus();
};

/**
 * SkipLinks - ページ先頭のスキップリンク（#68）
 *
 * デスクトップではサイドバー（同期の操作・検索履歴・「さらに表示」）が DOM 上で検索欄より前にあり、
 * 見た目の順（左のサイドバー → 右の検索・一覧）と Tab の順を一致させている。
 * 検索欄・論文一覧へは、ヘッダーとサイドバーを通らずにこのリンクから移動する。
 *
 * - ページで最初の Tab の到達先になるよう、ヘッダーより前に置く
 * - フォーカスされるまでは画面の外に置く（読み上げの対象には残す）。フォーカス時だけ左上に表示する
 */
export const SkipLinks: FC = () => (
  <>
    {SKIP_TARGETS.map(({ id, label }) => (
      <a
        key={id}
        href={`#${id}`}
        onClick={(event) => focusTarget(event, id)}
        className="fixed left-4 top-4 z-60 -translate-y-[300%] rounded-md border border-primary bg-background px-4 py-2 text-sm font-bold text-foreground shadow-lg outline-none focus:translate-y-0 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {label}
      </a>
    ))}
  </>
);
