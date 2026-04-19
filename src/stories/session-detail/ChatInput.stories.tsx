import type {Meta, StoryObj} from '@storybook/react-vite';
import {ChatInput} from '../../components/chat-input';

const noop = () => {};

const meta = {
	title: 'Session Detail/ChatInput',
	component: ChatInput,
	args: {
		onSend: noop,
		onCancel: noop,
	},
} satisfies Meta<typeof ChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyInput: Story = {
	args: {
		isStreaming: false,
	},
};

export const Streaming: Story = {
	args: {
		isStreaming: true,
	},
};

export const WithProjectPath: Story = {
	args: {
		isStreaming: false,
		projectPath: '/Users/craig/projects/claude-code-plans',
	},
};
