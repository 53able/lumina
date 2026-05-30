import { parseISO } from "date-fns";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";

const createPaper = (overrides: Partial<Paper> = {}): Paper => ({
  id: "2401.00001",
  title: "A long multilingual title about transformer inference and efficient layout",
  abstract: "Abstract",
  authors: ["Alice", "Bob", "Carol", "Dave"],
  categories: ["cs.AI", "cs.LG"],
  publishedAt: parseISO("2024-01-01"),
  updatedAt: parseISO("2024-01-01"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
  embedding: Array(10).fill(0.1),
  ...overrides,
});

describe("estimatePaperCardHeight", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("@chenglou/pretext");
  });

  it("Pretext の prepare 結果をキャッシュし、幅変更時は layout だけを再実行する", async () => {
    const prepare = vi.fn((text: string, font: string) => ({ text, font }));
    const layout = vi.fn((_prepared: unknown, maxWidth: number, lineHeight: number) => ({
      lineCount: maxWidth < 220 ? 2 : 1,
      height: maxWidth < 220 ? lineHeight * 2 : lineHeight,
    }));
    vi.doMock("@chenglou/pretext", () => ({ prepare, layout }));

    const { estimatePaperCardHeight } = await import("./paperCardLayout");
    const paper = createPaper();

    const wide = estimatePaperCardHeight(paper, { itemWidth: 420, whyRead: "Worth reading" });
    const narrow = estimatePaperCardHeight(paper, { itemWidth: 260, whyRead: "Worth reading" });

    expect(wide).toBeGreaterThan(0);
    expect(narrow).toBeGreaterThanOrEqual(wide);
    expect(prepare).toHaveBeenCalledTimes(3); // title, whyRead, authors; second call reuses cache
    expect(layout).toHaveBeenCalledTimes(6); // same prepared text, new width arithmetic
  });

  it("canvas が無い環境では Pretext 失敗時も決定的なフォールバック値を返す", async () => {
    vi.doMock("@chenglou/pretext", () => ({
      prepare: vi.fn(() => {
        throw new Error("Text measurement requires OffscreenCanvas or a DOM canvas context.");
      }),
      layout: vi.fn(),
    }));

    const { estimatePaperCardHeight } = await import("./paperCardLayout");
    const height = estimatePaperCardHeight(createPaper(), { itemWidth: 320 });

    expect(height).toBeGreaterThanOrEqual(190);
  });

  it("カテゴリや未設定 embedding バッジが折り返す狭い幅では高さを増やす", async () => {
    const { estimatePaperCardHeight } = await import("./paperCardLayout");
    const paper = createPaper({
      categories: ["cs.AI", "cs.LG", "cs.CL", "stat.ML", "math.OC"],
      embedding: undefined,
    });

    const wide = estimatePaperCardHeight(paper, { itemWidth: 520 });
    const narrow = estimatePaperCardHeight(paper, { itemWidth: 260 });

    expect(narrow).toBeGreaterThan(wide);
  });
});
