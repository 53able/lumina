import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { resetArxivHtmlForTest } from "../services/arxivHtml";

const htmlResponse = (html = "<html><body>University</body></html>") =>
  new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });

describe("GET /api/v1/affiliations", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const request = (id: string) =>
    createApp().request(`/api/v1/affiliations?paperId=${encodeURIComponent(id)}`);

  beforeEach(() => {
    resetArxivHtmlForTest();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    "",
    "https://example.com",
    "../2401.12345",
    "2401.12345?url=other",
    "2401.12345#x",
  ])("rejects invalid identifiers without upstream requests: %s", async (id) => {
    expect((await request(id)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "2401.12345",
    "2401.12345v2",
    "hep-th/9901001v1",
    "math.GT/0309136",
  ])("fetches only the fixed arXiv HTML URL for %s", async (id) => {
    fetchMock.mockResolvedValue(htmlResponse());
    const response = await request(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      html: "<html><body>University</body></html>",
      sourceUrl: `https://arxiv.org/html/${id}`,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://arxiv.org/html/${id}`,
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) })
    );
  });

  it("serves successful results from cache without another upstream request", async () => {
    fetchMock.mockResolvedValue(htmlResponse());
    expect((await request("2401.12345")).status).toBe(200);
    expect((await request("2401.12345")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expires successful cache entries after one day", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => htmlResponse());
    expect((await request("2401.12345")).status).toBe(200);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect((await request("2401.12345")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("limits cache storage to 100 entries", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => htmlResponse());
    for (let index = 0; index <= 100; index += 1) {
      expect((await request(`2401.${String(index).padStart(5, "0")}`)).status).toBe(200);
      vi.advanceTimersByTime(3000);
    }
    expect((await request("2401.00000")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(102);
  });

  it("enforces a three second interval between upstream starts", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => htmlResponse());
    expect((await request("2401.12345")).status).toBe(200);
    const limited = await request("2401.12346");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect((await request("2401.12346")).status).toBe(200);
  });

  it("allows only one active upstream request", async () => {
    vi.useFakeTimers();
    let finish: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const first = request("2401.12345");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(3000);
    expect((await request("2401.12346")).status).toBe(429);
    finish?.(htmlResponse());
    expect((await first).status).toBe(200);
  });

  it.each([
    [404, 404],
    [429, 503],
    [503, 503],
    [500, 502],
    [302, 502],
  ])("maps upstream %i to %i without exposing the upstream body", async (upstream, expected) => {
    fetchMock.mockResolvedValue(new Response("private upstream details", { status: upstream }));
    const response = await request("2401.12345");
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain("private upstream details");
  });

  it("handles network failure without exposing its details", async () => {
    fetchMock.mockRejectedValue(new TypeError("secret upstream details"));
    const response = await request("2401.12345");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret upstream details");
  });

  it("times out requests even if upstream never resolves", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const pending = request("2401.12345");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).status).toBe(503);
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.signal?.aborted).toBe(true);
  });

  it("includes a stalled response body in the timeout", async () => {
    vi.useFakeTimers();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            bodyController = controller;
            controller.enqueue(new TextEncoder().encode("<html>"));
          },
        }),
        { headers: { "content-type": "text/html" } }
      )
    );
    const pending = request("2401.12345");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).status).toBe(503);
    bodyController?.error(new Error("aborted body"));
  });

  it("rejects non-HTML responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("%PDF", { headers: { "content-type": "application/pdf" } })
    );
    expect((await request("2401.12345")).status).toBe(502);
  });

  it("rejects content-length above the byte limit before reading", async () => {
    const response = htmlResponse();
    response.headers.set("content-length", String(2 * 1024 * 1024 + 1));
    fetchMock.mockResolvedValue(response);
    expect((await request("2401.12345")).status).toBe(502);
  });

  it("enforces the streamed byte limit without a content-length header", async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(2 * 1024 * 1024));
            controller.enqueue(new Uint8Array(1));
          },
          cancel,
        }),
        { headers: { "content-type": "text/html" } }
      )
    );
    expect((await request("2401.12345")).status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
