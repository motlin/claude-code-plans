import {describe, it, expect} from 'vitest';
import {toolInputSchemas, isMcpTool} from '../src/lib/tool-input-schemas';
import {ContentBlockSchema, AttachmentPayloadSchema} from '../src/lib/schemas';

// ---------------------------------------------------------------------------
// Tool renderer story files
// ---------------------------------------------------------------------------
import * as BashStories from '../src/stories/session-detail/tool-renderers/BashRenderer.stories';
import * as GlobStories from '../src/stories/session-detail/tool-renderers/GlobRenderer.stories';
import * as GrepStories from '../src/stories/session-detail/tool-renderers/GrepRenderer.stories';
import * as WriteStories from '../src/stories/session-detail/tool-renderers/WriteRenderer.stories';
import * as EditStories from '../src/stories/session-detail/tool-renderers/EditRenderer.stories';
import * as ReadStories from '../src/stories/session-detail/tool-renderers/ReadRenderer.stories';
import * as AgentStories from '../src/stories/session-detail/tool-renderers/AgentRenderer.stories';
import * as WebFetchStories from '../src/stories/session-detail/tool-renderers/WebFetchRenderer.stories';
import * as SkillStories from '../src/stories/session-detail/tool-renderers/SkillRenderer.stories';
import * as AskUserQuestionStories from '../src/stories/session-detail/tool-renderers/AskUserQuestionRenderer.stories';
import * as ExitPlanModeStories from '../src/stories/session-detail/tool-renderers/ExitPlanModeRenderer.stories';
import * as TaskCreateStories from '../src/stories/session-detail/tool-renderers/TaskCreateRenderer.stories';
import * as TaskGetStories from '../src/stories/session-detail/tool-renderers/TaskGetRenderer.stories';
import * as TaskListStories from '../src/stories/session-detail/tool-renderers/TaskListRenderer.stories';
import * as TaskUpdateStories from '../src/stories/session-detail/tool-renderers/TaskUpdateRenderer.stories';
import * as EnterPlanModeStories from '../src/stories/session-detail/tool-renderers/EnterPlanModeRenderer.stories';
import * as TodoWriteStories from '../src/stories/session-detail/tool-renderers/TodoWriteRenderer.stories';
import * as WebSearchStories from '../src/stories/session-detail/tool-renderers/WebSearchRenderer.stories';
import * as SendMessageStories from '../src/stories/session-detail/tool-renderers/SendMessageRenderer.stories';
import * as TaskStopStories from '../src/stories/session-detail/tool-renderers/TaskStopRenderer.stories';
import * as CronCreateStories from '../src/stories/session-detail/tool-renderers/CronCreateRenderer.stories';

// Non-tool-renderer stories that contain ClientToolCall fixtures
import * as TasksViewStories from '../src/stories/tasks/TasksView.stories';

// SessionChat stories with content block fixtures
import * as SessionChatStories from '../src/stories/session-detail/SessionChat.stories';

// AttachmentBanner stories
import * as AttachmentBannerStories from '../src/stories/session-detail/AttachmentBanner.stories';

// MCP-based tool stories (inputs vary by server, validated as isMcpTool)
import * as McpStories from '../src/stories/session-detail/tool-renderers/McpRenderer.stories';
import * as GithubStories from '../src/stories/session-detail/tool-renderers/GithubRenderer.stories';
import * as PlaywrightStories from '../src/stories/session-detail/tool-renderers/PlaywrightRenderer.stories';
import * as Context7Stories from '../src/stories/session-detail/tool-renderers/Context7Renderer.stories';
import * as ChromeDevtoolsStories from '../src/stories/session-detail/tool-renderers/ChromeDevtoolsRenderer.stories';
import * as ClaudeInChromeStories from '../src/stories/session-detail/tool-renderers/ClaudeInChromeRenderer.stories';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StoryWithToolCall {
	args?: {
		toolCall?: {
			name?: string;
			input?: Record<string, unknown>;
		};
	};
}

function extractToolCallStories(
	storyModule: Record<string, unknown>,
): Array<{storyName: string; toolName: string; input: Record<string, unknown>}> {
	const results: Array<{storyName: string; toolName: string; input: Record<string, unknown>}> = [];
	for (const [key, value] of Object.entries(storyModule)) {
		if (key === 'default') continue;
		const story = value as StoryWithToolCall;
		const toolCall = story.args?.toolCall;
		if (!toolCall?.name || !toolCall.input) continue;
		results.push({storyName: key, toolName: toolCall.name, input: toolCall.input});
	}
	return results;
}

// ---------------------------------------------------------------------------
// Validate tool input fixtures against strict Zod schemas
// ---------------------------------------------------------------------------

const allStoryModules: Array<{moduleName: string; module: Record<string, unknown>}> = [
	{moduleName: 'BashRenderer', module: BashStories as Record<string, unknown>},
	{moduleName: 'GlobRenderer', module: GlobStories as Record<string, unknown>},
	{moduleName: 'GrepRenderer', module: GrepStories as Record<string, unknown>},
	{moduleName: 'WriteRenderer', module: WriteStories as Record<string, unknown>},
	{moduleName: 'EditRenderer', module: EditStories as Record<string, unknown>},
	{moduleName: 'ReadRenderer', module: ReadStories as Record<string, unknown>},
	{moduleName: 'AgentRenderer', module: AgentStories as Record<string, unknown>},
	{moduleName: 'WebFetchRenderer', module: WebFetchStories as Record<string, unknown>},
	{moduleName: 'SkillRenderer', module: SkillStories as Record<string, unknown>},
	{moduleName: 'AskUserQuestionRenderer', module: AskUserQuestionStories as Record<string, unknown>},
	{moduleName: 'ExitPlanModeRenderer', module: ExitPlanModeStories as Record<string, unknown>},
	{moduleName: 'TaskCreateRenderer', module: TaskCreateStories as Record<string, unknown>},
	{moduleName: 'TaskGetRenderer', module: TaskGetStories as Record<string, unknown>},
	{moduleName: 'TaskListRenderer', module: TaskListStories as Record<string, unknown>},
	{moduleName: 'TaskUpdateRenderer', module: TaskUpdateStories as Record<string, unknown>},
	{moduleName: 'EnterPlanModeRenderer', module: EnterPlanModeStories as Record<string, unknown>},
	{moduleName: 'TodoWriteRenderer', module: TodoWriteStories as Record<string, unknown>},
	{moduleName: 'WebSearchRenderer', module: WebSearchStories as Record<string, unknown>},
	{moduleName: 'SendMessageRenderer', module: SendMessageStories as Record<string, unknown>},
	{moduleName: 'TaskStopRenderer', module: TaskStopStories as Record<string, unknown>},
	{moduleName: 'CronCreateRenderer', module: CronCreateStories as Record<string, unknown>},
	{moduleName: 'McpRenderer', module: McpStories as Record<string, unknown>},
	{moduleName: 'GithubRenderer', module: GithubStories as Record<string, unknown>},
	{moduleName: 'PlaywrightRenderer', module: PlaywrightStories as Record<string, unknown>},
	{moduleName: 'Context7Renderer', module: Context7Stories as Record<string, unknown>},
	{moduleName: 'ChromeDevtoolsRenderer', module: ChromeDevtoolsStories as Record<string, unknown>},
	{moduleName: 'ClaudeInChromeRenderer', module: ClaudeInChromeStories as Record<string, unknown>},
];

describe('Story fixture validation against strict Zod schemas', () => {
	describe('tool renderer stories', () => {
		for (const {moduleName, module} of allStoryModules) {
			const stories = extractToolCallStories(module);
			for (const {storyName, toolName, input} of stories) {
				it(`${moduleName}/${storyName} — ${toolName} input passes schema`, () => {
					if (isMcpTool(toolName)) {
						return;
					}

					const schema = toolInputSchemas[toolName];
					expect(schema, `No schema registered for tool "${toolName}"`).toBeDefined();
					if (!schema) return;

					const result = schema!.safeParse(input);
					if (!result.success) {
						const issues = result.error.issues
							.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
							.join('\n');
						throw new Error(`${moduleName}/${storyName}: ${toolName} input validation failed:\n${issues}`);
					}
				});
			}
		}
	});

	describe('TasksView stories — toolCalls arrays', () => {
		interface StoryWithToolCalls {
			args?: {
				toolCalls?: Array<{
					name?: string;
					input?: Record<string, unknown>;
				}>;
			};
		}

		for (const [storyName, value] of Object.entries(TasksViewStories as Record<string, unknown>)) {
			if (storyName === 'default') continue;
			const story = value as StoryWithToolCalls;
			const toolCalls = story.args?.toolCalls ?? [];
			for (let index = 0; index < toolCalls.length; index++) {
				const tc = toolCalls[index];
				if (!tc?.name || !tc.input) continue;
				const toolName = tc.name;
				const input = tc.input;

				it(`TasksView/${storyName}[${index}] — ${toolName} input passes schema`, () => {
					if (isMcpTool(toolName)) return;

					const schema = toolInputSchemas[toolName];
					expect(schema, `No schema registered for tool "${toolName}"`).toBeDefined();
					if (!schema) return;

					const result = schema!.safeParse(input);
					if (!result.success) {
						const issues = result.error.issues
							.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
							.join('\n');
						throw new Error(
							`TasksView/${storyName}[${index}]: ${toolName} input validation failed:\n${issues}`,
						);
					}
				});
			}
		}
	});

	describe('AttachmentBanner stories — attachmentJson passes AttachmentPayloadSchema', () => {
		interface AttachmentStory {
			args?: {
				attachmentJson?: string;
			};
		}

		for (const [storyName, value] of Object.entries(AttachmentBannerStories as Record<string, unknown>)) {
			if (storyName === 'default') continue;
			const story = value as AttachmentStory;
			const json = story.args?.attachmentJson;
			if (!json) continue;

			it(`AttachmentBanner/${storyName} passes AttachmentPayloadSchema`, () => {
				const parsed = JSON.parse(json);
				const result = AttachmentPayloadSchema.safeParse(parsed);
				if (!result.success) {
					const issues = result.error.issues
						.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
						.join('\n');
					throw new Error(`AttachmentBanner/${storyName}: attachment validation failed:\n${issues}`);
				}
			});
		}
	});

	describe('SessionChat stories — content blocks pass ContentBlockSchema', () => {
		interface SessionChatStory {
			args?: {
				lines?: Array<{
					message?: {
						content?: string | Array<Record<string, unknown>>;
					};
				}>;
			};
		}

		for (const [storyName, value] of Object.entries(SessionChatStories as Record<string, unknown>)) {
			if (storyName === 'default') continue;
			const story = value as SessionChatStory;
			const lines = story.args?.lines ?? [];
			for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				const content = lines[lineIndex]?.message?.content;
				if (!Array.isArray(content)) continue;
				for (let blockIndex = 0; blockIndex < content.length; blockIndex++) {
					const block = content[blockIndex]!;
					it(`SessionChat/${storyName} line[${lineIndex}] block[${blockIndex}] (${block['type']}) passes ContentBlockSchema`, () => {
						const result = ContentBlockSchema.safeParse(block);
						if (!result.success) {
							const issues = result.error.issues
								.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
								.join('\n');
							throw new Error(
								`SessionChat/${storyName} line[${lineIndex}] block[${blockIndex}]: content block validation failed:\n${issues}`,
							);
						}
					});
				}
			}
		}
	});
});
