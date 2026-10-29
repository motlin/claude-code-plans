// @vitest-environment jsdom

import {describe, it, expect} from "vite-plus/test";
import {renderToStaticMarkup} from "react-dom/server";
import {render} from "@testing-library/react";
import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {AttachmentBanner} from "../src/components/attachment-banner";
import {AttachmentPayloadSchema, type AttachmentPayload} from "../src/lib/schemas";

function renderBanner(payload: AttachmentPayload): string {
	return renderToStaticMarkup(<AttachmentBanner attachmentJson={JSON.stringify(payload)} />);
}

async function renderBannerWithRouter(payload: AttachmentPayload): Promise<string> {
	const rootRoute = createRootRoute({
		component: () => <AttachmentBanner attachmentJson={JSON.stringify(payload)} />,
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	const view = render(<RouterProvider router={router} />);
	const html = view.container.innerHTML;
	view.unmount();
	return html;
}

const MINIMAL_BY_TYPE: Record<string, AttachmentPayload> = {
	plan_mode: {type: "plan_mode"},
	auto_mode: {type: "auto_mode"},
	auto_mode_exit: {type: "auto_mode_exit"},
	plan_file_reference: {type: "plan_file_reference"},
	nested_memory: {type: "nested_memory"},
	team_context: {type: "team_context"},
	plan_mode_exit: {type: "plan_mode_exit"},
	plan_mode_reentry: {type: "plan_mode_reentry"},
	hook_success: {
		type: "hook_success",
		hookName: "h",
		hookEvent: "PreToolUse",
	},
	hook_non_blocking_error: {
		type: "hook_non_blocking_error",
		hookName: "h",
		hookEvent: "PreToolUse",
	},
	hook_blocking_error: {
		type: "hook_blocking_error",
		hookName: "h",
		hookEvent: "PreToolUse",
	},
	hook_cancelled: {
		type: "hook_cancelled",
		hookName: "h",
		hookEvent: "PreToolUse",
	},
	hook_system_message: {
		type: "hook_system_message",
		hookName: "h",
		hookEvent: "PreToolUse",
	},
	hook_additional_context: {
		type: "hook_additional_context",
		hookName: "h",
		hookEvent: "PreToolUse",
	},
	async_hook_response: {
		type: "async_hook_response",
		processId: "async-hook-100",
		hookName: "PreToolUse:Read",
		hookEvent: "PreToolUse",
	},
	deferred_tools_delta: {type: "deferred_tools_delta"},
	agent_listing_delta: {type: "agent_listing_delta"},
	mcp_instructions_delta: {type: "mcp_instructions_delta"},
	skill_listing: {type: "skill_listing"},
	dynamic_skill: {type: "dynamic_skill"},
	task_reminder: {type: "task_reminder"},
	todo_reminder: {type: "todo_reminder"},
	total_tokens_reminder: {
		type: "total_tokens_reminder",
		text: "<total_tokens>10000000 tokens left</total_tokens>",
	},
	token_usage: {type: "token_usage", used: 120000, total: 1000000, remaining: 880000},
	task_status: {type: "task_status", taskId: "100", status: "completed"},
	edited_text_file: {type: "edited_text_file", filename: "f.ts"},
	file: {type: "file", filename: "f.ts"},
	already_read_file: {type: "already_read_file", filename: "/tmp/test/example.ts"},
	directory: {type: "directory"},
	compact_file_reference: {type: "compact_file_reference"},
	read_truncation_notice: {
		type: "read_truncation_notice",
		banner: "[Truncated: showing lines 1-100 of 200 total.]",
		toolUseID: "toolu_100",
	},
	date_change: {type: "date_change", newDate: "2026-05-14"},
	command_permissions: {type: "command_permissions"},
	diagnostics: {type: "diagnostics"},
	queued_command: {type: "queued_command"},
	selected_lines_in_ide: {type: "selected_lines_in_ide"},
	opened_file_in_ide: {type: "opened_file_in_ide"},
	companion_intro: {type: "companion_intro"},
	invoked_skills: {type: "invoked_skills"},
	ultrathink_effort: {type: "ultrathink_effort"},
	max_turns_reached: {type: "max_turns_reached"},
	workflow_keyword_request: {type: "workflow_keyword_request"},
	bash_output_audience_note: {type: "bash_output_audience_note"},
	batching_reminder_sent: {type: "batching_reminder_sent"},
	credential_org: {type: "credential_org"},
	date: {type: "date"},
	deferred_tools_record: {type: "deferred_tools_record"},
	environment: {type: "environment"},
	fork_briefing: {type: "fork_briefing"},
	hook_permission_decision: {type: "hook_permission_decision"},
	instructions: {type: "instructions"},
	model: {type: "model"},
	output_style: {type: "output_style"},
	output_style_instructions: {type: "output_style_instructions"},
	prompt_snapshot: {type: "prompt_snapshot"},
	remote_session_change: {type: "remote_session_change"},
	session_context: {type: "session_context"},
	silent_turn_reminder: {type: "silent_turn_reminder"},
	thinking_drop: {type: "thinking_drop"},
	thinking_stripped: {type: "thinking_stripped"},
	structured_output: {type: "structured_output", toolUseID: "toolu_100", data: {}},
	skill_mention: {type: "skill_mention"},
	inlined_image_paths: {type: "inlined_image_paths", paths: ["/tmp/uploads/a-image.png"]},
	session_cron_carry: {type: "session_cron_carry", tasks: []},
};

describe("AttachmentBanner", () => {
	const schemaTypes = AttachmentPayloadSchema.options.map((opt) => opt.shape.type.value);

	it("covers every attachment type declared in AttachmentPayloadSchema", () => {
		const fixtureTypes = Object.keys(MINIMAL_BY_TYPE).toSorted();
		expect(fixtureTypes).toEqual(schemaTypes.toSorted());
	});

	it("keeps provider-less fixtures free of plan file paths", () => {
		expect(Object.entries(MINIMAL_BY_TYPE).filter(([, payload]) => "planFilePath" in payload)).toStrictEqual([]);
	});

	for (const type of schemaTypes) {
		it(`renders ${type} without throwing`, () => {
			const payload = MINIMAL_BY_TYPE[type];
			expect(payload, `fixture for ${type} missing`).toBeDefined();
			// Schema must accept the fixture, otherwise the rendering test below is meaningless.
			expect(AttachmentPayloadSchema.safeParse(payload).success).toBe(true);
			expect(() => renderBanner(payload!)).not.toThrow();
		});
	}

	describe("hook_blocking_error", () => {
		it("renders the nested blocking message when blockingError carries a message string", () => {
			const html = renderBanner({
				type: "hook_blocking_error",
				hookName: "policy-guard",
				hookEvent: "PreToolUse",
				blockingError: {message: "Command rejected by policy"},
			});
			expect(html.match(/<span class="text-t6">[^<]+<\/span>/g) ?? []).toStrictEqual([
				'<span class="text-t6">Command rejected by policy</span>',
			]);
		});

		it("does not render a blocking message when blockingError is absent", () => {
			const html = renderBanner({
				type: "hook_blocking_error",
				hookName: "policy-guard",
				hookEvent: "PreToolUse",
			});
			expect(html.match(/<span class="text-t6">[^<]+<\/span>/g) ?? []).toStrictEqual([]);
		});
	});

	describe("hook_additional_context", () => {
		it("joins array content into the banner text", () => {
			const container = document.createElement("div");
			container.innerHTML = renderBanner({
				type: "hook_additional_context",
				hookName: "PostToolUse:Bash",
				hookEvent: "PostToolUse",
				content: ["Git commit detected!", "Run /reflect."],
			});
			expect(container.querySelector("pre")?.textContent).toBe("Git commit detected!\nRun /reflect.");
		});

		it("keeps string content as is", () => {
			const container = document.createElement("div");
			container.innerHTML = renderBanner({
				type: "hook_additional_context",
				hookName: "UserPromptSubmit",
				hookEvent: "UserPromptSubmit",
				content: "Caveman mode",
			});
			expect(container.querySelector("pre")?.textContent).toBe("Caveman mode");
		});
	});

	it("renders read truncation notices", () => {
		const html = renderBanner({
			type: "read_truncation_notice",
			banner: "[Truncated: showing lines 1-100 of 200 total.]",
			toolUseID: "toolu_100",
		});

		expect(html).toStrictEqual(
			'<div class="flex flex-wrap items-center gap-2 py-1.5 px-3 text-xs text-t6 bg-surface-1 rounded-md border border-subtle"><span class="shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert h-3.5 w-3.5" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg></span><span>Read output truncated</span><pre class="w-full mt-1 text-[10px] leading-tight text-t6 bg-surface-0 rounded px-2 py-1 whitespace-pre-wrap break-all">[Truncated: showing lines 1-100 of 200 total.]</pre></div>',
		);
	});

	it("labels carried-over session crons with a pluralized count", () => {
		const task = {
			id: "9672e493",
			cron: "7 13 19 10 *",
			prompt: "Restore",
			createdAt: 1792343284261,
			recurring: false,
		};
		expect([
			renderBanner({type: "session_cron_carry", tasks: [task]}).match(/<span>([^<]*)<\/span>/)?.[1],
			renderBanner({type: "session_cron_carry", tasks: [task, {...task, id: "1a2b3c4d"}]}).match(
				/<span>([^<]*)<\/span>/,
			)?.[1],
		]).toStrictEqual(["Carried over 1 scheduled task", "Carried over 2 scheduled tasks"]);
	});

	it("labels inlined image paths with a pluralized count", () => {
		expect([
			renderBanner({type: "inlined_image_paths", paths: ["/tmp/uploads/a-image.png"]}).match(
				/<span>([^<]*)<\/span>/,
			)?.[1],
			renderBanner({
				type: "inlined_image_paths",
				paths: ["/tmp/uploads/a-image.png", "/tmp/uploads/b-image.png"],
			}).match(/<span>([^<]*)<\/span>/)?.[1],
		]).toStrictEqual(["Inlined 1 image", "Inlined 2 images"]);
	});

	it("renders total token reminders", () => {
		const html = renderBanner({
			type: "total_tokens_reminder",
			text: "<total_tokens>10000000 tokens left</total_tokens>",
		});

		expect(html).toStrictEqual(
			'<div class="flex flex-wrap items-center gap-2 py-1.5 px-3 text-xs text-t6 bg-surface-1 rounded-md border border-subtle"><span class="shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hourglass h-3.5 w-3.5" aria-hidden="true"><path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path></svg></span><span>Token budget reminder</span><pre class="w-full mt-1 text-[10px] leading-tight text-t6 bg-surface-0 rounded px-2 py-1 whitespace-pre-wrap break-all">&lt;total_tokens&gt;10000000 tokens left&lt;/total_tokens&gt;</pre></div>',
		);
	});

	it("renders token usage as used of total with what remains", () => {
		const html = renderBanner({type: "token_usage", used: 120000, total: 1000000, remaining: 880000});

		expect(html.match(/<span>([^<]*)<\/span>/)?.[1]).toStrictEqual(
			"Token usage: 120,000 / 1,000,000 (880,000 left)",
		);
	});

	describe("queued_command", () => {
		it("renders a relative timestamp with an absolute title when timestamp is present", () => {
			const html = renderBanner({
				type: "queued_command",
				prompt: "do the thing",
				timestamp: "2020-01-15T08:30:00.000Z",
			});
			expect(html).toContain("ago");
			expect(html).toContain("2020");
		});

		it("labels a queued command absorbed into the running turn", () => {
			const html = renderToStaticMarkup(
				<AttachmentBanner
					attachmentJson={JSON.stringify({type: "queued_command", prompt: "do the thing"})}
					absorbedMidTurn
				/>,
			);
			expect(html).toContain("<span>Sent mid-turn</span>");
			expect(html).not.toContain("Queued command");
		});

		it("keeps the queued command label when it was not absorbed mid-turn", () => {
			const html = renderBanner({type: "queued_command", prompt: "do the thing"});
			expect(html).toContain("<span>Queued command</span>");
			expect(html).not.toContain("Sent mid-turn");
		});

		it("omits the timestamp span when no timestamp is present", () => {
			const html = renderBanner({
				type: "queued_command",
				prompt: "do the thing",
			});
			expect(html).not.toContain("ago");
		});
	});

	describe("model", () => {
		it("labels the banner with the marketing name, falling back to the model id when it is unknown", () => {
			expect({
				known: renderBanner({
					type: "model",
					identity: {modelId: "claude-opus-5-5", marketingName: "Opus 5.5", knowledgeCutoff: "June 2026"},
				}).includes("Model: Opus 5.5"),
				unknown: renderBanner({
					type: "model",
					identity: {modelId: "claude-nonexistent-model-9", marketingName: null, knowledgeCutoff: null},
				}).includes("Model: claude-nonexistent-model-9"),
			}).toStrictEqual({known: true, unknown: true});
		});
	});

	describe("deferred_tools_delta", () => {
		it("appends a pluralized pending MCP server count to the banner label", () => {
			const html = renderBanner({
				type: "deferred_tools_delta",
				addedNames: ["WebFetch"],
				pendingMcpServers: ["context7", "github"],
			});
			expect(html).toContain("2 MCP servers pending");
		});

		it("uses the singular form for a single pending MCP server", () => {
			const html = renderBanner({
				type: "deferred_tools_delta",
				pendingMcpServers: ["context7"],
			});
			expect(html).toContain("1 MCP server pending");
			expect(html).not.toContain("1 MCP servers pending");
		});

		it("counts the removed tools a block took away", () => {
			const html = renderBanner({
				type: "deferred_tools_delta",
				removedNames: ["mcp__docs__batch", "mcp__docs__guide", "mcp__docs__query"],
				removedByBlock: ["mcp__docs__batch", "mcp__docs__guide"],
			});
			expect(html).toContain("Deferred tools: -3 tools, 2 blocked");
		});

		it("omits the pending segment when there are no pending MCP servers", () => {
			const html = renderBanner({
				type: "deferred_tools_delta",
				addedNames: ["WebFetch"],
			});
			expect(html).not.toContain("MCP server");
		});
	});

	it("links team context to tasks and identifies its source files", async () => {
		const html = await renderBannerWithRouter({
			type: "team_context",
			agentId: "agent-100",
			agentName: "alice",
			teamName: "webapp",
			teamConfigPath: "/Users/craig/.claude/teams/webapp/config.json",
			taskListPath: "/Users/craig/.claude/tasks/webapp/tasks.json",
		});

		expect(html).toContain("Team: alice (webapp)");
		expect(html).toContain('href="/tasks"');
		expect(html).toContain("View tasks");
		expect(html).toContain("/Users/craig/.claude/teams/webapp/config.json");
		expect(html).toContain('title="/Users/craig/.claude/tasks/webapp/tasks.json"');
	});

	describe("expandable context details", () => {
		function detailSections(
			payload: AttachmentPayload,
			extra: {
				rendered?: string[];
				renderedInHumanTurn?: string[];
				renderedRole?: "system" | "user";
				sameAsDescriptions?: Record<string, string>;
			} = {},
		): [string, string][] {
			const view = render(<AttachmentBanner attachmentJson={JSON.stringify(payload)} {...extra} />);
			const sections = [...view.container.querySelectorAll("[data-attachment-detail]")].map(
				(el): [string, string] => [
					el.getAttribute("data-attachment-detail") ?? "",
					el.querySelector("[data-detail-body]")?.textContent ?? "",
				],
			);
			view.unmount();
			return sections;
		}

		it("stays a plain row when there is nothing to expand", () => {
			const html = renderBanner({type: "silent_turn_reminder"});
			expect(html).not.toContain("<details");
		});

		it("shows the exact system-reminder text the attachment rendered", () => {
			expect(
				detailSections(
					{type: "silent_turn_reminder"},
					{rendered: ["<system-reminder>Stay quiet</system-reminder>"]},
				),
			).toStrictEqual([["System reminder", "<system-reminder>Stay quiet</system-reminder>"]]);
		});

		it("labels text injected into the user turn and human-turn renderings", () => {
			expect(
				detailSections(
					{type: "date", date: "2026-09-29"},
					{
						rendered: ["Today is 2026-09-29"],
						renderedInHumanTurn: ["[date 2026-09-29]"],
						renderedRole: "user",
					},
				),
			).toStrictEqual([
				["Injected into user turn", "Today is 2026-09-29"],
				["Rendered in human turn", "[date 2026-09-29]"],
			]);
		});

		it("details the environment snapshot and changes", () => {
			expect(
				detailSections({
					type: "environment",
					snapshot: {
						workingDirectory: "/work/repo",
						isGitRepo: true,
						platform: "darwin",
						shell: "zsh",
					},
					changes: [
						{field: "workingDirectory", from: "/work/old"},
						{field: "additionalWorkingDirectories", added: ["/a"], removed: ["/b"]},
					],
				}),
			).toStrictEqual([
				[
					"Environment snapshot",
					"Working directory: /work/repo\nGit repository: yes\nPlatform: darwin\nShell: zsh",
				],
				["Environment changes", "workingDirectory (was /work/old)\nadditionalWorkingDirectories +/a -/b"],
			]);
		});

		it("lists instruction files with their contents", () => {
			expect(
				detailSections({
					type: "instructions",
					reason: "session_start",
					files: [
						{path: "/repo/CLAUDE.md", type: "Project", content: "Be terse."},
						{path: "/home/.claude/CLAUDE.md"},
					],
					removed: ["/old/CLAUDE.md"],
				}),
			).toStrictEqual([
				["Reason", "session_start"],
				["Instruction files", "/repo/CLAUDE.md (Project)Be terse./home/.claude/CLAUDE.md"],
				["Removed", "/old/CLAUDE.md"],
			]);
		});

		it("shows the model identity", () => {
			expect(
				detailSections({
					type: "model",
					identity: {
						modelId: "claude-opus-5-5",
						marketingName: "Opus 5.5",
						knowledgeCutoff: "June 2026",
					},
					text: "You are powered by Opus 5.5.",
				}),
			).toStrictEqual([
				["Model identity", "Model ID: claude-opus-5-5\nName: Opus 5.5\nKnowledge cutoff: June 2026"],
				["Model text", "You are powered by Opus 5.5."],
			]);
		});

		it("omits an unknown name and knowledge cutoff from the model identity", () => {
			expect(
				detailSections({
					type: "model",
					identity: {modelId: "claude-nonexistent-model-9", marketingName: null, knowledgeCutoff: null},
					text: "You are powered by the model claude-nonexistent-model-9.",
				}),
			).toStrictEqual([
				["Model identity", "Model ID: claude-nonexistent-model-9"],
				["Model text", "You are powered by the model claude-nonexistent-model-9."],
			]);
		});

		it("labels structured output and shows its data as formatted JSON", () => {
			const payload: AttachmentPayload = {
				type: "structured_output",
				toolUseID: "toolu_100",
				data: {investigated: true, taskCount: 5},
			};
			expect(renderBanner(payload)).toContain("Structured output");
			expect(detailSections(payload)).toStrictEqual([
				["Structured output", '{\n  "investigated": true,\n  "taskCount": 5\n}'],
			]);
		});

		it("lists prompt snapshot tools and system prompt blocks", () => {
			expect(
				detailSections({
					type: "prompt_snapshot",
					systemPrompt: ["You are Claude.", "Be helpful."],
					tools: [{name: "Bash"}, {name: "Read"}],
				}),
			).toStrictEqual([
				["Tools (2)", "Bash, Read"],
				["System prompt (2 blocks)", "You are Claude.Be helpful."],
			]);
		});

		it("lists added, removed, and built-in agent types for agent listing deltas", () => {
			expect(
				detailSections({
					type: "agent_listing_delta",
					addedTypes: ["reviewer"],
					addedLines: ["- reviewer: Reviews code"],
					removedTypes: ["old-agent"],
					builtInTypes: ["general-purpose", "Explore", "Plan"],
					isInitial: true,
				}),
			).toStrictEqual([
				["Added agents", "- reviewer: Reviews code"],
				["Removed agents", "old-agent"],
				["Built-in agents (3)", "general-purpose, Explore, Plan"],
			]);
		});

		it("falls back to added agent type names when no listing lines are present", () => {
			expect(detailSections({type: "agent_listing_delta", addedTypes: ["a", "b"]})).toStrictEqual([
				["Added agents", "a\nb"],
			]);
		});

		it("shows the session context's user email and git status", () => {
			expect(
				detailSections({
					type: "session_context",
					context: {userEmail: "dev@example.com", gitStatus: "Current branch: main\n\nStatus:\n(clean)"},
				}),
			).toStrictEqual([
				["Session context", "User email: dev@example.com"],
				["Git status", "Current branch: main\n\nStatus:\n(clean)"],
			]);
		});

		it("lists surfaced deferred tool definitions with their descriptions", () => {
			expect(
				detailSections({
					type: "deferred_tools_delta",
					surfacedDefinitions: [
						{
							name: "WebFetch",
							listing: "abc123",
							definition: {name: "WebFetch", description: "Fetches a URL.\nMore detail."},
						},
						{name: "mcp__docs__read", listing: "def456", definition: {name: "mcp__docs__read"}},
						{name: "mcp__docs__write", listing: "abc123", sameAs: "398d17b2-379f-4a8c-9d42-6180faf07536"},
					],
				}),
			).toStrictEqual([["Surfaced tools (3)", "WebFetch: Fetches a URL.\nmcp__docs__read\nmcp__docs__write"]]);
		});

		it("describes sameAs-surfaced tools with the earlier record's definition", () => {
			expect(
				detailSections(
					{
						type: "deferred_tools_delta",
						surfacedDefinitions: [
							{
								name: "mcp__docs__guide",
								listing: "abc123",
								sameAs: "398d17b2-379f-4a8c-9d42-6180faf07536",
							},
							{
								name: "mcp__docs__write",
								listing: "def456",
								sameAs: "398d17b2-379f-4a8c-9d42-6180faf07536",
							},
						],
					},
					{sameAsDescriptions: {mcp__docs__guide: "Docs guides.\nMore detail."}},
				),
			).toStrictEqual([["Surfaced tools (2)", "mcp__docs__guide: Docs guides.\nmcp__docs__write"]]);
		});

		it("lists the deferred tools a block removed", () => {
			expect(
				detailSections({
					type: "deferred_tools_delta",
					removedNames: ["mcp__docs__batch", "mcp__docs__guide", "mcp__docs__query"],
					removedByBlock: ["mcp__docs__batch", "mcp__docs__guide"],
				}),
			).toStrictEqual([["Removed by block (2)", "mcp__docs__batch\nmcp__docs__guide"]]);
		});

		it("shows the run a queued command belongs to", () => {
			expect(detailSections({type: "queued_command", prompt: "go", runId: "0mv45nq7g-73fb270e"})).toStrictEqual([
				["Queued command", "Run ID: 0mv45nq7g-73fb270e"],
			]);
		});

		it("lists each carried-over scheduled task with its cron, recurrence and prompt", () => {
			expect(
				detailSections({
					type: "session_cron_carry",
					tasks: [
						{
							id: "9672e493",
							cron: "7 13 19 10 *",
							prompt: "Restore the .envrc references",
							createdAt: 1792343284261,
							recurring: false,
						},
						{
							id: "1a2b3c4d",
							cron: "*/5 * * * *",
							prompt: "Check the deploy",
							createdAt: 1792343284262,
							recurring: true,
						},
					],
				}),
			).toStrictEqual([
				[
					"Scheduled tasks (2)",
					"7 13 19 10 * (once): Restore the .envrc references\n*/5 * * * * (recurring): Check the deploy",
				],
			]);
		});

		it("omits the scheduled task list when no tasks were carried over", () => {
			expect(detailSections({type: "session_cron_carry", tasks: []})).toStrictEqual([]);
		});

		it("puts the type-specific details before the rendered reminder", () => {
			expect(
				detailSections(
					{type: "fork_briefing", text: "You are a fork."},
					{rendered: ["<system-reminder>fork</system-reminder>"]},
				),
			).toStrictEqual([
				["Briefing", "You are a fork."],
				["System reminder", "<system-reminder>fork</system-reminder>"],
			]);
		});
	});
});
