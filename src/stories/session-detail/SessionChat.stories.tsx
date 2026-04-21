import type {Meta, StoryObj} from '@storybook/react-vite';
import {SessionChat} from '../../components/session-chat';
import type {SessionLine, SessionContentBlock} from '../../lib/sessions';

function line(index: number, type: 'user' | 'assistant', content: string, timestamp?: string): SessionLine {
	return {
		type,
		uuid: `uuid-${index}`,
		timestamp,
		lineIndex: index,
		message: {role: type === 'user' ? 'user' : 'assistant', content},
	};
}

function userBlocks(index: number, blocks: SessionContentBlock[], timestamp?: string): SessionLine {
	return {
		type: 'user',
		uuid: `uuid-${index}`,
		timestamp,
		lineIndex: index,
		message: {role: 'user', content: blocks},
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

export const WithGroupedAssistantMessages: Story = {
	args: {
		sessionId: 'story-session-grouped',
		lines: [
			line(0, 'user', 'Refactor the auth module', '2026-04-19T11:00:00Z'),
			assistantBlocks(
				1,
				[{type: 'text', text: "I'll start by reading the current implementation."}],
				'2026-04-19T11:00:02Z',
			),
			assistantBlocks(
				2,
				[
					{
						type: 'tool_use',
						id: 'tool-g1',
						name: 'Read',
						input: {file_path: '/src/auth.ts'} as SessionContentBlock['input'],
					},
				],
				'2026-04-19T11:00:03Z',
			),
			assistantBlocks(
				3,
				[
					{
						type: 'tool_use',
						id: 'tool-g2',
						name: 'Edit',
						input: {
							file_path: '/src/auth.ts',
							old_string: 'function login()',
							new_string: 'async function login()',
						} as SessionContentBlock['input'],
					},
				],
				'2026-04-19T11:00:05Z',
			),
			assistantBlocks(
				4,
				[
					{
						type: 'tool_use',
						id: 'tool-g3',
						name: 'Bash',
						input: {command: 'npm test', description: 'Run auth tests'} as SessionContentBlock['input'],
					},
				],
				'2026-04-19T11:00:10Z',
			),
			assistantBlocks(
				5,
				[{type: 'text', text: 'The auth module has been refactored. All tests pass.'}],
				'2026-04-19T11:00:15Z',
			),
			line(6, 'user', 'Looks good, thanks!', '2026-04-19T11:01:00Z'),
			assistantBlocks(
				7,
				[{type: 'text', text: "You're welcome! Let me know if you need anything else."}],
				'2026-04-19T11:01:02Z',
			),
		],
		toolResultMap: [
			[
				'tool-g1',
				{
					result: 'function login() {\n  return fetch("/api/login");\n}',
					isError: false,
					resultUuid: 'result-g1',
					duration: 15,
				},
			],
			['tool-g2', {result: 'OK', isError: false, resultUuid: 'result-g2', duration: 8}],
			['tool-g3', {result: 'All 12 tests passed', isError: false, resultUuid: 'result-g3', duration: 3200}],
		],
		decorations: [],
		textHtmlMap: [
			['0:0', '<p>Refactor the auth module</p>'],
			['1:0', "<p>I'll start by reading the current implementation.</p>"],
			['5:0', '<p>The auth module has been refactored. All tests pass.</p>'],
			['6:0', '<p>Looks good, thanks!</p>'],
			['7:0', "<p>You're welcome! Let me know if you need anything else.</p>"],
		],
	},
};

// 1x1 red pixel PNG
const tinyPngBase64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

// Minimal PDF header
const tinyPdfBase64 = 'JVBERi0xLjAKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyA+PgplbmRvYmoK';

export const WithUserImage: Story = {
	args: {
		sessionId: 'story-session-user-image',
		lines: [
			userBlocks(
				0,
				[
					{type: 'text', text: 'Here is a screenshot of the error'},
					{
						type: 'image',
						source: {type: 'base64', media_type: 'image/png', data: tinyPngBase64},
					},
				],
				'2026-04-19T12:00:00Z',
			),
			assistantBlocks(
				1,
				[{type: 'text', text: 'I can see the error in your screenshot. The issue is a missing import.'}],
				'2026-04-19T12:00:05Z',
			),
		],
		toolResultMap: [],
		decorations: [],
		textHtmlMap: [
			['0:0', '<p>Here is a screenshot of the error</p>'],
			['1:0', '<p>I can see the error in your screenshot. The issue is a missing import.</p>'],
		],
	},
};

export const WithAssistantImage: Story = {
	args: {
		sessionId: 'story-session-assistant-image',
		lines: [
			line(0, 'user', 'Take a screenshot of the page', '2026-04-19T13:00:00Z'),
			assistantBlocks(
				1,
				[
					{type: 'text', text: 'Here is the current state of the page:'},
					{
						type: 'image',
						source: {type: 'base64', media_type: 'image/png', data: tinyPngBase64},
					},
				],
				'2026-04-19T13:00:05Z',
			),
		],
		toolResultMap: [],
		decorations: [],
		textHtmlMap: [
			['0:0', '<p>Take a screenshot of the page</p>'],
			['1:0', '<p>Here is the current state of the page:</p>'],
		],
	},
};

export const WithDocumentAttachment: Story = {
	args: {
		sessionId: 'story-session-document',
		lines: [
			userBlocks(
				0,
				[
					{type: 'text', text: 'Please review this PDF'},
					{
						type: 'document',
						source: {type: 'base64', media_type: 'application/pdf', data: tinyPdfBase64},
					},
				],
				'2026-04-19T14:00:00Z',
			),
			assistantBlocks(
				1,
				[{type: 'text', text: "I've reviewed the document. Here are my findings."}],
				'2026-04-19T14:00:10Z',
			),
		],
		toolResultMap: [],
		decorations: [],
		textHtmlMap: [
			['0:0', '<p>Please review this PDF</p>'],
			['1:0', "<p>I've reviewed the document. Here are my findings.</p>"],
		],
	},
};
