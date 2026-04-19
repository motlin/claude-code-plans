import type {Meta, StoryObj} from '@storybook/react-vite';
import {SubagentSequence} from '../../components/subagent-sequence';
import {makeAgent} from './subagent-fixtures';

const sequenceAgents = [
	makeAgent({id: 'root', agentType: 'Plan', description: 'Build feature'}),
	makeAgent({
		id: 'explore',
		parentAgentId: 'root',
		agentType: 'Explore',
		description: 'Read source files',
		startedAt: '2026-04-19T10:00:03Z',
		finishedAt: '2026-04-19T10:00:20Z',
	}),
	makeAgent({
		id: 'commit',
		parentAgentId: 'root',
		agentType: 'git:commit-handler',
		description: 'Commit changes',
		startedAt: '2026-04-19T10:00:25Z',
		finishedAt: '2026-04-19T10:00:45Z',
	}),
];

const meta = {
	title: 'Session Detail/Subagents/SubagentSequence',
	component: SubagentSequence,
} satisfies Meta<typeof SubagentSequence>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SequenceDiagram: Story = {
	args: {
		agents: sequenceAgents,
	},
};

export const Empty: Story = {
	args: {
		agents: [],
	},
};
