import type {Meta, StoryObj} from '@storybook/react-vite';
import {TaskUpdateRenderer} from '../../../components/tool-renderers/task-update-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-task-update-1',
		name: 'TaskUpdate',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/TaskUpdateRenderer',
	component: TaskUpdateRenderer,
} satisfies Meta<typeof TaskUpdateRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {taskId: '7', status: 'completed'},
			result: 'Updated task #7 status',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {taskId: '999', status: 'completed'},
			result: 'Error: Task #999 not found',
			isError: true,
		}),
	},
};

export const InProgress: Story = {
	args: {
		toolCall: makeToolCall({
			input: {taskId: '3', status: 'in_progress', activeForm: 'Running database migrations'},
			result: 'Updated task #3 status, activeForm',
		}),
	},
};
