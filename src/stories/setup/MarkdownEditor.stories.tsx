import type {Meta, StoryObj} from '@storybook/react-vite';
import {MarkdownEditor} from '../../components/markdown-editor';

const noop = () => {};

const meta = {
	title: 'Setup/MarkdownEditor',
	component: MarkdownEditor,
	args: {
		onChange: noop,
	},
} satisfies Meta<typeof MarkdownEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithContent: Story = {
	args: {
		markdown:
			'# Hello World\n\nThis is a **bold** paragraph with a [link](https://example.com).\n\n- Item one\n- Item two\n\n```ts\nconst x = 42;\n```\n',
	},
};

export const EmptyEditor: Story = {
	args: {markdown: ''},
};
