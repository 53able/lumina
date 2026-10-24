const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MIN_INTERVAL_MS = 3_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 100;

export interface ArxivHtml {
  html: string;
  sourceUrl: string;
}

export class ArxivHtmlError extends Error {
  constructor(
    readonly status: 404 | 429 | 502 | 503,
    readonly retryAfter?: number
  ) {
    super("arXiv HTML could not be retrieved");
  }
}

const cache = new Map<string, { value: ArxivHtml; expiresAt: number }>();
let active = false;
let lastStartedAt = Number.NEGATIVE_INFINITY;

/** Reset module-scoped cache and admission gate between tests. */
export const resetArxivHtmlForTest = (): void => {
  cache.clear();
  active = false;
  lastStartedAt = Number.NEGATIVE_INFINITY;
};

const readBoundedHtml = async (response: Response): Promise<string> => {
  if (Number(response.headers.get("content-length")) > MAX_HTML_BYTES) {
    await response.body?.cancel();
    throw new ArxivHtmlError(502);
  }
  if (!response.body) throw new ArxivHtmlError(502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new ArxivHtmlError(502);
      }
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};

/** Fixed-host, bounded HTML retrieval. Callers validate the arXiv identifier first. */
export const fetchArxivHtml = async (paperId: string): Promise<ArxivHtml> => {
  const cached = cache.get(paperId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  cache.delete(paperId);

  const remaining = lastStartedAt + MIN_INTERVAL_MS - Date.now();
  if (active || remaining > 0) {
    throw new ArxivHtmlError(429, Math.max(1, Math.ceil(remaining / 1000), active ? 3 : 0));
  }

  active = true;
  lastStartedAt = Date.now();
  const sourceUrl = `https://arxiv.org/html/${paperId}`;
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new ArxivHtmlError(503));
    }, FETCH_TIMEOUT_MS);
  });
  try {
    const value = await Promise.race([
      (async () => {
        const response = await fetch(sourceUrl, {
          signal: controller.signal,
          redirect: "error",
          headers: { Accept: "text/html" },
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404) throw new ArxivHtmlError(404);
          if (response.status === 429 || response.status === 503) throw new ArxivHtmlError(503);
          throw new ArxivHtmlError(502);
        }
        if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
          await response.body?.cancel();
          throw new ArxivHtmlError(502);
        }
        const html = await readBoundedHtml(response);
        if (!html.trim()) throw new ArxivHtmlError(502);
        return { html, sourceUrl };
      })(),
      timeout,
    ]);
    cache.set(paperId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  } catch (error) {
    if (error instanceof ArxivHtmlError) throw error;
    throw new ArxivHtmlError(503);
  } finally {
    clearTimeout(timeoutId);
    active = false;
  }
};
