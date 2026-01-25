import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Clock, Search, X } from "lucide-react";
import type { FC } from "react";
import type { SearchHistory as SearchHistoryType } from "../../shared/schemas/index";
import { Button } from "./ui/button";

/**
 * SearchHistory コンポーネントのProps
 */
interface SearchHistoryProps {
  /** 検索履歴の配列 */
  histories: SearchHistoryType[];
  /** 再検索時のコールバック */
  onReSearch?: (history: SearchHistoryType) => void;
  /** 削除時のコールバック */
  onDelete?: (id: string) => void;
  /** コンパクト表示モード（サイドバー用） */
  compact?: boolean;
}

/**
 * SearchHistory - 検索履歴コンポーネント
 *
 * Design Docsに基づく機能:
 * - 検索履歴一覧を表示
 * - ワンタップで再検索
 * - 履歴の削除
 */
export const SearchHistory: FC<SearchHistoryProps> = ({
  histories,
  onReSearch,
  onDelete,
  compact = false,
}) => {
  // 履歴がない場合 - Super Centered パターン
  if (histories.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center text-muted-foreground ${compact ? "h-full min-h-[100px]" : "min-h-[200px]"}`}
      >
        <div className="flex flex-col items-center gap-2">
          <div
            className={`rounded-full bg-muted/20 grid place-items-center ${compact ? "h-9 w-9" : "h-14 w-14"}`}
          >
            <Clock className={`${compact ? "h-4 w-4" : "h-6 w-6"} opacity-30`} />
          </div>
          <p className={`${compact ? "text-[11px]" : "text-sm"} text-muted-foreground/50`}>
            検索履歴がありません
          </p>
        </div>
      </div>
    );
  }

  const handleItemClick = (history: SearchHistoryType) => {
    onReSearch?.(history);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // 親のクリックイベントを止める
    onDelete?.(id);
  };

  return (
    <ul className={compact ? "space-y-1" : "space-y-2"}>
      {histories.map((history) => (
        <li
          key={history.id}
          className={`group flex items-center justify-between rounded-lg hover:bg-muted/50 transition-colors ${
            compact ? "p-2" : "p-3 border border-border/50"
          }`}
        >
          {/* 左側: クエリ情報（クリック可能） */}
          <button
            type="button"
            className={`flex items-center flex-1 min-w-0 text-left bg-transparent border-none cursor-pointer ${
              compact ? "gap-2" : "gap-3"
            }`}
            onClick={() => handleItemClick(history)}
          >
            <Search
              className={`text-muted-foreground flex-shrink-0 ${compact ? "h-3 w-3" : "h-4 w-4"}`}
            />
            <div className="min-w-0">
              <p className={`truncate ${compact ? "text-sm" : ""}`}>{history.originalQuery}</p>
              <p className={`text-muted-foreground ${compact ? "text-[10px]" : "text-xs"}`}>
                {history.resultCount}件 ・{" "}
                {formatDistanceToNow(history.createdAt, {
                  addSuffix: true,
                  locale: ja,
                })}
              </p>
            </div>
          </button>

          {/* 右側: 削除ボタン（コンパクト時はホバーで表示） */}
          <Button
            variant="ghost"
            size="icon"
            className={`flex-shrink-0 ${
              compact ? "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" : "h-8 w-8"
            }`}
            onClick={(e) => handleDeleteClick(e, history.id)}
            aria-label="削除"
          >
            <X className={compact ? "h-3 w-3" : "h-4 w-4"} />
          </Button>
        </li>
      ))}
    </ul>
  );
};
