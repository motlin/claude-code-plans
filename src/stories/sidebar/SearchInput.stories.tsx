import type {Meta, StoryObj} from '@storybook/react-vite';
import {SearchInput} from '../../components/sidebar/primitives/SearchInput';
import {withRouterAndQuery} from './decorators';

const meta = {
	title: 'Sidebar/SearchInput',
	component: SearchInput,
	decorators: [withRouterAndQuery],
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InSidebarWidth: Story = {
	decorators: [
		(Story) => (
			<div style={{width: 288, background: '#1b1b1d'}}>
				<Story />
			</div>
		),
	],
};
