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

import { generateSummary, generateExplanation } from "../services/openai";

describe("要約API", () => {
  const app = createApp();
  const openAIKeyHeader = "test-openai-api-key";

  beforeEach(() => {
    vi.clearAllMocks();

    // generateSummaryのモック
    vi.mocked(generateSummary).mockResolvedValue({
      summary: "これは深層学習に関する論文の要約です。",
      keyPoints: ["キーポイント1", "キーポイント2", "キーポイント3"],
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
      // OpenAIサービスが呼ばれる
      expect(generateSummary).toHaveBeenCalledTimes(1);
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

    it("異常系: abstractありでAPIキーがない場合は500エラー", async () => {
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
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toContain("API key");
    });

  });
});
