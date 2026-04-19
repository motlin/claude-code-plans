import type {Meta, StoryObj} from '@storybook/react-vite';
import {DurationBadge, ToolMeta} from '../../../components/tool-renderers/shared';

const meta = {
	title: 'Session Detail/Tool Renderers/ToolMeta',
	component: ToolMeta,
} satisfies Meta<typeof ToolMeta>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithDuration: Story = {
	args: {
		children: (
			<>
				Bash <DurationBadge duration={3200} />
			</>
		),
	},
};

export const NoDuration: Story = {
	args: {
		children: 'Read',
	},
};
