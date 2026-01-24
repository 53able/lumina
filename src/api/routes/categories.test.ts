import { describe, expect, it } from "vitest";
import { CategoryListResponseSchema } from "../../shared/schemas/category.js";
import { createApp } from "../app.js";

describe("カテゴリ情報取得API", () => {
  const app = createApp();

  describe("GET /api/v1/categories", () => {
    it("正常系: カテゴリ一覧を取得できる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from("admin:admin").toString("base64")}`,
        },
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const data = CategoryListResponseSchema.parse(await response.json());
      expect(data.categories).toBeDefined();
      expect(data.defaultCategoryIds).toBeDefined();
      expect(Array.isArray(data.categories)).toBe(true);
      expect(Array.isArray(data.defaultCategoryIds)).toBe(true);
    });

    it("正常系: カテゴリにはid, name, group, isDefaultプロパティが含まれる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from("admin:admin").toString("base64")}`,
        },
      });

      // Act
      const response = await app.request(request);

      // Assert
      const data = CategoryListResponseSchema.parse(await response.json());
      const firstCategory = data.categories[0];
      expect(firstCategory).toHaveProperty("id");
      expect(firstCategory).toHaveProperty("name");
      expect(firstCategory).toHaveProperty("group");
      expect(firstCategory).toHaveProperty("isDefault");
    });

    it("正常系: デフォルトカテゴリが含まれる（cs.AI, cs.LG, cs.CL, stat.ML）", async () => {
      // Arrange
      const expectedDefaults = ["cs.AI", "cs.LG", "cs.CL", "stat.ML"];
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from("admin:admin").toString("base64")}`,
        },
      });

      // Act
      const response = await app.request(request);

      // Assert
      const data = CategoryListResponseSchema.parse(await response.json());
      expect(data.defaultCategoryIds).toEqual(expect.arrayContaining(expectedDefaults));
    });

    it("正常系: Computer Scienceグループのカテゴリが含まれる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from("admin:admin").toString("base64")}`,
        },
      });

      // Act
      const response = await app.request(request);

      // Assert
      const data = CategoryListResponseSchema.parse(await response.json());
      const csCategories = data.categories.filter(
        (c: { group: string }) => c.group === "Computer Science"
      );
      expect(csCategories.length).toBeGreaterThan(0);
    });

    it("異常系: 認証なしの場合は401エラーを返す", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(401);
    });
  });
});
