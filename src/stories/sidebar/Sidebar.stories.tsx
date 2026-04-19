import type {Meta, StoryObj} from '@storybook/react-vite';
import {Sidebar} from '../../components/sidebar/Sidebar';
import {activeSessionsQueryOptions} from '../../queries/active';
import {createStoryQueryClient, StoryWrapper} from './decorators';

function createSeededQueryClient() {
	const queryClient = createStoryQueryClient();
	queryClient.setQueryData(activeSessionsQueryOptions.queryKey, [
		{
			sessionId: 'sess-1',
			projectDir: '/home/user/claude-code-plans',
			projectName: 'claude-code-plans',
			lastModified: Date.now(),
		},
	]);
	return queryClient;
}

const meta = {
	title: 'Sidebar/Sidebar',
	component: Sidebar,
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj;

export const Expanded: Story = {
	render: () => (
		<StoryWrapper queryClient={createSeededQueryClient()}>
			<div style={{height: 600, display: 'flex'}}>
				<Sidebar
					collapsed={false}
					onToggle={() => {}}
				/>
			</div>
		</StoryWrapper>
	),
};

export const Collapsed: Story = {
	render: () => (
		<StoryWrapper queryClient={createSeededQueryClient()}>
			<div style={{height: 600, position: 'relative'}}>
				<Sidebar
					collapsed={true}
					onToggle={() => {}}
				/>
			</div>
		</StoryWrapper>
	),
};

export const Mobile: Story = {
	render: () => (
		<StoryWrapper queryClient={createSeededQueryClient()}>
			<div style={{height: 600, display: 'flex'}}>
				<Sidebar
					collapsed={false}
					onToggle={() => {}}
					mobile
				/>
			</div>
		</StoryWrapper>
	),
};
