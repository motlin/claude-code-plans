import type { SessionLine } from "../../src/lib/transcript";

export const sessionResourceLines = [
  {
    type: "system",
    subtype: "turn_duration",
    durationMs: 1_000,
    lineIndex: 100,
    uuid: "uuid-100",
  },
  {
    type: "user",
    lineIndex: 200,
    uuid: "uuid-200",
    message: {
      role: "user",
      content: "Inspect the example resources.",
    },
  },
  {
    type: "assistant",
    lineIndex: 300,
    uuid: "uuid-300",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "I will inspect the example file." },
        { type: "thinking", thinking: "Choose the example read tool." },
        {
          type: "tool_use",
          id: "tool-use-read-example",
          name: "Read",
          input: { file_path: "/tmp/test/alice.txt" },
        },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "fake-image-data" },
        },
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: "fake-document-data" },
        },
      ],
    },
  },
  {
    type: "user",
    lineIndex: 400,
    uuid: "uuid-400",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-use-read-example",
          content: "Example file contents",
        },
      ],
    },
  },
  {
    type: "assistant",
    lineIndex: 500,
    uuid: "uuid-500",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-use-bash-example",
          name: "Bash",
          input: { command: "printf 'example'" },
        },
      ],
    },
  },
  {
    type: "user",
    lineIndex: 600,
    uuid: "uuid-600",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-use-bash-example",
          content: [
            { type: "text", text: "First example line" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "fake-result-image" },
            },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: "fake-result-document",
              },
            },
            { type: "text", text: "Second example line" },
          ],
        },
      ],
    },
  },
] satisfies SessionLine[];
