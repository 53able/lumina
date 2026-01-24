import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server.edge";
import { StaticRouter } from "react-router";
import { App } from "@/client/App";
import { InteractionProvider } from "@/client/contexts/InteractionContext";
import type { InitialData } from "./dataLoader";
import { HtmlTemplate } from "./html";
import {
  generateDebugScript,
  generateInitialDataScript,
  generatePreambleScript,
} from "./scripts/index";

/**
 * SSRレンダラーのオプション
 */
export interface SSRRenderOptions {
  /**
   * リクエストパス
   */
  pathname: string;
  /**
   * 初期データ
   */
  initialData?: InitialData;
  /**
   * ビルドされたアセットのパス
   */
  assets?: {
    css?: string[];
    js?: string[];
  };
}

/**
 * ReactアプリをSSRでレンダリング
 *
 * @param options - SSRレンダラーのオプション
 * @returns レンダリングされたHTML文字列
 */
export const renderSSR = (options: SSRRenderOptions): string => {
  // SSR環境で古いJSXトランスフォームに備えて React をグローバルに公開しておく
  // （App.tsx 側がグローバル React を参照するケースに対応）
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { pathname, initialData, assets } = options;

  // React RouterのStaticRouterを使用してサーバー側でルーティング
  // クライアントと同様に QueryClientProvider / InteractionProvider でラップ
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const appHtml = renderToString(
    <StaticRouter location={pathname}>
      <QueryClientProvider client={queryClient}>
        <InteractionProvider>
          <App />
          {/* ToasterはSSR環境ではレンダリングしない（ハイドレーションエラー回避） */}
        </InteractionProvider>
      </QueryClientProvider>
    </StaticRouter>
  );

  // HTMLテンプレートに埋め込む
  // renderToStringを使用してハイドレーション可能なHTMLを生成
  const html = renderToString(<HtmlTemplate assets={assets} />);

  // スクリプトを生成（文字列操作で挿入することでdangerouslySetInnerHTMLの警告を回避）
  const preambleScript = generatePreambleScript();
  const initialDataScript = generateInitialDataScript(initialData);
  const debugScript = generateDebugScript();

  // appHtmlを<div id="root">の中に挿入（dangerouslySetInnerHTMLの警告を回避）
  const ROOT_DIV_OPEN = '<div id="root">';
  const ROOT_DIV_CLOSE = "</div>";
  const rootDivOpenIndex = html.indexOf(ROOT_DIV_OPEN);

  if (rootDivOpenIndex === -1) {
    // root divが見つからない場合はエラー
    throw new Error("Root div not found in HTML template");
  }

  const rootDivCloseIndex = html.indexOf(ROOT_DIV_CLOSE, rootDivOpenIndex);
  if (rootDivCloseIndex === -1) {
    // root divの閉じタグが見つからない場合はエラー
    throw new Error("Root div close tag not found in HTML template");
  }

  // <div id="root">と</div>の間にappHtmlを挿入
  const htmlBeforeRoot = html.slice(0, rootDivOpenIndex + ROOT_DIV_OPEN.length);
  const htmlAfterRoot = html.slice(rootDivCloseIndex);

  // </div>の後にinitialDataスクリプトとデバッグスクリプトを挿入
  const scriptsToInsert = (initialDataScript ?? "") + debugScript;
  const htmlWithAppAndScripts =
    htmlBeforeRoot + appHtml + ROOT_DIV_CLOSE + scriptsToInsert + htmlAfterRoot;

  // preambleスクリプトを<body>タグの直後に挿入
  const BODY_TAG = "<body>";
  const bodyTagIndex = htmlWithAppAndScripts.indexOf(BODY_TAG);

  if (bodyTagIndex === -1) {
    // body tagが見つからない場合はエラー
    throw new Error("Body tag not found in HTML template");
  }

  const htmlWithPreamble =
    htmlWithAppAndScripts.slice(0, bodyTagIndex + BODY_TAG.length) +
    preambleScript +
    htmlWithAppAndScripts.slice(bodyTagIndex + BODY_TAG.length);

  // DOCTYPEを追加
  return `<!doctype html>${htmlWithPreamble}`;
};
