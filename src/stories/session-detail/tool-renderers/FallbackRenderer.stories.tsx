import type {Meta, StoryObj} from '@storybook/react-vite';
import {FallbackRenderer} from '../../../components/tool-renderers/fallback-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-unknown-1',
		name: 'UnknownTool',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/FallbackRenderer',
	component: FallbackRenderer,
} satisfies Meta<typeof FallbackRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {query: 'search term', limit: '10'},
			result: 'Found 3 results:\n1. First result\n2. Second result\n3. Third result',
		}),
	},
};

export const MissingData: Story = {
	args: {
		toolCall: makeToolCall({
			input: {},
			isError: true,
		}),
	},
};
