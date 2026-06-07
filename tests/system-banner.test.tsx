import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemBanner } from "../src/components/system-banner";
import type { ProcessedLine } from "../src/lib/transcript";

type SystemLine = Extract<ProcessedLine, { type: "system" }>;

function renderBanner(line: SystemLine): string {
  return renderToStaticMarkup(<SystemBanner line={line} />);
}

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
