// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/paper";

const paper: Paper = {
  id: "2403.17281",
  title: "Title",
  abstract: "",
  authors: ["Alice"],
  categories: [],
  publishedAt: new Date(),
  updatedAt: new Date(),
  arxivUrl: "https://arxiv.org/abs/2403.17281",
  pdfUrl: "https://arxiv.org/pdf/2403.17281",
};
const response = () =>
  new Response(
    JSON.stringify({
      html: '<div class="ltx_authors"><span class="ltx_contact ltx_role_affiliation">Example University</span></div>',
    }),
    { headers: { "Content-Type": "application/json" } }
  );
describe("affiliation request queue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("shares card/detail requests, retaining an active second consumer", async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    const { loadPaperAffiliations } = await import("./loadPaperAffiliations");
    let firstActive = true;
    const first = loadPaperAffiliations(paper, () => firstActive);
    const second = loadPaperAffiliations(paper, () => true);
    firstActive = false;
    await vi.runAllTimersAsync();
    expect(await first).toEqual(await second);
    expect((await second)?.organizations).toEqual(["Example University"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("skips queued consumers that have unmounted", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { loadPaperAffiliations } = await import("./loadPaperAffiliations");
    const pending = loadPaperAffiliations(paper, () => false);
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("serializes requests with three-second spacing", async () => {
    const starts: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        starts.push(Date.now());
        return response();
      })
    );
    const { loadPaperAffiliations } = await import("./loadPaperAffiliations");
    const first = loadPaperAffiliations(paper, () => true);
    const second = loadPaperAffiliations({ ...paper, id: "2401.02954" }, () => true);
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(starts).toHaveLength(2);
    expect(Number(starts[1]) - Number(starts[0])).toBeGreaterThanOrEqual(3000);
  });
  it("retries 429 once using Retry-After", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "4" } }))
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);
    const { loadPaperAffiliations } = await import("./loadPaperAffiliations");
    const pending = loadPaperAffiliations(paper, () => true);
    await vi.runAllTimersAsync();
    expect((await pending)?.organizations).toEqual(["Example University"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
