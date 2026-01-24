import type { FC } from "react";

/**
 * HTMLテンプレートコンポーネント
 *
 * SSRで使用するHTMLの基本構造を定義します。
 * 初期データを`window.__INITIAL_DATA__`に埋め込みます。
 */
export interface HtmlTemplateProps {
  /**
   * ビルドされたアセットのパス
   */
  assets?: {
    css?: string[];
    js?: string[];
  };
}

/**
 * HTMLテンプレート
 *
 * @param props - HTMLテンプレートのプロパティ
 * @returns HTML文字列
 */
export const HtmlTemplate: FC<HtmlTemplateProps> = ({ assets }) => {
  const cssLinks = assets?.css?.map((href) => <link key={href} rel="stylesheet" href={href} />);
  const jsScripts = assets?.js?.map((src) => <script key={src} type="module" src={src} />);

  return (
    <html lang="ja">
      <head>
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/lumina.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta
          name="description"
          content="arXiv論文をセマンティック検索で探索できるオフライン対応の研究支援ツール"
        />
        <title>Lumina - AI-Powered Paper Search</title>
        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {cssLinks}
      </head>
      <body>
        <div id="root"></div>
        {jsScripts}
      </body>
    </html>
  );
};
