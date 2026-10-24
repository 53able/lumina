/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../shared/schemas/index";
import { App } from "./App";
import type { HomeMain } from "./components/HomeMain";
import { PaperDetail } from "./components/PaperDetail";
import { InteractionProvider } from "./contexts/InteractionContext";
import { usePaperStore } from "./stores/paperStore";
import { useSettingsStore } from "./stores/settingsStore";
import { resetPaperStoreForTest } from "./testing/paperStoreTestUtils";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));
vi.mock("./hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("./hooks/useSyncPapers", () => ({
  useSyncPapers: () => ({
    sync: vi.fn(),
    retrySync: vi.fn(),
    syncMore: vi.fn(),
    syncAll: vi.fn(),
    stopSync: vi.fn(),
    runEmbeddingBackfill: vi.fn(),
    isSyncing: false,
    isSyncingFromDate: false,
    hasMore: false,
  }),
}));

// Keep the actual detail renderer while isolating App's selection and live-store wiring.
vi.mock("./components/HomeMain", () => ({
  HomeMain: (props: ComponentProps<typeof HomeMain>) => (
    <>
      {props.displayPapers.map((paper) => (
        <button key={paper.id} type="button" onClick={() => props.onPaperClick(paper)}>
          Open {paper.title}
        </button>
      ))}
      {props.selectedPaper && (
        <>
          <button type="button" onClick={props.onCloseDetail}>
            Close detail
          </button>
          <PaperDetail paper={props.selectedPaper} />
        </>
      )}
    </>
  ),
}));

const paper: Paper = {
  id: "2401.00001",
  title: "Stored Paper",
  abstract: "Abstract",
  authors: ["Author"],
  categories: ["cs.AI"],
  publishedAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
};

const renderApp = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <InteractionProvider>
          <App />
        </InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("App mobile author affiliations", () => {
  beforeEach(() => {
    useSettingsStore.setState({ apiEnabled: false, lastSyncedAt: new Date().toISOString() });
    usePaperStore.setState({ papers: [paper], loadStatus: "ready", isLoading: false });
  });
  afterEach(() => {
    cleanup();
    resetPaperStoreForTest();
    vi.clearAllMocks();
  });

  it("updates affiliations in an already-open detail when the same ID is synchronized, and still closes", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Open Stored Paper" }));
    expect(screen.getByText("所属不明")).toBeInTheDocument();
    act(() => {
      usePaperStore.setState({
        papers: [{ ...paper, authorAffiliations: [["Google", "University"]] }],
      });
    });
    expect(screen.getByText("Google · University")).toBeInTheDocument();
    expect(screen.queryByText("所属不明")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close detail" }));
    expect(screen.queryByRole("list", { name: "著者と所属" })).not.toBeInTheDocument();
  });

  it("keeps the selected fallback if the paper is temporarily absent from the store", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Open Stored Paper" }));
    act(() => {
      usePaperStore.setState({ papers: [] });
    });
    expect(screen.getByText("Stored Paper")).toBeInTheDocument();
    expect(screen.getByText("所属不明")).toBeInTheDocument();
  });
});
