import type {Meta, StoryObj} from '@storybook/react-vite';
import {CollapsibleSection} from '../../../components/tool-renderers/shared';

const meta = {
	title: 'Session Detail/Tool Renderers/CollapsibleSection',
	component: CollapsibleSection,
} satisfies Meta<typeof CollapsibleSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
	args: {
		label: <span>Details</span>,
		defaultOpen: true,
		children: (
			<pre className="text-xs text-text-500">Line 1: some output\nLine 2: more output\nLine 3: final line</pre>
		),
	},
};

export const Collapsed: Story = {
	args: {
		label: <span>Hidden content</span>,
		defaultOpen: false,
		children: <pre className="text-xs text-text-500">This content is initially hidden.</pre>,
	},
};
