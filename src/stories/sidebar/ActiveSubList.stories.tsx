import type {Meta, StoryObj} from '@storybook/react-vite';
import {ActiveSubList} from '../../components/sidebar/sublists/ActiveSubList';
import {activeSessionsQueryOptions} from '../../queries/active';
import {createStoryQueryClient, StoryWrapper} from './decorators';

const meta = {
	title: 'Sidebar/ActiveSubList',
	component: ActiveSubList,
} satisfies Meta<typeof ActiveSubList>;

export default meta;
type Story = StoryObj;

export const Loading: Story = {
	render: () => {
		const queryClient = createStoryQueryClient({enabled: false});
		return (
			<StoryWrapper queryClient={queryClient}>
				<ActiveSubList />
			</StoryWrapper>
		);
	},
};

export const WithSessions: Story = {
	render: () => {
		const queryClient = createStoryQueryClient();
		queryClient.setQueryData(activeSessionsQueryOptions.queryKey, [
			{
				sessionId: 'sess-1',
				projectDir: '/home/user/claude-code-plans',
				projectName: 'claude-code-plans',
				lastModified: Date.now(),
			},
			{
				sessionId: 'sess-2',
				projectDir: '/home/user/my-other-project',
				projectName: 'my-other-project',
				lastModified: Date.now(),
			},
		]);
		return (
			<StoryWrapper queryClient={queryClient}>
				<ActiveSubList />
			</StoryWrapper>
		);
	},
};

export const Empty: Story = {
	render: () => {
		const queryClient = createStoryQueryClient();
		queryClient.setQueryData(activeSessionsQueryOptions.queryKey, []);
		return (
			<StoryWrapper queryClient={queryClient}>
				<ActiveSubList />
			</StoryWrapper>
		);
	},
};
