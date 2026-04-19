import type {Meta, StoryObj} from '@storybook/react-vite';
import {SidebarToggleIcon} from '../../components/sidebar/primitives/SidebarToggleIcon';

const meta = {
	title: 'Sidebar/SidebarToggleIcon',
	component: SidebarToggleIcon,
} satisfies Meta<typeof SidebarToggleIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InButton: Story = {
	decorators: [
		(Story) => (
			<button
				type="button"
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: 32,
					height: 32,
					borderRadius: 6,
					border: 'none',
					background: '#2a2a2c',
					color: '#e0e0e0',
					cursor: 'pointer',
				}}
			>
				<Story />
			</button>
		),
	],
};
