import { X } from "lucide-react";
import { type FC, useId, useState } from "react";
import { getCategoryDescription, getCategoryName } from "../lib/categoryDescriptions";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** この件数を超えるカテゴリがあるとき、名前・コードで探す欄を出す */
const CATEGORY_SEARCH_MIN_COUNT = 6;

/**
 * CategoryFilter コンポーネントのProps
 */
interface CategoryFilterProps {
  /** 利用可能なカテゴリ一覧 */
  availableCategories: string[];
  /** 選択中のカテゴリ一覧 */
  selectedCategories: Set<string>;
  /** カテゴリ選択/解除時のコールバック */
  onToggle: (category: string) => void;
  /** 全選択解除時のコールバック */
  onClear?: () => void;
  /** 「絞り込み:」ラベルを非表示にする（コンパクト表示用） */
  hideLabel?: boolean;
  /** カテゴリ一覧の高さの上限（領域内でスクロールする）。既定は max-h-40 */
  listMaxHeightClassName?: string;
}

/**
 * カテゴリがキーワード（コード・分野名のいずれか）に一致するか
 * 説明文は対象外（cs.AI の説明の「機械学習…を除く」のように、対象外の分野名を含むため）
 */
const matchesCategory = (category: string, keyword: string): boolean => {
  const normalized = keyword.trim().toLowerCase();
  if (normalized === "") return true;
  return [category, getCategoryName(category)].some((text) =>
    text?.toLowerCase().includes(normalized)
  );
};

/**
 * CategoryFilter - 論文のカテゴリ絞り込みコンポーネント
 *
 * spec 12章「UI構成」に基づく機能:
 * - カテゴリのトグル選択（コードと日本語の分野名を併記）
 * - 複数選択可能
 * - カテゴリが多いときは名前・コードで探せる（全件をスクロールしなくても選べる）
 */
export const CategoryFilter: FC<CategoryFilterProps> = ({
  availableCategories,
  selectedCategories,
  onToggle,
  onClear,
  hideLabel = false,
  listMaxHeightClassName = "max-h-40",
}) => {
  const [keyword, setKeyword] = useState("");
  const searchInputId = useId();

  // カテゴリがない場合は何も表示しない
  if (availableCategories.length === 0) {
    return null;
  }

  const hasSelection = selectedCategories.size > 0;
  const isSearchable = availableCategories.length > CATEGORY_SEARCH_MIN_COUNT;
  const visibleCategories = isSearchable
    ? availableCategories.filter((category) => matchesCategory(category, keyword))
    : availableCategories;

  return (
    <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0">
      <legend className={hideLabel ? "sr-only" : "text-muted-foreground/60 text-xs mr-1 inline"}>
        {hideLabel ? "カテゴリで絞り込み" : "絞り込み:"}
      </legend>

      {isSearchable ? (
        <>
          <label htmlFor={searchInputId} className="sr-only">
            カテゴリを分野名・コードで探す
          </label>
          <input
            id={searchInputId}
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="分野名・コードで探す（例: 機械学習, cs.CL）"
            autoComplete="off"
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {/* 一致なしは読み上げる（入力中に一覧が空になったことを画面を見ずに分かるように） */}
          <output
            aria-live="polite"
            aria-label="カテゴリの検索結果"
            className="block text-xs text-muted-foreground"
          >
            {visibleCategories.length === 0
              ? `「${keyword.trim()}」に一致するカテゴリはありません`
              : ""}
          </output>
        </>
      ) : null}

      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 overflow-y-auto p-0.5",
          listMaxHeightClassName
        )}
      >
        {visibleCategories.map((category) => {
          const isSelected = selectedCategories.has(category);
          const name = getCategoryName(category);
          const description = getCategoryDescription(category);

          return (
            <Tooltip key={category}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onToggle(category)}
                  aria-pressed={isSelected}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <span className="font-mono font-semibold">{category}</span>
                  {/* 空白で、読み上げ時にコードと分野名を区切る */}
                  {name ? (
                    <>
                      {" "}
                      <span>{name}</span>
                    </>
                  ) : null}
                </button>
              </TooltipTrigger>
              {description ? (
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-xs">{description}</p>
                </TooltipContent>
              ) : null}
            </Tooltip>
          );
        })}

        {/* クリアボタン */}
        {hasSelection && onClear && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            aria-label="絞り込みをすべて解除"
            className="h-6 px-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </fieldset>
  );
};
