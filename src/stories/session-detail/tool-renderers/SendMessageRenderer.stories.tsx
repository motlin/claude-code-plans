import type {Meta, StoryObj} from '@storybook/react-vite';
import {SendMessageRenderer} from '../../../components/tool-renderers/send-message-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-sm-1',
		name: 'SendMessage',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/SendMessageRenderer',
	component: SendMessageRenderer,
} satisfies Meta<typeof SendMessageRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRecipient: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				to: 'agent-worker-1',
				message: 'Please review the changes in src/lib/db.ts',
				summary: 'Code review request',
			},
			result: 'Message sent',
		}),
	},
};

export const WithContent: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				recipient: 'team-lead',
				content: 'Build completed successfully with 0 errors',
			},
			result: 'Message sent',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {to: 'unknown-agent', message: 'test'},
			result: 'Error: Recipient not found',
			isError: true,
		}),
	},
};
