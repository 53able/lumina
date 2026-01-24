import { ArrowLeft } from "lucide-react";
import type { FC } from "react";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils.js";

/**
 * BackToListLink のProps
 */
interface BackToListLinkProps {
  /** 追加のCSSクラス */
  className?: string;
}

/**
 * BackToListLink - 論文一覧へ戻るリンク
 *
 * 論文詳細ページから一覧ページへ戻るためのナビゲーションリンク。
 * DRY原則に基づき共通化。
 */
export const BackToListLink: FC<BackToListLinkProps> = ({ className }) => (
  <Link
    to="/"
    className={cn(
      "inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors",
      className
    )}
  >
    <ArrowLeft className="h-4 w-4" />
    論文一覧へ戻る
  </Link>
);
