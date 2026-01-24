/**
 * React Fast Refreshのpreambleスクリプトを生成
 *
 * SSR環境では自動注入されないため、手動で注入する必要がある。
 * 開発環境でのみ注入される。
 *
 * Viteミドルウェアモードでは、すべてのアセットが同じサーバーから配信されるため、
 * 相対パス（/@react-refresh）を使用する。
 *
 * @returns preambleスクリプトのHTML文字列（開発環境の場合）、空文字列（本番環境の場合）
 */
export const generatePreambleScript = (): string => {
  if (process.env.NODE_ENV === "production") {
    return "";
  }

  // Viteミドルウェアモードでは同一オリジンから配信されるため相対パスを使用
  return `<script type="module">
(async () => {
	try {
		const RefreshRuntime = await import('/@react-refresh');
		RefreshRuntime.injectIntoGlobalHook(window);
		window.$RefreshReg$ = () => {};
		window.$RefreshSig$ = () => (type) => type;
		window.__vite_plugin_react_preamble_installed__ = true;
	} catch (e) {
		console.warn('[SSR] Fast Refresh preamble injection failed:', e);
	}
})();
</script>`;
};
