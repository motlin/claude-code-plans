import { describe, expect, it } from "vite-plus/test";
import { extractSessionFiles } from "../src/lib/session-files";
import type { SessionLine } from "../src/lib/transcript";

describe("extractSessionFiles", () => {
  it("extracts scoped prose paths, trims punctuation, and rejects unrelated absolute paths", () => {
    const lines = [
      {
        type: "user",
        lineIndex: 100,
        message: {
          role: "user",
          content:
            "Open /home/alice/example/first.ts, ~/example/second.ts! Ignore /usr/lib/x and /home/bob/private.ts.",
        },
      },
    ] satisfies SessionLine[];

    expect(extractSessionFiles(lines, "/home/alice")).toStrictEqual({
      files: [
        {
          path: "~/example/first.ts",
          absolutePath: "/home/alice/example/first.ts",
          occurrences: [
            {
              source: "visible",
              anchorIndex: 100,
              role: "user",
            },
          ],
        },
        {
          path: "~/example/second.ts",
          absolutePath: "/home/alice/example/second.ts",
          occurrences: [
            {
              source: "visible",
              anchorIndex: 100,
              role: "user",
            },
          ],
        },
      ],
      totalCount: 2,
      counts: {
        userMessage: 2,
        agentMessage: 0,
        read: 0,
        editWrite: 0,
        bash: 0,
        grepGlob: 0,
        thinking: 0,
        other: 0,
      },
    });
  });

  it("stops regex matches at JSON-escaped newlines", () => {
    const lines = [
      {
        type: "assistant",
        lineIndex: 100,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-use-bash-example",
              name: "Bash",
              input: {
                command: "cat /home/alice/example/first.ts\ncat /home/alice/example/second.ts",
              },
            },
          ],
        },
      },
    ] satisfies SessionLine[];

    expect(extractSessionFiles(lines, "/home/alice")).toStrictEqual({
      files: [
        {
          path: "~/example/first.ts",
          absolutePath: "/home/alice/example/first.ts",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "Bash",
            },
          ],
        },
        {
          path: "~/example/second.ts",
          absolutePath: "/home/alice/example/second.ts",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "Bash",
            },
          ],
        },
      ],
      totalCount: 2,
      counts: {
        userMessage: 0,
        agentMessage: 0,
        read: 0,
        editWrite: 0,
        bash: 2,
        grepGlob: 0,
        thinking: 0,
        other: 0,
      },
    });
  });

  it("uses strict typed inputs for every supported path-bearing tool", () => {
    const lines = [
      {
        type: "assistant",
        lineIndex: 100,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-use-read-example",
              name: "Read",
              input: { file_path: "~/typed/read path.ts" },
            },
            {
              type: "tool_use",
              id: "tool-use-edit-example",
              name: "Edit",
              input: {
                file_path: "~/typed/edit path.ts",
                old_string: "old example",
                new_string: "new example",
              },
            },
            {
              type: "tool_use",
              id: "tool-use-multi-edit-example",
              name: "MultiEdit",
              input: { file_path: "~/typed/multi path.ts", edits: [] },
            },
            {
              type: "tool_use",
              id: "tool-use-write-example",
              name: "Write",
              input: { path: "~/typed/write path.ts", data: "fake contents" },
            },
            {
              type: "tool_use",
              id: "tool-use-glob-example",
              name: "Glob",
              input: { pattern: "*.ts", path: "~/typed/glob path" },
            },
            {
              type: "tool_use",
              id: "tool-use-grep-example",
              name: "Grep",
              input: { pattern: "fake", path: "~/typed/grep path" },
            },
            {
              type: "tool_use",
              id: "tool-use-lsp-example",
              name: "LSP",
              input: { file_path: "~/typed/lsp path.ts" },
            },
            {
              type: "tool_use",
              id: "tool-use-notebook-edit-example",
              name: "NotebookEdit",
              input: {
                notebook_path: "~/typed/notebook path.ipynb",
                new_source: "fake source",
              },
            },
            {
              type: "tool_use",
              id: "tool-use-ls-example",
              name: "LS",
              input: { path: "~/typed/ls path" },
            },
          ],
        },
      },
    ] satisfies SessionLine[];

    expect(extractSessionFiles(lines, "/home/alice")).toStrictEqual({
      files: [
        {
          path: "~/typed/edit path.ts",
          absolutePath: "/home/alice/typed/edit path.ts",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "Edit",
            },
          ],
        },
        {
          path: "~/typed/glob path",
          absolutePath: "/home/alice/typed/glob path",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "Glob",
            },
          ],
        },
        {
          path: "~/typed/grep path",
          absolutePath: "/home/alice/typed/grep path",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "Grep",
            },
          ],
        },
        {
          path: "~/typed/ls path",
          absolutePath: "/home/alice/typed/ls path",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "LS",
            },
          ],
        },
        {
          path: "~/typed/lsp path.ts",
          absolutePath: "/home/alice/typed/lsp path.ts",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "LSP",
            },
          ],
        },
        {
          path: "~/typed/multi path.ts",
          absolutePath: "/home/alice/typed/multi path.ts",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "MultiEdit",
            },
          ],
        },
        {
          path: "~/typed/notebook path.ipynb",
          absolutePath: "/home/alice/typed/notebook path.ipynb",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "NotebookEdit",
            },
          ],
        },
        {
          path: "~/typed/read path.ts",
          absolutePath: "/home/alice/typed/read path.ts",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "Read",
            },
          ],
        },
        {
          path: "~/typed/write path.ts",
          absolutePath: "/home/alice/typed/write path.ts",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "Write",
            },
          ],
        },
      ],
      totalCount: 9,
      counts: {
        userMessage: 0,
        agentMessage: 0,
        read: 1,
        editWrite: 4,
        bash: 0,
        grepGlob: 3,
        thinking: 0,
        other: 1,
      },
    });
  });

  it("deduplicates typed and regex occurrences for the same canonical path", () => {
    const lines = [
      {
        type: "assistant",
        lineIndex: 100,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-use-read-example",
              name: "Read",
              input: { file_path: "/home/alice/example/read.ts" },
            },
          ],
        },
      },
    ] satisfies SessionLine[];

    expect(extractSessionFiles(lines, "/home/alice")).toStrictEqual({
      files: [
        {
          path: "~/example/read.ts",
          absolutePath: "/home/alice/example/read.ts",
          occurrences: [
            {
              source: "tool",
              anchorIndex: 100,
              role: "assistant",
              tool: "Read",
            },
          ],
        },
      ],
      totalCount: 1,
      counts: {
        userMessage: 0,
        agentMessage: 0,
        read: 1,
        editWrite: 0,
        bash: 0,
        grepGlob: 0,
        thinking: 0,
        other: 0,
      },
    });
  });

  it("uses the supplied macOS home root", () => {
    const lines = [
      {
        type: "assistant",
        lineIndex: 100,
        message: {
          role: "assistant",
          content: "Inspect /Users/alice/example/mac.ts.",
        },
      },
    ] satisfies SessionLine[];

    expect(extractSessionFiles(lines, "/Users/alice")).toStrictEqual({
      files: [
        {
          path: "~/example/mac.ts",
          absolutePath: "/Users/alice/example/mac.ts",
          occurrences: [
            {
              source: "visible",
              anchorIndex: 100,
              role: "assistant",
            },
          ],
        },
      ],
      totalCount: 1,
      counts: {
        userMessage: 0,
        agentMessage: 1,
        read: 0,
        editWrite: 0,
        bash: 0,
        grepGlob: 0,
        thinking: 0,
        other: 0,
      },
    });
  });

  it("attributes tool results to owners and keeps counts independent of consumer filtering", () => {
    const lines = [
      {
        type: "user",
        lineIndex: 100,
        message: { role: "user", content: "Review ~/example/shared.ts." },
      },
      {
        type: "assistant",
        lineIndex: 200,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I will review ~/example/shared.ts." },
            { type: "thinking", thinking: "Check ~/example/shared.ts first." },
            {
              type: "tool_use",
              id: "tool-use-bash-example",
              name: "Bash",
              input: { command: "test -f ~/example/shared.ts" },
            },
            {
              type: "tool_use",
              id: "tool-use-read-example",
              name: "Read",
              input: { file_path: "~/example/read-only.ts" },
            },
          ],
        },
      },
      {
        type: "user",
        lineIndex: 300,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-use-bash-example",
              content: "~/example/shared.ts",
            },
          ],
        },
      },
    ] satisfies SessionLine[];

    const extracted = extractSessionFiles(lines, "/home/alice");
    const visibleUserFiles = extracted.files.filter((file) =>
      file.occurrences.some(
        (occurrence) => occurrence.source === "visible" && occurrence.role === "user",
      ),
    );

    expect({ extracted, visibleUserFiles }).toStrictEqual({
      extracted: {
        files: [
          {
            path: "~/example/read-only.ts",
            absolutePath: "/home/alice/example/read-only.ts",
            occurrences: [
              {
                source: "tool",
                anchorIndex: 200,
                role: "assistant",
                tool: "Read",
              },
            ],
          },
          {
            path: "~/example/shared.ts",
            absolutePath: "/home/alice/example/shared.ts",
            occurrences: [
              {
                source: "visible",
                anchorIndex: 100,
                role: "user",
              },
              {
                source: "visible",
                anchorIndex: 200,
                role: "assistant",
              },
              {
                source: "thinking",
                anchorIndex: 200,
                role: "assistant",
              },
              {
                source: "tool",
                anchorIndex: 200,
                role: "assistant",
                tool: "Bash",
              },
              {
                source: "tool",
                anchorIndex: 200,
                role: "user",
                tool: "Bash",
              },
            ],
          },
        ],
        totalCount: 2,
        counts: {
          userMessage: 1,
          agentMessage: 1,
          read: 1,
          editWrite: 0,
          bash: 1,
          grepGlob: 0,
          thinking: 1,
          other: 0,
        },
      },
      visibleUserFiles: [
        {
          path: "~/example/shared.ts",
          absolutePath: "/home/alice/example/shared.ts",
          occurrences: [
            {
              source: "visible",
              anchorIndex: 100,
              role: "user",
            },
            {
              source: "visible",
              anchorIndex: 200,
              role: "assistant",
            },
            {
              source: "thinking",
              anchorIndex: 200,
              role: "assistant",
            },
            {
              source: "tool",
              anchorIndex: 200,
              role: "assistant",
              tool: "Bash",
            },
            {
              source: "tool",
              anchorIndex: 200,
              role: "user",
              tool: "Bash",
            },
          ],
        },
      ],
    });
  });
});
