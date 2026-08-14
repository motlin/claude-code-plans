import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemBanner } from "../src/components/system-banner";
import type { ProcessedLine } from "../src/lib/transcript";

type SystemLine = Extract<ProcessedLine, { type: "system" }>;

function renderBanner(line: SystemLine): string {
  return renderToStaticMarkup(<SystemBanner line={line} />);
}

/** The class list of the banner's outermost element. */
function rootClassName(html: string): string | null {
  return /^<[a-z]+ class="([^"]*)"/.exec(html)?.[1] ?? null;
}

const STATUS_CLASS = "flex items-center gap-1.5 min-w-0 text-footnote text-t6 select-none";

describe("SystemBanner", () => {
  it("renders compact_boundary with token stats", () => {
    const html = renderBanner({
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      compactMetadata: {
        trigger: "auto",
        preTokens: 261187,
        postTokens: 10827,
        durationMs: 48788,
      },
      lineIndex: 0,
    });
    expect(html).toContain("Conversation compacted");
    expect(html).toContain("auto");
    expect(html).toContain("261.2k");
    expect(html).toContain("10.8k");
    expect(html).toContain("48.8s");
  });

  it("renders compact_boundary preserved segment and message counts", () => {
    const html = renderBanner({
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      compactMetadata: {
        trigger: "manual",
        preTokens: 180000,
        postTokens: 9000,
        preservedSegment: {
          headUuid: "11111111-aaaa-4bbb-8ccc-dddddddddddd",
          anchorUuid: "22222222-eeee-4fff-8000-111111111111",
          tailUuid: "33333333-2222-4333-8444-555555555555",
        },
        preservedMessages: {
          anchorUuid: "22222222-eeee-4fff-8000-111111111111",
          uuids: ["22222222-eeee-4fff-8000-111111111111", "33333333-2222-4333-8444-555555555555"],
          allUuids: [
            "00000000-0000-4000-8000-000000000000",
            "11111111-aaaa-4bbb-8ccc-dddddddddddd",
            "22222222-eeee-4fff-8000-111111111111",
            "33333333-2222-4333-8444-555555555555",
          ],
        },
      },
      lineIndex: 0,
    });
    expect(html).toContain("2/4 messages preserved");
    expect(html).toContain("head 11111111");
    expect(html).toContain("anchor 22222222");
    expect(html).toContain("tail 33333333");
  });

  it("renders stop_hook_summary with error and blocked chips", () => {
    const html = renderBanner({
      type: "system",
      subtype: "stop_hook_summary",
      hookCount: 7,
      hookErrors: ["boom"],
      preventedContinuation: true,
      lineIndex: 0,
    });
    expect(html).toContain("7 stop hooks ran");
    expect(html).toContain("1 error");
    expect(html).toContain("blocked continuation");
  });

  it("renders clean stop_hook_summary without error chips", () => {
    const html = renderBanner({
      type: "system",
      subtype: "stop_hook_summary",
      hookCount: 3,
      hookErrors: [],
      lineIndex: 0,
    });
    expect(html).toContain("3 stop hooks ran");
    expect(html).not.toContain("error");
    expect(html).not.toContain("blocked continuation");
  });

  it("renders api_error with formatted headline and retry chips", () => {
    const html = renderBanner({
      type: "system",
      subtype: "api_error",
      error: {
        message: "Connection error.",
        formatted: "Unable to connect to API (ConnectionRefused)",
      },
      retryAttempt: 2,
      retryInMs: 4000,
      maxRetries: 10,
      lineIndex: 0,
    });
    expect(html).toContain("Unable to connect to API (ConnectionRefused)");
    expect(html).toContain("retry 2/10");
    expect(html).toContain("in 4.0s");
  });

  it("renders turn_duration with pending background agents", () => {
    const html = renderBanner({
      type: "system",
      subtype: "turn_duration",
      durationMs: 46391,
      pendingBackgroundAgentCount: 2,
      lineIndex: 0,
    });
    expect(html).toContain("Turn took 46.4s");
    expect(html).toContain("2 background agents pending");
  });
});

describe("SystemBanner variants", () => {
  it("draws single-line informational subtypes as borderless status lines", () => {
    const compact = renderBanner({
      type: "system",
      subtype: "compact_boundary",
      content: "Conversation compacted",
      lineIndex: 0,
    });
    const apiError = renderBanner({
      type: "system",
      subtype: "api_error",
      error: "Overloaded",
      lineIndex: 0,
    });
    const turnDuration = renderBanner({
      type: "system",
      subtype: "turn_duration",
      durationMs: 1000,
      lineIndex: 0,
    });

    expect({
      compactBoundary: rootClassName(compact),
      apiError: rootClassName(apiError),
      turnDuration: rootClassName(turnDuration),
    }).toStrictEqual({
      compactBoundary: STATUS_CLASS,
      apiError: STATUS_CLASS,
      turnDuration: STATUS_CLASS,
    });
  });

  it("keeps the bordered pill for the subtype with expandable children", () => {
    const html = renderBanner({
      type: "system",
      subtype: "stop_hook_summary",
      hookCount: 2,
      hookErrors: ["boom"],
      lineIndex: 0,
    });

    expect(rootClassName(html)).toStrictEqual(
      "flex flex-wrap items-center gap-2 py-1.5 px-3 text-xs text-t6 bg-surface-1 rounded-md border border-subtle",
    );
  });

  it("drops the icon from status lines and keeps it on pills", () => {
    const status = renderBanner({
      type: "system",
      subtype: "turn_duration",
      durationMs: 1000,
      lineIndex: 0,
    });
    const pill = renderBanner({
      type: "system",
      subtype: "stop_hook_summary",
      hookCount: 1,
      lineIndex: 0,
    });

    expect({ status: status.includes("<svg"), pill: pill.includes("<svg") }).toStrictEqual({
      status: false,
      pill: true,
    });
  });
});
