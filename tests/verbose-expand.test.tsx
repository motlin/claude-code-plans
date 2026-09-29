// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionChat } from "../src/components/session-chat";
import { processTranscript } from "../src/lib/transcript";
import type { TranscriptMode } from "../src/lib/transcript-mode";

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

afterEach(cleanup);

interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
}

/** One assistant turn issuing `uses`, each followed by its own tool result. */
function toolCallRecords(uses: ToolUse[]): unknown[] {
  return [
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: uses.map(({ id, name, input }) => ({
          type: "tool_use",
          id,
          name,
          input,
        })),
      },
    },
    ...uses.map(({ id, result }) => ({
      type: "user",
      uuid: `r-${id}`,
      parentUuid: "a1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: result }],
      },
    })),
  ];
}

const GREPS: ToolUse[] = [1, 2].map((n) => ({
  id: `t${n}`,
  name: "Grep",
  input: { pattern: `pattern-${n}` },
  result: `${n} match`,
}));

function transcript(records: unknown[], transcriptMode: TranscriptMode) {
  const { lines, toolResultMap } = processTranscript(records);
  return (
    <SessionChat
      sessionId="test-session"
      lines={lines}
      toolResultMap={toolResultMap}
      showThinking
      transcriptMode={transcriptMode}
      shouldScrollToEnd={false}
    />
  );
}

interface Disclosure {
  expanded: string | null;
  body: string | null;
}

function disclosure(element: Element): Disclosure {
  const controlled = element.getAttribute("aria-controls") ?? "";
  return {
    expanded: element.getAttribute("aria-expanded"),
    body: controlled === "" ? null : (document.getElementById(controlled)?.textContent ?? null),
  };
}

function disclosures(container: HTMLElement): Disclosure[] {
  return [...container.querySelectorAll("[aria-expanded]")].map(disclosure);
}

const EXPANDED_GROUP: Disclosure[] = [
  {
    expanded: "true",
    body: "Searchedpattern-1pattern: pattern-11 matchSearchedpattern-2pattern: pattern-22 match",
  },
  { expanded: "true", body: "pattern: pattern-11 match" },
  { expanded: "true", body: "pattern: pattern-22 match" },
];
const COLLAPSED_GROUP: Disclosure[] = [{ expanded: "false", body: null }];

describe("Verbose transcript mode pre-expands tool rows", () => {
  it("expands the group and every nested row in verbose", async () => {
    const { container } = render(transcript(toolCallRecords(GREPS), "verbose"));

    await waitFor(() => expect(disclosures(container)).toStrictEqual(EXPANDED_GROUP));
  });

  it.each(["normal", "thinking"] as const)("keeps the group collapsed in %s", (mode) => {
    const { container } = render(transcript(toolCallRecords(GREPS), mode));

    expect(disclosures(container)).toStrictEqual(COLLAPSED_GROUP);
  });

  it("expands a single Agent row to its params card and result in verbose", async () => {
    const records = toolCallRecords([
      {
        id: "t1",
        name: "Agent",
        input: { description: "Find the schema", prompt: "Look for schema.ts" },
        result: "Found it in src/lib/db",
      },
    ]);
    const { container } = render(transcript(records, "verbose"));

    await waitFor(() =>
      expect(disclosures(container)).toStrictEqual([
        {
          expanded: "true",
          body: "description: Find the schemaprompt: Look for schema.tsFound it in src/lib/db",
        },
      ]),
    );
  });

  it("keeps a user toggle until the mode changes, then resets to the mode's default", async () => {
    const records = toolCallRecords(GREPS);
    const { container, rerender } = render(transcript(records, "verbose"));
    await waitFor(() => expect(disclosures(container)).toStrictEqual(EXPANDED_GROUP));

    fireEvent.click(container.querySelector("button[aria-expanded]") as Element);
    const toggledInVerbose = disclosures(container);

    rerender(transcript(records, "normal"));
    const afterNormal = disclosures(container);

    fireEvent.click(container.querySelector("button[aria-expanded]") as Element);
    const toggledInNormal = disclosures(container);

    rerender(transcript(records, "thinking"));
    const afterThinking = disclosures(container);

    rerender(transcript(records, "verbose"));
    const backToVerbose = disclosures(container);

    expect({
      toggledInVerbose,
      afterNormal,
      toggledInNormal,
      afterThinking,
      backToVerbose,
    }).toStrictEqual({
      toggledInVerbose: COLLAPSED_GROUP,
      afterNormal: COLLAPSED_GROUP,
      toggledInNormal: [
        {
          expanded: "true",
          body: "Searchedpattern-1Searchedpattern-2",
        },
        { expanded: "false", body: null },
        { expanded: "false", body: null },
      ],
      afterThinking: COLLAPSED_GROUP,
      backToVerbose: EXPANDED_GROUP,
    });
  });
});
