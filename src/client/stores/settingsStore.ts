import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { SyncPeriod } from "@/shared/schemas";
import { parseISO, timestamp } from "@/shared/utils/dateTime";

/** デフォルトの対象カテゴリ */
const DEFAULT_CATEGORIES = ["cs.AI", "cs.LG", "cs.CL", "stat.ML"];

/** デフォルトの同期期間 */
const DEFAULT_SYNC_PERIOD: SyncPeriod = "7";

/** 自動同期を発動する閾値（24時間 = ミリ秒） */
const AUTO_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * settingsStore の状態型
 */
interface SettingsState {
  /** OpenAI APIキー */
  apiKey: string;
  /** 対象カテゴリ */
  selectedCategories: string[];
  /** 同期期間 */
  syncPeriodDays: SyncPeriod;
  /** 論文詳細表示時にAI要約を自動生成するか */
  autoGenerateSummary: boolean;
  /** 最終同期日時（ISO文字列で永続化） */
  lastSyncedAt: string | null;
}

/**
 * settingsStore のアクション型
 */
interface SettingsActions {
  /** APIキーを設定する */
  setApiKey: (apiKey: string) => void;
  /** APIキーが設定されているか確認する */
  hasApiKey: () => boolean;
  /** APIキーをクリアする */
  clearApiKey: () => void;
  /** カテゴリを設定する */
  setSelectedCategories: (categories: string[]) => void;
  /** カテゴリを追加する */
  addCategory: (category: string) => void;
  /** カテゴリを削除する */
  removeCategory: (category: string) => void;
  /** カテゴリをデフォルトにリセットする */
  resetCategoriesToDefault: () => void;
  /** 同期期間を設定する */
  setSyncPeriodDays: (period: SyncPeriod) => void;
  /** 自動要約生成の有効/無効を設定する */
  setAutoGenerateSummary: (enabled: boolean) => void;
  /** 最終同期日時を設定する */
  setLastSyncedAt: (date: Date) => void;
  /** 最終同期日時を取得する（Date型で返す） */
  getLastSyncedAt: () => Date | null;
  /** 自動同期すべきか判定する（24時間以上経過している場合true） */
  shouldAutoSync: () => boolean;
  /** 全設定をリセットする */
  resetAllSettings: () => void;
}

type SettingsStore = SettingsState & SettingsActions;

/**
 * settingsStore - アプリ設定の管理
 *
 * Zustand + localStorage永続化（persist middleware）
 */
export const useSettingsStore = create<SettingsStore>()(
  devtools(
    persist(
      (set, get) => ({
        // State（デフォルト値）
        apiKey: "",
        selectedCategories: DEFAULT_CATEGORIES,
        syncPeriodDays: DEFAULT_SYNC_PERIOD,
        autoGenerateSummary: false,
        lastSyncedAt: null,

        // Actions
        setApiKey: (apiKey) => {
          set({ apiKey });
        },

        hasApiKey: () => {
          return get().apiKey.length > 0;
        },

        clearApiKey: () => {
          set({ apiKey: "" });
        },

        setSelectedCategories: (categories) => {
          set({ selectedCategories: categories });
        },

        addCategory: (category) => {
          const current = get().selectedCategories;
          // 重複チェック
          if (!current.includes(category)) {
            set({ selectedCategories: [...current, category] });
          }
        },

        removeCategory: (category) => {
          const current = get().selectedCategories;
          set({ selectedCategories: current.filter((c) => c !== category) });
        },

        resetCategoriesToDefault: () => {
          set({ selectedCategories: DEFAULT_CATEGORIES });
        },

        setSyncPeriodDays: (period) => {
          set({ syncPeriodDays: period });
        },

        setAutoGenerateSummary: (enabled) => {
          set({ autoGenerateSummary: enabled });
        },

        setLastSyncedAt: (date) => {
          set({ lastSyncedAt: date.toISOString() });
        },

        getLastSyncedAt: () => {
          const stored = get().lastSyncedAt;
          return stored ? parseISO(stored) : null;
        },

        shouldAutoSync: () => {
          const stored = get().lastSyncedAt;
          if (!stored) return true; // 一度も同期していない場合は自動同期
          const lastSynced = parseISO(stored).getTime();
          const currentTime = timestamp();
          return currentTime - lastSynced > AUTO_SYNC_THRESHOLD_MS;
        },

        resetAllSettings: () => {
          set({
            apiKey: "",
            selectedCategories: DEFAULT_CATEGORIES,
            syncPeriodDays: DEFAULT_SYNC_PERIOD,
            autoGenerateSummary: false,
            lastSyncedAt: null,
          });
        },
      }),
      {
        name: "lumina-settings",
      }
    ),
    { name: "settings-store" }
  )
);
