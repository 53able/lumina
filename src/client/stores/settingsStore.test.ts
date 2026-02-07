/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * settingsStore テスト
 *
 * Design Docsに基づく仕様:
 * - アプリ設定の管理
 * - localStorageへの永続化
 * - OpenAI APIキー
 * - 対象カテゴリ
 * - 同期期間
 */

describe("settingsStore", () => {
  beforeEach(() => {
    // localStorageをクリア
    localStorage.clear();
    // モジュールキャッシュをクリア（Zustand storeをリセット）
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  describe("初期化", () => {
    it("正常系: デフォルト値で初期化される", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      const state = useSettingsStore.getState();

      expect(state.apiKey).toBe("");
      expect(state.selectedCategories).toEqual(["cs.AI", "cs.LG", "cs.CL", "stat.ML"]);
      expect(state.syncPeriodDays).toBe("3");
    });

    it("正常系: localStorageから既存データをロードする", async () => {
      // Arrange - localStorageに事前にデータを入れておく
      localStorage.setItem(
        "lumina-settings",
        JSON.stringify({
          state: {
            apiKey: "sk-test-key",
            selectedCategories: ["cs.AI"],
            syncPeriodDays: 30,
          },
          version: 0,
        })
      );

      // Act
      const { useSettingsStore } = await import("./settingsStore");

      const state = useSettingsStore.getState();

      // Assert
      expect(state.apiKey).toBe("sk-test-key");
      expect(state.selectedCategories).toEqual(["cs.AI"]);
      expect(state.syncPeriodDays).toBe(30);
    });
  });

  describe("APIキーの管理", () => {
    it("正常系: APIキーを設定できる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      // Act
      useSettingsStore.getState().setApiKey("sk-new-key");

      // Assert - Store
      const state = useSettingsStore.getState();
      expect(state.apiKey).toBe("sk-new-key");

      // Assert - localStorage永続化
      const stored = JSON.parse(localStorage.getItem("lumina-settings") || "{}");
      expect(stored.state.apiKey).toBe("sk-new-key");
    });

    it("正常系: APIキーが設定されているか確認できる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      expect(useSettingsStore.getState().hasApiKey()).toBe(false);

      useSettingsStore.getState().setApiKey("sk-test");

      expect(useSettingsStore.getState().hasApiKey()).toBe(true);
    });

    it("正常系: APIキーをクリアできる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setApiKey("sk-test");
      useSettingsStore.getState().clearApiKey();

      expect(useSettingsStore.getState().apiKey).toBe("");
    });
  });

  describe("カテゴリの管理", () => {
    it("正常系: カテゴリを設定できる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      // Act
      useSettingsStore.getState().setSelectedCategories(["cs.CV", "cs.NE"]);

      // Assert
      const state = useSettingsStore.getState();
      expect(state.selectedCategories).toEqual(["cs.CV", "cs.NE"]);
    });

    it("正常系: カテゴリを追加できる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      // Act
      useSettingsStore.getState().addCategory("cs.RO");

      // Assert
      const state = useSettingsStore.getState();
      expect(state.selectedCategories).toContain("cs.RO");
    });

    it("正常系: 重複カテゴリは追加されない", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      const initialLength = useSettingsStore.getState().selectedCategories.length;

      // Act - 既存のカテゴリを追加
      useSettingsStore.getState().addCategory("cs.AI");

      // Assert
      expect(useSettingsStore.getState().selectedCategories.length).toBe(initialLength);
    });

    it("正常系: カテゴリを削除できる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      // Act
      useSettingsStore.getState().removeCategory("cs.AI");

      // Assert
      const state = useSettingsStore.getState();
      expect(state.selectedCategories).not.toContain("cs.AI");
    });

    it("正常系: カテゴリをデフォルトにリセットできる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setSelectedCategories(["only.one"]);

      // Act
      useSettingsStore.getState().resetCategoriesToDefault();

      // Assert
      const state = useSettingsStore.getState();
      expect(state.selectedCategories).toEqual(["cs.AI", "cs.LG", "cs.CL", "stat.ML"]);
    });
  });

  describe("同期期間の管理", () => {
    it("正常系: 同期期間を設定できる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      // Act
      useSettingsStore.getState().setSyncPeriodDays("30");

      // Assert
      const state = useSettingsStore.getState();
      expect(state.syncPeriodDays).toBe("30");
    });

    it("正常系: 有効な同期期間のみ設定できる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      // Act - 有効な値（SyncPeriod型: "3" | "7" | "30" | "90" | "180" | "365"）
      useSettingsStore.getState().setSyncPeriodDays("3");
      expect(useSettingsStore.getState().syncPeriodDays).toBe("3");

      useSettingsStore.getState().setSyncPeriodDays("7");
      expect(useSettingsStore.getState().syncPeriodDays).toBe("7");

      useSettingsStore.getState().setSyncPeriodDays("30");
      expect(useSettingsStore.getState().syncPeriodDays).toBe("30");

      useSettingsStore.getState().setSyncPeriodDays("90");
      expect(useSettingsStore.getState().syncPeriodDays).toBe("90");

      useSettingsStore.getState().setSyncPeriodDays("180");
      expect(useSettingsStore.getState().syncPeriodDays).toBe("180");

      useSettingsStore.getState().setSyncPeriodDays("365");
      expect(useSettingsStore.getState().syncPeriodDays).toBe("365");
    });
  });

  describe("API利用可能", () => {
    it("正常系: apiEnabled のデフォルトが true である", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      const state = useSettingsStore.getState();

      expect(state.apiEnabled).toBe(true);
    });

    it("正常系: setApiEnabled(false) で apiEnabled が false になる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setApiEnabled(false);

      expect(useSettingsStore.getState().apiEnabled).toBe(false);
    });

    it("正常系: canUseApi() は APIキー未設定なら false", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      expect(useSettingsStore.getState().canUseApi()).toBe(false);
    });

    it("正常系: canUseApi() は キー設定かつ apiEnabled が true なら true", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setApiKey("sk-test");
      useSettingsStore.getState().setApiEnabled(true);

      expect(useSettingsStore.getState().canUseApi()).toBe(true);
    });

    it("正常系: canUseApi() は キー設定かつ apiEnabled が false なら false", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setApiKey("sk-test");
      useSettingsStore.getState().setApiEnabled(false);

      expect(useSettingsStore.getState().canUseApi()).toBe(false);
    });

    it("正常系: resetAllSettings() 後に apiEnabled が true に戻る", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setApiEnabled(false);
      useSettingsStore.getState().resetAllSettings();

      expect(useSettingsStore.getState().apiEnabled).toBe(true);
    });
  });

  describe("設定のリセット", () => {
    it("正常系: 全設定をリセットできる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      // 設定を変更（検索しきい値も変更してリセットで戻ることを確認）
      useSettingsStore.getState().setApiKey("sk-test");
      useSettingsStore.getState().setSelectedCategories(["cs.CV"]);
      useSettingsStore.getState().setSyncPeriodDays("90");
      useSettingsStore.getState().setSearchScoreThreshold(0.5);

      // Act
      useSettingsStore.getState().resetAllSettings();

      // Assert
      const state = useSettingsStore.getState();
      expect(state.apiKey).toBe("");
      expect(state.selectedCategories).toEqual(["cs.AI", "cs.LG", "cs.CL", "stat.ML"]);
      expect(state.syncPeriodDays).toBe("3");
      expect(state.searchScoreThreshold).toBe(0.3);
    });
  });

  describe("検索しきい値", () => {
    it("正常系: デフォルトは 0.3", async () => {
      const { useSettingsStore } = await import("./settingsStore");
      useSettingsStore.getState().resetAllSettings();
      expect(useSettingsStore.getState().searchScoreThreshold).toBe(0.3);
    });

    it("正常系: setSearchScoreThreshold でしきい値を変更できる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setSearchScoreThreshold(0.5);
      expect(useSettingsStore.getState().searchScoreThreshold).toBe(0.5);

      useSettingsStore.getState().setSearchScoreThreshold(0);
      expect(useSettingsStore.getState().searchScoreThreshold).toBe(0);

      useSettingsStore.getState().setSearchScoreThreshold(1);
      expect(useSettingsStore.getState().searchScoreThreshold).toBe(1);
    });

    it("正常系: 0〜1 の範囲にクランプされる", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setSearchScoreThreshold(1.5);
      expect(useSettingsStore.getState().searchScoreThreshold).toBe(1);

      useSettingsStore.getState().setSearchScoreThreshold(-0.1);
      expect(useSettingsStore.getState().searchScoreThreshold).toBe(0);
    });
  });

  describe("同期期間リセットマイグレーション（1回限り）", () => {
    it("未実施時: runSyncPeriodResetMigration() で同期期間が3日になり true を返す", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setSyncPeriodDays("30");

      const result = useSettingsStore.getState().runSyncPeriodResetMigration();

      expect(result).toBe(true);
      expect(useSettingsStore.getState().syncPeriodDays).toBe("3");
      expect(useSettingsStore.getState().syncPeriodResetMigrationDone).toBe(true);
    });

    it("実施済み時: runSyncPeriodResetMigration() は何もせず false を返す", async () => {
      const { useSettingsStore } = await import("./settingsStore");

      useSettingsStore.getState().setSyncPeriodDays("90");
      useSettingsStore.getState().runSyncPeriodResetMigration();

      const result = useSettingsStore.getState().runSyncPeriodResetMigration();

      expect(result).toBe(false);
      expect(useSettingsStore.getState().syncPeriodDays).toBe("3");
    });
  });
});
