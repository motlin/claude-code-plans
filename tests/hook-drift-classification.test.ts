import { describe, expect, it } from "vite-plus/test";
import { z, type ZodError, type ZodType } from "zod";
import { HookEventEnvelope } from "../src/lib/hook-events";
import { classifyZodIssues } from "../src/routes/api/hook";

function parseFailure(schema: ZodType, input: unknown): ZodError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("Expected the fixture to fail schema validation");
  return result.error;
}

describe("classifyZodIssues", () => {
  it("finds an unknown response field inside the matching union arm", () => {
    const recordedPayloadShape = {
      session_id: "session-100",
      transcript_path: "/tmp/test/session-100.jsonl",
      cwd: "/tmp/test",
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/test/example.ts",
        content: "export const example = true;",
      },
      tool_response: {
        type: "create",
        filePath: "/tmp/test/example.ts",
        content: "export const example = true;",
        structuredPatch: [],
        originalFile: null,
        userModified: false,
      },
    };
    const recordedPayloadSchema = z.union([
      z.strictObject({ hook_event_name: z.literal("SessionStart") }),
      z.union([
        z.object({
          hook_event_name: z.literal("PostToolUse"),
          tool_name: z.literal("Write"),
          tool_response: z.strictObject({
            type: z.string(),
            filePath: z.string(),
            content: z.string(),
            structuredPatch: z.array(z.unknown()),
            originalFile: z.null(),
          }),
        }),
        z.object({
          hook_event_name: z.literal("PostToolUse"),
          tool_name: z.literal("Read"),
          tool_response: z.string(),
        }),
      ]),
    ]);

    expect(
      classifyZodIssues(
        parseFailure(recordedPayloadSchema, recordedPayloadShape),
        recordedPayloadShape,
      ),
    ).toStrictEqual({
      missingFields: [],
      unknownFields: ["tool_response.userModified"],
    });
  });

  it("names an unmatched tool discriminator", () => {
    const payload = {
      session_id: "session-100",
      transcript_path: "/tmp/test/session-100.jsonl",
      cwd: "/tmp/test",
      hook_event_name: "PostToolUse",
      tool_name: "NotARealTool",
      tool_input: { example: true },
    };

    expect(classifyZodIssues(parseFailure(HookEventEnvelope, payload), payload)).toStrictEqual({
      missingFields: [],
      unknownFields: ["tool_name: NotARealTool"],
    });
  });
});
