import type {Meta, StoryObj} from "@storybook/react-vite";
import {Composer} from "../../components/composer";

const noop = () => {};

const meta = {
	title: "Session Detail/Composer",
	component: Composer,
	args: {
		variant: "session",
		draftKey: "storybook-session",
		onSend: noop,
		onCancel: noop,
	},
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Session: Story = {
	args: {
		deliveryHint: "Starts a forked session",
	},
};

export const Streaming: Story = {
	args: {
		isStreaming: true,
	},
};

export const Home: Story = {
	args: {
		variant: "home",
		draftKey: "storybook-home",
	},
};
