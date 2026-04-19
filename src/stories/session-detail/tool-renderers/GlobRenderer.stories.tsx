import type {Meta, StoryObj} from '@storybook/react-vite';
import {GlobRenderer} from '../../../components/tool-renderers/glob-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-glob-1',
		name: 'Glob',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/GlobRenderer',
	component: GlobRenderer,
} satisfies Meta<typeof GlobRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MatchedFiles: Story = {
	args: {
		toolCall: makeToolCall({
			input: {pattern: '**/*.tsx', path: 'src/components'},
			param: '**/*.tsx',
			result: 'src/components/app.tsx\nsrc/components/sidebar.tsx\nsrc/components/header.tsx\nsrc/components/footer.tsx\nsrc/components/theme-provider.tsx',
		}),
	},
};

export const NoMatches: Story = {
	args: {
		toolCall: makeToolCall({
			input: {pattern: '**/*.rb'},
			param: '**/*.rb',
			result: '',
			isError: true,
		}),
	},
};
