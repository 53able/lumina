import { AISDKError, APICallError, RetryError } from "ai";
import type { Context } from "hono";
import pino, { type DestinationStream, type LevelWithSilent, type Logger } from "pino";
import { z } from "zod";
import type { AppEnv } from "../types/env.js";
import {
  ArxivHttpError,
  ArxivRateLimitError,
  ArxivServiceUnavailableError,
  OpenAIApiKeyNotConfiguredError,
} from "./errors.js";
import { getUpstreamStatusCode } from "./upstreamError.js";

export type { Logger };

/** 外部由来の文字列（名前・コード）を切る長さ */
const MAX_STRING_LENGTH = 64;
/** formatters.log で値として渡した文字列を切る長さ（超えたら末尾に … を付ける。msg には適用しない） */
const MAX_LOG_STRING_LENGTH = 256;
/** formatters.log で配列を出す件数（先頭から） */
const MAX_LOG_ARRAY_LENGTH = 20;
/** 自前のエラーの message と stack を切る長さ */
const MAX_OWN_ERROR_TEXT_LENGTH = 300;
/** DOMException のうち message を出す name（ブラウザ・Node が決めた固定文） */
const DOM_EXCEPTION_NAMES_WITH_MESSAGE = new Set(["TimeoutError", "AbortError"]);
/** ZodError の issues を出す件数 */
const MAX_ZOD_ISSUES = 10;
/** cause をたどる段数 */
const MAX_CAUSE_DEPTH = 2;
/** RetryError の lastError を入れ子で直列化する深さ */
const MAX_ERROR_DEPTH = 2;
/** formatters.log で plain object と配列を走査する深さ（トップレベル = 0） */
const MAX_LOG_DEPTH = 3;
/** 呼び出し側が msg を渡さなかったときの msg（level に依存しない文言） */
const DEFAULT_MSG = "log";
/** pino が出力する項目と重複するため、マージ用オブジェクトのトップレベルから捨てるキー */
const RESERVED_KEYS = new Set(["msg", "level", "time", "service", "reqId"]);
const VALID_LEVELS: readonly string[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] satisfies LevelWithSilent[];

/** serializeError が返した値。冪等にするため、これに含まれる値はそのまま返す */
const serializedResults = new WeakSet<object>();

const truncate = (value: unknown): string | undefined =>
  typeof value === "string" ? value.slice(0, MAX_STRING_LENGTH) : undefined;

const constructorName = (value: object): string => {
  const name: unknown = Object.getPrototypeOf(value)?.constructor?.name;
  return truncate(name) || "Object";
};

const isErrorLike = (value: unknown): value is Error =>
  value instanceof Error || AISDKError.isInstance(value);

const isOwnError = (value: unknown): boolean =>
  value instanceof ArxivRateLimitError ||
  value instanceof ArxivServiceUnavailableError ||
  value instanceof ArxivHttpError ||
  value instanceof OpenAIApiKeyNotConfiguredError;

/** cause を { name, code, cause } で MAX_CAUSE_DEPTH 段までたどる（message は出さない） */
const serializeCause = (cause: unknown, level: number): Record<string, unknown> | undefined => {
  if (cause === undefined || cause === null || level > MAX_CAUSE_DEPTH) return undefined;
  if (typeof cause !== "object") return { type: typeof cause };
  const { code, cause: inner } = cause as { code?: unknown; cause?: unknown };
  return {
    name: constructorName(cause),
    code: truncate(code),
    cause: serializeCause(inner, level + 1),
  };
};

/** APICallError.data.error の code / type（OpenAI の分類）を取り出す */
const getApiErrorDetail = (data: unknown): { errorCode?: string; errorType?: string } => {
  if (!data || typeof data !== "object" || !("error" in data)) return {};
  const inner = (data as { error: unknown }).error;
  if (!inner || typeof inner !== "object") return {};
  const { code, type } = inner as { code?: unknown; type?: unknown };
  return { errorCode: truncate(code), errorType: truncate(type) };
};

const serializeErrorUnchecked = (value: unknown, depth: number): Record<string, unknown> => {
  if (value === null || typeof value !== "object") return { type: typeof value };
  if (typeof DOMException !== "undefined" && value instanceof DOMException) {
    return {
      name: truncate(value.name),
      ...(DOM_EXCEPTION_NAMES_WITH_MESSAGE.has(value.name)
        ? { message: value.message.slice(0, MAX_OWN_ERROR_TEXT_LENGTH) }
        : {}),
      cause: serializeCause(value.cause, 1),
    };
  }
  if (!isErrorLike(value)) return { type: typeof value };
  const cause = serializeCause(value.cause, 1);
  if (isOwnError(value)) {
    return {
      name: value.name,
      message: value.message.slice(0, MAX_OWN_ERROR_TEXT_LENGTH),
      stack: value.stack?.slice(0, MAX_OWN_ERROR_TEXT_LENGTH),
      ...(value instanceof ArxivHttpError ? { status: value.status } : {}),
      cause,
    };
  }
  if (APICallError.isInstance(value)) {
    // Vercel の関数ビルドの型検査では ai のエラー型の継承が解決されないため、使う項目だけの型で読む
    // （ai 4.3.19 で vercel build の tsc が TS2339 を出した: APICallError の data・isRetryable、
    // RetryError の name が Error 型に存在しない。tsgo では再現しない）
    const apiError = value as unknown as ApiCallErrorFields;
    return {
      name: truncate(apiError.name),
      statusCode: getUpstreamStatusCode(apiError),
      isRetryable: apiError.isRetryable,
      ...getApiErrorDetail(apiError.data),
      cause,
    };
  }
  if (RetryError.isInstance(value)) {
    const retryError = value as unknown as RetryErrorFields;
    return {
      name: truncate(retryError.name),
      reason: truncate(retryError.reason),
      attempts: retryError.errors.length,
      lastError:
        depth < MAX_ERROR_DEPTH ? serializeError(retryError.lastError, depth + 1) : undefined,
      cause,
    };
  }
  if (value instanceof z.ZodError) {
    return {
      name: constructorName(value),
      issues: value.issues.slice(0, MAX_ZOD_ISSUES).map((issue) => ({
        path: issue.path.map((segment) =>
          (typeof segment === "symbol" ? "[symbol]" : `${segment}`).slice(0, MAX_STRING_LENGTH)
        ),
        code: truncate(issue.code),
      })),
      cause,
    };
  }
  return { name: constructorName(value), cause };
};

/** serializeError が APICallError から読む項目 */
type ApiCallErrorFields = {
  name: string;
  statusCode?: number;
  isRetryable: boolean;
  data?: unknown;
};

/** serializeError が RetryError から読む項目 */
type RetryErrorFields = { name: string; reason: string; errors: unknown[]; lastError: unknown };

/**
 * エラーを型ごとの allowlist で直列化する（表にない項目は出さない）
 * - 自前のエラー: name / message / stack（それぞれ300文字まで。ArxivHttpError は status も）
 * - DOMException: name（TimeoutError / AbortError のときだけ message も）
 * - APICallError: name / statusCode / isRetryable / data.error の code・type
 * - RetryError: name / reason / attempts / lastError（入れ子は depth 2 まで）
 * - その他の Error: コンストラクタ名（ZodError は issues の path と code）
 * - Error 以外: { type }
 * すべての Error で cause を 2 段まで { name, code, cause } で出す。
 * 例外を投げない。返した値を再び渡すとそのまま返す（冪等）
 */
export const serializeError = (value: unknown, depth = 0): Record<string, unknown> => {
  let result: Record<string, unknown>;
  try {
    if (value !== null && typeof value === "object" && serializedResults.has(value)) {
      return value as Record<string, unknown>;
    }
    result = serializeErrorUnchecked(value, depth);
  } catch {
    result = { name: "SerializeError" };
  }
  serializedResults.add(result);
  return result;
};

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * formatters.log の走査本体。元のオブジェクトは書き換えず、plain object と配列だけをコピーする
 * - 関数（toJSON を含む）は捨てる（JSON.stringify が toJSON の戻り値を出すのを防ぐ）
 * - 文字列は256文字、配列は先頭20件まで
 * ancestors は現在の経路上のオブジェクト（循環参照の検出用）
 */
const sanitizeLogValue = (value: unknown, depth: number, ancestors: WeakSet<object>): unknown => {
  if (typeof value === "function") return undefined;
  if (typeof value === "string") {
    return value.length > MAX_LOG_STRING_LENGTH
      ? `${value.slice(0, MAX_LOG_STRING_LENGTH)}…`
      : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (isErrorLike(value)) return serializeError(value);
  if (serializedResults.has(value)) return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (!Array.isArray(value) && !isPlainObject(value)) return { type: constructorName(value) };
  if (depth > MAX_LOG_DEPTH) return "[Truncated]";
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  const copy = Array.isArray(value)
    ? value
        .slice(0, MAX_LOG_ARRAY_LENGTH)
        .map((item) => sanitizeLogValue(item, depth + 1, ancestors))
    : Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => typeof item !== "function")
          .map(([key, item]) => [key, sanitizeLogValue(item, depth + 1, ancestors)])
      );
  ancestors.delete(value);
  return copy;
};

/**
 * シリアライザが効くのはトップレベルの err / error だけなので、それ以外のキーにある Error や
 * plain でないオブジェクトもここで置き換える。トップレベルの予約キーは捨てる
 */
const formatLogObject = (obj: Record<string, unknown>): Record<string, unknown> => {
  try {
    if (!isPlainObject(obj)) return { type: constructorName(obj) };
    const ancestors = new WeakSet<object>([obj]);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (RESERVED_KEYS.has(key) || typeof value === "function") continue;
      result[key] = sanitizeLogValue(value, 1, ancestors);
    }
    return result;
  } catch {
    return { logFormatError: true };
  }
};

/**
 * 引数を「マージ用オブジェクト + 固定文の msg」に正規化する
 * pino が Error の message を msg に入れる経路と、%s / %o / %j で展開する経路を塞ぐ
 */
const normalizeLogArgs = (args: unknown[]): [string] | [object, string] => {
  const [first, second] = args;
  const msg = typeof second === "string" ? second : DEFAULT_MSG;
  if (typeof first === "string") return [first];
  if (isErrorLike(first)) return [{ err: first }, msg];
  if (first !== null && typeof first === "object") return [first, msg];
  return [{}, DEFAULT_MSG];
};

const isValidLevel = (value: string): value is LevelWithSilent => VALID_LEVELS.includes(value);

/**
 * level の優先順位: 引数 → LOG_LEVEL → NODE_ENV=test なら silent → info
 * LOG_LEVEL が不正なら info に確定する（起動は止めない）。空文字列は未設定として扱う
 */
const resolveLevel = (level: LevelWithSilent | undefined): LevelWithSilent => {
  if (level !== undefined) return isValidLevel(level) ? level : "info";
  const envLevel = process.env.LOG_LEVEL;
  if (envLevel !== undefined && envLevel !== "") {
    return isValidLevel(envLevel) ? envLevel : "info";
  }
  return process.env.NODE_ENV === "test" ? "silent" : "info";
};

/**
 * 既定の出力先。Vercel は console のメソッドでレベルを判定するため、console を経由して書く
 * error 以上は console.error、それ以外（warn を含む）は console.log
 * 書き込みの失敗でリクエストを壊さないよう、例外は握りつぶす
 */
const createConsoleSink = (): DestinationStream =>
  pino.multistream(
    [
      {
        level: "trace",
        stream: {
          write: (line: string) => {
            try {
              // biome-ignore lint/suspicious/noConsole: Vercel が console.log の出力を info 以下として扱うため、出力先として使う
              console.log(line.trimEnd());
            } catch {
              // ログを書けなくても処理は続ける
            }
          },
        },
      },
      {
        level: "error",
        stream: {
          write: (line: string) => {
            try {
              // biome-ignore lint/suspicious/noConsole: Vercel が console.error の出力を error として扱うため、出力先として使う
              console.error(line.trimEnd());
            } catch {
              // ログを書けなくても処理は続ける
            }
          },
        },
      },
    ],
    { dedupe: true }
  );

export interface CreateLoggerOptions {
  level?: LevelWithSilent;
  /** 出力先（テストではメモリのストリームを渡す）。省略時は console */
  sink?: DestinationStream;
}

export const createLogger = ({ level, sink }: CreateLoggerOptions = {}): Logger =>
  pino(
    {
      level: resolveLevel(level),
      base: { service: "lumina-api" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        log: formatLogObject,
      },
      serializers: { err: serializeError, error: serializeError },
      hooks: {
        // ログの失敗でリクエストを壊さないよう、引数の正規化と書き込みの例外は握りつぶす
        logMethod(inputArgs, method) {
          let args: [string] | [object, string];
          try {
            args = normalizeLogArgs(inputArgs);
          } catch {
            args = [{ logFormatError: true }, DEFAULT_MSG];
          }
          try {
            method.apply(this, args as Parameters<typeof method>);
          } catch {
            // ログを書けなくても処理は続ける
          }
        },
      },
      // 今の設計では apiKey を出さないので効果はない。保険として残す
      redact: ["*.apiKey", "apiKey"],
    },
    sink ?? createConsoleSink()
  );

export const rootLogger: Logger = createLogger();

/**
 * Context からリクエストごとのロガー（reqId 付き）を取る。未設定なら rootLogger
 */
export const getLogger = (c: Context<AppEnv>): Logger => c.get("logger") ?? rootLogger;
