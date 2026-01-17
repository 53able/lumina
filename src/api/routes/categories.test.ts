import { describe, expect, it } from "vitest";
import { createApp } from "../app";

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
      const body = await response.json();
      expect(body).toHaveProperty("categories");
      expect(body).toHaveProperty("defaultCategoryIds");
      expect(Array.isArray(body.categories)).toBe(true);
      expect(Array.isArray(body.defaultCategoryIds)).toBe(true);
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
      const body = await response.json();
      const firstCategory = body.categories[0];
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
      const body = await response.json();
      expect(body.defaultCategoryIds).toEqual(expect.arrayContaining(expectedDefaults));
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
      const body = await response.json();
      const csCategories = body.categories.filter(
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
