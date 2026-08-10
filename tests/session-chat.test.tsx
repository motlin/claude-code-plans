import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionChat } from "../src/components/session-chat";
import { StreamingMessage } from "../src/components/streaming-message";
import { processTranscript } from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({
    settings: { showDebug: true },
  }),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ failedTools: new Map() }),
}));

// ---------------------------------------------------------------------------
// Fixtures: real JSONL records captured from ~/.claude/projects (see
// tests/fixtures/user-message-shapes.json). Each shape is one user record.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(
  fileURLToPath(new URL("./fixtures/user-message-shapes.json", import.meta.url)),
);
const SHAPES = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
const GLOBAL_STYLES_PATH = fileURLToPath(new URL("../src/styles/globals.css", import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RenderOverrides {
  showCompactSummaries?: boolean;
  showTranscriptOnly?: boolean;
}

function renderRecord(
  record: unknown,
  overrides: RenderOverrides,
  defaults: Required<RenderOverrides>,
): string {
  const { lines, toolResultMap } = processTranscript([record]);
  return renderToStaticMarkup(
    <SessionChat
      sessionId="test-session"
      lines={lines}
      toolResultMap={toolResultMap}
      showCompactSummaries={overrides.showCompactSummaries ?? defaults.showCompactSummaries}
      showTranscriptOnly={overrides.showTranscriptOnly ?? defaults.showTranscriptOnly}
    />,
  );
}

function renderShape(shapeKey: string, overrides: RenderOverrides = {}): string {
  const record = SHAPES[shapeKey];
  expect(record, `fixture ${shapeKey} missing`).toBeDefined();
  // Shapes test rendering: enable both flags by default so the bubbles appear.
  return renderRecord(record, overrides, {
    showCompactSummaries: true,
    showTranscriptOnly: true,
  });
}

function findClassName(html: string, marker: string): string | null {
  return html.match(new RegExp(`<div class="([^"]*${marker}[^"]*)"`))?.[1] ?? null;
}

// Labels that should never leak onto user-initiated bubbles (shapes A and F).
// 'Automated' is the legacy badge from the bug; the other four are the labels
// LabeledAutomatedEntry renders for the four labeled kinds.
const AUTOMATED_LABELS = [
  "Automated",
  "Request interrupted",
  "Compact summary",
  "Stop hook feedback",
  "Slash command body",
];

describe("SessionChat body typography", () => {
  it("renders transcript and streaming prose with the upstream 14px/20px body token", () => {
    const styles = readFileSync(GLOBAL_STYLES_PATH, "utf8");
    const userHtml = renderRecord(
      {
        type: "user",
        message: { role: "user", content: "Fabricated user message" },
      },
      {},
      { showCompactSummaries: true, showTranscriptOnly: true },
    );
    const assistantHtml = renderRecord(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Fabricated assistant response" }],
        },
      },
      {},
      { showCompactSummaries: true, showTranscriptOnly: true },
    );
    const streamingHtml = renderToStaticMarkup(
      <StreamingMessage
        text="Fabricated streaming response"
        isComplete={false}
        sentPrompt="Fabricated streaming prompt"
      />,
    );

    expect({
      bodyFontSize: styles.match(/--upstream-text-body:\s*([^;]+);/)?.[1] ?? null,
      bodyLineHeight: styles.match(/--upstream-leading-body:\s*([^;]+);/)?.[1] ?? null,
      sessionColumnClassName: findClassName(userHtml, "max-w-3xl"),
      userBubbleClassName: findClassName(userHtml, "user-message-bubble"),
      assistantProseClassName: findClassName(assistantHtml, "relative min-w-0 text-body"),
      streamingBubbleClassName: findClassName(streamingHtml, "user-message-bubble"),
      streamingProseClassName: findClassName(streamingHtml, "min-w-0 text-body"),
    }).toStrictEqual({
      bodyFontSize: "14px",
      bodyLineHeight: "20px",
      sessionColumnClassName: "mx-auto w-full max-w-3xl px-8 pt-4 pb-4 text-body",
      userBubbleClassName:
        "user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] rounded-bl-[2px] bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text",
      assistantProseClassName: "relative min-w-0 text-body text-text-100",
      streamingBubbleClassName:
        "user-message-bubble flex flex-col gap-[5px] rounded-[10px] rounded-bl-[2px] px-3 py-2 break-words min-w-0 overflow-hidden bg-user-msg-bg text-user-msg-text max-w-[75%] text-body whitespace-pre-wrap select-text",
      streamingProseClassName: "min-w-0 text-body text-text-100",
    });
  });
});

describe("SessionChat user-message shapes", () => {
  it("Shape A — plain text renders the regular blue user bubble with no automated label", () => {
    const html = renderShape("A");

    // Blue user-bubble class is present.
    expect(html).toContain("bg-user-msg-bg");
    // Gray automated bubble class is NOT present.
    expect(html).not.toContain("bg-auto-msg-bg");

    // None of the automated labels appear (this is the regression test for
    // the original "Automated" badge bug — every plain user message used to
    // get tagged because userType is always 'external' in real JSONL).
    for (const label of AUTOMATED_LABELS) {
      expect(html, `Shape A must not contain label "${label}"`).not.toContain(`>${label}<`);
    }
  });

  it('Shape B — Request interrupted renders gray bubble with the "Request interrupted" label', () => {
    const html = renderShape("B");

    expect(html).toContain("bg-auto-msg-bg");
    expect(html).toContain(">Request interrupted<");
  });

  it('Shape C — Compact summary renders gray bubble with the "Compact summary" label', () => {
    const html = renderShape("C");

    expect(html).toContain("bg-auto-msg-bg");
    expect(html).toContain(">Compact summary<");
  });

  it('Shape D — Stop hook feedback renders gray bubble with the "Stop hook feedback" label', () => {
    const html = renderShape("D");

    expect(html).toContain("bg-auto-msg-bg");
    expect(html).toContain(">Stop hook feedback<");
  });

  it('Shape E — Slash command body renders gray bubble with the "Slash command body" label', () => {
    const html = renderShape("E");

    expect(html).toContain("bg-auto-msg-bg");
    expect(html).toContain(">Slash command body<");
  });

  it("Shape C — compact summary collapses to a stub when showCompactSummaries=false", () => {
    const html = renderShape("C", { showCompactSummaries: false });

    // Stub label appears with the size hint and call-to-action.
    expect(html).toContain("Compact summary (~");
    expect(html).toContain("click to expand");
    // Full automated bubble is NOT rendered.
    expect(html).not.toContain("bg-auto-msg-bg");
  });

  it("Shape C — compact summary renders fully when showCompactSummaries=true", () => {
    const html = renderShape("C", { showCompactSummaries: true });

    // Full automated bubble IS rendered.
    expect(html).toContain("bg-auto-msg-bg");
    expect(html).toContain(">Compact summary<");
    // Stub call-to-action is NOT shown.
    expect(html).not.toContain("click to expand");
  });

  it("Shape F — document attachment renders the regular blue user bubble path with no automated label", () => {
    const html = renderShape("F");

    // Document attachments should fall through the user-initiated path, not
    // the labeled automated path — even though the fixture has isMeta=true.
    expect(html).not.toContain("bg-auto-msg-bg");

    for (const label of AUTOMATED_LABELS) {
      expect(html, `Shape F must not contain label "${label}"`).not.toContain(`>${label}<`);
    }

    // The PDF/document block renders its own caption.
    expect(html).toContain("PDF attached");
  });
});

describe("SessionChat prompt metadata", () => {
  it("identifies system prompts that Claude queued for later", () => {
    const html = renderRecord(
      {
        type: "user",
        message: {
          role: "user",
          content: "Background agents were stopped by the user.",
        },
        promptSource: "system",
        queuePriority: "later",
      },
      {},
      {
        showCompactSummaries: true,
        showTranscriptOnly: true,
      },
    );

    const labels = Array.from(
      html.matchAll(/<span class="text-\[11px\] text-text-500">([^<]+)<\/span>/g),
      ([, label]) => label,
    );
    expect(labels).toStrictEqual(["System prompt · queued for later"]);
  });
});

describe("SessionChat source links", () => {
  it("uses the parsed snake_case record session identifier", () => {
    const html = renderRecord(
      {
        type: "user",
        uuid: "record-uuid",
        session_id: "record-session",
        message: {
          role: "user",
          content: "Session-specific source",
        },
      },
      {},
      {
        showCompactSummaries: true,
        showTranscriptOnly: true,
      },
    );

    expect(html).toContain('href="/session/record-session/source/record-uuid"');
    expect(html).not.toContain('href="/session/test-session/source/record-uuid"');
  });
});

// ---------------------------------------------------------------------------
// Transcript-only suppression: records with isVisibleInTranscriptOnly=true and
// isCompactSummary=false (the broader catch-all category, distinct from compact
// summaries) should be fully suppressed when showTranscriptOnly=false.
// ---------------------------------------------------------------------------

const TRANSCRIPT_ONLY_TEXT = "TRANSCRIPT_ONLY_MARKER_PHRASE_FOR_TEST";

const TRANSCRIPT_ONLY_RECORD = {
  parentUuid: "00000000-0000-0000-0000-000000000001",
  isSidechain: false,
  type: "user",
  message: {
    role: "user",
    content: TRANSCRIPT_ONLY_TEXT,
  },
  isVisibleInTranscriptOnly: true,
  isCompactSummary: false,
  uuid: "00000000-0000-0000-0000-000000000002",
  timestamp: "2026-05-07T00:00:00.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/tmp/test",
  sessionId: "00000000-0000-0000-0000-000000000003",
  version: "2.1.132",
  gitBranch: "main",
  slug: "transcript-only-test",
};

function renderTranscriptOnly(overrides: RenderOverrides): string {
  // Default both flags to false so isLineVisible can suppress the row.
  return renderRecord(TRANSCRIPT_ONLY_RECORD, overrides, {
    showCompactSummaries: false,
    showTranscriptOnly: false,
  });
}

describe("SessionChat transcript-only suppression", () => {
  it("omits the row entirely when isVisibleInTranscriptOnly=true && isCompactSummary=false && showTranscriptOnly=false", () => {
    const html = renderTranscriptOnly({ showTranscriptOnly: false });

    // The marker text must not appear anywhere in the output: the line is
    // fully filtered out by isLineVisible() before the renderer ever sees it.
    expect(html).not.toContain(TRANSCRIPT_ONLY_TEXT);
    // Neither the labeled automated bubble nor the regular blue bubble.
    expect(html).not.toContain("bg-auto-msg-bg");
    expect(html).not.toContain("bg-user-msg-bg");
  });

  it("renders the row fully when isVisibleInTranscriptOnly=true && isCompactSummary=false && showTranscriptOnly=true", () => {
    const html = renderTranscriptOnly({ showTranscriptOnly: true });

    // The marker text appears.
    expect(html).toContain(TRANSCRIPT_ONLY_TEXT);
    // The compact-summary classifier in classifyUserContent treats
    // isVisibleInTranscriptOnly=true the same as isCompactSummary=true,
    // so it falls through to the LabeledAutomatedEntry "Compact summary"
    // path — the gray automated bubble is shown.
    expect(html).toContain("bg-auto-msg-bg");
  });
});
