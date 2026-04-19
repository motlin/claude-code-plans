import type {Meta, StoryObj} from '@storybook/react-vite';
import {DiffStats} from '../../../components/tool-renderers/shared';

const meta = {
	title: 'Session Detail/Tool Renderers/DiffStats',
	component: DiffStats,
} satisfies Meta<typeof DiffStats>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		added: 15,
		removed: 3,
	},
};

export const AdditionsOnly: Story = {
	args: {
		added: 42,
		removed: 0,
	},
};
