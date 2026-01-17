import { useEffect, useState } from "react";

/**
 * メディアクエリの状態を監視するカスタムフック
 *
 * @param query - メディアクエリ文字列（例: "(min-width: 1024px)"）
 * @returns メディアクエリがマッチするかどうか
 *
 * @example
 * ```tsx
 * const isDesktop = useMediaQuery("(min-width: 1024px)");
 * ```
 */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);

    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // 初期値を設定
    setMatches(mediaQueryList.matches);

    // イベントリスナーを追加
    mediaQueryList.addEventListener("change", handleChange);

    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, [query]);

  return matches;
};
