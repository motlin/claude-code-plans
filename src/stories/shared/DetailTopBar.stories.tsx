import type {Meta, StoryObj} from '@storybook/react-vite';
import {DetailTopBar, pillStyles} from '../../components/detail-top-bar';

const meta = {
	title: 'Shared/DetailTopBar',
	component: DetailTopBar,
} satisfies Meta<typeof DetailTopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTitleAndPills: Story = {
	args: {
		children: (
			<>
				<h1 className="text-sm font-semibold">Session Details</h1>
				<a
					href="#"
					className={pillStyles.primary}
				>
					Primary
				</a>
				<a
					href="#"
					className={pillStyles.outline}
				>
					Outline
				</a>
			</>
		),
	},
};

export const Empty: Story = {
	args: {
		children: null,
	},
};

export const OverflowPills: Story = {
	args: {
		children: (
			<>
				{Array.from({length: 12}, (_, i) => (
					<a
						key={i}
						href="#"
						className={pillStyles.primary}
					>
						Pill {i + 1}
					</a>
				))}
			</>
		),
	},
};
