import { RetryError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";

// OpenAIサービスをモック
vi.mock("../services/openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/openai")>();
  return {
    ...original,
    generateSummary: vi.fn(),
    generateExplanation: vi.fn(),
  };
});

import { generateExplanation, generateSummary } from "../services/openai";

describe("要約API", () => {
  const app = createApp();
  const openAIKeyHeader = "test-openai-api-key";

  beforeEach(() => {
    vi.clearAllMocks();

    // generateSummaryのモック
    vi.mocked(generateSummary).mockResolvedValue({
      summary: "これは深層学習に関する論文の要約です。",
      keyPoints: ["キーポイント1", "キーポイント2", "キーポイント3"],
      keyPointEvidence: [
        [{ index: 0, text: "This paper presents a new deep learning method..." }],
        [],
        [],
      ],
    });

    // generateExplanationのモック
    vi.mocked(generateExplanation).mockResolvedValue({
      explanation: "深層学習に関する説明文です。",
      targetAudience: "機械学習研究者",
      whyRead: "最新の深層学習手法を理解できる",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/summary/:id", () => {
    it("正常系: abstractなしでスタブ要約を生成できる", async () => {
      // Arrange
      const paperId = "2401.12345";
      const request = new Request(`http://localhost/api/v1/summary/${paperId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: "ja",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("paperId");
      expect(body).toHaveProperty("summary");
      expect(body).toHaveProperty("keyPoints");
      expect(body).toHaveProperty("language");
      expect(body).toHaveProperty("createdAt");
      expect(body.paperId).toBe(paperId);
      expect(body.language).toBe("ja");
      // OpenAIサービスは呼ばれない
      expect(generateSummary).not.toHaveBeenCalled();
    });

    it("正常系: abstractありでOpenAI APIを使用して要約を生成できる", async () => {
      // Arrange
      const paperId = "2401.12345";
      const request = new Request(`http://localhost/api/v1/summary/${paperId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          language: "ja",
          abstract: "This paper presents a new deep learning method...",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.summary).toBe("これは深層学習に関する論文の要約です。");
      expect(body.keyPoints).toHaveLength(3);
      // キーポイントごとの根拠（サーバーで Abstract に実在すると確かめた文）を返す
      expect(body.keyPointEvidence).toEqual([
        [{ index: 0, text: "This paper presents a new deep learning method..." }],
        [],
        [],
      ]);
      // OpenAIサービスが呼ばれる
      expect(generateSummary).toHaveBeenCalledTimes(1);
    });

    it("異常系: Abstract が上限（10,000文字）を超える場合は、AI呼び出しや文分割の前に400で返す", async () => {
      const response = await app.request(
        new Request("http://localhost/api/v1/summary/2401.12345", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": "fake-key" },
          body: JSON.stringify({ language: "ja", abstract: "A. ".repeat(4_000) }),
        })
      );

      expect(response.status).toBe(400);
      expect(generateSummary).not.toHaveBeenCalled();
      expect(generateExplanation).not.toHaveBeenCalled();
    });

    it("正常系: 要約を生成しない場合（スタブ・説明文のみ）は根拠を返さない", async () => {
      const stub = await app.request(
        new Request("http://localhost/api/v1/summary/2401.12345", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: "ja" }),
        })
      );
      expect(await stub.json()).not.toHaveProperty("keyPointEvidence");

      const explanationOnly = await app.request(
        new Request("http://localhost/api/v1/summary/2401.12345", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": openAIKeyHeader },
          body: JSON.stringify({
            language: "ja",
            abstract: "This paper presents a new deep learning method...",
            generateTarget: "explanation",
          }),
        })
      );
      expect(await explanationOnly.json()).not.toHaveProperty("keyPointEvidence");
    });

    it("正常系: 英語で要約を生成できる", async () => {
      // Arrange
      const paperId = "2401.12345";
      const request = new Request(`http://localhost/api/v1/summary/${paperId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: "en",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.language).toBe("en");
    });

    it("正常系: keyPointsは配列で返される", async () => {
      // Arrange
      const paperId = "2401.12345";
      const request = new Request(`http://localhost/api/v1/summary/${paperId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: "ja",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      const body = await response.json();
      expect(Array.isArray(body.keyPoints)).toBe(true);
    });

    it("異常系: 無効な言語の場合は400エラー", async () => {
      // Arrange
      const paperId = "2401.12345";
      const request = new Request(`http://localhost/api/v1/summary/${paperId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: "invalid",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(400);
    });

    describe("工程別の失敗（部分成功）", () => {
      const postSummary = (generateTarget: "both" | "explanation") =>
        app.request(
          new Request("http://localhost/api/v1/summary/2401.12345", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-OpenAI-API-Key": openAIKeyHeader,
            },
            body: JSON.stringify({
              language: "ja",
              abstract: "This paper presents a new deep learning method...",
              generateTarget,
            }),
          })
        );

      it("正常系: 説明文だけが失敗した場合は、成功済みの要約と explanationError を200で返す", async () => {
        vi.mocked(generateExplanation).mockRejectedValueOnce(
          new Error("upstream timeout: sk-secret-detail")
        );

        const response = await postSummary("both");

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.summary).toBe("これは深層学習に関する論文の要約です。");
        expect(body.keyPoints).toHaveLength(3);
        expect(body.explanationError).toEqual({ code: "upstream", retryable: true });
        // 上流のエラー文は応答に含めない
        expect(JSON.stringify(body)).not.toContain("sk-secret-detail");
        expect(body).not.toHaveProperty("explanation");
        expect(generateSummary).toHaveBeenCalledTimes(1);
        expect(generateExplanation).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["429", Object.assign(new Error("rate limited"), { statusCode: 429 }), "rate_limit", true],
        [
          "RetryError に包まれた429",
          new RetryError({
            message: "Failed after 3 attempts",
            reason: "maxRetriesExceeded",
            errors: [Object.assign(new Error("rate limited"), { statusCode: 429 })],
          }),
          "rate_limit",
          true,
        ],
        ["401", Object.assign(new Error("invalid key"), { statusCode: 401 }), "auth", false],
        ["JSONの解析失敗", new SyntaxError("Unexpected token"), "invalid_output", true],
      ])("正常系: 説明文の失敗（%s）を安全な分類で返す", async (_label, error, code, retryable) => {
        vi.mocked(generateExplanation).mockRejectedValueOnce(error);

        const response = await postSummary("both");

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.explanationError).toEqual({ code, retryable });
      });

      it("正常系: 両方成功した場合は explanationError を含めない", async () => {
        const response = await postSummary("both");

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.explanation).toBe("深層学習に関する説明文です。");
        expect(body).not.toHaveProperty("explanationError");
      });

      it("異常系: 要約が失敗した場合は500を返し、説明文は生成しない", async () => {
        vi.mocked(generateSummary).mockRejectedValueOnce(new Error("upstream timeout"));

        const response = await postSummary("both");

        expect(response.status).toBe(500);
        expect(generateExplanation).not.toHaveBeenCalled();
      });

      it("異常系: 説明文のみの生成（再試行）が失敗した場合は500を返し、要約は生成しない", async () => {
        vi.mocked(generateExplanation).mockRejectedValueOnce(new Error("upstream timeout"));

        const response = await postSummary("explanation");

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toEqual({
          error: "要約の生成に失敗しました",
          code: "upstream",
          retryable: true,
        });
        expect(generateSummary).not.toHaveBeenCalled();
      });
    });

    describe("全体の失敗（上流のエラー文を返さない）", () => {
      const upstreamMessage = "Incorrect API key provided: sk-proj-abcd...wxyz";

      const postSummary = (generateTarget: "both" | "explanation") =>
        app.request(
          new Request("http://localhost/api/v1/summary/2401.12345", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-OpenAI-API-Key": openAIKeyHeader,
            },
            body: JSON.stringify({
              language: "ja",
              abstract: "This paper presents a new deep learning method...",
              generateTarget,
            }),
          })
        );

      it.each([
        [401, 401, "auth", false],
        [403, 401, "auth", false],
        [429, 429, "rate_limit", true],
        [500, 500, "upstream", true],
      ] as const)("異常系: 要約の工程が上流 %s で失敗した場合は %s・安全な分類だけを返す", async (upstreamStatus, status, code, retryable) => {
        vi.mocked(generateSummary).mockRejectedValueOnce(
          Object.assign(new Error(upstreamMessage), { statusCode: upstreamStatus })
        );

        const response = await postSummary("both");

        expect(response.status).toBe(status);
        const body = await response.json();
        expect(body).toEqual({ error: "要約の生成に失敗しました", code, retryable });
        expect(JSON.stringify(body)).not.toContain("sk-");
        expect(JSON.stringify(body)).not.toContain("Incorrect API key");
      });

      it("異常系: RetryError に包まれた429も rate_limit として429で返す", async () => {
        vi.mocked(generateSummary).mockRejectedValueOnce(
          new RetryError({
            message: `Failed after 3 attempts. Last error: ${upstreamMessage}`,
            reason: "maxRetriesExceeded",
            errors: [Object.assign(new Error(upstreamMessage), { statusCode: 429 })],
          })
        );

        const response = await postSummary("both");

        expect(response.status).toBe(429);
        const body = await response.json();
        expect(body).toEqual({
          error: "要約の生成に失敗しました",
          code: "rate_limit",
          retryable: true,
        });
      });

      it("異常系: 説明文のみの生成が上流の認証エラーで失敗しても上流の文言を返さない", async () => {
        vi.mocked(generateExplanation).mockRejectedValueOnce(
          Object.assign(new Error(upstreamMessage), { statusCode: 401 })
        );

        const response = await postSummary("explanation");

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body).toEqual({ error: "要約の生成に失敗しました", code: "auth", retryable: false });
        expect(JSON.stringify(body)).not.toContain("sk-");
      });
    });

    it("異常系: abstractありでAPIキーがない場合は401（auth）を返す", async () => {
      // Arrange
      const paperId = "2401.12345";
      const request = new Request(`http://localhost/api/v1/summary/${paperId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // X-OpenAI-API-Key を省略
        },
        body: JSON.stringify({
          language: "ja",
          abstract: "This paper presents...",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({ error: "要約の生成に失敗しました", code: "auth", retryable: false });
    });
  });
});
