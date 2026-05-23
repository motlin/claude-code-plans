import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkillRenderer } from "../../../components/tool-renderers/skill-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-skill-1",
    name: "Skill",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/SkillRenderer",
  component: SkillRenderer,
} satisfies Meta<typeof SkillRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    toolCall: makeToolCall({
      input: { skill: "build:precommit" },
      result: "Skill loaded successfully.",
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: { skill: "nonexistent:skill" },
      result:
        'Error: Skill "nonexistent:skill" not found. Available skills: build:precommit, code:cli, git:git-workflow',
      isError: true,
    }),
  },
};
