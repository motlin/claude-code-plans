// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SessionHoverCard } from "../src/components/session-hover-card";
import { approvalsQueryOptions } from "../src/lib/api/approvals";

const QUESTION_APPROVAL = {
  sessionId: "blocked-1",
  projectId: "-projects-alpha",
  projectName: "alpha",
  toolName: "AskUserQuestion" as const,
  toolUseId: "toolu_ask",
  blockedSince: "2026-09-29T11:00:00.000Z",
  planFilename: null,
  questionPreview: "Which database should we use?",
  questionOptions: ["Postgres", "SQLite"],
};

function renderCard(
  props: { sessionId: string; title: string; summary: string | null; blocked: boolean },
  approvals: (typeof QUESTION_APPROVAL)[] = [],
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(approvalsQueryOptions().queryKey, { approvals });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionHoverCard {...props} onOpen={() => undefined} render={<div data-testid="row" />}>
        {props.title}
      </SessionHoverCard>
    </QueryClientProvider>,
  );
}

async function hover() {
  const row = screen.getByTestId("row");
  await act(async () => {
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    fireEvent.mouseEnter(row);
    fireEvent.mouseMove(row);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function card(): HTMLElement | null {
  return document.querySelector("[data-session-hover-card]");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SessionHoverCard", () => {
  it("opens a 440px card for blocked rows after 400ms", async () => {
    renderCard({ sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true }, [
      QUESTION_APPROVAL,
    ]);
    await hover();
    await advance(399);
    expect(card()).toBeNull();
    await advance(1);
    expect({
      kind: card()?.getAttribute("data-kind"),
      width: card()?.style.width,
    }).toStrictEqual({ kind: "blocked", width: "440px" });
  });

  it("opens a 340px card for other rows after 500ms", async () => {
    renderCard({
      sessionId: "done-1",
      title: "Refactor parser",
      summary: "Split the tokenizer out of the parser.",
      blocked: false,
    });
    await hover();
    await advance(499);
    expect(card()).toBeNull();
    await advance(1);
    expect({
      kind: card()?.getAttribute("data-kind"),
      width: card()?.style.width,
      title: card()?.querySelector("[data-card-title]")?.textContent,
      summary: card()?.querySelector("[data-card-summary]")?.textContent,
    }).toStrictEqual({
      kind: "other",
      width: "340px",
      title: "Refactor parser",
      summary: "Split the tokenizer out of the parser.",
    });
  });

  it("shows the pending question with its options and a quick reply box", async () => {
    renderCard({ sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true }, [
      QUESTION_APPROVAL,
    ]);
    await hover();
    await advance(400);
    const root = card()!;
    expect({
      title: root.querySelector("[data-card-title]")?.textContent,
      question: root.querySelector("[data-card-question]")?.textContent,
      options: Array.from(root.querySelectorAll("[data-card-option]"), (b) => b.textContent),
      reply: root.querySelector("textarea")?.getAttribute("aria-label"),
      note: root.querySelector("[data-card-note]")?.textContent,
    }).toStrictEqual({
      title: "Pick a DB",
      question: "Which database should we use?",
      options: ["Postgres", "SQLite"],
      reply: "Quick reply",
      note: "Quick reply and approval controls available",
    });
  });

  it("submits an option as the answer to the pending question", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true }, [
      QUESTION_APPROVAL,
    ]);
    await hover();
    await advance(400);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    });
    await advance(0);
    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body]),
    ).toStrictEqual([
      [
        "/api/answer-question",
        "POST",
        JSON.stringify({
          sessionId: "blocked-1",
          toolUseId: "toolu_ask",
          answers: [{ question: "Which database should we use?", answer: "SQLite" }],
        }),
      ],
    ]);
    expect(card()?.querySelector("[data-card-sent]")?.textContent).toBe("Reply sent");
  });

  it("submits a typed quick reply on Enter", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ sessionId: "blocked-1", title: "Pick a DB", summary: null, blocked: true }, [
      QUESTION_APPROVAL,
    ]);
    await hover();
    await advance(400);
    const reply = screen.getByRole("textbox", { name: "Quick reply" });
    await act(async () => {
      fireEvent.change(reply, { target: { value: "  Use DuckDB  " } });
      fireEvent.keyDown(reply, { key: "Enter" });
    });
    await advance(0);
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toStrictEqual([
      JSON.stringify({
        sessionId: "blocked-1",
        toolUseId: "toolu_ask",
        answers: [{ question: "Which database should we use?", answer: "Use DuckDB" }],
      }),
    ]);
  });

  it("points blocked rows without an answerable question at the session", async () => {
    renderCard({ sessionId: "blocked-2", title: "Needs a look", summary: null, blocked: true });
    await hover();
    await advance(400);
    const root = card()!;
    expect({
      reply: root.querySelector("textarea"),
      open: screen.getByRole("button", { name: "Open session" }).textContent,
    }).toStrictEqual({ reply: null, open: "Open session" });
  });
});
