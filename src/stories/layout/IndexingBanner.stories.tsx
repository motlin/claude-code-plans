import type {Meta, StoryObj} from '@storybook/react-vite';
import {IndexingBannerView} from '../../components/indexing-banner';
import {withDarkTheme} from './decorators';

const meta = {
	title: 'Layout/IndexingBanner',
	component: IndexingBannerView,
	args: {onDismiss: () => {}},
} satisfies Meta<typeof IndexingBannerView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Indexing: Story = {};

export const DarkMode: Story = {
	decorators: [withDarkTheme],
};
