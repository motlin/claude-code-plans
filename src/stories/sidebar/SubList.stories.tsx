import type {Meta, StoryObj} from '@storybook/react-vite';
import {SubList} from '../../components/sidebar/sublists/SubList';
import {sessionsQueryOptions} from '../../queries/sessions';
import {createStoryQueryClient, StoryWrapper} from './decorators';

const meta = {
	title: 'Sidebar/SubList',
	component: SubList,
} satisfies Meta<typeof SubList>;

export default meta;
type Story = StoryObj;

export const WithSessions: Story = {
	render: () => {
		const queryClient = createStoryQueryClient();
		queryClient.setQueryData(sessionsQueryOptions.queryKey, [
			{
				project: 'my-project',
				projectName: 'my-project',
				sessions: [
					{
						id: 'sess-1',
						title: 'Fix sidebar layout',
						summary: undefined,
						mtime: '2026-04-19T10:00:00Z',
						created: '2026-04-19T09:00:00Z',
						project: 'my-project',
						projectName: 'my-project',
						messageCount: 12,
						gitBranch: undefined,
						starred: false,
					},
					{
						id: 'sess-2',
						title: 'Add storybook stories',
						summary: undefined,
						mtime: '2026-04-18T09:00:00Z',
						created: '2026-04-18T08:00:00Z',
						project: 'my-project',
						projectName: 'my-project',
						messageCount: 8,
						gitBranch: undefined,
						starred: false,
					},
					{
						id: 'sess-3',
						title: 'Refactor hooks',
						summary: undefined,
						mtime: '2026-04-17T08:00:00Z',
						created: '2026-04-17T07:00:00Z',
						project: 'my-project',
						projectName: 'my-project',
						messageCount: 5,
						gitBranch: undefined,
						starred: false,
					},
				],
			},
		]);
		return (
			<StoryWrapper queryClient={queryClient}>
				<SubList
					section="sessions"
					activeItemId="sess-1"
				/>
			</StoryWrapper>
		);
	},
};

export const Loading: Story = {
	render: () => {
		const queryClient = createStoryQueryClient({enabled: false});
		return (
			<StoryWrapper queryClient={queryClient}>
				<SubList
					section="sessions"
					activeItemId={null}
				/>
			</StoryWrapper>
		);
	},
};

export const Empty: Story = {
	render: () => {
		const queryClient = createStoryQueryClient();
		queryClient.setQueryData(sessionsQueryOptions.queryKey, [] as never[]);
		return (
			<StoryWrapper queryClient={queryClient}>
				<SubList
					section="sessions"
					activeItemId={null}
				/>
			</StoryWrapper>
		);
	},
};
