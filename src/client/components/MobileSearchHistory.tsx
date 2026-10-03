import { ChevronDown, History } from "lucide-react";
import { type FC, useId, useRef, useState } from "react";
import type { SearchHistory as SearchHistoryType } from "../../shared/schemas/index";
import type { SearchHistoryUndo } from "../hooks/useSearchHistoryUndo";
import { cn } from "../lib/utils";
import { SearchHistory } from "./SearchHistory";
import { Button } from "./ui/button";

/**
 * MobileSearchHistory のProps（デスクトップのサイドバーと同じ値を受け取る）
 */
interface MobileSearchHistoryProps {
  /** 検索履歴 */
  histories: SearchHistoryType[];
  /** 再検索ハンドラー */
  onReSearch: (history: SearchHistoryType) => void;
  /** 履歴の削除と取り消し（操作と結果） */
  undo?: SearchHistoryUndo;
}

/**
 * MobileSearchHistory - モバイル（lg未満）の検索履歴
 *
 * 一覧を覆わないよう、検索欄の手前に折りたたみ領域として置く。
 * 中身はサイドバーと同じ SearchHistory を使い、削除・元に戻す・失敗表示・通知・フォーカス移動をそろえる。
 * 削除ボタンをホバーなしで見せるため、コンパクト表示にはしない。
 */
export const MobileSearchHistory: FC<MobileSearchHistoryProps> = ({
  histories,
  onReSearch,
  undo,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setIsOpen(false);
    // 押したボタンが隠れてフォーカスを見失わないよう、開閉ボタンへ戻す
    toggleRef.current?.focus();
  };

  // 再検索したら折りたたみ、結果の一覧を上に戻す
  const handleReSearch = (history: SearchHistoryType) => {
    onReSearch(history);
    close();
  };

  return (
    <div className="mb-3 space-y-2">
      <Button
        ref={toggleRef}
        variant="outline"
        size="sm"
        onClick={() => setIsOpen((open) => !open)}
        className="h-8 gap-1.5 px-3 text-sm"
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <History className="h-4 w-4" aria-hidden />
        検索履歴
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
          aria-hidden
        />
      </Button>
      <section
        id={panelId}
        aria-label="検索履歴"
        hidden={!isOpen}
        onKeyDown={(event) => {
          // Esc で折りたたみ、内部にあったフォーカスを開閉ボタンへ戻す
          if (event.key === "Escape") close();
        }}
        className="rounded-lg border border-border/60 p-3"
      >
        <SearchHistory histories={histories} onReSearch={handleReSearch} undo={undo} />
      </section>
    </div>
  );
};
