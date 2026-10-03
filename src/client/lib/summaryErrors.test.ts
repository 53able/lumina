import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiDisabledError } from "./api";
import { PartialSummaryError, SummaryApiError, showSummaryErrorToast } from "./summaryErrors";

const toastError = vi.hoisted(() => vi.fn());
const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastError, warning: toastWarning },
}));

describe("showSummaryErrorToast", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("部分成功は失敗トーストではなく警告として、要約を保存したことを伝える", () => {
    showSummaryErrorToast(new PartialSummaryError("upstream", true), "Attention Is All You Need");

    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith("説明文を生成できませんでした", {
      description:
        "Attention Is All You Need: 要約は保存しました。AIサービスでエラーが発生しました。再試行してください。",
    });
  });

  it("API利用OFFは停止中の見出しで失敗トーストを出す", () => {
    const err = new ApiDisabledError("設定の「利用可能」をONにすると再開できます。");

    showSummaryErrorToast(err, undefined);

    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("AI要約を停止中", { description: err.message });
  });

  it("説明文のみの生成の失敗は、要約生成エラーではなく説明文の警告として出す", () => {
    showSummaryErrorToast(new Error("timeout"), "論文", "explanation");

    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith("説明文を生成できませんでした", {
      description: "論文: timeout",
    });
  });

  it("説明文のみの生成でも API利用OFF は停止中として出す", () => {
    const err = new ApiDisabledError("設定の「利用可能」をONにすると再開できます。");

    showSummaryErrorToast(err, undefined, "explanation");

    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("AI要約を停止中", { description: err.message });
  });

  it.each([
    ["auth", false, "論文: APIキーの設定を確認してください。"],
    ["rate_limit", true, "論文: AIの利用上限に達しました。時間をおいて再試行してください。"],
    ["upstream", true, "論文: AIサービスでエラーが発生しました。再試行してください。"],
  ] as const)("要約APIの全体の失敗（%s）は分類の案内文で出す", (code, retryable, description) => {
    showSummaryErrorToast(new SummaryApiError(code, retryable), "論文");

    expect(toastError).toHaveBeenCalledWith("要約生成エラー", { description });
  });

  it("その他の失敗は要約生成エラーとして出す", () => {
    showSummaryErrorToast(new Error("timeout"), "論文");

    expect(toastError).toHaveBeenCalledWith("要約生成エラー", { description: "論文: timeout" });
  });
});

describe("PartialSummaryError", () => {
  it("分類から案内文を作り、上流のエラー文を含めない", () => {
    const err = new PartialSummaryError("auth", false);

    expect(err.code).toBe("auth");
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("要約は保存しました。APIキーの設定を確認してください。");
  });
});

describe("SummaryApiError", () => {
  it("分類から案内文を作り、上流のエラー文を含めない", () => {
    const err = new SummaryApiError("auth", false);

    expect(err.code).toBe("auth");
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("APIキーの設定を確認してください。");
  });
});
