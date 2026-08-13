import { describe, expect, it } from "vite-plus/test";
import {
  formatResourceCount,
  resourceCoverageNote,
  scanSessionContent,
} from "../src/lib/session-resources";
import { sessionResourceLines } from "./fixtures/session-resources";

describe("resource coverage", () => {
  it("marks a count as a floor only while earlier records are unscanned", () => {
    expect([
      formatResourceCount(24, 0),
      formatResourceCount(24, 1),
      formatResourceCount(0, 3200),
    ]).toStrictEqual(["24", "24+", "0+"]);
  });

  it("explains the unscanned remainder and stays silent once the whole session is loaded", () => {
    expect([
      resourceCoverageNote(0),
      resourceCoverageNote(1),
      resourceCoverageNote(3200),
    ]).toStrictEqual([
      undefined,
      "Counted from the loaded messages only — 1 earlier record has not been scanned. Load earlier messages to include it.",
      "Counted from the loaded messages only — 3200 earlier records have not been scanned. Load earlier messages to include them.",
    ]);
  });
});

describe("scanSessionContent", () => {
  it("flattens scannable blocks and attributes tool results to their owning calls", () => {
    expect(scanSessionContent(sessionResourceLines)).toStrictEqual([
      {
        text: "Inspect the example resources.",
        source: "visible",
        anchorIndex: 200,
        role: "user",
      },
      {
        text: "I will inspect the example file.",
        source: "visible",
        anchorIndex: 300,
        role: "assistant",
      },
      {
        text: "Choose the example read tool.",
        source: "thinking",
        anchorIndex: 300,
        role: "assistant",
      },
      {
        text: '{"file_path":"/tmp/test/alice.txt"}',
        source: "tool",
        anchorIndex: 300,
        role: "assistant",
        tool: "Read",
      },
      {
        text: "Example file contents",
        source: "tool",
        anchorIndex: 300,
        role: "user",
        tool: "Read",
      },
      {
        text: '{"command":"printf \'example\'"}',
        source: "tool",
        anchorIndex: 500,
        role: "assistant",
        tool: "Bash",
      },
      {
        text: "First example line\nSecond example line",
        source: "tool",
        anchorIndex: 500,
        role: "user",
        tool: "Bash",
      },
    ]);
  });
});
