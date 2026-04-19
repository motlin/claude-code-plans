import type {Meta, StoryObj} from '@storybook/react-vite';
import {ModeToggle} from '../../components/mode-toggle';
import {withDarkTheme, withTheme} from './decorators';

const meta = {
	title: 'Layout/ModeToggle',
	component: ModeToggle,
	decorators: [withTheme],
} satisfies Meta<typeof ModeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LightMode: Story = {};

export const DarkMode: Story = {
	decorators: [withDarkTheme],
};
