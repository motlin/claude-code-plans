// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionChat } from "../src/components/session-chat";
import { getToolRenderer } from "../src/components/tool-renderers";
import { ArtifactRenderer } from "../src/components/tool-renderers/artifact-renderer";
import { FallbackRenderer } from "../src/components/tool-renderers/fallback-renderer";
import { buildClientToolCall, type ClientToolCall } from "../src/components/tool-renderers/types";
import { toolLabel } from "../src/lib/tool-labels";
import { processTranscript } from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({ settings: { showDebug: false } }),
}));
vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ failedTools: new Map() }),
}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): ResizeObserverEntry[] {
    return [];
  }
}

globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

interface Sample {
  input: Record<string, unknown>;
  tool_result_text: string;
  toolUseResult: unknown;
}

const SAMPLES = (
  JSON.parse(readFileSync(resolve(__dirname, "fixtures/artifact-tool-samples.json"), "utf8")) as {
    samples: Sample[];
  }
).samples;

function sample(predicate: (s: Sample) => boolean): Sample {
  const found = SAMPLES.find(predicate);
  if (found === undefined) throw new Error("fixture sample missing");
  return found;
}

const PUBLISH = sample((s) => (s.toolUseResult as { title?: string }).title === "Quarto Oracle");
const TYPE_CREATE = sample((s) => s.input["action"] === "publish");
const LIST = sample((s) => s.input["action"] === "list");
const READ = sample((s) => s.input["action"] === "read");
const READ_DB = sample((s) => s.input["action"] === "read_db");
const QUICKSTART = sample((s) => s.input["action"] === "quickstart");

const QUARTO_URL = "https://claude.ai/code/artifact/29d89ae8-e33b-4f55-bbbd-874d5d316169";
const QUARTO_TEXT = `Published /Users/craig/projects/quarto/dist/quarto.html at ${QUARTO_URL}\n\nLive subscription: armed`;
const PIN_URL = "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709";

const CARD_CLASS =
  "relative isolate flex self-start min-w-[318px] max-w-[318px] items-start gap-g3 rounded-r6 pl-2.5 pr-p3 py-p6 text-left group/btn cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus";

function transcriptRecords(
  input: Record<string, unknown>,
  resultText: string,
  toolUseResult: unknown,
  isError = false,
): unknown[] {
  return [
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_art", name: "Artifact", input }],
      },
    },
    {
      type: "user",
      uuid: "u1",
      toolUseResult,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_art",
            content: resultText,
            is_error: isError,
          },
        ],
      },
    },
  ];
}

/** Runs a single Artifact call through the real transcript join and ClientToolCall builder. */
function transcriptCall(
  input: Record<string, unknown>,
  resultText: string,
  toolUseResult: unknown,
  isError = false,
): ClientToolCall {
  const { toolResultMap } = processTranscript(
    transcriptRecords(input, resultText, toolUseResult, isError),
  );
  return buildClientToolCall(
    { type: "tool_use", id: "toolu_art", name: "Artifact", input },
    "a1",
    toolResultMap,
  );
}

function cardSummary(container: HTMLElement) {
  const card = container.querySelector('[role="button"]');
  return {
    wrapper: card?.parentElement?.className,
    tag: card?.tagName,
    ariaLabel: card?.getAttribute("aria-label"),
    href: card?.getAttribute("href"),
    target: card?.getAttribute("target"),
    rel: card?.getAttribute("rel"),
    className: card?.getAttribute("class"),
    label: card?.querySelector("span.truncate")?.textContent,
  };
}

describe("Artifact tool labels", () => {
  it("labels each action with the upstream verb and meta", () => {
    const label = (input: Record<string, unknown>) => toolLabel({ name: "Artifact", input });

    expect({
      publish: label(PUBLISH.input),
      explicitPublish: label({ action: "publish", file_path: "/tmp/x/report.html" }),
      typeCreate: label(TYPE_CREATE.input),
      pin: label({ action: "pin", url: PIN_URL }),
      unpin: label({ action: "unpin", url: PIN_URL }),
      list: label(LIST.input),
      read: label(READ.input),
      readDb: label(READ_DB.input),
      quickstart: label(QUICKSTART.input),
    }).toStrictEqual({
      publish: {
        verb: "Published artifact",
        meta: "quarto.html",
        failedVerb: "Failed to publish artifact",
      },
      explicitPublish: {
        verb: "Published artifact",
        meta: "report.html",
        failedVerb: "Failed to publish artifact",
      },
      typeCreate: { verb: "Published artifact", failedVerb: "Failed to publish artifact" },
      pin: { verb: "Pinned artifact", failedVerb: "Failed to pin artifact" },
      unpin: { verb: "Unpinned artifact", failedVerb: "Failed to unpin artifact" },
      list: { verb: "Listed artifacts", failedVerb: "Failed to list artifacts" },
      read: { verb: "Used artifact tool", meta: "read", failedVerb: "Failed to use artifact tool" },
      readDb: {
        verb: "Used artifact tool",
        meta: "read_db",
        failedVerb: "Failed to use artifact tool",
      },
      quickstart: {
        verb: "Used artifact tool",
        meta: "quickstart",
        failedVerb: "Failed to use artifact tool",
      },
    });
  });
});

describe("Artifact transcript decoration", () => {
  it("attaches the parsed artifact with its toolUseResult title to a publish call", () => {
    const call = transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult);

    expect(call.artifact).toStrictEqual({
      url: QUARTO_URL,
      kind: "uuid",
      id: "29d89ae8-e33b-4f55-bbbd-874d5d316169",
      path: "/Users/craig/projects/quarto/dist/quarto.html",
      version: "1788236255-caec",
      title: "Quarto Oracle",
    });
  });

  it("attaches the returned artifacts to a list call", () => {
    const call = transcriptCall(LIST.input, LIST.tool_result_text, LIST.toolUseResult);

    expect(call.artifactList?.slice(0, 2)).toStrictEqual([
      {
        title: "Asap Ladder Rebalance",
        url: "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6",
        favicon: "🪜",
        updatedAt: "2026-09-13T19:09:36Z",
      },
      {
        title: "Asap Ladder Queue",
        url: "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709",
        favicon: "📌",
        updatedAt: "2026-09-11T01:40:38Z",
      },
    ]);
  });

  it("leaves a failed publish undecorated", () => {
    const call = transcriptCall(
      PUBLISH.input,
      "Error: upload failed",
      "Error: upload failed",
      true,
    );

    expect({ artifact: call.artifact, artifactList: call.artifactList }).toStrictEqual({
      artifact: undefined,
      artifactList: undefined,
    });
  });
});

describe("ArtifactRenderer", () => {
  it("is the registered body for Artifact", () => {
    expect(getToolRenderer("Artifact")).not.toBe(getToolRenderer("Frobnicate"));
  });

  it("renders a publish as an Open artifact card titled from the toolUseResult", () => {
    const call = transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult);
    const { container } = render(<ArtifactRenderer toolCall={call} />);

    expect(cardSummary(container)).toStrictEqual({
      wrapper: "flex flex-col w-full my-[6px]",
      tag: "A",
      ariaLabel: "Open artifact Quarto Oracle",
      href: QUARTO_URL,
      target: "_blank",
      rel: "noopener noreferrer",
      className: CARD_CLASS,
      label: "Quarto Oracle",
    });
  });

  it("falls back to the file basename when the result has no title", () => {
    const call = transcriptCall(
      { file_path: "/Users/craig/projects/quarto/dist/quarto.html" },
      QUARTO_TEXT,
      undefined,
    );
    const { container } = render(<ArtifactRenderer toolCall={call} />);

    expect({
      ariaLabel: cardSummary(container).ariaLabel,
      href: cardSummary(container).href,
    }).toStrictEqual({ ariaLabel: "Open artifact quarto.html", href: QUARTO_URL });
  });

  it("renders a type-created publish with its title and slug URL", () => {
    const call = transcriptCall(
      TYPE_CREATE.input,
      "Created a new Artifact at https://claude.ai/artifact/88kDDG41ePqvfVZNsq4HCF (version 1790103359-22eb) from the Artifact type https://claude.ai/artifact/Rp9naXUCj2xozpUkyQy19W",
      TYPE_CREATE.toolUseResult,
    );
    const { container } = render(<ArtifactRenderer toolCall={call} />);

    expect({
      ariaLabel: cardSummary(container).ariaLabel,
      href: cardSummary(container).href,
      target: cardSummary(container).target,
    }).toStrictEqual({
      ariaLabel: "Open artifact Blueprint Bot renderer routing",
      href: "https://claude.ai/artifact/88kDDG41ePqvfVZNsq4HCF",
      target: "_blank",
    });
  });

  it("renders an open with the artifact id when nothing else names it", () => {
    const call = transcriptCall(
      { action: "open", url: PIN_URL },
      `Opened the Artifact at ${PIN_URL}`,
      undefined,
    );
    const { container } = render(<ArtifactRenderer toolCall={call} />);

    expect({
      ariaLabel: cardSummary(container).ariaLabel,
      href: cardSummary(container).href,
    }).toStrictEqual({
      ariaLabel: "Open artifact 17b8a2c1-4c41-46bf-b064-a272240be709",
      href: PIN_URL,
    });
  });

  it("offers a Preview source link when the publish came from a local HTML or Markdown file", () => {
    const call = transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult);
    render(<ArtifactRenderer toolCall={call} />);

    const link = screen.getByRole("link", { name: "Preview source" });
    expect({ href: link.getAttribute("href"), target: link.getAttribute("target") }).toStrictEqual({
      href: "/artifact/29d89ae8-e33b-4f55-bbbd-874d5d316169",
      target: null,
    });
  });

  it("offers no Preview source link without a previewable local file", () => {
    const call = transcriptCall(
      { action: "open", url: PIN_URL },
      `Opened the Artifact at ${PIN_URL}`,
      undefined,
    );
    render(<ArtifactRenderer toolCall={call} />);

    expect(screen.queryByRole("link", { name: "Preview source" })).toBeNull();
  });

  it("opens the artifact in a new tab on Space", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const call = transcriptCall(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult);
    render(<ArtifactRenderer toolCall={call} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Open artifact Quarto Oracle" }), {
      key: " ",
    });

    expect(open.mock.calls).toStrictEqual([[QUARTO_URL, "_blank", "noopener,noreferrer"]]);
    open.mockRestore();
  });

  it("renders a list as link rows to each returned artifact", () => {
    const call = transcriptCall(LIST.input, LIST.tool_result_text, LIST.toolUseResult);
    const { container } = render(<ArtifactRenderer toolCall={call} />);
    const links = [...container.querySelectorAll("a")].slice(0, 2).map((a) => ({
      text: a.textContent,
      href: a.getAttribute("href"),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
    }));

    expect({
      count: container.querySelectorAll("a").length,
      links,
    }).toStrictEqual({
      count: (LIST.toolUseResult as { artifacts: unknown[] }).artifacts.length,
      links: [
        {
          text: "🪜Asap Ladder Rebalance",
          href: "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6",
          target: "_blank",
          rel: "noopener noreferrer",
        },
        {
          text: "📌Asap Ladder Queue",
          href: "https://claude.ai/code/artifact/17b8a2c1-4c41-46bf-b064-a272240be709",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      ],
    });
  });

  it.each([
    ["read", READ],
    ["read_db", READ_DB],
    ["quickstart", QUICKSTART],
  ])("keeps the key/value body for %s", (_action, fixture) => {
    const call = transcriptCall(fixture.input, fixture.tool_result_text, fixture.toolUseResult);
    const { container } = render(<ArtifactRenderer toolCall={call} />);
    const expected = render(<FallbackRenderer toolCall={call} />).container;

    expect({
      cards: container.querySelectorAll('[role="button"]').length,
      html: container.innerHTML,
    }).toStrictEqual({ cards: 0, html: expected.innerHTML });
  });

  it.each(["pin", "unpin"])("keeps the key/value body for %s", (action) => {
    const call = transcriptCall({ action, url: PIN_URL }, `${action}ned ${PIN_URL}`, undefined);
    const { container } = render(<ArtifactRenderer toolCall={call} />);
    const expected = render(<FallbackRenderer toolCall={call} />).container;

    expect({
      cards: container.querySelectorAll('[role="button"]').length,
      html: container.innerHTML,
    }).toStrictEqual({ cards: 0, html: expected.innerHTML });
  });

  it("shows a failed publish as the key/value error body", () => {
    const call = transcriptCall(
      PUBLISH.input,
      "Error: upload failed",
      "Error: upload failed",
      true,
    );
    const { container } = render(<ArtifactRenderer toolCall={call} />);
    const expected = render(<FallbackRenderer toolCall={call} />).container;

    expect({
      cards: container.querySelectorAll('[role="button"]').length,
      html: container.innerHTML,
    }).toStrictEqual({ cards: 0, html: expected.innerHTML });
  });
});

describe("Artifact row in the session transcript", () => {
  it("shows the publish row with its card always visible and no disclosure", async () => {
    const { lines, toolResultMap } = processTranscript(
      transcriptRecords(PUBLISH.input, QUARTO_TEXT, PUBLISH.toolUseResult),
    );
    const { container } = render(
      <SessionChat
        sessionId="test-session"
        lines={lines}
        toolResultMap={toolResultMap}
        showCompactSummaries
        showTranscriptOnly
      />,
    );
    const card = await screen.findByRole("button", { name: "Open artifact Quarto Oracle" });

    expect({
      href: card.getAttribute("href"),
      expandables: container.querySelectorAll("[aria-expanded]").length,
      verb: screen.getByText("Published artifact").tagName,
      meta: screen.getByText("quarto.html").tagName,
    }).toStrictEqual({ href: QUARTO_URL, expandables: 0, verb: "SPAN", meta: "SPAN" });
  });
});
