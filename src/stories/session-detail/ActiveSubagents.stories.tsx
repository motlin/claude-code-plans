import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActiveSubagents } from "../../components/active-subagents";
import { withRouterAndQuery } from "../sidebar/decorators";

const meta = {
  title: "Session Detail/Subagents/ActiveSubagents",
  component: ActiveSubagents,
  decorators: [withRouterAndQuery],
} satisfies Meta<typeof ActiveSubagents>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneActive: Story = {
  args: {
    agents: [
      {
        key: "session-test:agent-active",
        sessionId: "session-test",
        agentId: "agent-active",
        agentType: "Explore",
        description: "Inspect active subagent behavior",
      },
    ],
  },
};

export const SeveralActive: Story = {
  args: {
    agents: [
      {
        key: "session-test:agent-active-a",
        sessionId: "session-test",
        agentId: "agent-active-a",
        agentType: "Explore",
        description: "Inspect the tree",
      },
      {
        key: "session-test:agent-active-b",
        sessionId: "session-test",
        agentId: "agent-active-b",
        agentType: "general-purpose",
        description: "Implement the session list",
      },
    ],
  },
};
