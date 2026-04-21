import type {Meta, StoryObj} from '@storybook/react-vite';
import {CronCreateRenderer} from '../../../components/tool-renderers/cron-create-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-cc-1',
		name: 'CronCreate',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/CronCreateRenderer',
	component: CronCreateRenderer,
} satisfies Meta<typeof CronCreateRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RecurringJob: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				cron: '0 */6 * * *',
				prompt: 'Check deployment status and report failures',
				recurring: true,
			},
			result: 'Cron job created',
		}),
	},
};

export const OneTimeJob: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				cron: '30 14 * * *',
				prompt: 'Run database migration',
				recurring: false,
			},
			result: 'One-time job scheduled',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {cron: 'invalid', prompt: 'test'},
			result: 'Error: Invalid cron expression',
			isError: true,
		}),
	},
};
