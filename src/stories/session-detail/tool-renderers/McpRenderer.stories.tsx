import type {Meta, StoryObj} from '@storybook/react-vite';
import {McpRenderer} from '../../../components/tool-renderers/mcp-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-mcp-1',
		name: 'mcp__plugin_serena_serena__find_symbol',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/McpRenderer',
	component: McpRenderer,
} satisfies Meta<typeof McpRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {name_path: 'AppDb', relative_path: 'src/lib/db'},
			result: JSON.stringify({name: 'AppDb', kind: 'class', path: 'src/lib/db/connection.ts', line: 42}, null, 2),
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			name: 'mcp__plugin_serena_serena__get_symbols_overview',
			input: {relative_path: 'src/nonexistent/file.ts'},
			result: 'Error: File not found: src/nonexistent/file.ts',
			isError: true,
		}),
	},
};
