import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubagentGantt } from "../../components/subagent-gantt";
import { makeAgent } from "./subagent-fixtures";

const timelineAgents = [
  makeAgent({
    id: "root",
    agentType: "Plan",
    description: "Orchestrate refactor",
  }),
  makeAgent({
    id: "explore",
    parentAgentId: "root",
    agentType: "Explore",
    description: "Scan codebase",
    startedAt: "2026-04-19T10:00:05Z",
    finishedAt: "2026-04-19T10:00:25Z",
  }),
  makeAgent({
    id: "precommit",
    parentAgentId: "root",
    agentType: "build:precommit-runner",
    description: "Run lint + tests",
    startedAt: "2026-04-19T10:00:30Z",
    finishedAt: "2026-04-19T10:00:50Z",
  }),
];

const meta = {
  title: "Session Detail/Subagents/SubagentGantt",
  component: SubagentGantt,
} satisfies Meta<typeof SubagentGantt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TimelineWithBars: Story = {
  args: {
    agents: timelineAgents,
  },
};

export const NoSubagents: Story = {
  args: {
    agents: [],
  },
};
