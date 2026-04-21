import type {Meta, StoryObj} from '@storybook/react-vite';
import {TodoWriteRenderer} from '../../../components/tool-renderers/todo-write-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-todo-1',
		name: 'TodoWrite',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/TodoWriteRenderer',
	component: TodoWriteRenderer,
} satisfies Meta<typeof TodoWriteRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultipleTodos: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				todos: [
					{id: '1', content: 'Fix login bug', status: 'in_progress'},
					{id: '2', content: 'Write tests', status: 'pending'},
					{id: '3', content: 'Update docs', status: 'completed'},
				],
			},
			result: 'Updated 3 todos',
		}),
	},
};

export const SingleTodo: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				todos: [{id: '1', content: 'Fix critical bug', status: 'in_progress'}],
			},
			result: 'Updated 1 todo',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {todos: []},
			result: 'Error: Failed to write todos',
			isError: true,
		}),
	},
};
