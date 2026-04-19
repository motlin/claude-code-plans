import type {Meta, StoryObj} from '@storybook/react-vite';
import {SubagentTree} from '../../components/subagent-tree';
import {buildSubagentTree} from '../../lib/db/queries';
import {withRouterAndQuery} from '../sidebar/decorators';
import {makeAgent} from './subagent-fixtures';

const flatAgents = [
	makeAgent({id: 'root', agentType: 'Plan', description: 'Implement feature X'}),
	makeAgent({
		id: 'child-1',
		parentAgentId: 'root',
		agentType: 'Explore',
		description: 'Read codebase',
		startedAt: '2026-04-19T10:00:05Z',
		finishedAt: '2026-04-19T10:00:30Z',
	}),
	makeAgent({
		id: 'child-2',
		parentAgentId: 'root',
		agentType: 'build:precommit-runner',
		description: 'Run tests',
		startedAt: '2026-04-19T10:00:35Z',
		finishedAt: '2026-04-19T10:00:55Z',
	}),
];

const deepAgents = [
	makeAgent({id: 'd0', agentType: 'Plan', description: 'Top-level plan'}),
	makeAgent({
		id: 'd1',
		parentAgentId: 'd0',
		agentType: 'Explore',
		description: 'Explore level 1',
		startedAt: '2026-04-19T10:00:02Z',
		finishedAt: '2026-04-19T10:00:50Z',
	}),
	makeAgent({
		id: 'd2',
		parentAgentId: 'd1',
		agentType: 'general-purpose',
		description: 'Work level 2',
		startedAt: '2026-04-19T10:00:05Z',
		finishedAt: '2026-04-19T10:00:40Z',
	}),
	makeAgent({
		id: 'd3',
		parentAgentId: 'd2',
		agentType: 'git:commit-handler',
		description: 'Commit level 3',
		startedAt: '2026-04-19T10:00:10Z',
		finishedAt: '2026-04-19T10:00:35Z',
	}),
	makeAgent({
		id: 'd4',
		parentAgentId: 'd3',
		agentType: 'build:precommit-runner',
		description: 'Precommit level 4',
		startedAt: '2026-04-19T10:00:15Z',
		finishedAt: '2026-04-19T10:00:30Z',
	}),
];

const meta = {
	title: 'Session Detail/Subagents/SubagentTree',
	component: SubagentTree,
	decorators: [withRouterAndQuery],
} satisfies Meta<typeof SubagentTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TreeWithChildren: Story = {
	args: {
		tree: buildSubagentTree(flatAgents),
		totalCount: flatAgents.length,
	},
};

export const EmptyTree: Story = {
	args: {
		tree: [],
		totalCount: 0,
	},
};

export const DeeplyNested: Story = {
	args: {
		tree: buildSubagentTree(deepAgents),
		totalCount: deepAgents.length,
	},
};
