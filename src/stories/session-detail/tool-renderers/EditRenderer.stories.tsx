import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditRenderer } from "../../../components/tool-renderers/edit-renderer";
import type { ClientToolCall } from "../../../components/tool-renderers/types";

function makeToolCall(
  overrides: Partial<ClientToolCall> & { input: ClientToolCall["input"] },
): ClientToolCall {
  return {
    id: "tool-edit-1",
    name: "Edit",
    param: "",
    sourceUuid: "uuid-1",
    ...overrides,
  };
}

const meta = {
  title: "Session Detail/Tool Renderers/EditRenderer",
  component: EditRenderer,
} satisfies Meta<typeof EditRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DiffView: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        file_path: "/Users/craig/projects/app/src/server.ts",
        old_string: "const PORT = 3000;",
        new_string: "const PORT = process.env.PORT ?? 3000;",
      },
      param: "/Users/craig/projects/app/src/server.ts",
      result: "Edit applied successfully.",
    }),
  },
};

export const EditFailure: Story = {
  args: {
    toolCall: makeToolCall({
      input: {
        file_path: "/Users/craig/projects/app/src/server.ts",
        old_string: "nonexistent string",
        new_string: "replacement",
      },
      param: "/Users/craig/projects/app/src/server.ts",
      result: "The old_string was not found in the file. Make sure it matches exactly.",
      isError: true,
    }),
  },
};
