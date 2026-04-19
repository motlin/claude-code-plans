import type {Meta, StoryObj} from '@storybook/react-vite';
import {SessionChat} from '../../components/session-chat';
import type {SessionLine, SessionContentBlock} from '../../lib/sessions';

function line(index: number, type: string, content: string, timestamp?: string): SessionLine {
	return {
		type,
		uuid: `uuid-${index}`,
		timestamp,
		lineIndex: index,
		message: {role: type === 'user' ? 'user' : 'assistant', content},
	};
}

function assistantBlocks(index: number, blocks: SessionContentBlock[], timestamp?: string): SessionLine {
	return {
		type: 'assistant',
		uuid: `uuid-${index}`,
		timestamp,
		lineIndex: index,
		message: {role: 'assistant', content: blocks},
	};
}

const simpleConversation: SessionLine[] = [
	line(0, 'user', 'How do I add Storybook to a Vite project?', '2026-04-19T10:00:00Z'),
	assistantBlocks(
		1,
		[{type: 'text', text: 'You can add Storybook to a Vite project by running `npx storybook@latest init`.'}],
		'2026-04-19T10:00:05Z',
	),
	line(2, 'user', 'What about testing?', '2026-04-19T10:01:00Z'),
	assistantBlocks(
		3,
		[{type: 'text', text: 'For testing stories, install `@storybook/test-runner` and run `npx test-storybook`.'}],
		'2026-04-19T10:01:08Z',
	),
];

const textHtmlEntries: Array<[string, string]> = [
	['1:0', '<p>You can add Storybook to a Vite project by running <code>npx storybook@latest init</code>.</p>'],
	[
		'3:0',
		'<p>For testing stories, install <code>@storybook/test-runner</code> and run <code>npx test-storybook</code>.</p>',
	],
	['0:0', '<p>How do I add Storybook to a Vite project?</p>'],
	['2:0', '<p>What about testing?</p>'],
];

const meta = {
	title: 'Session Detail/SessionChat',
	component: SessionChat,
} satisfies Meta<typeof SessionChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithMessages: Story = {
	args: {
		sessionId: 'story-session-1',
		lines: simpleConversation,
		toolResultMap: [],
		decorations: [],
		textHtmlMap: textHtmlEntries,
	},
};

export const EmptySession: Story = {
	args: {
		sessionId: 'story-session-empty',
		lines: [],
		toolResultMap: [],
		decorations: [],
		textHtmlMap: [],
	},
};

export const WithToolCalls: Story = {
	args: {
		sessionId: 'story-session-tools',
		lines: [
			line(0, 'user', 'Read the README', '2026-04-19T09:00:00Z'),
			assistantBlocks(
				1,
				[
					{
						type: 'tool_use',
						id: 'tool-1',
						name: 'Read',
						input: {file_path: '/README.md'} as SessionContentBlock['input'],
					},
				],
				'2026-04-19T09:00:03Z',
			),
		],
		toolResultMap: [
			[
				'tool-1',
				{result: '# My Project\nA sample project.', isError: false, resultUuid: 'result-1', duration: 42},
			],
		],
		decorations: [],
		textHtmlMap: [['0:0', '<p>Read the README</p>']],
	},
};
