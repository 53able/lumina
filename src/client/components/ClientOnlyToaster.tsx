import { useEffect, useState } from "react";
import { Toaster } from "sonner";

/**
 * クライアント側でのみToasterをレンダリングするコンポーネント
 * SSR環境でのハイドレーションエラーを回避するため
 */
export const ClientOnlyToaster: React.FC = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // ハイドレーション完了後にマウント
    setMounted(true);
  }, []);

  // SSR環境では何もレンダリングしない（ハイドレーションエラー回避）
  if (!mounted) {
    return null;
  }

  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        className: "font-sans",
        duration: 4000,
      }}
    />
  );
};
