// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SessionChat } from "../src/components/session-chat";
import type { SessionLine } from "../src/lib/sessions";

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({
    settings: { showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark" },
  }),
}));
vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ failedTools: new Map() }),
}));

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
/** Unmeasured transcript entries are estimated at 320px each. */
const ESTIMATED_ENTRY_HEIGHT = 320;

function user(lineIndex: number, content: string, extra: Partial<SessionLine> = {}): SessionLine {
  return {
    type: "user",
    uuid: `line-${lineIndex}`,
    lineIndex,
    message: { role: "user", content },
    ...extra,
  } as SessionLine;
}

function assistant(lineIndex: number): SessionLine {
  return {
    type: "assistant",
    uuid: `line-${lineIndex}`,
    lineIndex,
    message: {
      role: "assistant",
      content: [{ type: "text", text: `Fabricated reply ${lineIndex}` }],
    },
  } as SessionLine;
}

const LINES: SessionLine[] = [
  user(0, "Fabricated first prompt"),
  assistant(1),
  user(2, "Stop hook feedback: fabricated", { isMeta: true }),
  assistant(3),
  user(4, "Fabricated second prompt"),
  assistant(5),
];

function renderInScroller(): { scrollTops: number[] } {
  const scrollTops: number[] = [];
  const { container } = render(
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <SessionChat
        sessionId="fabricated-session"
        lines={LINES}
        toolResultMap={new Map()}
        shouldScrollToEnd={false}
      />
    </div>,
  );
  const scroller = container.querySelector("[data-testid='scroller']");
  if (!scroller) throw new Error("scroller not rendered");
  let scrollTop = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
      scrollTops.push(value);
    },
  });
  return { scrollTops };
}

function pressNextPrompt() {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        metaKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("SessionChat prompt jump", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("⌥⌘↓ scrolls to the next user prompt, skipping stop-hook feedback", () => {
    const { scrollTops } = renderInScroller();

    pressNextPrompt();

    expect(scrollTops).toStrictEqual([4 * ESTIMATED_ENTRY_HEIGHT]);
  });
});
