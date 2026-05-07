import type {Meta, StoryObj} from '@storybook/react-vite';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {RouterProvider} from '@tanstack/react-router';
import {CommandPalette} from '../../components/command-palette';
import {sessionsQueryOptions} from '../../queries/sessions';
import {createStoryRouter} from '../sidebar/decorators';

const now = Date.now();

const sampleSessions = [
	{
		project: '/users/dev/project-a',
		projectName: 'project-a',
		sessions: [
			{
				id: 'sess-1',
				title: 'Refactor auth module',
				summary: undefined,
				mtime: new Date(now).toISOString(),
				created: new Date(now - 7_200_000).toISOString(),
				project: '/users/dev/project-a',
				projectName: 'project-a',
				messageCount: 24,
				gitBranch: 'main' as string | undefined,
				starred: false,
			},
			{
				id: 'sess-2',
				title: 'Fix database migration',
				summary: undefined,
				mtime: new Date(now - 3_600_000).toISOString(),
				created: new Date(now - 14_400_000).toISOString(),
				project: '/users/dev/project-a',
				projectName: 'project-a',
				messageCount: 12,
				gitBranch: 'fix/db' as string | undefined,
				starred: false,
			},
		],
	},
	{
		project: '/users/dev/project-b',
		projectName: 'project-b',
		sessions: [
			{
				id: 'sess-3',
				title: 'Add unit tests for parser',
				summary: undefined,
				mtime: new Date(now - 86_400_000).toISOString(),
				created: new Date(now - 172_800_000).toISOString(),
				project: '/users/dev/project-b',
				projectName: 'project-b',
				messageCount: 8,
				gitBranch: undefined,
				starred: false,
			},
		],
	},
];

function createSeededQueryClient(data: typeof sampleSessions | undefined) {
	const qc = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
	if (data) {
		qc.setQueryData(sessionsQueryOptions.queryKey, data);
	}
	return qc;
}

const meta = {
	title: 'Layout/CommandPalette',
	component: CommandPalette,
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenWithItems: Story = {
	args: {open: true, onOpenChange: () => {}},
	decorators: [
		(Story) => {
			const router = createStoryRouter();
			const qc = createSeededQueryClient(sampleSessions);
			return (
				<QueryClientProvider client={qc}>
					<RouterProvider
						router={router}
						defaultComponent={() => <Story />}
					/>
				</QueryClientProvider>
			);
		},
	],
};

export const NoResults: Story = {
	args: {open: true, onOpenChange: () => {}},
	decorators: [
		(Story) => {
			const router = createStoryRouter();
			const qc = createSeededQueryClient([]);
			return (
				<QueryClientProvider client={qc}>
					<RouterProvider
						router={router}
						defaultComponent={() => <Story />}
					/>
				</QueryClientProvider>
			);
		},
	],
};
