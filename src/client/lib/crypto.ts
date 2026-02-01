/**
 * API Key 暗号化ユーティリティ
 *
 * @description
 * Web Crypto API を使用して API key を暗号化・復号化する。
 * - アルゴリズム: AES-GCM 256bit
 * - 鍵派生: PBKDF2（ブラウザ固有の情報から派生）
 * - 保存形式: Base64（IV + 暗号文）
 *
 * セキュリティ特性:
 * - 同一 origin（同じサイト）であればスマホ・PC で復号可能（salt は origin のみ）
 * - 旧データは origin+userAgent でフォールバック復号
 * - XSS 攻撃で暗号化された値を盗んでも、別 origin では使用不可
 *
 * @remarks
 * クライアントサイド暗号化は「完璧なセキュリティ」ではなく
 * 「攻撃コストを上げる」対策。XSS を完全に防ぐには CSP が本質的に重要。
 */

/** 暗号化アルゴリズム */
const ALGORITHM = "AES-GCM";

/** 鍵長（ビット） */
const KEY_LENGTH = 256;

/** IV（初期化ベクトル）の長さ（バイト） */
const IV_LENGTH = 12;

/** PBKDF2 のイテレーション回数 */
const PBKDF2_ITERATIONS = 100000;

/** 暗号化データの識別子（移行ロジック用） */
const ENCRYPTED_PREFIX = "enc:";

/**
 * 同一 origin 用のソルト（スマホ・PC で共有するため origin のみ）
 *
 * @description
 * origin のみでソルトを生成する。同一オリジンならスマホ・PC で同じ鍵になり、
 * 一方で保存した API キーが他方で復号できる。
 *
 * @returns ソルト文字列
 */
const getBrowserSalt = (): string => {
  const origin = typeof window !== "undefined" ? window.location.origin : "localhost";
  return `lumina:${origin}`;
};

/**
 * 旧仕様のソルト（origin + userAgent）。既存データの復号フォールバック用。
 */
const getLegacyBrowserSalt = (): string => {
  const origin = typeof window !== "undefined" ? window.location.origin : "localhost";
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  return `lumina:${origin}:${userAgent}`;
};

/**
 * 文字列を ArrayBuffer に変換する
 */
const stringToBuffer = (str: string): ArrayBuffer => {
  return new TextEncoder().encode(str).buffer;
};

/**
 * ArrayBuffer を文字列に変換する
 */
const bufferToString = (buffer: ArrayBuffer): string => {
  return new TextDecoder().decode(buffer);
};

/**
 * ArrayBuffer を Base64 文字列に変換する
 */
const bufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

/**
 * Base64 文字列を ArrayBuffer に変換する
 */
const base64ToBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * 派生鍵のキャッシュ（同一 salt で複数回 deriveKey すると OperationError が出る環境があるため）
 */
let cachedDerivedKey: { salt: string; key: CryptoKey } | null = null;

/**
 * PBKDF2 で暗号化鍵を派生する
 *
 * @param salt - ソルト文字列
 * @returns AES-GCM 用の CryptoKey
 */
const deriveKey = async (salt: string): Promise<CryptoKey> => {
  if (cachedDerivedKey?.salt === salt) {
    return cachedDerivedKey.key;
  }
  let keyMaterial: CryptoKey;
  try {
    keyMaterial = await crypto.subtle.importKey("raw", stringToBuffer(salt), "PBKDF2", false, [
      "deriveKey",
    ]);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[decryptApiKey] importKey failed", { name: err.name, message: err.message });
    throw e;
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: stringToBuffer("lumina-api-key-encryption"),
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[decryptApiKey] deriveKey failed", { name: err.name, message: err.message });
    throw e;
  }
  cachedDerivedKey = { salt, key };
  return key;
};

/**
 * API key を暗号化する
 *
 * @param plainText - 平文の API key
 * @returns 暗号化された文字列（Base64 形式、enc: プレフィックス付き）
 *
 * @example
 * ```typescript
 * const encrypted = await encryptApiKey("sk-abc123...");
 * // => "enc:base64encodedstring..."
 * ```
 */
export const encryptApiKey = async (plainText: string): Promise<string> => {
  // 空文字列の場合はそのまま返す
  if (!plainText) {
    return "";
  }

  const salt = getBrowserSalt();
  const key = await deriveKey(salt);

  // ランダムな IV を生成
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // 暗号化
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    stringToBuffer(plainText)
  );

  // IV + 暗号文を結合して Base64 エンコード
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return ENCRYPTED_PREFIX + bufferToBase64(combined.buffer);
};

/**
 * 暗号化された API key を復号化する
 *
 * @param encryptedData - 暗号化された文字列（enc: プレフィックス付き）
 * @returns 平文の API key
 * @throws 復号化に失敗した場合
 *
 * @example
 * ```typescript
 * const plainKey = await decryptApiKey("enc:base64encodedstring...");
 * // => "sk-abc123..."
 * ```
 */
export const decryptApiKey = async (encryptedData: string): Promise<string> => {
  // 空文字列の場合はそのまま返す
  if (!encryptedData) {
    return "";
  }

  // プレフィックスを除去
  if (!encryptedData.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error("Invalid encrypted data format");
  }

  const base64Data = encryptedData.slice(ENCRYPTED_PREFIX.length);
  let combined: Uint8Array;
  try {
    combined = new Uint8Array(base64ToBuffer(base64Data));
  } catch {
    throw new Error("Invalid encrypted data: Base64 decode failed");
  }
  if (combined.length < IV_LENGTH + 1) {
    throw new Error("Invalid encrypted data: payload too short (corrupted or wrong format)");
  }

  // IV と暗号文を分離
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const isOperationError = (e: unknown): boolean =>
    Boolean(
      (e instanceof Error && e.name === "OperationError") ||
        (e && (e as { name?: string }).name === "OperationError")
    );

  const tryDecryptWithSalt = async (salt: string): Promise<string> => {
    const getKey = (): Promise<CryptoKey> => deriveKey(salt);
    let key: CryptoKey;
    try {
      key = await getKey();
    } catch (e) {
      if (!isOperationError(e)) throw e;
      cachedDerivedKey = null;
      key = await getKey();
    }
    let decrypted: ArrayBuffer;
    try {
      decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.warn("[decryptApiKey] decrypt failed", { name: err.name, message: err.message });
      throw e;
    }
    return bufferToString(decrypted);
  };

  try {
    return await tryDecryptWithSalt(getBrowserSalt());
  } catch (e) {
    if (!isOperationError(e)) throw e;
    cachedDerivedKey = null;
    try {
      return await tryDecryptWithSalt(getLegacyBrowserSalt());
    } catch {
      throw e;
    }
  }
};

/**
 * Web Crypto のウォームアップ（起動時に 1 回呼ぶ）
 *
 * @description
 * 同一ドキュメントで最初の crypto.subtle 利用時に失敗する環境を避けるため、
 * ユーザー操作前に origin 用と legacy（origin+userAgent）用の両方で deriveKey を実行し、
 * リロード直後の検索で復号が失敗しないようにする。失敗してもアプリ起動はブロックしない。
 */
export const warmupCrypto = async (): Promise<void> => {
  const salts = [getBrowserSalt(), getLegacyBrowserSalt()];
  for (const salt of salts) {
    try {
      await deriveKey(salt);
    } catch (e) {
      console.warn("[warmupCrypto] failed for salt", e instanceof Error ? e.message : String(e));
    }
  }
};

/**
 * 文字列が暗号化されているかどうかを判定する
 *
 * @param value - 判定対象の文字列
 * @returns 暗号化されている場合 true
 *
 * @description
 * 既存ユーザーの移行ロジックで使用。
 * 平文で保存されている API key を検出するため。
 */
export const isEncrypted = (value: string): boolean => {
  return value.startsWith(ENCRYPTED_PREFIX);
};
