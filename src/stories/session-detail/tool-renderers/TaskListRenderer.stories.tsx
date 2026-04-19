import type {Meta, StoryObj} from '@storybook/react-vite';
import {TaskListRenderer} from '../../../components/tool-renderers/task-list-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-task-list-1',
		name: 'TaskList',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/TaskListRenderer',
	component: TaskListRenderer,
} satisfies Meta<typeof TaskListRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {},
			result: '#1 [completed] Set up project scaffolding\n#2 [in_progress] Implement database schema\n#3 [pending] Add API endpoints',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {},
			result: '',
			isError: true,
		}),
	},
};
