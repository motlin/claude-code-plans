import type {Meta, StoryObj} from '@storybook/react-vite';
import {FileTree} from '../../components/file-tree';
import type {FileTreeNode} from '../../lib/plugins';
import {withRouterAndQuery} from '../sidebar/decorators';

const simpleTree: FileTreeNode = {
	path: '',
	children: [
		{
			path: 'skills',
			children: [{path: 'skills/SKILL.md'}, {path: 'skills/helper.ts'}],
		},
		{path: 'plugin.json'},
		{path: 'README.md'},
	],
};

const deepTree: FileTreeNode = {
	path: '',
	children: [
		{
			path: 'src',
			children: [
				{
					path: 'src/lib',
					children: [
						{
							path: 'src/lib/utils',
							children: [{path: 'src/lib/utils/format.ts'}, {path: 'src/lib/utils/parse.py'}],
						},
					],
				},
			],
		},
	],
};

const meta = {
	title: 'Plugins/FileTree',
	component: FileTree,
	decorators: [withRouterAndQuery],
} satisfies Meta<typeof FileTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFiles: Story = {
	args: {tree: simpleTree, pluginId: 'my-plugin'},
};

export const EmptyTree: Story = {
	args: {
		tree: {path: '', children: []},
		pluginId: 'empty-plugin',
	},
};

export const DeeplyNested: Story = {
	args: {tree: deepTree, pluginId: 'deep-plugin'},
};
