import type {Meta, StoryObj} from '@storybook/react-vite';
import {EnterPlanModeRenderer} from '../../../components/tool-renderers/enter-plan-mode-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-epm-1',
		name: 'EnterPlanMode',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/EnterPlanModeRenderer',
	component: EnterPlanModeRenderer,
} satisfies Meta<typeof EnterPlanModeRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		toolCall: makeToolCall({
			input: {},
			result: 'success',
		}),
	},
};
