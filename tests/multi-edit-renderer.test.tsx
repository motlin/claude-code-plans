// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EditRenderer } from "../src/components/tool-renderers/edit-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";
import { SessionChat } from "../src/components/session-chat";
import { processTranscript } from "../src/lib/transcript";
import { summarizeToolCallsStructured } from "../src/lib/session-utils";

vi.mock("@git-diff-view/react", () => ({
  DiffModeEnum: { Unified: 4 },
  DiffView: ({ data }: { data: { hunks: string[] } }) => (
    <div data-testid="diff-view">{data.hunks.join("\n")}</div>
  ),
}));

vi.mock("../src/lib/diff-highlighter", () => ({
  resolveDiffLanguage: () => "typescript",
  useShikiDiffHighlighter: () => undefined,
}));

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

const FILE_PATH = "/Users/craig/projects/app/src/cache.ts";

/** Two edits to one file: +1/-1 on the first, +3/-2 on the second. */
const EDITS = [
  { old_string: "const a = 1;", new_string: "const a = 2;" },
  {
    old_string: "const b = 1;\nconst c = 1;",
    new_string: "const b = 2;\nconst c = 2;\nconst d = 3;",
  },
];

function multiEditCall(overrides: Partial<ClientToolCall> = {}): ClientToolCall {
  return {
    id: "tool-multiedit-1",
    name: "MultiEdit",
    input: { file_path: FILE_PATH, edits: EDITS },
    param: FILE_PATH,
    result: "Applied 2 edits to /Users/craig/projects/app/src/cache.ts",
    sourceUuid: "uuid-multiedit-1",
    ...overrides,
  };
}

function diffTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-testid="diff-view"]')].map(
    (node) => node.textContent ?? "",
  );
}

describe("MultiEdit rendering", () => {
  it("renders one diff per edit instead of dumping the raw result", () => {
    const { container } = render(<EditRenderer toolCall={multiEditCall()} />);

    const diffs = diffTexts(container);
    expect(diffs.length).toBe(2);
    expect(diffs[0]).toContain("-const a = 1;");
    expect(diffs[0]).toContain("+const a = 2;");
    expect(diffs[1]).toContain("+const d = 3;");
    expect(container.querySelector("pre")).toBe(null);
  });

  it("gives every edit its own file-path header and copy button", () => {
    const { container } = render(<EditRenderer toolCall={multiEditCall()} />);

    const headers = [...container.querySelectorAll(`[title="${FILE_PATH}"]`)];
    expect(headers.length).toBe(2);
    expect(headers.map((header) => header.textContent)).toStrictEqual([FILE_PATH, FILE_PATH]);
    expect(container.querySelectorAll("button").length).toBe(2);
  });

  it("still renders exactly one diff for a single-edit Edit call", () => {
    const { container } = render(
      <EditRenderer
        toolCall={multiEditCall({
          name: "Edit",
          input: { file_path: FILE_PATH, old_string: "const a = 1;", new_string: "const a = 2;" },
        })}
      />,
    );

    expect(diffTexts(container).length).toBe(1);
  });

  it("falls back to the raw result when a MultiEdit call carries no edits", () => {
    const { container } = render(
      <EditRenderer
        toolCall={multiEditCall({
          input: { file_path: FILE_PATH, edits: [] },
          result: "File has not been read yet",
        })}
      />,
    );

    expect(diffTexts(container)).toStrictEqual([]);
    expect(container.querySelector("pre")?.textContent).toBe("File has not been read yet");
  });
});

describe("MultiEdit diff stats", () => {
  it("shows aggregate +added/-removed on the collapsed tool row", () => {
    const { lines, toolResultMap } = processTranscript([
      {
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "MultiEdit",
              input: { file_path: FILE_PATH, edits: EDITS },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "r1",
        parentUuid: "a1",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "Applied 2 edits" }],
        },
      },
    ]);

    const { container } = render(
      <SessionChat
        sessionId="test-session"
        lines={lines}
        toolResultMap={toolResultMap}
        showCompactSummaries
        showTranscriptOnly
        showThinking
      />,
    );

    const added = container.querySelector(".text-extended-green");
    const removed = container.querySelector(".text-extended-pink");
    expect(added?.textContent).toBe("+4");
    expect(removed?.textContent).toBe("-3");
  });

  it("aggregates MultiEdit stats into the collapsed turn summary", () => {
    expect(
      summarizeToolCallsStructured([
        { name: "MultiEdit", input: { file_path: FILE_PATH, edits: EDITS } },
      ]),
    ).toStrictEqual([{ verb: "Edited", rest: "cache.ts +4 -3" }]);
  });
});
