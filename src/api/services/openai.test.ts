import type { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types/env";
import {
  createEmbedding,
  expandQuery,
  generateExplanation,
  generateSummary,
  getOpenAIConfig,
  type OpenAIConfig,
} from "./openai.js";

// AI SDKをモック
vi.mock("ai", () => ({
  embed: vi.fn(),
  generateText: vi.fn(),
}));

// モックをインポート
import { embed, generateText } from "ai";

describe("OpenAIサービス", () => {
  const mockConfig: OpenAIConfig = {
    apiKey: "test-api-key",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createEmbedding", () => {
    it("テキストから1536次元のEmbeddingベクトルを生成できる", async () => {
      // Arrange
      const mockEmbedding = Array(1536).fill(0.1);
      vi.mocked(embed).mockResolvedValue({
        embedding: mockEmbedding,
        usage: { tokens: 10 },
      } as Awaited<ReturnType<typeof embed>>);

      // Act
      const result = await createEmbedding("test text", mockConfig);

      // Assert
      expect(result.embedding).toHaveLength(1536);
      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.tokensUsed).toBe(10);
    });

    it("embed関数が正しいパラメータで呼ばれる", async () => {
      // Arrange
      vi.mocked(embed).mockResolvedValue({
        embedding: Array(1536).fill(0),
        usage: { tokens: 10 },
      } as Awaited<ReturnType<typeof embed>>);

      // Act
      await createEmbedding("test text", mockConfig);

      // Assert
      expect(embed).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(embed).mock.calls[0][0];
      expect(callArgs.value).toBe("test text");
    });

    it("APIエラー時は例外をスローする", async () => {
      // Arrange
      vi.mocked(embed).mockRejectedValue(new Error("OpenAI API error: Invalid API key"));

      // Act & Assert
      await expect(createEmbedding("test", mockConfig)).rejects.toThrow("OpenAI API error");
    });
  });

  describe("expandQuery", () => {
    it("日本語クエリを英訳し、同義語を拡張できる", async () => {
      // Arrange
      const mockResponse = {
        original: "深層学習",
        english: "deep learning",
        synonyms: ["neural network", "machine learning", "AI"],
        searchText: "deep learning neural network",
      };
      vi.mocked(generateText).mockResolvedValue({
        text: JSON.stringify(mockResponse),
      } as Awaited<ReturnType<typeof generateText>>);

      // Act
      const result = await expandQuery("深層学習", mockConfig);

      // Assert
      expect(result.original).toBe("深層学習");
      expect(result.english).toBe("deep learning");
      expect(result.synonyms).toEqual(["neural network", "machine learning", "AI"]);
      expect(result.searchText).toBe("deep learning neural network");
    });

    it("英語クエリはそのまま処理される", async () => {
      // Arrange
      const mockResponse = {
        original: "machine learning",
        english: "machine learning",
        synonyms: ["deep learning", "AI", "statistical learning"],
        searchText: "machine learning AI",
      };
      vi.mocked(generateText).mockResolvedValue({
        text: JSON.stringify(mockResponse),
      } as Awaited<ReturnType<typeof generateText>>);

      // Act
      const result = await expandQuery("machine learning", mockConfig);

      // Assert
      expect(result.original).toBe("machine learning");
      expect(result.english).toBe("machine learning");
    });
  });

  describe("generateSummary", () => {
    it("論文アブストラクトから日本語要約を生成できる", async () => {
      // Arrange
      const mockResponse = {
        summary: "この論文は深層学習の新しい手法を提案しています。",
        keyPoints: ["新しいアーキテクチャの提案", "従来手法より高い精度", "計算コストの削減"],
      };
      vi.mocked(generateText).mockResolvedValue({
        text: JSON.stringify(mockResponse),
      } as Awaited<ReturnType<typeof generateText>>);

      // Act
      const result = await generateSummary(
        "This paper proposes a new deep learning method...",
        "ja",
        mockConfig
      );

      // Assert
      expect(result.summary).toContain("深層学習");
      expect(result.keyPoints).toHaveLength(3);
    });

    it("英語要約も生成できる", async () => {
      // Arrange
      const mockResponse = {
        summary: "This paper proposes a new deep learning method.",
        keyPoints: ["Novel architecture", "Higher accuracy", "Reduced computational cost"],
      };
      vi.mocked(generateText).mockResolvedValue({
        text: JSON.stringify(mockResponse),
      } as Awaited<ReturnType<typeof generateText>>);

      // Act
      const result = await generateSummary(
        "This paper proposes a new deep learning method...",
        "en",
        mockConfig
      );

      // Assert
      expect(result.summary).toContain("deep learning");
      expect(result.keyPoints).toHaveLength(3);
    });

    it("generateText関数が言語に応じた正しいsystemプロンプトで呼ばれる", async () => {
      // Arrange
      const mockResponse = {
        summary: "要約テスト",
        keyPoints: ["ポイント1"],
      };
      vi.mocked(generateText).mockResolvedValue({
        text: JSON.stringify(mockResponse),
      } as Awaited<ReturnType<typeof generateText>>);

      // Act
      await generateSummary("test abstract", "ja", mockConfig);

      // Assert
      expect(generateText).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(generateText).mock.calls[0][0];
      expect(callArgs.system).toContain("Japanese");
      expect(callArgs.prompt).toContain("test abstract");
    });
  });

  describe("generateExplanation", () => {
    it("正常系: 論文アブストラクトから認知負荷最適化説明文を日本語で生成できる", async () => {
      // Arrange
      const mockResponse = {
        explanation:
          "大規模言語モデルの学習コストに悩んでいませんか？この論文では従来の3分の1の計算リソースで同等の性能を実現する新手法を提案しています。",
        targetAudience: "LLMの効率化に関心のある研究者・エンジニア",
        whyRead: "学習コストの大幅削減により、限られたリソースでも最先端モデルの開発が可能に",
      };
      vi.mocked(generateText).mockResolvedValue({
        text: JSON.stringify(mockResponse),
      } as Awaited<ReturnType<typeof generateText>>);

      const abstract =
        "We propose a novel efficient training method for large language models that reduces computational cost by 66% while maintaining performance.";

      // Act
      const result = await generateExplanation(abstract, "ja", mockConfig);

      // Assert
      expect(result.explanation).toContain("悩んでいませんか");
      expect(result.targetAudience).toBeDefined();
      expect(result.whyRead).toBeDefined();
    });

    it("正常系: 英語でも認知負荷最適化説明文を生成できる", async () => {
      // Arrange
      const mockResponse = {
        explanation:
          "Struggling with the computational costs of training large language models? This paper presents a method that achieves the same performance with one-third of the resources.",
        targetAudience: "Researchers and engineers interested in LLM efficiency",
        whyRead:
          "Significant reduction in training costs enables cutting-edge model development with limited resources",
      };
      vi.mocked(generateText).mockResolvedValue({
        text: JSON.stringify(mockResponse),
      } as Awaited<ReturnType<typeof generateText>>);

      const abstract =
        "We propose a novel efficient training method for large language models that reduces computational cost by 66% while maintaining performance.";

      // Act
      const result = await generateExplanation(abstract, "en", mockConfig);

      // Assert
      expect(result.explanation).toContain("Struggling");
      expect(result.targetAudience).toBeDefined();
      expect(result.whyRead).toBeDefined();
    });

    it("システムプロンプトに読者視点の説明文生成指示が含まれる", async () => {
      // Arrange
      const mockResponse = {
        explanation: "テスト説明文",
        targetAudience: "テスト対象者",
        whyRead: "読む理由テスト",
      };
      vi.mocked(generateText).mockResolvedValue({
        text: JSON.stringify(mockResponse),
      } as Awaited<ReturnType<typeof generateText>>);

      // Act
      await generateExplanation("test abstract", "ja", mockConfig);

      // Assert
      expect(generateText).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(generateText).mock.calls[0][0];
      // 認知負荷最適化のためのキーワードがプロンプトに含まれることを確認
      expect(callArgs.system).toMatch(/cognitive|reader|audience|problem/i);
    });
  });

  describe("getOpenAIConfig", () => {
    /**
     * Hono Contextのモックを作成するヘルパー関数
     */
    const createMockContext = (options: {
      headerKey?: string;
      envKey?: string;
      nodeEnv?: string;
    }): Context<{ Bindings: Env }> => {
      const { headerKey, envKey, nodeEnv } = options;
      return {
        req: {
          header: vi.fn((name: string) => {
            if (name === "X-OpenAI-API-Key") {
              return headerKey;
            }
            return undefined;
          }),
        },
        env: {
          OPENAI_API_KEY: envKey,
          NODE_ENV: nodeEnv,
        } as Env,
      } as unknown as Context<{ Bindings: Env }>;
    };

    it("正常系: 開発環境でヘッダーからAPIキーを取得できる", () => {
      // Arrange
      const mockContext = createMockContext({
        headerKey: "header-api-key",
        nodeEnv: "development",
      });

      // Act
      const result = getOpenAIConfig(mockContext);

      // Assert
      expect(result.apiKey).toBe("header-api-key");
    });

    it("正常系: 開発環境で環境変数からAPIキーを取得できる（ヘッダーなし）", () => {
      // Arrange
      const mockContext = createMockContext({
        envKey: "env-api-key",
        nodeEnv: "development",
      });

      // Act
      const result = getOpenAIConfig(mockContext);

      // Assert
      expect(result.apiKey).toBe("env-api-key");
    });

    it("正常系: 開発環境で環境変数からAPIキーを取得できる（NODE_ENV未設定）", () => {
      // Arrange
      const mockContext = createMockContext({
        envKey: "env-api-key",
      });

      // Act
      const result = getOpenAIConfig(mockContext);

      // Assert
      expect(result.apiKey).toBe("env-api-key");
    });

    it("正常系: 本番環境でヘッダーからAPIキーを取得できる", () => {
      // Arrange
      const mockContext = createMockContext({
        headerKey: "header-api-key",
        envKey: "env-api-key",
        nodeEnv: "production",
      });

      // Act
      const result = getOpenAIConfig(mockContext);

      // Assert
      expect(result.apiKey).toBe("header-api-key");
    });

    it("正常系: 本番環境で環境変数を使用しない（ヘッダーのみ）", () => {
      // Arrange
      const mockContext = createMockContext({
        envKey: "env-api-key",
        nodeEnv: "production",
      });

      // Act & Assert
      expect(() => getOpenAIConfig(mockContext)).toThrow("OpenAI API key is not configured");
    });

    it("異常系: 開発環境でヘッダーも環境変数もない場合はエラー", () => {
      // Arrange
      const mockContext = createMockContext({
        nodeEnv: "development",
      });

      // Act & Assert
      expect(() => getOpenAIConfig(mockContext)).toThrow("OpenAI API key is not configured");
    });

    it("異常系: 本番環境でヘッダーも環境変数もない場合はエラー", () => {
      // Arrange
      const mockContext = createMockContext({
        nodeEnv: "production",
      });

      // Act & Assert
      expect(() => getOpenAIConfig(mockContext)).toThrow("OpenAI API key is not configured");
    });
  });
});
