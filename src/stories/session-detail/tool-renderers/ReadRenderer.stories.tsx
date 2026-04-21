import type {Meta, StoryObj} from '@storybook/react-vite';
import {ReadRenderer} from '../../../components/tool-renderers/read-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-read-1',
		name: 'Read',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/ReadRenderer',
	component: ReadRenderer,
} satisfies Meta<typeof ReadRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLineNumbers: Story = {
	args: {
		toolCall: makeToolCall({
			input: {file_path: '/Users/craig/projects/app/src/index.ts'},
			param: '/Users/craig/projects/app/src/index.ts',
			result: '     1\u2192import express from "express";\n     2\u2192\n     3\u2192const app = express();\n     4\u2192app.listen(3000);',
		}),
	},
};

export const FileNotFound: Story = {
	args: {
		toolCall: makeToolCall({
			input: {file_path: '/missing/file.ts'},
			param: '/missing/file.ts',
			result: 'File does not exist. Note: your current working directory is /Users/craig/projects/app.',
			isError: true,
		}),
	},
};
