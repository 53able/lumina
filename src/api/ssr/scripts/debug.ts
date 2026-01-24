/**
 * デバッグスクリプト生成のオプション
 */
export interface DebugScriptOptions {
  /**
   * CSP nonce（本番環境で必須）
   */
  nonce?: string;
}

/**
 * デバッグ用スクリプトを生成
 *
 * SSR環境でのデバッグ情報を収集するためのスクリプト。
 * スクリプトタグの確認、エラー監視、Promise拒否の監視を行う。
 * 本番環境ではCSP nonceを使用してインラインスクリプトを許可する。
 *
 * @param options - デバッグスクリプト生成のオプション
 * @returns デバッグスクリプトのHTML文字列
 */
export const generateDebugScript = (options: DebugScriptOptions = {}): string => {
  const { nonce } = options;
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";

  return `<script${nonceAttr}>
console.log('[SSR Debug] Inline script executed');
// DOMContentLoaded後にスクリプトタグを確認
const checkScripts = () => {
	const scriptTags = document.querySelectorAll('script[type="module"]');
	console.log('[SSR Debug] Module script tags found:', scriptTags.length);
	scriptTags.forEach((tag, idx) => {
		const src = tag.src || tag.getAttribute('src');
		console.log('[SSR Debug] Script', idx, 'src:', src);
		// スクリプトが読み込まれているか確認
	});
};
// 即座にチェック（スクリプトタグが既に存在する場合）
checkScripts();
// DOMContentLoaded後にもチェック
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', checkScripts);
} else {
	// 既に読み込み完了している場合
	setTimeout(checkScripts, 100);
}
// スクリプト読み込みエラーを監視
window.addEventListener('error', (event) => {
	console.error('[SSR Debug] Global error:', event.message, event.filename, event.lineno, event.error);
}, true);
// 未処理のPromise拒否も監視
window.addEventListener('unhandledrejection', (event) => {
	console.error('[SSR Debug] Unhandled rejection:', event.reason);
});
</script>`;
};
