import type { FC } from "react";

/**
 * HomeFooter - ホームページのフッターコンポーネント
 *
 * 責務:
 * - フッター情報の表示
 */
export const HomeFooter: FC = () => {
  return (
    <footer className="sticky bottom-0 z-40 border-t border-border/30 py-5 text-center text-xs text-muted-foreground/40 bg-background/80 backdrop-blur-md">
      <p>Built with 💜 for researchers</p>
      <p className="mt-1.5">
        Thank you to{" "}
        <a
          href="https://arxiv.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/20 underline-offset-2 hover:text-foreground/60 hover:decoration-foreground/40 transition-colors"
        >
          arXiv
        </a>{" "}
        for use of its open access interoperability.
      </p>
    </footer>
  );
};
