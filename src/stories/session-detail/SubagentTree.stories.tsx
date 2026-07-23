import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubagentTree } from "../../components/subagent-tree";
import { withRouterAndQuery } from "../sidebar/decorators";
import { makeAgent } from "./subagent-fixtures";

const agents = [
  makeAgent({
    id: "agent-parent",
    agentType: "Plan",
    description: "Coordinate implementation",
    finishedAt: null,
  }),
  makeAgent({
    id: "agent-child",
    parentAgentId: "agent-parent",
    agentType: "Explore",
    description: "Inspect the codebase",
  }),
  makeAgent({
    id: "agent-parallel-a",
    agentType: "general-purpose",
    description: "Implement the first change",
    startedAt: "1999-12-31T00:01:00.000Z",
    finishedAt: "1999-12-31T00:01:30.000Z",
  }),
  makeAgent({
    id: "agent-parallel-b",
    agentType: "general-purpose",
    description: "Implement the second change",
    startedAt: "1999-12-31T00:01:01.000Z",
    finishedAt: "1999-12-31T00:01:40.000Z",
  }),
];

const meta = {
  title: "Session Detail/Subagents/SubagentTree",
  component: SubagentTree,
  decorators: [withRouterAndQuery],
} satisfies Meta<typeof SubagentTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NestedAndParallel: Story = {
  args: { agents },
};

export const Empty: Story = {
  args: { agents: [] },
};
