import {describe, it, expect} from "vite-plus/test";
import {isMcpTool, toolInputSchemaByName} from "../src/lib/tool-input-schemas";
import {ContentBlockSchema, AttachmentPayloadSchema} from "../src/lib/schemas";

// ---------------------------------------------------------------------------
// Tool renderer story files
// ---------------------------------------------------------------------------
import * as BashStories from "../src/stories/session-detail/tool-renderers/BashRenderer.stories";
import * as GlobStories from "../src/stories/session-detail/tool-renderers/GlobRenderer.stories";
import * as GrepStories from "../src/stories/session-detail/tool-renderers/GrepRenderer.stories";
import * as WriteStories from "../src/stories/session-detail/tool-renderers/WriteRenderer.stories";
import * as EditStories from "../src/stories/session-detail/tool-renderers/EditRenderer.stories";
import * as ReadStories from "../src/stories/session-detail/tool-renderers/ReadRenderer.stories";
import * as AgentStories from "../src/stories/session-detail/tool-renderers/AgentRenderer.stories";
import * as WebFetchStories from "../src/stories/session-detail/tool-renderers/WebFetchRenderer.stories";
import * as SkillStories from "../src/stories/session-detail/tool-renderers/SkillRenderer.stories";
import * as AskUserQuestionStories from "../src/stories/session-detail/tool-renderers/AskUserQuestionRenderer.stories";
import * as ExitPlanModeStories from "../src/stories/session-detail/tool-renderers/ExitPlanModeRenderer.stories";
import * as TaskCreateStories from "../src/stories/session-detail/tool-renderers/TaskCreateRenderer.stories";
import * as TaskGetStories from "../src/stories/session-detail/tool-renderers/TaskGetRenderer.stories";
import * as TaskListStories from "../src/stories/session-detail/tool-renderers/TaskListRenderer.stories";
import * as TaskUpdateStories from "../src/stories/session-detail/tool-renderers/TaskUpdateRenderer.stories";
import * as EnterPlanModeStories from "../src/stories/session-detail/tool-renderers/EnterPlanModeRenderer.stories";
import * as TodoWriteStories from "../src/stories/session-detail/tool-renderers/TodoWriteRenderer.stories";
import * as WebSearchStories from "../src/stories/session-detail/tool-renderers/WebSearchRenderer.stories";
import * as SendMessageStories from "../src/stories/session-detail/tool-renderers/SendMessageRenderer.stories";
import * as TaskStopStories from "../src/stories/session-detail/tool-renderers/TaskStopRenderer.stories";
import * as CronCreateStories from "../src/stories/session-detail/tool-renderers/CronCreateRenderer.stories";

// Non-tool-renderer stories that contain ClientToolCall fixtures

// SessionChat stories with content block fixtures
import * as SessionChatStories from "../src/stories/session-detail/SessionChat.stories";

// AttachmentBanner stories
import * as AttachmentBannerStories from "../src/stories/session-detail/AttachmentBanner.stories";

// MCP-based tool stories (inputs vary by server, validated as isMcpTool)
import * as McpStories from "../src/stories/session-detail/tool-renderers/McpRenderer.stories";
import * as GithubStories from "../src/stories/session-detail/tool-renderers/GithubRenderer.stories";
import * as PlaywrightStories from "../src/stories/session-detail/tool-renderers/PlaywrightRenderer.stories";
import * as Context7Stories from "../src/stories/session-detail/tool-renderers/Context7Renderer.stories";
import * as ChromeDevtoolsStories from "../src/stories/session-detail/tool-renderers/ChromeDevtoolsRenderer.stories";
import * as ClaudeInChromeStories from "../src/stories/session-detail/tool-renderers/ClaudeInChromeRenderer.stories";

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

function extractToolCallStories(storyModule: Record<string, unknown>): Array<{
	storyName: string;
	toolName: string;
	input: Record<string, unknown>;
}> {
	const results: Array<{
		storyName: string;
		toolName: string;
		input: Record<string, unknown>;
	}> = [];
	for (const [key, value] of Object.entries(storyModule)) {
		if (key === "default") continue;
		const story = value as StoryWithToolCall;
		const toolCall = story.args?.toolCall;
		if (!toolCall?.name || !toolCall.input) continue;
		results.push({
			storyName: key,
			toolName: toolCall.name,
			input: toolCall.input,
		});
	}
	return results;
}

// ---------------------------------------------------------------------------
// Validate tool input fixtures against strict Zod schemas
// ---------------------------------------------------------------------------

const allStoryModules: Array<{
	moduleName: string;
	module: Record<string, unknown>;
}> = [
	{
		moduleName: "BashRenderer",
		module: BashStories,
	},
	{
		moduleName: "GlobRenderer",
		module: GlobStories,
	},
	{
		moduleName: "GrepRenderer",
		module: GrepStories,
	},
	{
		moduleName: "WriteRenderer",
		module: WriteStories,
	},
	{
		moduleName: "EditRenderer",
		module: EditStories,
	},
	{
		moduleName: "ReadRenderer",
		module: ReadStories,
	},
	{
		moduleName: "AgentRenderer",
		module: AgentStories,
	},
	{
		moduleName: "WebFetchRenderer",
		module: WebFetchStories,
	},
	{
		moduleName: "SkillRenderer",
		module: SkillStories,
	},
	{
		moduleName: "AskUserQuestionRenderer",
		module: AskUserQuestionStories,
	},
	{
		moduleName: "ExitPlanModeRenderer",
		module: ExitPlanModeStories,
	},
	{
		moduleName: "TaskCreateRenderer",
		module: TaskCreateStories,
	},
	{
		moduleName: "TaskGetRenderer",
		module: TaskGetStories,
	},
	{
		moduleName: "TaskListRenderer",
		module: TaskListStories,
	},
	{
		moduleName: "TaskUpdateRenderer",
		module: TaskUpdateStories,
	},
	{
		moduleName: "EnterPlanModeRenderer",
		module: EnterPlanModeStories,
	},
	{
		moduleName: "TodoWriteRenderer",
		module: TodoWriteStories,
	},
	{
		moduleName: "WebSearchRenderer",
		module: WebSearchStories,
	},
	{
		moduleName: "SendMessageRenderer",
		module: SendMessageStories,
	},
	{
		moduleName: "TaskStopRenderer",
		module: TaskStopStories,
	},
	{
		moduleName: "CronCreateRenderer",
		module: CronCreateStories,
	},
	{moduleName: "McpRenderer", module: McpStories},
	{
		moduleName: "GithubRenderer",
		module: GithubStories,
	},
	{
		moduleName: "PlaywrightRenderer",
		module: PlaywrightStories,
	},
	{
		moduleName: "Context7Renderer",
		module: Context7Stories,
	},
	{
		moduleName: "ChromeDevtoolsRenderer",
		module: ChromeDevtoolsStories,
	},
	{
		moduleName: "ClaudeInChromeRenderer",
		module: ClaudeInChromeStories,
	},
];

describe("Story fixture validation against strict Zod schemas", () => {
	describe("tool renderer stories", () => {
		for (const {moduleName, module} of allStoryModules) {
			const stories = extractToolCallStories(module);
			for (const {storyName, toolName, input} of stories) {
				it(`${moduleName}/${storyName} — ${toolName} input passes schema`, () => {
					if (isMcpTool(toolName)) {
						return;
					}

					const schema = toolInputSchemaByName.get(toolName);
					if (!schema) throw new Error(`No schema registered for tool "${toolName}"`);

					expect(schema.parse(input)).toStrictEqual(input);
				});
			}
		}
	});

	describe("AttachmentBanner stories — attachmentJson passes AttachmentPayloadSchema", () => {
		interface AttachmentStory {
			args?: {
				attachmentJson?: string;
			};
		}

		for (const [storyName, value] of Object.entries(AttachmentBannerStories as Record<string, unknown>)) {
			if (storyName === "default") continue;
			const story = value as AttachmentStory;
			const json = story.args?.attachmentJson;
			if (!json) continue;

			it(`AttachmentBanner/${storyName} passes AttachmentPayloadSchema`, () => {
				const input = JSON.parse(json);
				expect(AttachmentPayloadSchema.parse(input)).toStrictEqual(input);
			});
		}
	});

	describe("SessionChat stories — content blocks pass ContentBlockSchema", () => {
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
			if (storyName === "default") continue;
			const story = value as SessionChatStory;
			const lines = story.args?.lines ?? [];
			for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				const content = lines[lineIndex]?.message?.content;
				if (!Array.isArray(content)) continue;
				for (let blockIndex = 0; blockIndex < content.length; blockIndex++) {
					const block = content[blockIndex]!;
					it(`SessionChat/${storyName} line[${lineIndex}] block[${blockIndex}] (${String(block["type"])}) passes ContentBlockSchema`, () => {
						expect(ContentBlockSchema.parse(block)).toStrictEqual(block);
					});
				}
			}
		}
	});
});
