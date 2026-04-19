import type {Meta, StoryObj} from '@storybook/react-vite';
import {WriteRenderer} from '../../../components/tool-renderers/write-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';
import {withRouterAndQuery} from '../../sidebar/decorators';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-write-1',
		name: 'Write',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/WriteRenderer',
	component: WriteRenderer,
	decorators: [withRouterAndQuery],
} satisfies Meta<typeof WriteRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				file_path: '/Users/craig/projects/app/src/config.ts',
				content: 'export const PORT = 3000;\nexport const HOST = "localhost";\nexport const DEBUG = false;\n',
			},
			param: '/Users/craig/projects/app/src/config.ts',
			result: 'File written successfully.',
		}),
	},
};

export const WriteError: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				file_path: '/readonly/path/file.ts',
				content: 'export const x = 1;\n',
			},
			param: '/readonly/path/file.ts',
			result: 'Permission denied: /readonly/path/file.ts',
			isError: true,
		}),
	},
};
