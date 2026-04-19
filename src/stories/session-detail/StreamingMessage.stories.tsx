import type {Meta, StoryObj} from '@storybook/react-vite';
import {StreamingMessage} from '../../components/streaming-message';

const meta = {
	title: 'Session Detail/StreamingMessage',
	component: StreamingMessage,
} satisfies Meta<typeof StreamingMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Streaming: Story = {
	args: {
		text: 'I will help you refactor the `session-chat.tsx` component. Let me start by reading the current implementation...',
		isComplete: false,
		sentPrompt: 'Refactor session-chat.tsx to use smaller components',
	},
};

export const Error: Story = {
	args: {
		text: '',
		isComplete: true,
		error: 'Connection lost. The session may have ended or the server is unreachable.',
		sentPrompt: 'What files were changed?',
	},
};

export const CompletedWithFork: Story = {
	args: {
		text: 'Done! I have refactored the component into smaller pieces.\n\n**Files changed:**\n- `src/components/session-chat.tsx`\n- `src/components/session-message.tsx`',
		isComplete: true,
		forkedSessionId: 'abc-123-def',
		sentPrompt: 'Refactor session-chat.tsx',
	},
};
