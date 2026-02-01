import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ArxivQueryOptions, fetchArxivPapers, parseArxivEntry } from "./arxivFetcher";

describe("arXivFetcher", () => {
  describe("parseArxivEntry", () => {
    it("arXiv APIレスポンスのエントリを Paper オブジェクトにパースできる", () => {
      // Arrange
      const mockEntry = `
        <entry>
          <id>http://arxiv.org/abs/2401.12345v1</id>
          <title>Test Paper Title</title>
          <summary>This is a test abstract for the paper.</summary>
          <author><name>John Doe</name></author>
          <author><name>Jane Smith</name></author>
          <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
          <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
          <published>2024-01-15T00:00:00Z</published>
          <updated>2024-01-16T00:00:00Z</updated>
          <link href="http://arxiv.org/abs/2401.12345v1" rel="alternate" type="text/html"/>
          <link href="http://arxiv.org/pdf/2401.12345v1.pdf" title="pdf" rel="related" type="application/pdf"/>
        </entry>
      `;

      // Act
      const paper = parseArxivEntry(mockEntry);

      // Assert
      expect(paper.id).toBe("2401.12345");
      expect(paper.title).toBe("Test Paper Title");
      expect(paper.abstract).toBe("This is a test abstract for the paper.");
      expect(paper.authors).toEqual(["John Doe", "Jane Smith"]);
      expect(paper.categories).toEqual(["cs.AI", "cs.LG"]);
      expect(paper.pdfUrl).toBe("http://arxiv.org/pdf/2401.12345v1.pdf");
      expect(paper.arxivUrl).toBe("http://arxiv.org/abs/2401.12345v1");
    });

    it("バージョン番号なしのIDを正しく抽出できる", () => {
      // Arrange
      const mockEntry = `
        <entry>
          <id>http://arxiv.org/abs/2401.12345</id>
          <title>Test Paper</title>
          <summary>Abstract</summary>
          <author><name>Author</name></author>
          <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
          <published>2024-01-15T00:00:00Z</published>
          <updated>2024-01-16T00:00:00Z</updated>
          <link href="http://arxiv.org/abs/2401.12345" rel="alternate" type="text/html"/>
          <link href="http://arxiv.org/pdf/2401.12345.pdf" title="pdf" rel="related" type="application/pdf"/>
        </entry>
      `;

      // Act
      const paper = parseArxivEntry(mockEntry);

      // Assert
      expect(paper.id).toBe("2401.12345");
    });

    it("古い形式のarXiv ID（math.GT/0309136）を正しく抽出できる", () => {
      // Arrange
      const mockEntry = `
        <entry>
          <id>http://arxiv.org/abs/math.GT/0309136v2</id>
          <title>Old Format Paper</title>
          <summary>Abstract</summary>
          <author><name>Author</name></author>
          <category term="math.GT" scheme="http://arxiv.org/schemas/atom"/>
          <published>2003-09-10T00:00:00Z</published>
          <updated>2003-09-11T00:00:00Z</updated>
          <link href="http://arxiv.org/abs/math.GT/0309136v2" rel="alternate" type="text/html"/>
          <link href="http://arxiv.org/pdf/math.GT/0309136v2.pdf" title="pdf" rel="related" type="application/pdf"/>
        </entry>
      `;

      // Act
      const paper = parseArxivEntry(mockEntry);

      // Assert
      expect(paper.id).toBe("math.GT/0309136");
    });
  });

  describe("fetchArxivPapers", () => {
    beforeEach(() => {
      // fetchをモック
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("arXiv APIから論文データを取得できる", async () => {
      // Arrange
      const mockResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">2</opensearch:totalResults>
          <entry>
            <id>http://arxiv.org/abs/2401.00001v1</id>
            <title>Paper 1</title>
            <summary>Abstract 1</summary>
            <author><name>Author 1</name></author>
            <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
            <published>2024-01-01T00:00:00Z</published>
            <updated>2024-01-01T00:00:00Z</updated>
            <link href="http://arxiv.org/abs/2401.00001v1" rel="alternate" type="text/html"/>
            <link href="http://arxiv.org/pdf/2401.00001v1.pdf" title="pdf" rel="related" type="application/pdf"/>
          </entry>
          <entry>
            <id>http://arxiv.org/abs/2401.00002v1</id>
            <title>Paper 2</title>
            <summary>Abstract 2</summary>
            <author><name>Author 2</name></author>
            <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
            <published>2024-01-02T00:00:00Z</published>
            <updated>2024-01-02T00:00:00Z</updated>
            <link href="http://arxiv.org/abs/2401.00002v1" rel="alternate" type="text/html"/>
            <link href="http://arxiv.org/pdf/2401.00002v1.pdf" title="pdf" rel="related" type="application/pdf"/>
          </entry>
        </feed>
      `;

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockResponse),
      } as Response);

      const options: ArxivQueryOptions = {
        categories: ["cs.AI", "cs.LG"],
        maxResults: 10,
      };

      // Act
      const result = await fetchArxivPapers(options);

      // Assert
      expect(result.papers).toHaveLength(2);
      expect(result.papers[0].id).toBe("2401.00001");
      expect(result.papers[1].id).toBe("2401.00002");
      expect(result.totalResults).toBe(2);
    });

    it("カテゴリを指定してクエリを構築できる", async () => {
      // Arrange
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults>
          </feed>`),
      } as Response);

      const options: ArxivQueryOptions = {
        categories: ["cs.AI", "cs.LG"],
        maxResults: 50,
      };

      // Act
      await fetchArxivPapers(options);

      // Assert（search_query はエンコードされるため cs.AI / cs.LG で検証）
      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("search_query=");
      expect(url).toContain("cs.AI");
      expect(url).toContain("cs.LG");
      expect(url).toContain("max_results=50");
    });

    it("APIエラー時は例外をスローする", async () => {
      // Arrange
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve(""),
      } as Response);

      const options: ArxivQueryOptions = {
        categories: ["cs.AI"],
        maxResults: 10,
      };

      // Act & Assert
      await expect(fetchArxivPapers(options)).rejects.toThrow("arXiv API error");
    });

    it("period 指定時は search_query に submittedDate 範囲を含める", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults>
          </feed>`),
      } as Response);

      await fetchArxivPapers({
        categories: ["cs.AI"],
        maxResults: 50,
        period: "7",
      });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("search_query=");
      expect(url).toContain("submittedDate");
      expect(url).toContain("TO");
    });
  });
});
