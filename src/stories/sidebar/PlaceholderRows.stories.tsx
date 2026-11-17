import type {Meta, StoryObj} from "@storybook/react-vite";
import {PlaceholderRows} from "../../components/sidebar/primitives/PlaceholderRows";

const meta =
{
	title: "Sidebar/PlaceholderRows",
	component: PlaceholderRows,
} satisfies Meta<typeof PlaceholderRows>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story =
{
	args:
	{
		rows: 3,
	},
};

export const LabelSpace: Story =
{
	args:
	{
		rows: 3,
		labelSpace: true,
		testId: "sidebar-column-placeholder",
	},
};

export const Described: Story =
{
	args:
	{
		rows: 3,
		described: true,
	},
};
