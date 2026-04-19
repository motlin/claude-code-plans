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

export const WithHighlighting: Story = {
	args: {
		toolCall: makeToolCall({
			input: {file_path: '/Users/craig/projects/app/src/index.ts'},
			param: '/Users/craig/projects/app/src/index.ts',
			result: '     1\u2192import express from "express";\n     2\u2192\n     3\u2192const app = express();\n     4\u2192app.listen(3000);',
			highlightedHtml:
				'<pre class="shiki" style="background-color:#1e1e1e"><code><span class="line"><span style="color:#C586C0">import</span> <span style="color:#9CDCFE">express</span> <span style="color:#C586C0">from</span> <span style="color:#CE9178">"express"</span><span style="color:#D4D4D4">;</span></span>\n<span class="line"></span>\n<span class="line"><span style="color:#569CD6">const</span> <span style="color:#4FC1FF">app</span> <span style="color:#D4D4D4">=</span> <span style="color:#DCDCAA">express</span><span style="color:#D4D4D4">();</span></span>\n<span class="line"><span style="color:#9CDCFE">app</span><span style="color:#D4D4D4">.</span><span style="color:#DCDCAA">listen</span><span style="color:#D4D4D4">(</span><span style="color:#B5CEA8">3000</span><span style="color:#D4D4D4">);</span></span></code></pre>',
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
