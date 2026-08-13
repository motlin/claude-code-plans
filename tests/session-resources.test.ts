import { describe, expect, it } from "vite-plus/test";
import { scanSessionContent } from "../src/lib/session-resources";
import { sessionResourceLines } from "./fixtures/session-resources";

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
