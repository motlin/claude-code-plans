import type {Meta, StoryObj} from '@storybook/react-vite';
import {PlansSubList} from '../../components/sidebar/sublists/PlansSubList';
import {plansQueryOptions} from '../../lib/api/plans';
import {createStoryQueryClient, StoryWrapper} from './decorators';

const meta = {
	title: 'Sidebar/PlansSubList',
	component: PlansSubList,
} satisfies Meta<typeof PlansSubList>;

export default meta;
type Story = StoryObj;

export const SingleProject: Story = {
	render: () => {
		const queryClient = createStoryQueryClient();
		queryClient.setQueryData(plansQueryOptions().queryKey, [
			{
				filename: 'plan-a.md',
				title: 'Storybook setup',
				sha: 'sha-a',
				systemFrom: '2026-04-19T10:00:00Z',
				projects: [{projectId: 'proj-1', projectName: 'claude-code-plans'}],
			},
			{
				filename: 'plan-b.md',
				title: 'Sidebar refactor',
				sha: 'sha-b',
				systemFrom: '2026-04-18T09:00:00Z',
				projects: [{projectId: 'proj-1', projectName: 'claude-code-plans'}],
			},
		]);
		return (
			<StoryWrapper queryClient={queryClient}>
				<PlansSubList activeItemId="plan-a.md" />
			</StoryWrapper>
		);
	},
};

export const MultipleProjects: Story = {
	render: () => {
		const queryClient = createStoryQueryClient();
		queryClient.setQueryData(plansQueryOptions().queryKey, [
			{
				filename: 'plan-a.md',
				title: 'Storybook setup',
				sha: 'sha-a',
				systemFrom: '2026-04-19T10:00:00Z',
				projects: [{projectId: 'proj-1', projectName: 'claude-code-plans'}],
			},
			{
				filename: 'plan-c.md',
				title: 'API redesign',
				sha: 'sha-c',
				systemFrom: '2026-04-17T08:00:00Z',
				projects: [{projectId: 'proj-2', projectName: 'other-project'}],
			},
			{
				filename: 'plan-d.md',
				title: 'DB migration',
				sha: 'sha-d',
				systemFrom: '2026-04-16T07:00:00Z',
				projects: [{projectId: 'proj-2', projectName: 'other-project'}],
			},
		]);
		return (
			<StoryWrapper queryClient={queryClient}>
				<PlansSubList activeItemId={null} />
			</StoryWrapper>
		);
	},
};

export const Loading: Story = {
	render: () => {
		const queryClient = createStoryQueryClient({enabled: false});
		return (
			<StoryWrapper queryClient={queryClient}>
				<PlansSubList activeItemId={null} />
			</StoryWrapper>
		);
	},
};
