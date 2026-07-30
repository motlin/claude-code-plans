import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentRenderer } from "../../../components/tool-renderers/agent-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";
import { withRouterAndQuery } from "../../sidebar/decorators";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-agent-1",
    name: "Agent",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/AgentRenderer",
  component: AgentRenderer,
  decorators: [withRouterAndQuery],
} satisfies Meta<typeof AgentRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        prompt: "Run the test suite and fix any failures you find in the authentication module.",
        subagent_type: "Code",
        description: "Fix auth test failures",
      },
      result: "agentId: abc123\nAll 12 tests now pass. Fixed a missing await in verifyToken().",
      duration: 45200,
      subagentInfo: {
        agentId: "agent-abc123",
        agentType: "Code",
        slug: "fix-auth-tests",
        description: "Fix auth test failures",
        startedAt: "2026-04-19T10:00:00Z",
        finishedAt: "2026-04-19T10:00:45Z",
        status: "done",
      },
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        prompt: "Deploy the application to production.",
        subagent_type: "build",
        description: "Production deployment",
      },
      result:
        "agentId: def456\nError: Build failed with exit code 1. Missing environment variable DATABASE_URL.",
      isError: true,
      subagentInfo: {
        agentId: "agent-def456",
        agentType: "build",
        slug: "deploy-prod",
        description: "Production deployment",
        startedAt: "2026-04-19T10:05:00Z",
        finishedAt: "2026-04-19T10:05:12Z",
        status: "error",
      },
    }),
  },
};

export const ParallelGroup: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        prompt: "Review the diff for correctness and style.",
        subagent_type: "code-review",
        description: "Review diff",
      },
      result: "agentId: par789\nNo issues found.",
      duration: 18000,
      subagentInfo: {
        agentId: "agent-par789",
        agentType: "code-review",
        slug: "review-diff",
        description: "Review diff",
        startedAt: "2026-04-19T10:10:00Z",
        finishedAt: "2026-04-19T10:10:18Z",
        status: "done",
        parallelGroupKey: "2026-04-19T10:10:00Z",
        parallelGroupSize: 3,
      },
    }),
  },
};

export const WithAgentType: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        prompt: "Search for files matching the pattern.",
        agentType: "Explore",
        description: "File pattern search",
        effort: "high",
      },
      result: "agentId: xyz789\nFound 25 matching files across the codebase.",
      duration: 12300,
    }),
  },
};

export const AgentTypePreferredOverSubagentType: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        prompt: "Create a comprehensive implementation plan.",
        agentType: "Plan",
        subagent_type: "legacy-type",
        description: "Implementation planning",
      },
      result: "agentId: plan001\n5-step implementation plan created and documented.",
      duration: 28500,
    }),
  },
};
