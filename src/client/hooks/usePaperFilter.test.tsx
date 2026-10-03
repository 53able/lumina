/**
 * @vitest-environment jsdom
 *
 * usePaperFilter の URL 更新（絞り込みの解除と検索のクリアの区別）のテスト。
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { usePaperFilter } from "./usePaperFilter";

const renderPaperFilter = (initialUrl: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  };
  return renderHook(() => ({ filter: usePaperFilter(), location: useLocation() }), { wrapper });
};

describe("usePaperFilter", () => {
  it("絞り込みの解除はフィルターとカテゴリだけを消し、検索語 q を保持する（#46）", () => {
    const { result } = renderPaperFilter("/?q=transformer&filter=liked&cat=cs.AI&cat=cs.LG");

    act(() => {
      result.current.filter.clearAllFilters();
    });

    expect(result.current.location.search).toBe("?q=transformer");
    expect(result.current.filter.searchQuery).toBe("transformer");
    expect(result.current.filter.filterMode).toBe("all");
    expect(result.current.filter.selectedCategories.size).toBe(0);
  });

  it("検索のクリアは検索語 q とフィルター・カテゴリをすべて消す", () => {
    const { result } = renderPaperFilter("/?q=transformer&filter=liked&cat=cs.AI&cat=cs.LG");

    act(() => {
      result.current.filter.clearSearchAndFilters();
    });

    expect(result.current.location.search).toBe("");
    expect(result.current.filter.searchQuery).toBeNull();
    expect(result.current.filter.filterMode).toBe("all");
    expect(result.current.filter.selectedCategories.size).toBe(0);
  });
});
