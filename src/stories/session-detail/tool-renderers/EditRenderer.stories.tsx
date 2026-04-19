import type {Meta, StoryObj} from '@storybook/react-vite';
import {EditRenderer} from '../../../components/tool-renderers/edit-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-edit-1',
		name: 'Edit',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/EditRenderer',
	component: EditRenderer,
} satisfies Meta<typeof EditRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DiffView: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				file_path: '/Users/craig/projects/app/src/server.ts',
				old_string: 'const PORT = 3000;',
				new_string: 'const PORT = process.env.PORT ?? 3000;',
			},
			param: '/Users/craig/projects/app/src/server.ts',
			result: 'Edit applied successfully.',
			diffData: {
				ops: [],
				added: 1,
				removed: 1,
				oldContent:
					'import express from "express";\n\nconst PORT = 3000;\nconst app = express();\napp.listen(PORT);',
				newContent:
					'import express from "express";\n\nconst PORT = process.env.PORT ?? 3000;\nconst app = express();\napp.listen(PORT);',
				unifiedHunk:
					'@@ -1,5 +1,5 @@\n import express from "express";\n \n-const PORT = 3000;\n+const PORT = process.env.PORT ?? 3000;\n const app = express();\n app.listen(PORT);',
				filePath: '/Users/craig/projects/app/src/server.ts',
			},
		}),
	},
};

export const EditFailure: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				file_path: '/Users/craig/projects/app/src/server.ts',
				old_string: 'nonexistent string',
				new_string: 'replacement',
			},
			param: '/Users/craig/projects/app/src/server.ts',
			result: 'The old_string was not found in the file. Make sure it matches exactly.',
			isError: true,
		}),
	},
};
