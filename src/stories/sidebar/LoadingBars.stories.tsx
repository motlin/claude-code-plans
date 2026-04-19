import type {Meta, StoryObj} from '@storybook/react-vite';
import {LoadingBars} from '../../components/sidebar/primitives/LoadingBars';

const meta = {
	title: 'Sidebar/LoadingBars',
	component: LoadingBars,
} satisfies Meta<typeof LoadingBars>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InContainer: Story = {
	decorators: [
		(Story) => (
			<div style={{width: 200, padding: 8, background: '#1b1b1d'}}>
				<Story />
			</div>
		),
	],
};
