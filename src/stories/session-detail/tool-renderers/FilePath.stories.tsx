import type { Meta, StoryObj } from "@storybook/react-vite";
import { FilePath } from "../../../components/tool-renderers/shared";

const meta = {
  title: "Session Detail/Tool Renderers/FilePath",
  component: FilePath,
} satisfies Meta<typeof FilePath>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    path: "src/components/App.tsx",
  },
};

export const LongPath: Story = {
  args: {
    path: "src/components/deeply/nested/directory/structure/that/goes/on/for/a/while/ComponentName.stories.tsx",
  },
};
