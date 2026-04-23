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
		subagentTree: [],
	},
};

export const EmptySession: Story = {
	args: {
		sessionId: 'story-session-empty',
		lines: [],
		toolResultMap: [],
		subagentTree: [],
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
		subagentTree: [],
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
		subagentTree: [],
	},
};

export const WithMetadataRecords: Story = {
	args: {
		sessionId: 'story-session-metadata',
		lines: [
			{type: 'agent-name', agentName: 'git-replay-automation', lineIndex: 0},
			{type: 'permission-mode', permissionMode: 'acceptEdits', lineIndex: 1},
			line(2, 'user', 'Fix the authentication bug', '2026-04-19T10:00:00Z'),
			assistantBlocks(
				3,
				[{type: 'text', text: "I'll look into the authentication module."}],
				'2026-04-19T10:00:05Z',
			),
			{
				type: 'pr-link',
				prUrl: 'https://github.com/example/repo/pull/42',
				prNumber: 42,
				prRepository: 'example/repo',
				timestamp: '2026-04-19T10:05:00Z',
				lineIndex: 4,
			},
			line(5, 'user', 'The PR looks good', '2026-04-19T10:10:00Z'),
			assistantBlocks(6, [{type: 'text', text: 'The fix has been merged.'}], '2026-04-19T10:10:05Z'),
		],
		toolResultMap: [],
		subagentTree: [],
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
		subagentTree: [],
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
		subagentTree: [],
	},
};

export const WithDisplayToggles: Story = {
	args: {
		sessionId: 'story-session-toggles',
		lines: [
			{type: 'agent-name', agentName: 'code-reviewer', lineIndex: 0},
			{type: 'permission-mode', permissionMode: 'auto', lineIndex: 1},
			line(2, 'user', 'Review the changes', '2026-04-19T10:00:00Z'),
			{
				type: 'attachment',
				attachmentJson: JSON.stringify({
					type: 'hook_success',
					hookName: 'pre-lint',
					hookEvent: 'PreToolUse',
					durationMs: 38,
				}),
				lineIndex: 3,
			},
			assistantBlocks(4, [{type: 'text', text: "I'll review the diff."}], '2026-04-19T10:00:03Z'),
			{
				type: 'attachment',
				attachmentJson: JSON.stringify({
					type: 'hook_success',
					hookName: 'post-lint',
					hookEvent: 'PostToolUse',
					durationMs: 12,
				}),
				lineIndex: 5,
			},
			{
				type: 'attachment',
				attachmentJson: JSON.stringify({
					type: 'hook_non_blocking_error',
					hookName: 'validator',
					hookEvent: 'PostToolUse',
					stderr: 'Warning: 2 issues found',
				}),
				lineIndex: 6,
			},
			{
				type: 'attachment',
				attachmentJson: JSON.stringify({type: 'task_reminder', content: 'You have 3 pending tasks'}),
				lineIndex: 7,
			},
			{
				type: 'attachment',
				attachmentJson: JSON.stringify({
					type: 'skill_listing',
					content: 'Available skills: build, test, deploy',
				}),
				lineIndex: 8,
			},
			line(9, 'user', 'Thanks!', '2026-04-19T10:01:00Z'),
			assistantBlocks(10, [{type: 'text', text: 'Review complete.'}], '2026-04-19T10:01:05Z'),
		],
		toolResultMap: [],
		subagentTree: [],
		showPassedHooks: false,
		showHookErrors: false,
		showSystemBanners: false,
		showTimestamps: false,
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
		subagentTree: [],
	},
};
