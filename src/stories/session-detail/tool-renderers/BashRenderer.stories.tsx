import type {Meta, StoryObj} from '@storybook/react-vite';
import {BashRenderer} from '../../../components/tool-renderers/bash-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-bash-1',
		name: 'Bash',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/BashRenderer',
	component: BashRenderer,
} satisfies Meta<typeof BashRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {command: 'ls -la src/', description: 'List files in src directory'},
			result: '$ ls -la src/\ntotal 48\ndrwxr-xr-x  12 user staff  384 Apr 19 10:00 .\ndrwxr-xr-x   8 user staff  256 Apr 19 09:55 ..\n-rw-r--r--   1 user staff 1234 Apr 19 10:00 index.ts\n-rw-r--r--   1 user staff  567 Apr 19 09:50 app.tsx',
			param: 'ls -la src/',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {command: 'cat /nonexistent/file.txt', description: 'Read nonexistent file'},
			result: '$ cat /nonexistent/file.txt\ncat: /nonexistent/file.txt: No such file or directory',
			isError: true,
			param: 'cat /nonexistent/file.txt',
		}),
	},
};

export const ExitCode: Story = {
	args: {
		toolCall: makeToolCall({
			input: {command: 'npm run ci:typecheck', description: 'Verify TypeScript type checking'},
			result: "$ npm run ci:typecheck\nExit code 2\n\n> animal-kingdom@0.0.0 ci:typecheck\n> tsc --noEmit\n\nsrc/app.tsx(8,34): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
			isError: true,
			param: 'npm run ci:typecheck',
		}),
	},
};

export const AnsiEscapeCodes: Story = {
	args: {
		toolCall: makeToolCall({
			input: {command: 'npm test', description: 'Run the test suite'},
			result: '$ npm test\n\x1b[32m PASS \x1b[39m src/app.test.ts\n\x1b[32m PASS \x1b[39m src/utils.test.ts\n\x1b[1m\x1b[32mAll tests passed!\x1b[39m\x1b[22m\n\x1b[31m2 failed\x1b[39m, \x1b[33m1 skipped\x1b[39m, \x1b[32m10 passed\x1b[39m',
			param: 'npm test',
		}),
	},
};
