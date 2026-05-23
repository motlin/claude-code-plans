import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionChat } from "../src/components/session-chat";
import { processTranscript } from "../src/lib/transcript";

// ---------------------------------------------------------------------------
// Fixtures: real JSONL records captured from ~/.claude/projects (see
// tests/fixtures/user-message-shapes.json). Each shape is one user record.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(
  fileURLToPath(new URL("./fixtures/user-message-shapes.json", import.meta.url)),
);
const SHAPES = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;

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
