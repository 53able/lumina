import { Check, RotateCcw } from "lucide-react";
import type { FC } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { CATEGORY_DESCRIPTIONS } from "@/client/lib/categoryDescriptions";
import { useSettingsStore } from "@/client/stores/settingsStore";

/** カテゴリをグループ化するための定義 */
const CATEGORY_GROUPS: Record<string, string[]> = {
  "Computer Science": [
    "cs.AI",
    "cs.LG",
    "cs.CL",
    "cs.CV",
    "cs.NE",
    "cs.RO",
    "cs.SE",
    "cs.CR",
    "cs.DB",
    "cs.DC",
    "cs.HC",
    "cs.IR",
    "cs.PL",
  ],
  Statistics: ["stat.ML", "stat.ME", "stat.TH", "stat.AP", "stat.CO"],
  Mathematics: [
    "math.OC",
    "math.PR",
    "math.ST",
    "math.CO",
    "math.NA",
    "math.IT",
  ],
  Physics: ["quant-ph", "physics.comp-ph", "physics.data-an"],
  "Other Sciences": ["q-bio.NC", "q-bio.QM", "eess.SP", "eess.AS", "econ.EM"],
};

/**
 * CategorySettings - arXivカテゴリ選択コンポーネント
 *
 * 機能:
 * - カテゴリの選択・解除
 * - グループ別表示
 * - デフォルトにリセット
 */
export const CategorySettings: FC = () => {
  const {
    selectedCategories,
    addCategory,
    removeCategory,
    resetCategoriesToDefault,
  } = useSettingsStore();

  const selectedSet = new Set(selectedCategories);

  const handleToggle = (categoryId: string) => {
    if (selectedSet.has(categoryId)) {
      removeCategory(categoryId);
    } else {
      addCategory(categoryId);
    }
  };

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          同期対象のカテゴリを選択（{selectedCategories.length}件選択中）
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetCategoriesToDefault}
          className="h-7 px-2 text-xs"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          リセット
        </Button>
      </div>

      {/* カテゴリグループ */}
      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
        {Object.entries(CATEGORY_GROUPS).map(([groupName, categories]) => (
          <div key={groupName} className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              {groupName}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((categoryId) => {
                const isSelected = selectedSet.has(categoryId);
                const description = CATEGORY_DESCRIPTIONS[categoryId];

                return (
                  <Tooltip key={categoryId}>
                    <TooltipTrigger asChild>
                      <Badge
                        variant={isSelected ? "default" : "outline"}
                        className={`cursor-pointer transition-all hover:scale-105 ${
                          isSelected
                            ? "bg-primary/90 hover:bg-primary"
                            : "hover:bg-muted"
                        }`}
                        onClick={() => handleToggle(categoryId)}
                      >
                        {isSelected && <Check className="mr-1 h-3 w-3" />}
                        {categoryId}
                      </Badge>
                    </TooltipTrigger>
                    {description && (
                      <TooltipContent
                        side="top"
                        className="max-w-[280px] text-xs"
                      >
                        {description}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 選択数の警告 */}
      {selectedCategories.length === 0 && (
        <p className="text-xs text-amber-600">
          少なくとも1つのカテゴリを選択してください
        </p>
      )}
    </div>
  );
};
