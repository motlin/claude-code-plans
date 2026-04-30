import type {Meta, StoryObj} from '@storybook/react-vite';
import {AgentRenderer} from '../../../components/tool-renderers/agent-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';
import {withRouterAndQuery} from '../../sidebar/decorators';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-agent-1',
		name: 'Agent',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/AgentRenderer',
	component: AgentRenderer,
	decorators: [withRouterAndQuery],
} satisfies Meta<typeof AgentRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				prompt: 'Run the test suite and fix any failures you find in the authentication module.',
				subagent_type: 'Code',
				description: 'Fix auth test failures',
			},
			result: 'agentId: abc123\nAll 12 tests now pass. Fixed a missing await in verifyToken().',
			duration: 45200,
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				prompt: 'Deploy the application to production.',
				subagent_type: 'build',
				description: 'Production deployment',
			},
			result: 'agentId: def456\nError: Build failed with exit code 1. Missing environment variable DATABASE_URL.',
			isError: true,
		}),
	},
};
