import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { SyncPeriod } from "../../shared/schemas/index";
import { parseISO, timestamp } from "../../shared/utils/dateTime";
import { decryptApiKey, encryptApiKey, isEncrypted } from "../lib/crypto";

/** デフォルトの対象カテゴリ */
const DEFAULT_CATEGORIES = ["cs.AI", "cs.LG", "cs.CL", "stat.ML"];

/** デフォルトの同期期間 */
const DEFAULT_SYNC_PERIOD: SyncPeriod = "3";

/** 検索時のコサイン類似度のデフォルトしきい値（この値以上を表示） */
const DEFAULT_SEARCH_SCORE_THRESHOLD = 0.3;

/** 自動同期を発動する閾値（24時間 = ミリ秒） */
const AUTO_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * settingsStore の状態型
 *
 * @remarks
 * apiKey は暗号化された状態で保存される（enc: プレフィックス付き）。
 * 平文の API key を取得するには getApiKeyAsync() を使用する。
 */
interface SettingsState {
  /** OpenAI APIキー（暗号化済み） */
  apiKey: string;
  /** APIキーを使って検索・同期・要約を行うか（ON/OFF） */
  apiEnabled: boolean;
  /** 対象カテゴリ */
  selectedCategories: string[];
  /** 同期期間 */
  syncPeriodDays: SyncPeriod;
  /** 論文詳細表示時にAI要約を自動生成するか */
  autoGenerateSummary: boolean;
  /** 検索時のコサイン類似度しきい値（この値未満の結果は除外） */
  searchScoreThreshold: number;
  /** 最終同期日時（ISO文字列で永続化） */
  lastSyncedAt: string | null;
  /** 同期期間を3日に統一するマイグレーションを実施済みか（1回限り） */
  syncPeriodResetMigrationDone: boolean;
}

/**
 * settingsStore のアクション型
 */
interface SettingsActions {
  /**
   * APIキーを設定する（非同期、暗号化）
   * @deprecated 同期版。暗号化が必要な場合は setApiKeyAsync を使用
   */
  setApiKey: (apiKey: string) => void;
  /**
   * APIキーを設定する（暗号化して保存）
   * @param plainKey - 平文の API key
   */
  setApiKeyAsync: (plainKey: string) => Promise<void>;
  /**
   * APIキーを取得する（復号化して返す）
   * @returns 平文の API key
   */
  getApiKeyAsync: () => Promise<string>;
  /** APIキーが設定されているか確認する */
  hasApiKey: () => boolean;
  /** API利用可能（ON/OFF）を設定する */
  setApiEnabled: (enabled: boolean) => void;
  /** APIキーが設定されていてかつ利用可能がONか */
  canUseApi: () => boolean;
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
  /** 検索時のコサイン類似度しきい値を設定する（0〜1） */
  setSearchScoreThreshold: (value: number) => void;
  /** 最終同期日時を設定する */
  setLastSyncedAt: (date: Date) => void;
  /** 最終同期日時を取得する（Date型で返す） */
  getLastSyncedAt: () => Date | null;
  /** 自動同期すべきか判定する（24時間以上経過している場合true） */
  shouldAutoSync: () => boolean;
  /** 全設定をリセットする */
  resetAllSettings: () => void;
  /**
   * ストアを初期化する（移行ロジック含む）
   * @description 平文で保存されている API key を検出し、自動暗号化する
   */
  initializeStore: () => Promise<void>;
  /**
   * 同期期間を3日に統一するマイグレーション（1回限り実行）。
   * persist の onFinishHydration 後に呼ぶこと。
   * @returns マイグレーションを実行した場合 true、実施済みで何もしなかった場合 false
   */
  runSyncPeriodResetMigration: () => boolean;
}

type SettingsStore = SettingsState & SettingsActions;

/**
 * settingsStore - アプリ設定の管理
 *
 * Zustand + localStorage永続化（persist middleware）
 *
 * @remarks
 * API key は暗号化された状態で保存される。
 * - 保存時: setApiKeyAsync() で暗号化
 * - 取得時: getApiKeyAsync() で復号化
 * - 移行: initializeStore() で平文を自動暗号化
 */
export const useSettingsStore = create<SettingsStore>()(
  devtools(
    persist(
      (set, get) => ({
        // State（デフォルト値）
        apiKey: "",
        apiEnabled: true,
        selectedCategories: DEFAULT_CATEGORIES,
        syncPeriodDays: DEFAULT_SYNC_PERIOD,
        autoGenerateSummary: false,
        searchScoreThreshold: DEFAULT_SEARCH_SCORE_THRESHOLD,
        lastSyncedAt: null,
        syncPeriodResetMigrationDone: false,

        // Actions

        /**
         * @deprecated 同期版。暗号化が必要な場合は setApiKeyAsync を使用
         */
        setApiKey: (apiKey) => {
          set({ apiKey });
        },

        setApiKeyAsync: async (plainKey) => {
          if (!plainKey) {
            set({ apiKey: "" });
            return;
          }
          const encrypted = await encryptApiKey(plainKey);
          set({ apiKey: encrypted });
        },

        getApiKeyAsync: async () => {
          const stored = get().apiKey;
          if (!stored) {
            return "";
          }
          // 暗号化されていない場合（移行前のデータ）はそのまま返す
          if (!isEncrypted(stored)) {
            return stored;
          }
          return decryptApiKey(stored);
        },

        hasApiKey: () => {
          return get().apiKey.length > 0;
        },

        setApiEnabled: (enabled) => {
          set({ apiEnabled: enabled });
        },

        canUseApi: () => {
          return get().apiKey.length > 0 && get().apiEnabled;
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

        setSearchScoreThreshold: (value) => {
          const clamped = Math.max(0, Math.min(1, value));
          set({ searchScoreThreshold: clamped });
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
            apiEnabled: true,
            selectedCategories: DEFAULT_CATEGORIES,
            syncPeriodDays: DEFAULT_SYNC_PERIOD,
            autoGenerateSummary: false,
            searchScoreThreshold: DEFAULT_SEARCH_SCORE_THRESHOLD,
            lastSyncedAt: null,
          });
        },

        initializeStore: async () => {
          const stored = get().apiKey;
          // 平文で保存されている API key を検出し、自動暗号化
          if (stored && !isEncrypted(stored)) {
            console.info("[settingsStore] Migrating plaintext API key to encrypted format");
            const encrypted = await encryptApiKey(stored);
            set({ apiKey: encrypted });
          }
        },

        runSyncPeriodResetMigration: () => {
          if (get().syncPeriodResetMigrationDone) return false;
          set({
            syncPeriodDays: DEFAULT_SYNC_PERIOD,
            syncPeriodResetMigrationDone: true,
          });
          return true;
        },
      }),
      {
        name: "lumina-settings",
      }
    ),
    { name: "settings-store" }
  )
);
