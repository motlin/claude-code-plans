import { describe, expect, it } from "vite-plus/test";
import { scanSessionContent } from "../src/lib/session-resources";
import { sessionResourceLines } from "./fixtures/session-resources";

describe("scanSessionContent", () => {
  it("flattens scannable blocks and attributes tool results to their owning calls", () => {
    expect(scanSessionContent(sessionResourceLines)).toStrictEqual([
      {
        text: "Inspect the example resources.",
        source: "visible",
        lineArrayIndex: 1,
        role: "user",
      },
      {
        text: "I will inspect the example file.",
        source: "visible",
        lineArrayIndex: 2,
        role: "assistant",
      },
      {
        text: "Choose the example read tool.",
        source: "thinking",
        lineArrayIndex: 2,
        role: "assistant",
      },
      {
        text: '{"file_path":"/tmp/test/alice.txt"}',
        source: "tool",
        lineArrayIndex: 2,
        role: "assistant",
        tool: "Read",
      },
      {
        text: "Example file contents",
        source: "tool",
        lineArrayIndex: 2,
        role: "user",
        tool: "Read",
      },
      {
        text: '{"command":"printf \'example\'"}',
        source: "tool",
        lineArrayIndex: 4,
        role: "assistant",
        tool: "Bash",
      },
      {
        text: "First example line\nSecond example line",
        source: "tool",
        lineArrayIndex: 4,
        role: "user",
        tool: "Bash",
      },
    ]);
  });
});
