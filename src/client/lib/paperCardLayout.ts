import { layout, type PreparedText, prepare } from "@chenglou/pretext";
import type { Paper } from "../../shared/schemas/index";

const TITLE_FONT = "700 18px Inter";
const TEXT_FONT = "400 14px Inter";
const TITLE_LINE_HEIGHT = 28;
const TEXT_LINE_HEIGHT = 20;
const TITLE_MAX_LINES = 2;
const WHY_READ_MAX_LINES = 2;

const CARD_OUTER_VERTICAL_PADDING = 48;
const CARD_INNER_HORIZONTAL_PADDING = 48;
const CARD_WRAPPER_HORIZONTAL_PADDING = 24;
const CARD_HEADER_CONTENT_GAP = 8;
const TITLE_INDEX_SPACE = 48;
const WHY_READ_MARGIN_TOP = 8;
const CATEGORY_TOP_MARGIN = 12;
const CATEGORY_ROW_HEIGHT = 28;
const CATEGORY_ROW_GAP = 8;
const ACTION_ROW_HEIGHT = 40;
const EMBEDDING_BADGE_WIDTH = 164;
const MIN_CARD_HEIGHT = 190;
const PRETEXT_UNAVAILABLE_CACHE_LIMIT = 64;

type PreparedCacheKey = `${string}\u0000${string}`;

const preparedCache = new Map<PreparedCacheKey, PreparedText>();
let pretextUnavailable = false;

export interface EstimatePaperCardHeightOptions {
  itemWidth: number;
  whyRead?: string;
  showIndex?: boolean;
}

const getPrepared = (text: string, font: string): PreparedText | null => {
  if (pretextUnavailable) return null;

  const key: PreparedCacheKey = `${font}\u0000${text}`;
  const cached = preparedCache.get(key);
  if (cached) return cached;

  try {
    const prepared = prepare(text, font);
    preparedCache.set(key, prepared);
    return prepared;
  } catch {
    // Tests/server-like environments may not expose canvas. Fall back to deterministic
    // arithmetic while keeping the browser hot path on Pretext.
    pretextUnavailable = true;
    if (preparedCache.size > PRETEXT_UNAVAILABLE_CACHE_LIMIT) preparedCache.clear();
    return null;
  }
};

const estimateAverageCharWidth = (font: string): number => {
  if (font === TITLE_FONT) return 9.5;
  return 7.2;
};

const estimateTextHeight = (
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number => {
  const normalizedWidth = Math.max(1, Math.floor(maxWidth));
  const prepared = getPrepared(text, font);
  const lineCount = prepared
    ? layout(prepared, normalizedWidth, lineHeight).lineCount
    : Math.max(1, Math.ceil((text.length * estimateAverageCharWidth(font)) / normalizedWidth));

  return Math.min(lineCount, maxLines) * lineHeight;
};

const estimateAuthorsText = (authors: string[]): string =>
  authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");

const estimateCategoryWidth = (category: string): number => Math.max(58, category.length * 8 + 26);

const estimateCategoryRows = (paper: Paper, contentWidth: number): number => {
  const maxWidth = Math.max(1, contentWidth);
  let rows = 1;
  let currentWidth = 0;
  const badgeWidths = paper.categories.map(estimateCategoryWidth);
  if (!paper.embedding || paper.embedding.length === 0) badgeWidths.push(EMBEDDING_BADGE_WIDTH);

  for (const width of badgeWidths) {
    const nextWidth = currentWidth === 0 ? width : currentWidth + 8 + width;
    if (nextWidth > maxWidth && currentWidth > 0) {
      rows += 1;
      currentWidth = width;
    } else {
      currentWidth = nextWidth;
    }
  }

  return rows;
};

/**
 * Estimate the normal PaperCard height without reading DOM layout.
 *
 * Pretext performs the expensive text segmentation/measurement once in prepare(), then layout()
 * is pure arithmetic for each width. That makes virtual-row estimates responsive to card width
 * changes without forcing browser reflow for every visible card.
 */
export const estimatePaperCardHeight = (
  paper: Paper,
  { itemWidth, whyRead, showIndex = true }: EstimatePaperCardHeightOptions
): number => {
  const cardWidth = Math.max(1, itemWidth - CARD_WRAPPER_HORIZONTAL_PADDING);
  const contentWidth = Math.max(1, cardWidth - CARD_INNER_HORIZONTAL_PADDING);
  const titleWidth = Math.max(1, contentWidth - (showIndex ? TITLE_INDEX_SPACE : 0));

  const titleHeight = estimateTextHeight(
    paper.title,
    TITLE_FONT,
    titleWidth,
    TITLE_LINE_HEIGHT,
    TITLE_MAX_LINES
  );
  const whyReadHeight = whyRead
    ? WHY_READ_MARGIN_TOP +
      estimateTextHeight(whyRead, TEXT_FONT, contentWidth, TEXT_LINE_HEIGHT, WHY_READ_MAX_LINES)
    : 0;
  const authorsHeight = estimateTextHeight(
    estimateAuthorsText(paper.authors),
    TEXT_FONT,
    contentWidth,
    TEXT_LINE_HEIGHT,
    1
  );
  const categoryRows = estimateCategoryRows(paper, contentWidth);
  const categoriesHeight =
    CATEGORY_TOP_MARGIN +
    categoryRows * CATEGORY_ROW_HEIGHT +
    (categoryRows - 1) * CATEGORY_ROW_GAP;

  return Math.max(
    MIN_CARD_HEIGHT,
    Math.ceil(
      CARD_OUTER_VERTICAL_PADDING +
        titleHeight +
        CARD_HEADER_CONTENT_GAP +
        whyReadHeight +
        authorsHeight +
        categoriesHeight +
        ACTION_ROW_HEIGHT
    )
  );
};
