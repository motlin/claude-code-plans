import type {Meta, StoryObj} from '@storybook/react-vite';
import {StatusFooter} from '../../components/status-footer';

const meta = {
	title: 'Session Detail/StatusFooter',
	component: StatusFooter,
} satisfies Meta<typeof StatusFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveSession: Story = {
	args: {
		data: {
			cwd: '/Users/craig/projects/claude-code-plans',
			version: '1.0.23',
			cost: {
				total_duration_ms: 342_000,
				total_cost_usd: 1.47,
				total_lines_added: 245,
				total_lines_removed: 89,
			},
			context_window: {
				used_percentage: 42,
				total_input_tokens: 85_000,
				total_output_tokens: 12_000,
				context_window_size: 200_000,
			},
			model: {display_name: 'Claude Sonnet 4'},
			rate_limits: {
				five_hour: {used_percentage: 18},
				seven_day: {used_percentage: 5},
			},
		},
		gitBranch: 'feature/storybook',
		gitSha: 'a1b2c3d',
		gitClean: false,
		messageCount: 24,
		pendingTaskCount: 3,
	},
};

export const CompletedSession: Story = {
	args: {
		data: {
			cwd: '/Users/craig/projects/example',
			version: '1.0.20',
			cost: {
				total_duration_ms: 60_000,
				total_cost_usd: 0.0032,
			},
			model: {display_name: 'Claude Haiku 3.5'},
		},
		gitBranch: 'main',
		gitSha: 'f4e5d6c',
		gitClean: true,
		messageCount: 4,
		pendingTaskCount: 0,
	},
};

export const MinimalData: Story = {
	args: {
		data: {
			cwd: '/tmp/scratch',
		},
		gitBranch: null,
		gitSha: null,
		gitClean: null,
		messageCount: 1,
		pendingTaskCount: 0,
	},
};
