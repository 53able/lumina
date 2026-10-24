import { APICallError, RetryError } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ArxivHttpError, ArxivServiceUnavailableError } from "./errors";
import { createLogger, serializeError } from "./logger";

const ABSTRACT = "ABSTRACT_SECRET";
const KEY_FRAGMENT = "sk-test-SECRETabcd";

/** 本文（requestBodyValues / responseBody）とキー断片（message）を持つ 401 の APICallError */
const createApiCallError = () =>
  new APICallError({
    message: `Incorrect API key provided: ${KEY_FRAGMENT}`,
    url: "https://api.openai.com/v1/embeddings",
    requestBodyValues: { input: ABSTRACT },
    statusCode: 401,
    responseHeaders: { "x-request-id": "req" },
    responseBody: JSON.stringify({ error: { message: `key ${KEY_FRAGMENT}`, input: ABSTRACT } }),
    isRetryable: false,
    data: { error: { code: "invalid_api_key", type: "invalid_request_error" } },
  });

const createRetryError = () => {
  const lastError = createApiCallError();
  return new RetryError({
    message: `Failed after 3 attempts. Last error: ${lastError.message}`,
    reason: "maxRetriesExceeded",
    errors: [lastError, lastError, lastError],
  });
};

/** メモリの出力先を差し込んだロガー */
const createMemoryLogger = () => {
  const lines: string[] = [];
  const logger = createLogger({ level: "trace", sink: { write: (line) => lines.push(line) } });
  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, parsed };
};

class Holder {
  constructor(public readonly inner: unknown) {}
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("serializeError", () => {
  it("(a) APICallError は statusCode・isRetryable・data.error の code/type だけを出す", () => {
    const result = serializeError(createApiCallError());
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result).toMatchObject({
      name: "AI_APICallError",
      statusCode: 401,
      isRetryable: false,
      errorCode: "invalid_api_key",
      errorType: "invalid_request_error",
    });
    expect(result).not.toHaveProperty("message");
    expect(result).not.toHaveProperty("stack");
  });

  it("(b) RetryError は reason・attempts と lastError の直列化だけを出す", () => {
    const result = serializeError(createRetryError());
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result).toMatchObject({
      name: "AI_RetryError",
      reason: "maxRetriesExceeded",
      attempts: 3,
      lastError: { name: "AI_APICallError", statusCode: 401 },
    });
  });

  it("(c) SyntaxError はコンストラクタ名だけを出す", () => {
    const result = serializeError(
      new SyntaxError(`Unexpected token 'A', "${ABSTRACT}"... is not valid JSON`)
    );
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result).toEqual({ name: "SyntaxError" });
  });

  it("ZodError は issues の path と code だけを 10 件まで出す", () => {
    const schema = z.array(z.object({ title: z.string() }));
    const parsed = schema.safeParse(Array.from({ length: 12 }, () => ({ title: ABSTRACT.length })));
    expect(parsed.success).toBe(false);
    const result = serializeError(parsed.error);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.name).toBe("ZodError");
    expect(result.issues).toHaveLength(10);
    expect((result.issues as unknown[])[0]).toEqual({ path: ["0", "title"], code: "invalid_type" });
  });

  it("自前のエラーは message と stack を出し、ArxivHttpError は status も出す", () => {
    const result = serializeError(new ArxivHttpError("arXiv API error: 400 Bad Request - x", 400));
    expect(result).toMatchObject({
      name: "ArxivHttpError",
      message: "arXiv API error: 400 Bad Request - x",
      status: 400,
    });
    expect(typeof result.stack).toBe("string");
  });

  it("cause は 2 段まで name と code だけを出す（fetch failed → ECONNRESET）", () => {
    const socketError = Object.assign(new Error(`socket ${KEY_FRAGMENT}`), { code: "ECONNRESET" });
    const fetchError = new TypeError("fetch failed", {
      cause: new Error("other side closed", { cause: socketError }),
    });
    const result = serializeError(
      new ArxivServiceUnavailableError("arXiv API request failed: fetch failed", {
        cause: fetchError,
      })
    );
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.cause).toEqual({
      name: "TypeError",
      code: undefined,
      cause: { name: "Error", code: undefined, cause: undefined },
    });

    const direct = serializeError(fetchError);
    expect(direct.cause).toMatchObject({ cause: { name: "Error", code: "ECONNRESET" } });
  });

  it("DOMException は TimeoutError と AbortError のときだけ message を出し、それ以外は name だけを出す", () => {
    expect(
      serializeError(new DOMException("The operation timed out.", "TimeoutError"))
    ).toMatchObject({ name: "TimeoutError", message: "The operation timed out." });
    expect(
      serializeError(new DOMException("This operation was aborted", "AbortError"))
    ).toMatchObject({ name: "AbortError", message: "This operation was aborted" });
    const other = serializeError(new DOMException(KEY_FRAGMENT, "DataCloneError"));
    expect(other).toMatchObject({ name: "DataCloneError" });
    expect(other).not.toHaveProperty("message");
  });

  it("自前のエラーの message と stack は300文字で切る", () => {
    const result = serializeError(new ArxivHttpError("x".repeat(1000), 500));
    expect(result.message).toBe("x".repeat(300));
    expect((result.stack as string).length).toBeLessThanOrEqual(300);
  });

  it("getter が例外を投げても例外を投げず { name: 'SerializeError' } を返す", () => {
    const error = new Error("x");
    Object.defineProperty(error, "cause", {
      get() {
        throw new Error("boom");
      },
    });
    expect(serializeError(error)).toEqual({ name: "SerializeError" });
  });

  it("Error 以外の値は { type } を返す", () => {
    expect(serializeError(KEY_FRAGMENT)).toEqual({ type: "string" });
    expect(serializeError({ message: KEY_FRAGMENT })).toEqual({ type: "object" });
  });

  it("2 回通しても結果が変わらない（冪等）", () => {
    const once = serializeError(createRetryError());
    const twice = serializeError(once);
    expect(twice).toBe(once);
    // 形が同じでも serializeError が返していない値は素通りさせない
    expect(serializeError({ ...once })).toEqual({ type: "object" });
  });
});

describe("createLogger の出力", () => {
  it("各行が JSON で、level（文字列）・time（ISO）・service・msg を持つ", () => {
    const { logger, parsed } = createMemoryLogger();
    logger.info({ count: 1 }, "hello");
    logger.warn("plain");
    for (const line of parsed()) {
      expect(typeof line.level).toBe("string");
      expect(new Date(line.time as string).toISOString()).toBe(line.time);
      expect(line.service).toBe("lumina-api");
      expect(typeof line.msg).toBe("string");
    }
    expect(parsed()[0]).toMatchObject({ level: "info", msg: "hello", count: 1 });
    expect(parsed()[1]).toMatchObject({ level: "warn", msg: "plain" });
  });

  it("(d) 生の APICallError を渡しても本文とキー断片が出ない", () => {
    const { logger, lines, parsed } = createMemoryLogger();
    const err = createApiCallError();
    logger.error(err);
    logger.error({ err });
    logger.error(err, "embedding failed");
    logger.error({ error: err });
    expect(lines).toHaveLength(4);
    expect(lines.join("")).not.toContain("SECRET");
    expect(parsed().map((line) => line.msg)).toEqual(["log", "log", "embedding failed", "log"]);
    expect(parsed()[0]?.err).toMatchObject({ statusCode: 401 });
    expect(parsed()[3]?.error).toMatchObject({ statusCode: 401 });
  });

  it("(f) 入れ子のキーや format 引数で渡しても本文とキー断片が出ない", () => {
    const { logger, lines, parsed } = createMemoryLogger();
    const err = createApiCallError();
    logger.error({ e: err }, "x");
    logger.error({ ctx: { err } }, "x");
    logger.error("failed %o", err);
    logger.error("failed %s", err);
    expect(lines).toHaveLength(4);
    expect(lines.join("")).not.toContain("SECRET");
    expect(parsed()[0]?.e).toMatchObject({ statusCode: 401 });
    expect(parsed()[1]?.ctx).toMatchObject({ err: { statusCode: 401 } });
    expect(parsed()[2]?.msg).toBe("failed %o");
    expect(parsed()[3]?.msg).toBe("failed %s");
  });

  it("(g) %j の引数と child logger でも本文とキー断片が出ない", () => {
    const { logger, lines, parsed } = createMemoryLogger();
    const err = createApiCallError();
    logger.info("x %j", { e: err });
    logger.child({ reqId: "r" }).error(err);
    expect(lines.join("")).not.toContain("SECRET");
    expect(parsed()[0]?.msg).toBe("x %j");
    expect(parsed()[1]).toMatchObject({ reqId: "r", msg: "log", err: { statusCode: 401 } });
  });

  it("(h) 深さごとに Error・[Truncated]・plain でないオブジェクトを置き換える", () => {
    const { logger, lines, parsed } = createMemoryLogger();
    const err = createApiCallError();
    logger.error({ a: { b: { c: { d: err } } } }, "x");
    logger.error({ a: { b: { c: { d: { e: err } } } } }, "x");
    logger.error({ list: [[[[err]]]] }, "x");
    logger.error({ h: new Holder(err) }, "x");
    expect(lines.join("")).not.toContain("SECRET");
    const [deepError, deepObject, deepArray, holder] = parsed();
    expect(deepError).toMatchObject({ a: { b: { c: { d: { statusCode: 401 } } } } });
    expect(deepObject).toMatchObject({ a: { b: { c: { d: "[Truncated]" } } } });
    // マージ用オブジェクトは配列にできないため、[[[[[err]]]]] の外側1段を list キーで代える。
    // list（深さ1）から数えて深さ4の配列が [Truncated] になる
    expect(deepArray).toMatchObject({ list: [[["[Truncated]"]]] });
    expect(holder).toMatchObject({ h: { type: "Holder" } });
  });

  it("(i) トップレベルの msg・service・reqId キーは捨て、上書きさせない", () => {
    const { logger, lines, parsed } = createMemoryLogger();
    logger.error({ msg: KEY_FRAGMENT }, "x");
    logger.child({ reqId: "r" }).info({ service: "evil", reqId: "spoof" }, "x");
    expect(lines.join("")).not.toContain("SECRET");
    expect(lines.join("")).not.toContain("evil");
    expect(lines.join("")).not.toContain("spoof");
    expect(parsed()[0]?.msg).toBe("x");
    expect(parsed()[1]).toMatchObject({ service: "lumina-api", reqId: "r" });
  });

  it("循環参照・Date・走査中の例外を安全に扱う", () => {
    const { logger, parsed } = createMemoryLogger();
    const circular: Record<string, unknown> = { name: "c" };
    circular.self = circular;
    logger.info({ circular, at: new Date("2026-01-02T03:04:05.000Z") }, "x");
    const throwing = {};
    Object.defineProperty(throwing, "boom", {
      enumerable: true,
      get() {
        throw new Error(KEY_FRAGMENT);
      },
    });
    logger.info({ throwing }, "x");
    expect(parsed()[0]).toMatchObject({
      circular: { name: "c", self: "[Circular]" },
      at: "2026-01-02T03:04:05.000Z",
    });
    expect(parsed()[1]).toMatchObject({ logFormatError: true, msg: "x" });
  });

  it("関数（toJSON を含む）は捨て、戻り値を出さない", () => {
    const { logger, lines, parsed } = createMemoryLogger();
    logger.info({ x: { toJSON: () => KEY_FRAGMENT } }, "x");
    logger.info({ toJSON: () => KEY_FRAGMENT, list: [() => KEY_FRAGMENT] }, "x");
    expect(lines.join("")).not.toContain("SECRET");
    expect(parsed()[0]).toMatchObject({ x: {} });
    expect(parsed()[1]).not.toHaveProperty("toJSON");
    expect(parsed()[1]).toMatchObject({ list: [null] });
  });

  it("文字列は256文字で切って … を付け、配列は先頭20件にする（msg は切らない）", () => {
    const { logger, parsed } = createMemoryLogger();
    const longMsg = "m".repeat(300);
    logger.info(
      {
        exact: "e".repeat(256),
        long: "s".repeat(300),
        nested: { long: "n".repeat(300) },
        list: Array.from({ length: 30 }, (_, i) => i),
      },
      longMsg
    );
    const [line] = parsed();
    expect(line?.exact).toBe("e".repeat(256));
    expect(line?.long).toBe(`${"s".repeat(256)}…`);
    expect(line?.nested).toEqual({ long: `${"n".repeat(256)}…` });
    expect(line?.list).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(line?.msg).toBe(longMsg);
  });

  it("引数の正規化で例外が出ても例外を投げず、logFormatError の行を出す", () => {
    const { logger, parsed } = createMemoryLogger();
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(KEY_FRAGMENT);
        },
      }
    );
    expect(() => logger.info(hostile, "x")).not.toThrow();
    expect(parsed()[0]).toMatchObject({ logFormatError: true, msg: "log" });
  });

  it("出力先が例外を投げても、ログ呼び出しは例外を投げない", () => {
    const logger = createLogger({
      level: "trace",
      sink: {
        write: () => {
          throw new Error("sink failed");
        },
      },
    });
    expect(() => logger.info({ count: 1 }, "x")).not.toThrow();
    expect(() => logger.error(createApiCallError())).not.toThrow();
  });

  it("プリミティブを渡すと {} と既定の msg にする", () => {
    const { logger, parsed } = createMemoryLogger();
    logger.info(42 as unknown as string);
    expect(parsed()[0]?.msg).toBe("log");
  });

  it("元のオブジェクトを書き換えない", () => {
    const { logger } = createMemoryLogger();
    const err = createApiCallError();
    const payload = { nested: { err }, msg: "m" };
    logger.error(payload, "x");
    expect(payload.nested.err).toBe(err);
    expect(payload.msg).toBe("m");
  });
});

describe("既定の出力先（console）", () => {
  it("info と warn は console.log、error 以上は console.error だけに 1 行ずつ出す", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ level: "trace" });
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");
    expect(log.mock.calls.map(([line]) => JSON.parse(line as string).msg)).toEqual(["i", "w"]);
    expect(error.mock.calls.map(([line]) => JSON.parse(line as string).msg)).toEqual(["e", "f"]);
    // 末尾の改行は落とす
    expect(log.mock.calls[0]?.[0]).not.toMatch(/\n$/);
  });

  it("console が例外を投げても、ログ呼び出しは例外を投げない", () => {
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("console failed");
    });
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console failed");
    });
    const logger = createLogger({ level: "trace" });
    expect(() => logger.info("i")).not.toThrow();
    expect(() => logger.error("e")).not.toThrow();
  });

  it("既定の出力先でも本文とキー断片が出ない", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ level: "trace" });
    const err = createApiCallError();
    logger.error(err);
    logger.warn({ ctx: { err } }, "x");
    logger.error("failed %o", createRetryError());
    const output = [...log.mock.calls, ...error.mock.calls].flat().join("");
    expect(output).not.toBe("");
    expect(output).not.toContain("SECRET");
  });
});

describe("level の決め方", () => {
  it("LOG_LEVEL が不正な値（warning）でも例外を投げず info になる", () => {
    vi.stubEnv("LOG_LEVEL", "warning");
    vi.stubEnv("NODE_ENV", "test");
    let logger: ReturnType<typeof createLogger> | undefined;
    expect(() => {
      logger = createLogger({ sink: { write: () => {} } });
    }).not.toThrow();
    expect(logger?.level).toBe("info");
  });

  it("LOG_LEVEL が正しければそれを使う", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    expect(createLogger({ sink: { write: () => {} } }).level).toBe("debug");
  });

  it("LOG_LEVEL が未設定・空文字列で NODE_ENV=test なら silent", () => {
    vi.stubEnv("LOG_LEVEL", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(createLogger({ sink: { write: () => {} } }).level).toBe("silent");
  });

  it("引数の level が LOG_LEVEL より優先される", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    expect(createLogger({ level: "trace", sink: { write: () => {} } }).level).toBe("trace");
  });
});
