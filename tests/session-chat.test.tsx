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

/** Arbitrary Tailwind variants like `[&>*]:px-p7` come back HTML-escaped. */
function decodeClassAttr(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&gt;", ">");
}

/** Class list of every tool card shell, in document order. */
function toolCardClassNames(html: string): string[] {
  return [...html.matchAll(/<div class="([^"]*card-outline[^"]*)"/g)].map((match) =>
    decodeClassAttr(match[1] ?? ""),
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

/**
 * Upstream's expanded "Read 3 files" / "Ran 3 commands" body: an outlined,
 * divided card whose children carry their own padding, not a tinted panel with
 * gaps between free-floating rows.
 */
const GROUP_CONTAINER_CLASS =
  "flex flex-col card-outline rounded-r6 overflow-clip mt-p6 divide-y divide-t3 [&>*]:px-p7 [&>*]:py-p6";

/** Class list of every expanding-body wrapper (`group/body ...`), in document order. */
function toolBodyClassNames(html: string): string[] {
  return [...html.matchAll(/<div class="(group\/body[^"]*)"/g)].map((match) => match[1] ?? "");
}

describe("SessionChat nested tool rows", () => {
  it("drops the card shell from rows nested inside a grouped tool card", () => {
    const groupedBash = renderTranscript(
      toolCallRecords([
        { id: "t1", name: "Bash", input: { command: "git status" } },
        { id: "t2", name: "Bash", input: { command: "git log --oneline" } },
      ]),
    );
    const groupedRead = renderTranscript(
      toolCallRecords([
        { id: "t1", name: "Read", input: { file_path: "/repo/src/a.ts" } },
        { id: "t2", name: "Read", input: { file_path: "/repo/src/b.ts" } },
      ]),
    );
    const singleBash = renderTranscript(
      toolCallRecords([{ id: "t1", name: "Bash", input: { command: "git status" } }]),
    );

    expect({
      groupedBashCards: toolCardClassNames(groupedBash),
      groupedBashBodies: toolBodyClassNames(groupedBash),
      groupedReadCards: toolCardClassNames(groupedRead),
      groupedReadBodies: toolBodyClassNames(groupedRead),
      singleBashCards: toolCardClassNames(singleBash),
      singleBashBodies: toolBodyClassNames(singleBash),
    }).toStrictEqual({
      // The only outline in a grouped card is the group container's own; the
      // rows inside it are bare.
      groupedBashCards: [GROUP_CONTAINER_CLASS],
      groupedBashBodies: [
        "group/body relative flex w-full pt-p3",
        "group/body relative flex w-full pt-p3",
      ],
      groupedReadCards: [GROUP_CONTAINER_CLASS],
      groupedReadBodies: [
        "group/body relative flex w-full flex-col pt-p3",
        "group/body relative flex w-full flex-col pt-p3",
      ],
      singleBashCards: ["card-outline rounded-r6 overflow-clip flex flex-col relative"],
      singleBashBodies: ["group/body py-p6"],
    });
  });
});

/** Class of the expanded grouped-tool-call container. */
function groupContainerClassNames(html: string): string[] {
  return [...html.matchAll(/<div class="(flex flex-col [^"]*rounded-r6[^"]*)"/g)].map((match) =>
    decodeClassAttr(match[1] ?? ""),
  );
}

describe("SessionChat grouped tool card", () => {
  it("renders the expanded group as an outlined, divided card instead of a filled panel", () => {
    const groupedBash = renderTranscript(
      toolCallRecords([
        { id: "t1", name: "Bash", input: { command: "git status" } },
        { id: "t2", name: "Bash", input: { command: "git log --oneline" } },
      ]),
    );

    expect({
      containers: groupContainerClassNames(groupedBash),
      fillsWithT1: groupedBash.includes("bg-t1"),
    }).toStrictEqual({
      containers: [GROUP_CONTAINER_CLASS],
      fillsWithT1: false,
    });
  });
});

/** One tool call plus its result, so the row renders with a known isError flag. */
function toolResultRecords(
  call: { name: string; input: unknown },
  content: string,
  isError = false,
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
        content: [{ type: "tool_result", tool_use_id: "t1", content, is_error: isError }],
      },
    },
  ];
}

function failedToolCallRecords(
  isError: boolean,
  call: { name: string; input: unknown } = { name: "Grep", input: { pattern: "alice" } },
): unknown[] {
  return toolResultRecords(call, "rg exited with code 2", isError);
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

// Matches both the disclosure row and the bare non-expanding row, whose class
// list stops before `cursor-pointer hide-focus-ring rounded-r3`.
const TOOL_ROW = /group\/tool[^"]*">([\s\S]*?)<\/div>/g;

/** [class, text] of every label span in one tool row's markup. */
function labelSpans(row: string): [string, string][] {
  return [...row.matchAll(/<span class="([^"]+)">([^<]*)<\/span>/g)]
    .filter((match) => match[1]!.includes("text-body") || match[1]!.includes("text-code"))
    .map((match): [string, string] => [match[1]!, match[2]!]);
}

/** The markup of every tool row, in document order. */
function toolRows(html: string): string[] {
  return [...html.matchAll(TOOL_ROW)].map((match) => match[1]!);
}

/** [class, text] of every label span in the first tool row, in document order. */
function toolRowLabelSpans(html: string): [string, string][] {
  return labelSpans(toolRows(html)[0] ?? "");
}

/** [class, text] of every label span in every tool row, in document order. */
function allToolRowLabelSpans(html: string): [string, string][] {
  return toolRows(html).flatMap((row) => labelSpans(row));
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
        ["text-body text-assistant-primary truncate min-w-0", "cache.ts"],
      ],
      okEdit: [
        [
          "shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
          "Edited",
        ],
        ["text-body text-assistant-primary truncate min-w-0", "cache.ts"],
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
          "truncate min-w-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary",
          "Installed dependencies and build",
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

describe("SessionChat file-param tool row argument", () => {
  const VERB =
    "shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary";
  const ARGUMENT = "text-body text-assistant-primary truncate min-w-0";

  it("sets a file argument in the sans body face, matching upstream Read/Edit rows", () => {
    const html = renderTranscript(
      toolCallRecords([{ id: "t1", name: "Read", input: { file_path: "/repo/src/cache.ts" } }]),
    );

    expect(toolRowLabelSpans(html)).toStrictEqual([
      [VERB, "Read"],
      [ARGUMENT, "cache.ts"],
    ]);
  });

  it("sets nested file arguments in the same face as a top-level one", () => {
    const html = renderTranscript(
      toolCallRecords([
        { id: "t1", name: "Read", input: { file_path: "/repo/src/cache.ts" } },
        { id: "t2", name: "Read", input: { file_path: "/repo/src/schema.ts" } },
      ]),
    );

    expect(
      allToolRowLabelSpans(html).filter(([className]) => className === ARGUMENT),
    ).toStrictEqual([
      [ARGUMENT, "cache.ts"],
      [ARGUMENT, "schema.ts"],
    ]);
  });
});

describe("SessionChat Bash row label", () => {
  const PHRASE =
    "truncate min-w-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary";

  const bashLabel = (input: Record<string, unknown>) =>
    toolRowLabelSpans(renderTranscript(failedToolCallRecords(false, { name: "Bash", input })));

  it("renders one label span holding the past-tensed description, with no separate verb span", () => {
    expect(
      bashLabel({ command: "git status --short", description: "Check git status" }),
    ).toStrictEqual([[PHRASE, "Checked git status"]]);
  });

  it("past-tenses irregular leading verbs the way upstream does", () => {
    const label = (description: string) =>
      bashLabel({ command: "true", description }).map(([, text]) => text);

    expect({
      run: label("Run tests to verify migration"),
      see: label("See new cache.ts structure"),
      find: label("Find conflict markers in cache.ts"),
      build: label("Build project to check for type errors"),
      show: label("Show changed files summary"),
      write: label("Write release notes"),
    }).toStrictEqual({
      run: ["Ran tests to verify migration"],
      see: ["Saw new cache.ts structure"],
      find: ["Found conflict markers in cache.ts"],
      build: ["Built project to check for type errors"],
      show: ["Showed changed files summary"],
      write: ["Wrote release notes"],
    });
  });

  it("suffixes regular verbs and leaves anything already past tense alone", () => {
    const label = (description: string) =>
      bashLabel({ command: "true", description }).map(([, text]) => text);

    expect({
      consonant: label("List files in current directory"),
      silentE: label("Create the release branch"),
      consonantY: label("Copy the fixture into place"),
      vowelY: label("Deploy the preview build"),
      alreadyPast: label("Checked git status"),
      nonWord: label("`git status` in the worktree"),
    }).toStrictEqual({
      consonant: ["Listed files in current directory"],
      silentE: ["Created the release branch"],
      consonantY: ["Copied the fixture into place"],
      vowelY: ["Deployed the preview build"],
      alreadyPast: ["Checked git status"],
      nonWord: ["`git status` in the worktree"],
    });
  });

  it("falls back to the raw command when the call carries no description", () => {
    expect(bashLabel({ command: "pnpm run build" })).toStrictEqual([[PHRASE, "pnpm run build"]]);
  });

  it('still reads "Failed to run" when an undescribed call errors', () => {
    expect(
      toolRowLabelSpans(
        renderTranscript(
          failedToolCallRecords(true, { name: "Bash", input: { command: "pnpm run build" } }),
        ),
      ),
    ).toStrictEqual([
      ["shrink-0 text-body text-extended-pink", "Failed to run"],
      ["truncate min-w-0 text-body text-extended-pink", "pnpm run build"],
    ]);
  });
});

describe("SessionChat tool row verbs", () => {
  const SECONDARY =
    "shrink-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary";
  const SECONDARY_PARAM =
    "truncate min-w-0 text-body text-assistant-secondary group-hover/tool:text-assistant-primary";

  it("labels every row with an upstream verb phrase instead of the raw tool name", () => {
    const label = (call: { name: string; input: unknown }) =>
      toolRowLabelSpans(renderTranscript(failedToolCallRecords(false, call)));

    expect({
      glob: label({ name: "Glob", input: { pattern: ".github/workflows/*.yml" } }),
      todoWrite: label({
        name: "TodoWrite",
        input: { todos: [{ content: "ship it", status: "pending", activeForm: "Shipping it" }] },
      }),
      enterPlanMode: label({ name: "EnterPlanMode", input: {} }),
      exitPlanMode: label({ name: "ExitPlanMode", input: { plan: "## Plan\n\nDo the thing" } }),
      cronCreate: label({
        name: "CronCreate",
        input: { cron: "0 9 * * 1", prompt: "Review the weekly metrics", recurring: true },
      }),
    }).toStrictEqual({
      glob: [
        [SECONDARY, "Searched"],
        [SECONDARY_PARAM, ".github/workflows/*.yml"],
      ],
      todoWrite: [[SECONDARY, "Updated todos"]],
      enterPlanMode: [[SECONDARY, "Entered plan mode"]],
      exitPlanMode: [[SECONDARY, "Presented plan"]],
      cronCreate: [
        [SECONDARY, "Scheduled"],
        [SECONDARY_PARAM, "0 9 * * 1"],
      ],
    });
  });

  it('rewrites those rows to "Failed to ..." when the call errored', () => {
    const label = (call: { name: string; input: unknown }) =>
      toolRowLabelSpans(renderTranscript(failedToolCallRecords(true, call))).map(
        ([, text]) => text,
      );

    expect({
      glob: label({ name: "Glob", input: { pattern: "*.yml" } }),
      todoWrite: label({ name: "TodoWrite", input: { todos: [] } }),
      enterPlanMode: label({ name: "EnterPlanMode", input: {} }),
      exitPlanMode: label({ name: "ExitPlanMode", input: { plan: "p" } }),
      cronCreate: label({ name: "CronCreate", input: { cron: "0 9 * * 1", prompt: "p" } }),
    }).toStrictEqual({
      glob: ["Failed to search", "*.yml"],
      todoWrite: ["Failed to update todos"],
      enterPlanMode: ["Failed to enter plan mode"],
      exitPlanMode: ["Failed to present plan"],
      cronCreate: ["Failed to schedule", "0 9 * * 1"],
    });
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

/** The chevron svg's viewBox, unique to `ChevronIcon` among the row's markup. */
const CHEVRON_MARKER = 'viewBox="0 0 16 16"';

function toolRowChrome(html: string): Record<string, unknown> {
  return {
    // Only a non-expanding row puts `class` first; the disclosure row leads
    // with role/tabindex/aria attributes.
    bareHeaderClass: html.match(/<div class="(relative group\/tool[^"]*)"/)?.[1] ?? null,
    roleButton: html.includes('role="button"'),
    ariaExpanded: html.includes("aria-expanded"),
    disclosureGrid: html.includes("grid-rows-"),
    chevron: html.includes(CHEVRON_MARKER),
  };
}

describe("SessionChat non-expanding tool rows", () => {
  it("draws a TodoWrite call as a bare label row with no chevron or disclosure", () => {
    const html = renderTranscript(
      failedToolCallRecords(false, {
        name: "TodoWrite",
        input: {
          todos: [{ content: "Fix login bug", status: "in_progress", activeForm: "Fixing bug" }],
        },
      }),
    );

    expect({ ...toolRowChrome(html), label: html.includes(">Updated todos<") }).toStrictEqual({
      bareHeaderClass:
        "relative group/tool flex self-start max-w-full items-center py-0 gap-g2 text-left",
      roleButton: false,
      ariaExpanded: false,
      disclosureGrid: false,
      chevron: false,
      label: true,
    });
  });

  it("draws an EnterPlanMode call as a bare label row with no instruction block", () => {
    const html = renderTranscript(
      toolResultRecords(
        { name: "EnterPlanMode", input: {} },
        "Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.\n\nRemember: DO NOT write or edit any files yet.",
      ),
    );

    expect({
      ...toolRowChrome(html),
      label: html.includes(">Entered plan mode<"),
      instructions: html.includes("DO NOT write or edit any files yet"),
    }).toStrictEqual({
      bareHeaderClass:
        "relative group/tool flex self-start max-w-full items-center py-0 gap-g2 text-left",
      roleButton: false,
      ariaExpanded: false,
      disclosureGrid: false,
      chevron: false,
      label: true,
      instructions: false,
    });
  });

  it("keeps the disclosure chrome on every other tool row", () => {
    expect(toolRowChrome(renderTranscript(failedToolCallRecords(false)))).toStrictEqual({
      bareHeaderClass: null,
      roleButton: true,
      ariaExpanded: true,
      disclosureGrid: true,
      chevron: true,
    });
  });
});
