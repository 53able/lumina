import { X } from "lucide-react";
import type { FC } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { getCategoryDescription } from "@/client/lib/categoryDescriptions";
import { cn } from "@/client/lib/utils";

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
}

/**
 * CategoryFilter - 論文のカテゴリ絞り込みコンポーネント
 *
 * spec 12章「UI構成」に基づく機能:
 * - カテゴリバッジのトグル選択
 * - 複数選択可能
 * - 選択状態の視覚的フィードバック
 */
export const CategoryFilter: FC<CategoryFilterProps> = ({
  availableCategories,
  selectedCategories,
  onToggle,
  onClear,
}) => {
  // カテゴリがない場合は何も表示しない
  if (availableCategories.length === 0) {
    return null;
  }

  const hasSelection = selectedCategories.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground/60 text-xs mr-1">絞り込み:</span>

      {availableCategories.map((category) => {
        const isSelected = selectedCategories.has(category);
        const description = getCategoryDescription(category);

        return (
          <Tooltip key={category}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggle(category)}
                className="focus:outline-none"
              >
                <Badge
                  variant={isSelected ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer transition-all hover:scale-105",
                    isSelected
                      ? "bg-primary/90 hover:bg-primary"
                      : "hover:bg-accent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {category}
                </Badge>
              </button>
            </TooltipTrigger>
            {description && (
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-xs">{description}</p>
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}

      {/* クリアボタン */}
      {hasSelection && onClear && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-5 px-1.5 text-muted-foreground hover:text-foreground ml-1"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};
