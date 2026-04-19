import type {Meta, StoryObj} from '@storybook/react-vite';
import {Context7Renderer} from '../../../components/tool-renderers/context7-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-context7-1',
		name: 'mcp__plugin_context7_context7__query-docs',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/Context7Renderer',
	component: Context7Renderer,
} satisfies Meta<typeof Context7Renderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {libraryId: '/tanstack/react-router', query: 'useNavigate hook'},
			result: '# useNavigate\n\nThe `useNavigate` hook returns a `navigate` function that can be used to navigate programmatically.\n\n```tsx\nimport { useNavigate } from "@tanstack/react-router"\n\nconst navigate = useNavigate()\nawait navigate({ to: "/posts" })\n```\n\n## Options\n- `to` - The destination path\n- `params` - Route params\n- `search` - Search params',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			name: 'mcp__plugin_context7_context7__resolve-library-id',
			input: {libraryName: 'nonexistent-lib-xyz'},
			result: JSON.stringify({error: 'Library not found: nonexistent-lib-xyz'}, null, 2),
		}),
	},
};
