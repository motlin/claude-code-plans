import type {Meta, StoryObj} from "@storybook/react-vite";
import {SessionDetails} from "../../components/panes/session-details-pane";

const meta = {
	title: "Session Detail/SessionDetails",
	component: SessionDetails,
} satisfies Meta<typeof SessionDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveSession: Story = {
	args: {
		data: {
			cwd: "/Users/craig/projects/claude-code-plans",
			version: "1.0.23",
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
			model: {display_name: "Claude Sonnet 4"},
			rate_limits: {
				five_hour: {used_percentage: 18},
				seven_day: {used_percentage: 5},
			},
		},
		messageCount: 24,
	},
};

export const CompletedSession: Story = {
	args: {
		data: {
			cwd: "/Users/craig/projects/example",
			version: "1.0.20",
			cost: {
				total_duration_ms: 60_000,
				total_cost_usd: 0.0032,
			},
			model: {display_name: "Claude Haiku 3.5"},
		},
		messageCount: 4,
	},
};

export const MinimalData: Story = {
	args: {
		data: {
			cwd: "/tmp/scratch",
		},
		messageCount: 1,
	},
};
