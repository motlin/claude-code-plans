import type {Meta, StoryObj} from '@storybook/react-vite';
import {WebFetchRenderer} from '../../../components/tool-renderers/webfetch-renderer';
import type {ClientToolCall} from '../../../components/tool-renderers/types';

function makeToolCall(overrides: Partial<ClientToolCall> & {input: ClientToolCall['input']}): ClientToolCall {
	return {
		id: 'tool-webfetch-1',
		name: 'WebFetch',
		param: '',
		sourceUuid: 'uuid-1',
		...overrides,
	};
}

const meta = {
	title: 'Session Detail/Tool Renderers/WebFetchRenderer',
	component: WebFetchRenderer,
} satisfies Meta<typeof WebFetchRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
	args: {
		toolCall: makeToolCall({
			input: {
				url: 'https://api.example.com/docs/getting-started',
				prompt: 'Extract the installation instructions',
			},
			result: '# Getting Started\n\nInstall the package:\n\n```bash\nnpm install @example/sdk\n```\n\nThen configure your client:\n\n```typescript\nimport { Client } from "@example/sdk";\nconst client = new Client({ apiKey: "..." });\n```',
			param: 'https://api.example.com/docs/getting-started',
		}),
	},
};

export const Error: Story = {
	args: {
		toolCall: makeToolCall({
			input: {url: 'https://api.example.com/private/endpoint'},
			result: 'Error: HTTP 403 Forbidden. Access denied.',
			isError: true,
			param: 'https://api.example.com/private/endpoint',
		}),
	},
};
