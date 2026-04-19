import type {Meta, StoryObj} from '@storybook/react-vite';
import {HookSetup} from '../../components/hook-setup';

const meta = {
	title: 'Setup/HookSetup',
	component: HookSetup,
} satisfies Meta<typeof HookSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initial: Story = {};

export const ErrorState: Story = {
	args: {},
};
