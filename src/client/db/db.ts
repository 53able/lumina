/**
 * DB の生成とシングルトン。
 *
 * LuminaDB クラスは schema.ts に分けている（Web Worker がシングルトンを生成せずにクラスだけを使うため）。
 */
import { LuminaDB } from "./schema";

export { LuminaDB };

/**
 * テスト用のDB生成関数
 * @param name DBの名前（テストごとにユニークにする）
 */
export const createLuminaDb = (name = "LuminaDB"): LuminaDB => {
  return new LuminaDB(name);
};

/**
 * Lumina DBのシングルトンインスタンス
 */
export const luminaDb = new LuminaDB();
