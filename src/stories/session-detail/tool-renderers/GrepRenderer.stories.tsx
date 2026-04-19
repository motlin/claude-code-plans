import type {Meta, StoryObj} from '@storybook/react-vite';
import {GrepRenderer} from '../../../components/tool-renderers/grep-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-grep-1',
		name: 'Grep',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/GrepRenderer',
	component: GrepRenderer,
} satisfies Meta<typeof GrepRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchResults: Story = {
	args: {
		toolCall: makeToolCall({
			input: {pattern: 'useEffect', glob: '*.tsx', path: 'src/'},
			param: 'useEffect',
			result: 'src/components/app.tsx:12:  useEffect(() => {\nsrc/components/app.tsx:18:  useEffect(() => {\nsrc/components/sidebar.tsx:8:  useEffect(() => {\nsrc/hooks/use-data.ts:5:  useEffect(() => {',
		}),
	},
};

export const NoMatches: Story = {
	args: {
		toolCall: makeToolCall({
			input: {pattern: 'nonexistentSymbol', type: 'ts'},
			param: 'nonexistentSymbol',
			result: '',
			isError: true,
		}),
	},
};
