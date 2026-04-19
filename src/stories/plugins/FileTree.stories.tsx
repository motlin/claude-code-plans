import type {Meta, StoryObj} from '@storybook/react-vite';
import {FileTree} from '../../components/file-tree';
import type {FileTreeNode} from '../../lib/plugins';
import {withRouterAndQuery} from '../sidebar/decorators';

const simpleTree: FileTreeNode = {
	name: 'my-plugin',
	path: '',
	type: 'directory',
	children: [
		{
			name: 'skills',
			path: 'skills',
			type: 'directory',
			children: [
				{name: 'SKILL.md', path: 'skills/SKILL.md', type: 'file'},
				{name: 'helper.ts', path: 'skills/helper.ts', type: 'file'},
			],
		},
		{name: 'plugin.json', path: 'plugin.json', type: 'file'},
		{name: 'README.md', path: 'README.md', type: 'file'},
	],
};

const deepTree: FileTreeNode = {
	name: 'deep-plugin',
	path: '',
	type: 'directory',
	children: [
		{
			name: 'src',
			path: 'src',
			type: 'directory',
			children: [
				{
					name: 'lib',
					path: 'src/lib',
					type: 'directory',
					children: [
						{
							name: 'utils',
							path: 'src/lib/utils',
							type: 'directory',
							children: [
								{name: 'format.ts', path: 'src/lib/utils/format.ts', type: 'file'},
								{name: 'parse.py', path: 'src/lib/utils/parse.py', type: 'file'},
							],
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
		tree: {name: 'empty-plugin', path: '', type: 'directory', children: []},
		pluginId: 'empty-plugin',
	},
};

export const DeeplyNested: Story = {
	args: {tree: deepTree, pluginId: 'deep-plugin'},
};
