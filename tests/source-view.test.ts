import { findPairedToolResult } from "../src/routes/session.$id_.source.$uuid";
import type { RawJsonlLine } from "../src/lib/sessions";

function rawLine(obj: unknown, lineIndex: number, uuid?: string): RawJsonlLine {
  const result: RawJsonlLine = { raw: JSON.stringify(obj), lineIndex };
  if (uuid !== undefined) result.uuid = uuid;
  return result;
}

describe("findPairedToolResult", () => {
  it("finds the matching tool_result in after window", () => {
    const focalRaw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_1", name: "Read" }] },
    });
    const after = [
      rawLine({ type: "system" }, 4),
      rawLine(
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }],
          },
        },
        5,
        "res-uuid",
      ),
    ];
    const paired = findPairedToolResult(focalRaw, after);
    if (!paired) throw new Error("Expected non-null paired result");
    expect(paired.toolUseId).toBe("tu_1");
    expect(paired.resultLineIndex).toBe(5);
    expect(paired.resultEntry.uuid).toBe("res-uuid");
  });

  it("returns null when focal has no tool_use", () => {
    const focalRaw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    const after = [
      rawLine(
        {
          type: "user",
          message: { content: [{ type: "text", text: "reply" }] },
        },
        1,
      ),
    ];
    expect(findPairedToolResult(focalRaw, after)).toBe(null);
  });

  it("returns null when focal is a user record", () => {
    const focalRaw = JSON.stringify({
      type: "user",
      message: { content: "hi" },
    });
    const after = [rawLine({ type: "assistant" }, 1)];
    expect(findPairedToolResult(focalRaw, after)).toBe(null);
  });

  it("returns null when no matching tool_result follows", () => {
    const focalRaw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_1" }] },
    });
    const after = [
      rawLine(
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu_OTHER" }],
          },
        },
        1,
      ),
    ];
    expect(findPairedToolResult(focalRaw, after)).toBe(null);
  });

  it("skips malformed JSON candidates without crashing", () => {
    const focalRaw = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_1" }] },
    });
    const after = [
      { raw: "{not valid", lineIndex: 1, parseError: true } as RawJsonlLine,
      rawLine(
        {
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "tu_1" }] },
        },
        2,
      ),
    ];
    const paired = findPairedToolResult(focalRaw, after);
    expect(paired!.resultLineIndex).toBe(2);
  });
});
