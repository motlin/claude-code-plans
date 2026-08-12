import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExitPlanModeRenderer } from "../../../components/tool-renderers/exit-plan-mode-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";
import { withRouterAndQuery } from "../../sidebar/decorators";

const PLAN = `# Switch git pager from delta to hunk

## Context

The git config currently uses delta as the global \`core.pager\`. The user wants
to switch the pager to hunk, a review-first terminal diff TUI.

## Change

Replace the \`core.pager\` value only. Leave \`interactive.diffFilter\` untouched.

\`\`\`ini
[core]
    pager = hunk pager
\`\`\`
`;

const APPROVED_RESULT =
  "User has approved your plan. You can now start coding. Start with updating your todo list if applicable\n\nYour plan has been saved to: /Users/craig/.claude/plans/switch-git-pager.md\nYou can refer back to it if needed during implementation.";

const REJECTED_RESULT =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nalso plan on working in a new worktree";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-epm-1",
    name: "ExitPlanMode",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/ExitPlanModeRenderer",
  component: ExitPlanModeRenderer,
  decorators: [withRouterAndQuery],
} satisfies Meta<typeof ExitPlanModeRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Approved: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        plan: PLAN,
        planFilePath: "/Users/craig/.claude/plans/switch-git-pager.md",
      },
      result: APPROVED_RESULT,
    }),
  },
};

export const WithAllowedPrompts: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        plan: PLAN,
        planFilePath: "/Users/craig/.claude/plans/switch-git-pager.md",
        allowedPrompts: [
          { tool: "Bash", prompt: "verify git pager config (git config --get, git log)" },
          { tool: "Bash", prompt: "stage and commit git changes" },
        ],
      },
      result: APPROVED_RESULT,
    }),
  },
};

export const Rejected: Story = {
  args: {
    toolCall: makeToolCall({
      input: { plan: PLAN },
      result: REJECTED_RESULT,
      isError: true,
    }),
  },
};

export const Error: Story = {
  args: {
    toolCall: makeToolCall({
      input: { plan: PLAN },
      result:
        "You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first. If your plan was already approved, continue with implementation.",
      isError: true,
    }),
  },
};
