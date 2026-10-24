import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ArxivQueryOptions,
  ArxivRateLimitError,
  ArxivServiceUnavailableError,
  fetchArxivPapers,
  parseArxivEntry,
  resetArxivGateForTest,
} from "./arxivFetcher";

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

    it("全著者の所属を欠損・複数所属・同名でも順序どおり対応づける", () => {
      const authors = [
        "<author><name>Missing</name></author>",
        "<author><name>Same Name</name><arxiv:affiliation>OpenAI</arxiv:affiliation></author>",
        "<author><name>Same Name</name><arxiv:affiliation>Google</arxiv:affiliation><arxiv:affiliation>University</arxiv:affiliation></author>",
        "<author><name>Fourth</name><arxiv:affiliation>Google</arxiv:affiliation></author>",
      ];
      const paper = parseArxivEntry(authors.join(""));
      expect(paper.authors).toEqual(["Missing", "Same Name", "Same Name", "Fourth"]);
      expect(paper.authorAffiliations).toEqual([
        [],
        ["OpenAI"],
        ["Google", "University"],
        ["Google"],
      ]);

      const reordered = parseArxivEntry([...authors].reverse().join(""));
      expect(reordered.authors).toEqual([...paper.authors].reverse());
      expect(reordered.authorAffiliations).toEqual([...(paper.authorAffiliations ?? [])].reverse());
    });

    it("著者と所属のXMLテキストを復号し空白を整形、空所属と重複を除去する", () => {
      const paper = parseArxivEntry(`
        <author>
          <name> A &amp; B &#x43; &#68; </name>
          <arxiv:affiliation> Research &amp; Development &lt;Lab&gt; &quot;AI&quot; &apos;X&apos; </arxiv:affiliation>
          <arxiv:affiliation />
          <arxiv:affiliation>Open&#65;I &#x1F52C;</arxiv:affiliation>
          <arxiv:affiliation><![CDATA[ Google &amp; <Lab> ]]></arxiv:affiliation>
          <arxiv:affiliation>  OpenAI
            Research </arxiv:affiliation>
          <arxiv:affiliation>OpenAI Research</arxiv:affiliation>
          <arxiv:affiliation>  </arxiv:affiliation>
          <arxiv:affiliation />
        </author>
      `);
      expect(paper.authors).toEqual(["A & B C D"]);
      expect(paper.authorAffiliations).toEqual([
        [
          "Research & Development <Lab> \"AI\" 'X'",
          "OpenAI 🔬",
          "Google &amp; <Lab>",
          "OpenAI Research",
        ],
      ]);
    });

    it("所属なしと著者なしも全長の配列で返し、author以外のnameを含めない", () => {
      expect(
        parseArxivEntry("<author><name>Only Author</name></author>").authorAffiliations
      ).toEqual([[]]);
      const paper = parseArxivEntry("<contributor><name>Editor</name></contributor>");
      expect(paper.authors).toEqual([]);
      expect(paper.authorAffiliations).toEqual([]);
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
      // 前のテストの送信予約が残っていると送信間隔の待ちが発生するため初期化する
      resetArxivGateForTest();
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

    it("fromDate 指定時は search_query にその日付を開始日とした submittedDate 範囲を含める", async () => {
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
        fromDate: "2024-06-01",
      });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("search_query=");
      expect(url).toContain("submittedDate");
      expect(url).toContain("20240601");
      expect(url).toContain("TO");
    });

    it("toDate 指定時は search_query に [toDate − period, toDate] の submittedDate 範囲を含める", async () => {
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
        period: "30",
        toDate: "2024-06-15",
      });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("search_query=");
      expect(url).toContain("submittedDate");
      expect(url).toContain("20240615");
      expect(url).toContain("20240516");
      expect(url).toContain("TO");
    });
  });

  describe("送信間隔とエラー分類", () => {
    const emptyFeed = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults>
      </feed>`;
    const options: ArxivQueryOptions = { categories: ["cs.AI"], maxResults: 10 };

    beforeEach(() => {
      vi.useFakeTimers();
      resetArxivGateForTest();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(emptyFeed),
      } as Response);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("https の arXiv API に 25 秒のタイムアウト付きで送信する", async () => {
      await fetchArxivPapers(options);

      const [url, init] = vi.mocked(global.fetch).mock.calls[0];
      expect(url as string).toMatch(/^https:\/\/export\.arxiv\.org\/api\/query\?/);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("連続して呼ぶと 2 回目の送信は 1 回目から 3 秒後になる", async () => {
      await fetchArxivPapers(options);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const second = fetchArxivPapers(options);
      await vi.advanceTimersByTimeAsync(2999);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await second;
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("実行中の fetch が終わるまで 2 本目を送らない", async () => {
      let finishFirst = (): void => {};
      vi.mocked(global.fetch).mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirst = () =>
              resolve({ ok: true, text: () => Promise.resolve(emptyFeed) } as Response);
          })
      );

      const first = fetchArxivPapers(options);
      const second = fetchArxivPapers(options);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      finishFirst();
      await first;
      await vi.advanceTimersByTimeAsync(0);
      await second;
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("並んだ後に前のリクエストが 15 秒を超えて終わらなければ、送信せずに ArxivRateLimitError を投げる", async () => {
      let finishFirst = (): void => {};
      vi.mocked(global.fetch).mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishFirst = () =>
              resolve({ ok: true, text: () => Promise.resolve(emptyFeed) } as Response);
          })
      );

      const first = fetchArxivPapers(options);
      const second = fetchArxivPapers(options).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(15_000);
      const error = await second;
      expect(error).toBeInstanceOf(ArxivRateLimitError);
      expect((error as ArxivRateLimitError).retryAfterSec).toBe(3);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // 抜けた後も直列は保たれ、次のリクエストは実行中の fetch の完了まで送らない
      const third = fetchArxivPapers(options);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      finishFirst();
      await first;
      await vi.advanceTimersByTimeAsync(0);
      await third;
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("前のリクエストが失敗しても後続は 3 秒後に送信される", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

      const first = fetchArxivPapers(options).catch((error: unknown) => error);
      const second = fetchArxivPapers(options);
      expect(await first).toBeInstanceOf(ArxivServiceUnavailableError);

      await vi.advanceTimersByTimeAsync(2999);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await second;
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("見積もり待ち時間が 15 秒を超える場合は並ばずに ArxivRateLimitError を投げる", async () => {
      // 前にいる件数 × 3 秒 が 0, 3, 6, 9, 12, 15 秒の 6 件は受け付ける
      const accepted = Array.from({ length: 6 }, () => fetchArxivPapers(options));

      // 7 件目は 18 秒待ちの見積もりになるため即時に拒否される（超過 3 秒 + 3 秒）
      const rejected = await fetchArxivPapers(options).catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(ArxivRateLimitError);
      expect((rejected as ArxivRateLimitError).retryAfterSec).toBe(6);

      await vi.advanceTimersByTimeAsync(15_000);
      await Promise.all(accepted);
      expect(global.fetch).toHaveBeenCalledTimes(6);
    });

    it("タイムアウトは ArxivServiceUnavailableError になる", async () => {
      vi.mocked(global.fetch).mockRejectedValue(
        new DOMException("The operation was aborted due to timeout", "TimeoutError")
      );

      await expect(fetchArxivPapers(options)).rejects.toBeInstanceOf(ArxivServiceUnavailableError);
    });

    it("ネットワーク失敗（fetch の TypeError）は ArxivServiceUnavailableError になる", async () => {
      vi.mocked(global.fetch).mockRejectedValue(new TypeError("fetch failed"));

      await expect(fetchArxivPapers(options)).rejects.toBeInstanceOf(ArxivServiceUnavailableError);
    });

    it.each([502, 503, 504])("%i は ArxivServiceUnavailableError になる", async (status) => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status,
        statusText: "Bad Gateway",
        headers: new Headers(),
        text: () => Promise.resolve(""),
      } as Response);

      await expect(fetchArxivPapers(options)).rejects.toBeInstanceOf(ArxivServiceUnavailableError);
    });
  });
});
