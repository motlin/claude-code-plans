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

/** Every `rounded*` utility on a class list, in source order. */
function cornerClasses(className: string | null): string[] {
  return (className ?? "").split(" ").filter((token) => token.startsWith("rounded"));
}

/** The body of a top-level CSS block (`:root`, `.dark`) from globals.css. */
function extractBlock(styles: string, selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  expect(start, `${selector} block missing from globals.css`).toBeGreaterThan(-1);
  return styles.slice(start, styles.indexOf("\n}", start));
}

function readToken(block: string, name: string): string | null {
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? null;
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
        "user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text",
      assistantProseClassName: "relative min-w-0 text-body text-text-100",
      streamingBubbleClassName:
        "user-message-bubble flex flex-col gap-[5px] rounded-[10px] px-3 py-2 break-words min-w-0 overflow-hidden bg-user-msg-bg text-user-msg-text max-w-[75%] text-body whitespace-pre-wrap select-text",
      streamingProseClassName: "min-w-0 text-body text-text-100",
    });
  });
});

describe("SessionChat user bubble chrome", () => {
  it("paints every user bubble with the upstream neutral wash and uniform 10px corners", () => {
    const styles = readFileSync(GLOBAL_STYLES_PATH, "utf8");
    const streamingHtml = renderToStaticMarkup(
      <StreamingMessage
        text="Fabricated streaming response"
        isComplete={false}
        sentPrompt="Fabricated streaming prompt"
      />,
    );

    expect({
      lightBg: readToken(extractBlock(styles, ":root"), "--user-msg-bg"),
      lightText: readToken(extractBlock(styles, ":root"), "--user-msg-text"),
      darkBg: readToken(extractBlock(styles, ".dark"), "--user-msg-bg"),
      darkText: readToken(extractBlock(styles, ".dark"), "--user-msg-text"),
      userCorners: cornerClasses(findClassName(renderShape("A"), "user-message-bubble")),
      automatedCorners: cornerClasses(findClassName(renderShape("B"), "user-message-bubble")),
      streamingCorners: cornerClasses(findClassName(streamingHtml, "user-message-bubble")),
    }).toStrictEqual({
      lightBg: "var(--upstream-t2)",
      lightText: "var(--upstream-text-assistant-primary)",
      darkBg: "var(--upstream-t2)",
      darkText: "var(--upstream-text-assistant-primary)",
      userCorners: ["rounded-[10px]"],
      automatedCorners: ["rounded-[10px]"],
      streamingCorners: ["rounded-[10px]"],
    });
  });
});

describe("SessionChat user-message shapes", () => {
  it("Shape A — plain text renders the regular user bubble with no automated label", () => {
    const html = renderShape("A");

    // Neutral user-bubble class is present.
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

  it("Shape F — document attachment renders the regular user bubble path with no automated label", () => {
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
    // Neither the labeled automated bubble nor the regular user bubble.
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

function renderTranscript(records: unknown[]): string {
  const { lines, toolResultMap } = processTranscript(records);
  return renderToStaticMarkup(
    <SessionChat
      sessionId="test-session"
      lines={lines}
      toolResultMap={toolResultMap}
      showCompactSummaries
      showTranscriptOnly
    />,
  );
}

/** Class list of every turn wrapper (`<div id="msg-N">`), in document order. */
function turnWrapperClassNames(html: string): string[] {
  return [...html.matchAll(/<div id="msg-\d+" class="([^"]*)"/g)].map((match) => match[1] ?? "");
}

describe("SessionChat turn spacing", () => {
  it("pads every turn wrapper with --chat-turn-gap and spaces intra-turn blocks with --chat-item-gap", () => {
    const styles = readFileSync(GLOBAL_STYLES_PATH, "utf8");
    const html = renderTranscript([
      {
        type: "user",
        uuid: "u1",
        message: { role: "user", content: "Fabricated user message" },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Fabricated first assistant response" }],
        },
      },
      {
        type: "assistant",
        uuid: "a2",
        parentUuid: "a1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Fabricated second assistant response" }],
        },
      },
    ]);

    expect({
      turnGap: styles.match(/--chat-turn-gap:\s*([^;]+);/)?.[1] ?? null,
      itemGap: styles.match(/--chat-item-gap:\s*([^;]+);/)?.[1] ?? null,
      // Every turn is padded, including the second assistant turn that follows
      // another assistant turn -- the old code only padded turn boundaries.
      turnWrappers: turnWrapperClassNames(html),
      itemGapColumns: (html.match(/gap-\[var\(--chat-item-gap\)\]/g) ?? []).length,
    }).toStrictEqual({
      turnGap: "15px",
      itemGap: "10px",
      turnWrappers: [
        "group relative pb-[var(--chat-turn-gap)] empty:pb-0",
        "group/msg flex flex-col w-full pb-[var(--chat-turn-gap)] empty:pb-0",
        "group/msg flex flex-col w-full pb-[var(--chat-turn-gap)] empty:pb-0",
      ],
      itemGapColumns: 2,
    });
  });
});

/** Class list of every tool card shell, in document order. */
function toolCardClassNames(html: string): string[] {
  return [...html.matchAll(/<div class="([^"]*card-outline[^"]*)"/g)].map(
    (match) => match[1] ?? "",
  );
}

function toolCallRecords(calls: { id: string; name: string; input: unknown }[]): unknown[] {
  return [
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: calls.map((call) => ({ type: "tool_use", ...call })),
      },
    },
    ...calls.map((call) => ({
      type: "user",
      uuid: `r-${call.id}`,
      parentUuid: "a1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: call.id, content: "Fabricated tool result" }],
      },
    })),
  ];
}

describe("SessionChat tool card chrome", () => {
  it("outlines tool cards with a hairline ring instead of filling them, and paints only code cards", () => {
    const styles = readFileSync(GLOBAL_STYLES_PATH, "utf8");
    const bashHtml = renderTranscript(
      toolCallRecords([{ id: "t1", name: "Bash", input: { command: "ls -la" } }]),
    );
    const editHtml = renderTranscript(
      toolCallRecords([
        {
          id: "t2",
          name: "Edit",
          input: { file_path: "/repo/src/a.ts", old_string: "a", new_string: "b" },
        },
      ]),
    );
    const readHtml = renderTranscript(
      toolCallRecords([{ id: "t3", name: "Read", input: { file_path: "/repo/src/a.ts" } }]),
    );

    expect({
      lightOutline: readToken(extractBlock(styles, ":root"), "--card-outline"),
      darkOutline: readToken(extractBlock(styles, ".dark"), "--card-outline"),
      lightCodeCardBg: readToken(extractBlock(styles, ":root"), "--code-card-bg"),
      darkCodeCardBg: readToken(extractBlock(styles, ".dark"), "--code-card-bg"),
      outlineRing: styles.includes("box-shadow: inset 0 0 0 1px var(--card-outline);"),
      codeCardFill: styles.includes("background-color: var(--code-card-bg);"),
      bashCard: toolCardClassNames(bashHtml),
      editCard: toolCardClassNames(editHtml),
      readCard: toolCardClassNames(readHtml),
      fillsAnyCardWithT1: bashHtml.includes("bg-t1") || editHtml.includes("bg-t1"),
    }).toStrictEqual({
      lightOutline: "hsl(0 0% 4% / 0.1)",
      darkOutline: "hsl(0 0% 100% / 0.12)",
      lightCodeCardBg: "hsl(60 14% 99%)",
      darkCodeCardBg: "hsl(60 2.7% 14.5%)",
      outlineRing: true,
      codeCardFill: true,
      bashCard: ["card-outline rounded-r6 overflow-clip flex flex-col relative"],
      editCard: ["card-outline code-card rounded-r6 overflow-clip flex flex-col relative"],
      readCard: ["card-outline code-card rounded-r6 overflow-clip flex flex-col relative"],
      fillsAnyCardWithT1: false,
    });
  });
});

/** One tool call plus its result, so the row renders with a known isError flag. */
function failedToolCallRecords(
  isError: boolean,
  call: { name: string; input: unknown } = { name: "Grep", input: { pattern: "alice" } },
): unknown[] {
  return [
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: call.name, input: call.input }],
      },
    },
    {
      type: "user",
      uuid: "r-t1",
      parentUuid: "a1",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "rg exited with code 2",
            is_error: isError,
          },
        ],
      },
    },
  ];
}

describe("SessionChat failed tool row label", () => {
  it("recolors a failed tool row label extended-pink and leaves a successful one secondary", () => {
    const failedHtml = renderTranscript(failedToolCallRecords(true));
    const okHtml = renderTranscript(failedToolCallRecords(false));

    expect({
      failedVerb: failedHtml.includes('<span class="shrink-0 text-body text-extended-pink">'),
      failedParam: failedHtml.includes(
        '<span class="truncate min-w-0 text-body text-extended-pink">',
      ),
      failedKeepsSecondaryLabel: failedHtml.includes(
        '<span class="shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary">',
      ),
      okVerb: okHtml.includes(
        '<span class="shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary">',
      ),
      okPink: okHtml.includes("text-extended-pink"),
    }).toStrictEqual({
      failedVerb: true,
      failedParam: true,
      failedKeepsSecondaryLabel: false,
      okVerb: true,
      okPink: false,
    });
  });
});

/** [class, text] of every label span in the first tool row, in document order. */
function toolRowLabelSpans(html: string): [string, string][] {
  const row = /hide-focus-ring rounded-r3">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  return [...row.matchAll(/<span class="([^"]+)">([^<]*)<\/span>/g)]
    .filter((match) => match[1]!.includes("text-body") || match[1]!.includes("text-code"))
    .map((match) => [match[1]!, match[2]!]);
}

describe("SessionChat failed tool row label text", () => {
  it('rewrites a failed row to "Failed to <verb>", keeping the file path primary', () => {
    const editInput = {
      file_path: "/repo/src/cache.ts",
      old_string: "a",
      new_string: "b",
    };

    expect({
      failedEdit: toolRowLabelSpans(
        renderTranscript(failedToolCallRecords(true, { name: "Edit", input: editInput })),
      ),
      okEdit: toolRowLabelSpans(
        renderTranscript(failedToolCallRecords(false, { name: "Edit", input: editInput })),
      ),
      failedGrep: toolRowLabelSpans(renderTranscript(failedToolCallRecords(true))),
      okGrep: toolRowLabelSpans(renderTranscript(failedToolCallRecords(false))),
    }).toStrictEqual({
      failedEdit: [
        ["shrink-0 text-body text-extended-pink", "Failed to edit"],
        ["truncate min-w-0 text-code text-assistant-primary", "cache.ts"],
      ],
      okEdit: [
        [
          "shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
          "Edited",
        ],
        ["truncate min-w-0 text-code text-assistant-primary", "cache.ts"],
      ],
      failedGrep: [
        ["shrink-0 text-body text-extended-pink", "Failed to search"],
        ["truncate min-w-0 text-body text-extended-pink", "alice"],
      ],
      okGrep: [
        [
          "shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
          "Searched",
        ],
        [
          "truncate min-w-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
          "alice",
        ],
      ],
    });
  });

  it("folds the verb into the description on a failed call that carries one", () => {
    const bashInput = {
      command: "pnpm install && pnpm build",
      description: "Install dependencies and build",
    };

    expect({
      failed: toolRowLabelSpans(
        renderTranscript(failedToolCallRecords(true, { name: "Bash", input: bashInput })),
      ),
      ok: toolRowLabelSpans(
        renderTranscript(failedToolCallRecords(false, { name: "Bash", input: bashInput })),
      ),
    }).toStrictEqual({
      failed: [
        [
          "truncate min-w-0 text-body text-extended-pink",
          "Failed to install dependencies and build",
        ],
      ],
      ok: [
        [
          "shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
          "Ran",
        ],
        [
          "truncate min-w-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
          "Install dependencies and build",
        ],
      ],
    });
  });

  it('falls back to "Failed to use <tool>" for tools with no verb of their own', () => {
    const html = renderTranscript(
      failedToolCallRecords(true, {
        name: "mcp__sentry__search_issues",
        input: { query: "unhandled" },
      }),
    );

    expect(toolRowLabelSpans(html)).toStrictEqual([
      ["shrink-0 text-body text-extended-pink", "Failed to use sentry"],
      ["truncate min-w-0 text-body text-extended-pink", "unhandled"],
    ]);
  });
});

/** Class list of every `<span>` in the clickable row header (classless spans -> ""). */
function rowHeaderSpanClasses(html: string): string[] {
  const start = html.indexOf('class="relative group/tool');
  expect(start, "no tool row header in html").toBeGreaterThan(-1);
  // The disclosure body follows the header; it is the first `grid-rows-*` div.
  const bodyStart = html.indexOf("grid-rows-", start);
  expect(bodyStart, "no disclosure body after tool row header").toBeGreaterThan(-1);
  const region = html.slice(start, bodyStart);
  return [...region.matchAll(/<span(?: class="([^"]*)")?[ >]/g)].map((match) => match[1] ?? "");
}

/** Two tool calls in one assistant turn, so the collapsed group summary renders. */
function groupedToolCallRecords(): unknown[] {
  return [
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Grep", input: { pattern: "alice" } },
          { type: "tool_use", id: "t2", name: "Grep", input: { pattern: "bob" } },
        ],
      },
    },
    ...["t1", "t2"].map((id) => ({
      type: "user",
      uuid: `r-${id}`,
      parentUuid: "a1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: "1 match" }],
      },
    })),
  ];
}

describe("SessionChat tool row hover treatment", () => {
  it("brightens a successful row's verb, param and chevron on group hover", () => {
    expect(rowHeaderSpanClasses(renderTranscript(failedToolCallRecords(false)))).toStrictEqual([
      "shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
      "truncate min-w-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
      "shrink-0 text-assistant-secondary group-hover/tool:text-assistant-primary",
    ]);
  });

  it("keeps a failed row's label pink on hover while its chevron still brightens", () => {
    expect(rowHeaderSpanClasses(renderTranscript(failedToolCallRecords(true)))).toStrictEqual([
      "shrink-0 text-body text-extended-pink",
      "truncate min-w-0 text-body text-extended-pink",
      "shrink-0 text-assistant-secondary group-hover/tool:text-assistant-primary",
    ]);
  });

  it("colors the group summary from its wrapper so the whole label brightens on hover", () => {
    expect(rowHeaderSpanClasses(renderTranscript(groupedToolCallRecords()))).toStrictEqual([
      "inline-flex items-center gap-g3 min-w-0 text-assistant-secondary group-hover/tool:text-assistant-primary",
      "text-body truncate min-w-0",
      "text-body",
      "",
      "shrink-0 text-assistant-secondary group-hover/tool:text-assistant-primary",
    ]);
  });
});
