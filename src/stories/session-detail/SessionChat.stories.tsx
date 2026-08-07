import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionChat } from "../../components/session-chat";
import type { SessionLine, SessionContentBlock } from "../../lib/sessions";
import type { ToolUseBlock } from "../../lib/schemas";

function line(
  index: number,
  type: "user" | "assistant",
  content: string,
  timestamp?: string,
): SessionLine {
  return {
    type,
    uuid: `uuid-${index}`,
    timestamp,
    lineIndex: index,
    message: { role: type === "user" ? "user" : "assistant", content },
  };
}

function userBlocks(index: number, blocks: SessionContentBlock[], timestamp?: string): SessionLine {
  return {
    type: "user",
    uuid: `uuid-${index}`,
    timestamp,
    lineIndex: index,
    message: { role: "user", content: blocks },
  };
}

function assistantBlocks(
  index: number,
  blocks: SessionContentBlock[],
  timestamp?: string,
): SessionLine {
  return {
    type: "assistant",
    uuid: `uuid-${index}`,
    timestamp,
    lineIndex: index,
    message: { role: "assistant", content: blocks },
  };
}

const simpleConversation: SessionLine[] = [
  line(0, "user", "How do I add Storybook to a Vite project?", "2026-04-19T10:00:00Z"),
  assistantBlocks(
    1,
    [
      {
        type: "text",
        text: "You can add Storybook to a Vite project by running `npx storybook@latest init`.",
      },
    ],
    "2026-04-19T10:00:05Z",
  ),
  line(2, "user", "What about testing?", "2026-04-19T10:01:00Z"),
  assistantBlocks(
    3,
    [
      {
        type: "text",
        text: "For testing stories, install `@storybook/test-runner` and run `npx test-storybook`.",
      },
    ],
    "2026-04-19T10:01:08Z",
  ),
];

const meta = {
  title: "Session Detail/SessionChat",
  component: SessionChat,
} satisfies Meta<typeof SessionChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithMessages: Story = {
  args: {
    sessionId: "story-session-1",
    lines: simpleConversation,
    toolResultMap: new Map(),
  },
};

export const EmptySession: Story = {
  args: {
    sessionId: "story-session-empty",
    lines: [],
    toolResultMap: new Map(),
  },
};

export const WithToolCalls: Story = {
  args: {
    sessionId: "story-session-tools",
    lines: [
      line(0, "user", "Read the README", "2026-04-19T09:00:00Z"),
      assistantBlocks(
        1,
        [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "/README.md" } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T09:00:03Z",
      ),
    ],
    toolResultMap: new Map([
      [
        "tool-1",
        {
          result: "# My Project\nA sample project.",
          isError: false,
          resultUuid: "result-1",
          duration: 42,
        },
      ],
    ]),
  },
};

export const WithSubagentInfo: Story = {
  args: {
    sessionId: "story-session-subagent",
    lines: [
      line(0, "user", "Investigate the codebase", "2026-04-19T10:00:00Z"),
      assistantBlocks(
        1,
        [
          {
            type: "tool_use",
            id: "tool-agent-1",
            name: "Agent",
            input: {
              subagent_type: "Explore",
              description: "Scan the codebase",
              prompt: "Find all files related to authentication.",
            } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T10:00:02Z",
      ),
    ],
    toolResultMap: new Map([
      [
        "tool-agent-1",
        {
          result: "agentId: scan001\nFound 42 files across the auth module.",
          isError: false,
          resultUuid: "result-agent-1",
          duration: 32000,
        },
      ],
    ]),
    subagents: [
      {
        id: "agent-scan001",
        sessionId: "story-session-subagent",
        projectId: "story-project",
        parentAgentId: null,
        agentType: "Explore",
        attributionAgent: null,
        slug: "scan-codebase",
        description: "Scan the codebase",
        startedAt: "2026-04-19T10:00:02Z",
        finishedAt: "2026-04-19T10:00:34Z",
      },
    ],
  },
};

export const WithGroupedAssistantMessages: Story = {
  args: {
    sessionId: "story-session-grouped",
    lines: [
      line(0, "user", "Refactor the auth module", "2026-04-19T11:00:00Z"),
      assistantBlocks(
        1,
        [
          {
            type: "text",
            text: "I'll start by reading the current implementation.",
          },
        ],
        "2026-04-19T11:00:02Z",
      ),
      assistantBlocks(
        2,
        [
          {
            type: "tool_use",
            id: "tool-g1",
            name: "Read",
            input: { file_path: "/src/auth.ts" } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T11:00:03Z",
      ),
      assistantBlocks(
        3,
        [
          {
            type: "tool_use",
            id: "tool-g2",
            name: "Edit",
            input: {
              file_path: "/src/auth.ts",
              old_string: "function login()",
              new_string: "async function login()",
            } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T11:00:05Z",
      ),
      assistantBlocks(
        4,
        [
          {
            type: "tool_use",
            id: "tool-g3",
            name: "Bash",
            input: {
              command: "npm test",
              description: "Run auth tests",
            } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T11:00:10Z",
      ),
      assistantBlocks(
        5,
        [
          {
            type: "text",
            text: "The auth module has been refactored. All tests pass.",
          },
        ],
        "2026-04-19T11:00:15Z",
      ),
      line(6, "user", "Looks good, thanks!", "2026-04-19T11:01:00Z"),
      assistantBlocks(
        7,
        [
          {
            type: "text",
            text: "You're welcome! Let me know if you need anything else.",
          },
        ],
        "2026-04-19T11:01:02Z",
      ),
    ],
    toolResultMap: new Map([
      [
        "tool-g1",
        {
          result: 'function login() {\n  return fetch("/api/login");\n}',
          isError: false,
          resultUuid: "result-g1",
          duration: 15,
        },
      ],
      ["tool-g2", { result: "OK", isError: false, resultUuid: "result-g2", duration: 8 }],
      [
        "tool-g3",
        {
          result: "All 12 tests passed",
          isError: false,
          resultUuid: "result-g3",
          duration: 3200,
        },
      ],
    ]),
  },
};

export const WithMetadataRecords: Story = {
  args: {
    sessionId: "story-session-metadata",
    lines: [
      line(0, "user", "Fix the authentication bug", "2026-04-19T10:00:00Z"),
      { type: "agent-name", agentName: "git-replay-automation", lineIndex: 1 },
      { type: "permission-mode", permissionMode: "acceptEdits", lineIndex: 2 },
      assistantBlocks(
        3,
        [{ type: "text", text: "I'll look into the authentication module." }],
        "2026-04-19T10:00:05Z",
      ),
      {
        type: "pr-link",
        prUrl: "https://github.com/example/repo/pull/42",
        prNumber: 42,
        prRepository: "example/repo",
        timestamp: "2026-04-19T10:05:00Z",
        lineIndex: 4,
      },
      line(5, "user", "The PR looks good", "2026-04-19T10:10:00Z"),
      assistantBlocks(
        6,
        [{ type: "text", text: "The fix has been merged." }],
        "2026-04-19T10:10:05Z",
      ),
    ],
    toolResultMap: new Map(),
  },
};

// 1x1 red pixel PNG
const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

// Minimal PDF header
const tinyPdfBase64 = "JVBERi0xLjAKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyA+PgplbmRvYmoK";

export const WithUserImage: Story = {
  args: {
    sessionId: "story-session-user-image",
    lines: [
      userBlocks(
        0,
        [
          { type: "text", text: "Here is a screenshot of the error" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: tinyPngBase64,
            },
          },
        ],
        "2026-04-19T12:00:00Z",
      ),
      assistantBlocks(
        1,
        [
          {
            type: "text",
            text: "I can see the error in your screenshot. The issue is a missing import.",
          },
        ],
        "2026-04-19T12:00:05Z",
      ),
    ],
    toolResultMap: new Map(),
  },
};

export const WithAssistantImage: Story = {
  args: {
    sessionId: "story-session-assistant-image",
    lines: [
      line(0, "user", "Take a screenshot of the page", "2026-04-19T13:00:00Z"),
      assistantBlocks(
        1,
        [
          { type: "text", text: "Here is the current state of the page:" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: tinyPngBase64,
            },
          },
        ],
        "2026-04-19T13:00:05Z",
      ),
    ],
    toolResultMap: new Map(),
  },
};

export const WithDisplayToggles: Story = {
  args: {
    sessionId: "story-session-toggles",
    lines: [
      { type: "agent-name", agentName: "code-reviewer", lineIndex: 0 },
      { type: "permission-mode", permissionMode: "auto", lineIndex: 1 },
      line(2, "user", "Review the changes", "2026-04-19T10:00:00Z"),
      {
        type: "attachment",
        attachmentJson: JSON.stringify({
          type: "hook_success",
          hookName: "pre-lint",
          hookEvent: "PreToolUse",
          durationMs: 38,
        }),
        lineIndex: 3,
      },
      assistantBlocks(4, [{ type: "text", text: "I'll review the diff." }], "2026-04-19T10:00:03Z"),
      {
        type: "attachment",
        attachmentJson: JSON.stringify({
          type: "hook_success",
          hookName: "post-lint",
          hookEvent: "PostToolUse",
          durationMs: 12,
        }),
        lineIndex: 5,
      },
      {
        type: "attachment",
        attachmentJson: JSON.stringify({
          type: "hook_non_blocking_error",
          hookName: "validator",
          hookEvent: "PostToolUse",
          stderr: "Warning: 2 issues found",
        }),
        lineIndex: 6,
      },
      {
        type: "attachment",
        attachmentJson: JSON.stringify({
          type: "task_reminder",
          content: "You have 3 pending tasks",
        }),
        lineIndex: 7,
      },
      {
        type: "attachment",
        attachmentJson: JSON.stringify({
          type: "skill_listing",
          content: "Available skills: build, test, deploy",
        }),
        lineIndex: 8,
      },
      line(9, "user", "Thanks!", "2026-04-19T10:01:00Z"),
      assistantBlocks(10, [{ type: "text", text: "Review complete." }], "2026-04-19T10:01:05Z"),
    ],
    toolResultMap: new Map(),
    showPassedHooks: false,
    showHookWarnings: false,
    showHookErrors: false,
    showSystemBanners: false,
    showCompactSummaries: false,
    showTranscriptOnly: false,
  },
};

const compactSummaryBody = `This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:

## Summary
- Refactored the auth module to use async/await throughout.
- Added unit tests covering login, logout, and refresh-token paths.
- Migrated the session store from in-memory to SQLite.

## Outstanding work
- Wire up the new \`/api/session/refresh\` endpoint.
- Update the docs site to mention the SQLite migration.
- Investigate intermittent CI flakiness in \`auth.test.ts\`.`;

const compactSummaryLine: SessionLine = {
  type: "user",
  uuid: "uuid-compact-1",
  timestamp: "2026-04-19T18:00:00Z",
  lineIndex: 0,
  isCompactSummary: true,
  isVisibleInTranscriptOnly: true,
  message: { role: "user", content: compactSummaryBody },
};

export const WithCompactSummaryCollapsed: Story = {
  args: {
    sessionId: "story-session-compact-collapsed",
    lines: [
      compactSummaryLine,
      line(
        1,
        "user",
        "Continue from where we left off — wire up the refresh endpoint.",
        "2026-04-19T18:00:30Z",
      ),
      assistantBlocks(
        2,
        [
          {
            type: "text",
            text: "I'll start by adding the route handler for /api/session/refresh.",
          },
        ],
        "2026-04-19T18:00:35Z",
      ),
    ],
    toolResultMap: new Map(),
    showCompactSummaries: false,
    showTranscriptOnly: false,
  },
};

export const WithCompactSummaryExpanded: Story = {
  args: {
    sessionId: "story-session-compact-expanded",
    lines: [
      compactSummaryLine,
      line(
        1,
        "user",
        "Continue from where we left off — wire up the refresh endpoint.",
        "2026-04-19T18:00:30Z",
      ),
      assistantBlocks(
        2,
        [
          {
            type: "text",
            text: "I'll start by adding the route handler for /api/session/refresh.",
          },
        ],
        "2026-04-19T18:00:35Z",
      ),
    ],
    toolResultMap: new Map(),
    showCompactSummaries: true,
    showTranscriptOnly: true,
  },
};

export const WithDocumentAttachment: Story = {
  args: {
    sessionId: "story-session-document",
    lines: [
      userBlocks(
        0,
        [
          { type: "text", text: "Please review this PDF" },
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: tinyPdfBase64,
            },
          },
        ],
        "2026-04-19T14:00:00Z",
      ),
      assistantBlocks(
        1,
        [
          {
            type: "text",
            text: "I've reviewed the document. Here are my findings.",
          },
        ],
        "2026-04-19T14:00:10Z",
      ),
    ],
    toolResultMap: new Map(),
  },
};

export const WithMcpToolCalls: Story = {
  args: {
    sessionId: "story-session-mcp",
    lines: [
      line(0, "user", "List the open issues on the repo", "2026-04-19T15:00:00Z"),
      assistantBlocks(
        1,
        [
          {
            type: "tool_use",
            id: "tool-mcp1",
            name: "mcp__plugin_github_github__list_issues",
            input: {
              owner: "example",
              repo: "myapp",
              state: "open",
            } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T15:00:02Z",
      ),
      assistantBlocks(
        2,
        [
          {
            type: "tool_use",
            id: "tool-mcp2",
            name: "mcp__plugin_github_github__list_issues",
            input: {
              owner: "example",
              repo: "utils",
              state: "open",
            } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T15:00:04Z",
      ),
      assistantBlocks(
        3,
        [
          {
            type: "tool_use",
            id: "tool-mcp3",
            name: "mcp__chrome-devtools__take_screenshot",
            input: {} as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T15:00:06Z",
      ),
      assistantBlocks(
        4,
        [
          {
            type: "text",
            text: "Found 7 open issues across both repos. The screenshot shows the current page state.",
          },
        ],
        "2026-04-19T15:00:08Z",
      ),
    ],
    toolResultMap: new Map([
      [
        "tool-mcp1",
        {
          result: '[{title: "Bug in login"}, {title: "Add dark mode"}]',
          isError: false,
          resultUuid: "r-mcp1",
          duration: 820,
        },
      ],
      [
        "tool-mcp2",
        {
          result: '[{title: "Fix typo"}, {title: "Update deps"}]',
          isError: false,
          resultUuid: "r-mcp2",
          duration: 650,
        },
      ],
      [
        "tool-mcp3",
        {
          result: "Screenshot saved",
          isError: false,
          resultUuid: "r-mcp3",
          duration: 1200,
        },
      ],
    ]),
  },
};

export const WithToolCallsOnly: Story = {
  args: {
    sessionId: "story-session-tools-only",
    lines: [
      line(0, "user", "Read all the config files", "2026-04-19T16:00:00Z"),
      assistantBlocks(
        1,
        [
          {
            type: "tool_use",
            id: "tool-nt1",
            name: "Read",
            input: { file_path: "/tsconfig.json" } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T16:00:02Z",
      ),
      assistantBlocks(
        2,
        [
          {
            type: "tool_use",
            id: "tool-nt2",
            name: "Read",
            input: { file_path: "/package.json" } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T16:00:04Z",
      ),
      assistantBlocks(
        3,
        [
          {
            type: "tool_use",
            id: "tool-nt3",
            name: "Glob",
            input: { pattern: "*.config.*" } as ToolUseBlock["input"],
          },
        ],
        "2026-04-19T16:00:06Z",
      ),
    ],
    toolResultMap: new Map([
      [
        "tool-nt1",
        {
          result: '{"compilerOptions": {"strict": true}}',
          isError: false,
          resultUuid: "r-nt1",
          duration: 10,
        },
      ],
      [
        "tool-nt2",
        {
          result: '{"name": "my-app", "version": "1.0.0"}',
          isError: false,
          resultUuid: "r-nt2",
          duration: 8,
        },
      ],
      [
        "tool-nt3",
        {
          result: "vite.config.ts\neslint.config.js",
          isError: false,
          resultUuid: "r-nt3",
          duration: 15,
        },
      ],
    ]),
  },
};

export const WithSingleAssistantNoTools: Story = {
  args: {
    sessionId: "story-session-simple-qa",
    lines: [
      line(
        0,
        "user",
        "What is the difference between let and const in JavaScript?",
        "2026-04-19T17:00:00Z",
      ),
      assistantBlocks(
        1,
        [
          {
            type: "text",
            text: '`let` declares a block-scoped variable that can be reassigned. `const` declares a block-scoped variable that cannot be reassigned after initialization. Both are hoisted but remain in the "temporal dead zone" until their declaration is evaluated.',
          },
        ],
        "2026-04-19T17:00:03Z",
      ),
    ],
    toolResultMap: new Map(),
  },
};
