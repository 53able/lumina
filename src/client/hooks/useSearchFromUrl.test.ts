/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSearchFromUrl } from "./useSearchFromUrl";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

describe("useSearchFromUrl", () => {
  it("startSearch の参照が変わっても、urlQuery が変わらなければ検索しない（#81）", () => {
    const activeQueryRef = { current: null as string | null };
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ query, startSearch }) => useSearchFromUrl(query, startSearch, activeQueryRef),
      { initialProps: { query: "", startSearch: first } }
    );

    rerender({ query: "", startSearch: second });

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("startSearch を差し替えた後に urlQuery が変わると、差し替え後の関数で検索する", () => {
    const activeQueryRef = { current: null as string | null };
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ query, startSearch }) => useSearchFromUrl(query, startSearch, activeQueryRef),
      { initialProps: { query: "", startSearch: first } }
    );

    // startSearch だけを差し替える（effect は再実行されない）
    rerender({ query: "", startSearch: second });
    // 次に urlQuery を変えると、ref 経由で最新の startSearch が呼ばれる
    rerender({ query: "transformer", startSearch: second });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith("transformer");
  });
});
