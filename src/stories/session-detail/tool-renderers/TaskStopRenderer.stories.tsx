import type {Meta, StoryObj} from '@storybook/react-vite';
import {TaskStopRenderer} from '../../../components/tool-renderers/task-stop-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-ts-1',
		name: 'TaskStop',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/TaskStopRenderer',
	component: TaskStopRenderer,
} satisfies Meta<typeof TaskStopRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {task_id: '42'},
			result: 'Task #42 stopped',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {task_id: '99'},
			result: 'Error: Task #99 not found',
			isError: true,
		}),
	},
};
