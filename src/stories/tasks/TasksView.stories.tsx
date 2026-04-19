import type {Meta, StoryObj} from '@storybook/react-vite';
import {TasksView} from '../../components/tasks-view';
import type {ClientToolCall} from '../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & Pick<ClientToolCall, 'name' | 'input'>): ClientToolCall {
	return {
		id: crypto.randomUUID(),
		param: '',
		sourceUuid: crypto.randomUUID(),
		...overrides,
	};
}

const toolCallsWithTasks: ClientToolCall[] = [
	makeToolCall({name: 'TaskCreate', input: {subject: 'Set up CI pipeline', description: 'Configure GitHub Actions'}}),
	makeToolCall({name: 'TaskCreate', input: {subject: 'Write unit tests', description: 'Cover core modules'}}),
	makeToolCall({
		name: 'TaskCreate',
		input: {subject: 'Deploy to staging', description: 'Push to staging environment'},
	}),
	makeToolCall({name: 'TaskUpdate', input: {taskId: '1', status: 'completed'}}),
	makeToolCall({name: 'TaskUpdate', input: {taskId: '2', status: 'in_progress'}}),
	makeToolCall({
		name: 'Agent',
		input: {prompt: 'Explore the codebase structure', subagent_type: 'Explore'},
		result: 'Found 42 source files across 8 modules.',
	}),
];

const meta = {
	title: 'Tasks/TasksView',
	component: TasksView,
} satisfies Meta<typeof TasksView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTasksAndAgents: Story = {
	args: {toolCalls: toolCallsWithTasks},
};

export const EmptyList: Story = {
	args: {toolCalls: []},
};
