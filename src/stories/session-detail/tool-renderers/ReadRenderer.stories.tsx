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

export const PythonFile: Story = {
	args: {
		toolCall: makeToolCall({
			input: {file_path: '/Users/craig/projects/app/src/main.py'},
			param: '/Users/craig/projects/app/src/main.py',
			result: '     1→import os\n     2→from pathlib import Path\n     3→\n     4→def main():\n     5→    root = Path(os.getcwd())\n     6→    for item in root.iterdir():\n     7→        if item.is_file():\n     8→            print(f"Found: {item.name}")\n     9→\n    10→if __name__ == "__main__":\n    11→    main()',
		}),
	},
};

export const JsonFile: Story = {
	args: {
		toolCall: makeToolCall({
			input: {file_path: '/Users/craig/projects/app/package.json'},
			param: '/Users/craig/projects/app/package.json',
			result: '     1→{\n     2→  "name": "my-app",\n     3→  "version": "1.0.0",\n     4→  "dependencies": {\n     5→    "express": "^4.18.0",\n     6→    "typescript": "^5.0.0"\n     7→  },\n     8→  "scripts": {\n     9→    "start": "node dist/index.js",\n    10→    "build": "tsc"\n    11→  }\n    12→}',
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
