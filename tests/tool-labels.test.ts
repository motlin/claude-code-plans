import {describeVerbForms, infinitive, pastTense} from "../src/lib/past-tense";
import
{
	groupRunningText,
	groupWordCase,
	groupWords,
	runningToolLabel,
	toolLabel,
	toolResultMetaFrom,
} from "../src/lib/tool-labels";
import {AskUserQuestionResultSchema} from "../src/lib/tool-input-schemas";
import type {ToolLabelCall} from "../src/lib/tool-labels";

const call = (
	name: string,
	input: Record<string, unknown> = {},
	resultMeta?: ToolLabelCall["resultMeta"],
): ToolLabelCall =>
	resultMeta === undefined
		?
			{
				name,
				input,
			}
		:
			{
				name,
				input,
				resultMeta,
			};

describe("toolLabel", () =>
{
	it.each([
		"Gate HEAD with the new test and archive the task list",
		"Gate the example branch",
		"gate example checks",
		"Map PR numbers to branches",
	])("keeps the entire unsupported leading description unchanged: %s", (description) =>
	{
		expect(
			toolLabel(
				call(
					"Bash",
					{
						command: "echo example",
						description,
					},
				),
			),
		).toStrictEqual(
			{
				verb: "Ran",
				meta: description,
				doneLabel: description,
			},
		);
	});

	it.each([
		{
			description: "Map PR numbers to branches",
			doneLabel: "Map PR numbers to branches",
		},
		{
			description: "map example paths",
			doneLabel: "map example paths",
		},
		{
			description: "MAP example paths",
			doneLabel: "MAP example paths",
		},
		{
			description: "Mapped example paths",
			doneLabel: "Mapped example paths",
		},
		{
			description: "Check example status",
			doneLabel: "Checked example status",
		},
		{
			description: "Run example tests",
			doneLabel: "Ran example tests",
		},
		{
			description: "Write example config",
			doneLabel: "Wrote example config",
		},
	])("keeps authored Map labels without changing established verbs: $description", ({description, doneLabel}) =>
	{
		expect(
			toolLabel(
				call(
					"Bash",
					{
						command: "echo example",
						description,
					},
				),
			),
		).toStrictEqual(
			{
				verb: "Ran",
				meta: description,
				doneLabel,
			},
		);
	});

	it("labels each tool with the upstream verb and meta", () =>
	{
		expect(
			{
				read: toolLabel(
					call(
						"Read",
						{
							file_path: "/repo/src/cache.ts",
						},
					),
				),
				writeCreate: toolLabel(
					call(
						"Write",
						{
							file_path: "/a/new.ts",
						},
						{
							writeType: "create",
						},
					),
				),
				writeUpdate: toolLabel(
					call(
						"Write",
						{
							file_path: "/a/old.ts",
						},
						{
							writeType: "update",
						},
					),
				),
				writeUnknown: toolLabel(
					call(
						"Write",
						{
							file_path: "/a/x.ts",
						},
					),
				),
				edit: toolLabel(
					call(
						"Edit",
						{
							file_path: "/a/x.ts",
						},
					),
				),
				multiEdit: toolLabel(
					call(
						"MultiEdit",
						{
							file_path: "/a/x.ts",
						},
					),
				),
				notebookEdit: toolLabel(
					call(
						"NotebookEdit",
						{
							notebook_path: "/a/x.ipynb",
						},
					),
				),
				grep: toolLabel(
					call(
						"Grep",
						{
							pattern: "TODO",
						},
					),
				),
				glob: toolLabel(
					call(
						"Glob",
						{
							pattern: "*.ts",
						},
					),
				),
				ls: toolLabel(
					call(
						"LS",
						{
							path: "/repo",
						},
					),
				),
				webFetch: toolLabel(
					call(
						"WebFetch",
						{
							url: "https://x.dev",
						},
					),
				),
				webSearch: toolLabel(
					call(
						"WebSearch",
						{
							query: "zod v4",
						},
					),
				),
				skill: toolLabel(
					call(
						"Skill",
						{
							skill: "git:commit",
						},
					),
				),
				taskGet: toolLabel(
					call(
						"TaskGet",
						{
							taskId: "3",
						},
					),
				),
				taskList: toolLabel(call("TaskList")),
				taskCreate: toolLabel(
					call(
						"TaskCreate",
						{
							subject: "Ship it",
						},
					),
				),
				taskStop: toolLabel(
					call(
						"TaskStop",
						{
							task_id: "b1",
						},
					),
				),
				enterPlanMode: toolLabel(call("EnterPlanMode")),
				exitPlanMode: toolLabel(
					call(
						"ExitPlanMode",
						{
							plan: "## Plan",
						},
					),
				),
				toolSearch: toolLabel(
					call(
						"ToolSearch",
						{
							query: "select:Read",
						},
					),
				),
				subagentHandback: toolLabel(
					call(
						"SubagentHandback",
						{
							message: "Done.",
						},
					),
				),
			},
		).toStrictEqual(
			{
				read:
				{
					verb: "Read",
				},
				writeCreate:
				{
					verb: "Created",
				},
				writeUpdate:
				{
					verb: "Updated",
				},
				writeUnknown:
				{
					verb: "Created",
				},
				edit:
				{
					verb: "Edited",
				},
				multiEdit:
				{
					verb: "Edited",
				},
				notebookEdit:
				{
					verb: "Edited",
				},
				grep:
				{
					verb: "Searched",
				},
				glob:
				{
					verb: "Searched",
				},
				ls:
				{
					verb: "Listed",
				},
				webFetch:
				{
					verb: "Fetched",
				},
				webSearch:
				{
					verb: "Searched web",
				},
				skill:
				{
					verb: "Ran skill",
					meta: "/git:commit",
					metaIsCode: true,
				},
				taskGet:
				{
					verb: "Read task",
				},
				taskList:
				{
					verb: "Listed tasks",
				},
				taskCreate:
				{
					verb: "Added task",
				},
				taskStop:
				{
					verb: "Stopped task",
				},
				enterPlanMode:
				{
					verb: "Started planning",
				},
				exitPlanMode:
				{
					verb: "Proposed plan",
					meta: "Plan",
				},
				toolSearch:
				{
					verb: "Loaded tools",
				},
				subagentHandback:
				{
					verb: "Reported back",
				},
			},
		);
	});

	it("labels ExitPlanMode with its plan's first heading, and a planless approved call 'Finished planning'", () =>
	{
		const approved = "User has approved exiting plan mode. You can now proceed.";
		expect(
			{
				heading: toolLabel(
					call(
						"ExitPlanMode",
						{
							plan: "# Plan: Make a Cup of Tea\n\n1. Boil",
						},
					),
				),
				noHeading: toolLabel(
					call(
						"ExitPlanMode",
						{
							plan: "Boil water",
						},
					),
				),
				planlessApproved: toolLabel(
					{
						name: "ExitPlanMode",
						input: {},
						result: approved,
					},
				),
				planlessPending: toolLabel(call("ExitPlanMode", {})),
				planlessRejected: toolLabel(
					{
						name: "ExitPlanMode",
						input: {},
						result: "rejected",
						isError: true,
					},
				),
				running: runningToolLabel(
					call(
						"ExitPlanMode",
						{
							plan: "# Water",
						},
					),
				),
			},
		).toStrictEqual(
			{
				heading:
				{
					verb: "Proposed plan",
					meta: "Plan: Make a Cup of Tea",
				},
				noHeading:
				{
					verb: "Proposed plan",
				},
				planlessApproved:
				{
					verb: "Finished planning",
				},
				planlessPending:
				{
					verb: "Proposed plan",
				},
				planlessRejected:
				{
					verb: "Proposed plan",
					failedVerb: "Failed to propose plan",
				},
				running:
				{
					verb: "Proposing plan",
					meta: "Water",
				},
			},
		);
	});

	it("picks the TaskUpdate verb from what the update changes", () =>
	{
		const update = (input: Record<string, unknown>) =>
			toolLabel(
				call(
					"TaskUpdate",
					{
						taskId: "1",
						...input,
					},
				),
			).verb;

		expect(
			{
				completed: update(
					{
						status: "completed",
					},
				),
				inProgress: update(
					{
						status: "in_progress",
					},
				),
				pending: update(
					{
						status: "pending",
					},
				),
				deleted: update(
					{
						status: "deleted",
					},
				),
				otherStatus: update(
					{
						status: "blocked",
					},
				),
				renamed: update(
					{
						subject: "New name",
					},
				),
				updated: update(
					{
						description: "More detail",
					},
				),
			},
		).toStrictEqual(
			{
				completed: "Completed task",
				inProgress: "Started task",
				pending: "Reset task to pending",
				deleted: "Removed task",
				otherStatus: "Updated task status",
				renamed: "Renamed task",
				updated: "Updated task",
			},
		);
	});

	it("says Cleared todos for an empty TodoWrite list", () =>
	{
		expect(
			{
				updated: toolLabel(
					call(
						"TodoWrite",
						{
							todos: [
								{
									content: "a",
									status: "pending",
								},
							],
						},
					),
				),
				cleared: toolLabel(
					call(
						"TodoWrite",
						{
							todos: [],
						},
					),
				),
			},
		).toStrictEqual(
			{
				updated:
				{
					verb: "Updated todos",
				},
				cleared:
				{
					verb: "Cleared todos",
				},
			},
		);
	});

	it('labels AskUserQuestion "Asked “<trimmed header>”" for one question and "Asked N questions" for several', () =>
	{
		const asked = (questions: unknown[]) =>
			toolLabel(
				call(
					"AskUserQuestion",
					{
						questions,
					},
				),
			);
		expect(
			{
				one: asked([
					{
						header: "Auth method",
						question: "Which?",
						options: [],
					},
				]),
				many: asked([
					{
						header: "A",
						question: "a?",
						options: [],
					},
					{
						header: "B",
						question: "b?",
						options: [],
					},
				]),
				padded: asked([
					{
						header: "  Pad  ",
						question: "p?",
						options: [],
					},
				]),
				blank: asked([
					{
						header: "",
						question: "e?",
						options: [],
					},
				]),
				spaces: asked([
					{
						header: "   ",
						question: "s?",
						options: [],
					},
				]),
				oneObjectAmongJunk: asked([
					"junk",
					{
						header: "Solo",
						question: "s?",
						options: [],
					},
				]),
			},
		).toStrictEqual(
			{
				one:
				{
					verb: "Asked",
					meta: "“Auth method”",
					doneLabel: "Asked “Auth method”",
				},
				many:
				{
					verb: "Asked",
					meta: "2 questions",
					doneLabel: "Asked 2 questions",
				},
				padded:
				{
					verb: "Asked",
					meta: "“Pad”",
					doneLabel: "Asked “Pad”",
				},
				blank:
				{
					verb: "Asked",
				},
				spaces:
				{
					verb: "Asked",
				},
				oneObjectAmongJunk:
				{
					verb: "Asked",
				},
			},
		);
	});

	it("past-tenses a subagent description by the Bash rule, keeping one that opens with an unknown verb", () =>
	{
		expect(
			{
				known: toolLabel(
					call(
						"Agent",
						{
							description: "Commit lazy allocation fixup",
						},
					),
				),
				compound: toolLabel(
					call(
						"Task",
						{
							description: "Test the fix and push",
						},
					),
				),
				unknown: toolLabel(
					call(
						"Agent",
						{
							description: "Open the PR form",
						},
					),
				),
			},
		).toStrictEqual(
			{
				known:
				{
					verb: "Ran agent",
					meta: "Commit lazy allocation fixup",
					doneLabel: "Committed lazy allocation fixup",
				},
				compound:
				{
					verb: "Ran agent",
					meta: "Test the fix and push",
					doneLabel: "Tested the fix and pushed",
				},
				unknown:
				{
					verb: "Ran agent",
					meta: "Open the PR form",
					doneLabel: "Open the PR form",
				},
			},
		);
	});

	it("names the subagent row by its description", () =>
	{
		expect(
			toolLabel(
				call(
					"Agent",
					{
						description: "Explore Drizzle setup",
					},
				),
			),
		).toStrictEqual(
			{
				verb: "Ran agent",
				meta: "Explore Drizzle setup",
				doneLabel: "Explore Drizzle setup",
			},
		);
	});

	it("past-tenses a Bash description, or falls back to the command", () =>
	{
		expect(
			{
				described: toolLabel(
					call(
						"Bash",
						{
							command: "git status",
							description: "Check status",
						},
					),
				),
				bare: toolLabel(
					call(
						"Bash",
						{
							command: "pnpm run build",
						},
					),
				),
			},
		).toStrictEqual(
			{
				described:
				{
					verb: "Ran",
					meta: "Check status",
					doneLabel: "Checked status",
				},
				bare:
				{
					verb: "Ran",
					meta: "pnpm run build",
					doneLabel: "pnpm run build",
				},
			},
		);
	});

	it("labels Bash git operations from the tool result", () =>
	{
		const git = (gitOperation: NonNullable<ToolLabelCall["resultMeta"]>["gitOperation"]) =>
			toolLabel(
				call(
					"Bash",
					{
						command: "git ...",
						description: "Run git",
					},
					gitOperation === undefined
						? {}
						:
							{
								gitOperation,
							},
				),
			);

		expect(
			{
				committed: git(
					{
						commit:
						{
							sha: "abc1234def",
							kind: "committed",
							branch: "main",
						},
					},
				),
				amended: git(
					{
						commit:
						{
							sha: "abc1234def",
							kind: "amended",
						},
					},
				),
				cherryPicked: git(
					{
						commit:
						{
							sha: "abc1234def",
							kind: "cherry-picked",
						},
					},
				),
				pushed: git(
					{
						push:
						{
							branch: "feature/x",
						},
					},
				),
				commitAndPush: git(
					{
						commit:
						{
							sha: "abc1234def",
							kind: "committed",
						},
						push:
						{
							branch: "main",
						},
					},
				),
				rebased: git(
					{
						branch:
						{
							ref: "origin/main",
							action: "rebased",
						},
					},
				),
				merged: git(
					{
						branch:
						{
							ref: "origin/main",
							action: "merged",
						},
					},
				),
				prCreated: git(
					{
						pr:
						{
							number: 42,
							url: "https://github.com/o/r/pull/42",
							action: "created",
						},
					},
				),
				prMerged: git(
					{
						pr:
						{
							number: 7,
							action: "merged",
						},
					},
				),
			},
		).toStrictEqual(
			{
				committed:
				{
					verb: "Committed",
					meta: "abc1234",
				},
				amended:
				{
					verb: "Amended commit",
					meta: "abc1234",
				},
				cherryPicked:
				{
					verb: "Cherry-picked",
					meta: "abc1234",
				},
				pushed:
				{
					verb: "Pushed",
					meta: "feature/x",
				},
				commitAndPush:
				{
					verb: "Committed",
					meta: "abc1234",
				},
				rebased:
				{
					verb: "Rebased onto",
					meta: "origin/main",
				},
				merged:
				{
					verb: "Merged",
					meta: "origin/main",
				},
				prCreated:
				{
					verb: "Created PR",
					meta: "#42",
					metaHref: "https://github.com/o/r/pull/42",
				},
				prMerged:
				{
					verb: "Merged PR",
					meta: "#7",
				},
			},
		);
	});

	it('uses "server: tool name" for MCP tools, the server lowercase as upstream keeps it, and "Used {name}" for anything unknown', () =>
	{
		expect(
			{
				mcp: toolLabel(
					call(
						"mcp__sentry__search_issues",
						{
							query: "x",
						},
					),
				),
				hyphenatedMcp: toolLabel(call("mcp__claude-in-chrome__javascript_tool")),
				pluginMcp: toolLabel(call("mcp__plugin_github_github__list_issues")),
				unknown: toolLabel(call("Frobnicate")),
			},
		).toStrictEqual(
			{
				mcp:
				{
					verb: "Used sentry: search issues",
				},
				hyphenatedMcp:
				{
					verb: "Used claude-in-chrome: javascript tool",
				},
				pluginMcp:
				{
					verb: "Used github: list issues",
				},
				unknown:
				{
					verb: "Used Frobnicate",
				},
			},
		);
	});

	it("uses the generic upstream phrase table", () =>
	{
		const verbs = (name: string) =>
		{
			const {verb} = toolLabel(call(name));
			return verb;
		};

		expect(
			{
				ReportFindings: verbs("ReportFindings"),
				TaskOutput: verbs("TaskOutput"),
				Monitor: verbs("Monitor"),
				LSP: verbs("LSP"),
				ListMcpResourcesTool: verbs("ListMcpResourcesTool"),
				ReadMcpResourceTool: verbs("ReadMcpResourceTool"),
				Workflow: verbs("Workflow"),
			},
		).toStrictEqual(
			{
				ReportFindings: "Reported review findings",
				TaskOutput: "Read task output",
				Monitor: "Started watching background command",
				LSP: "Inspected code",
				ListMcpResourcesTool: "Listed resources",
				ReadMcpResourceTool: "Read resource",
				Workflow: "Ran workflow",
			},
		);
	});
});

describe("toolResultMetaFrom", () =>
{
	it("reads the Write type and the Bash git operation through strict schemas", () =>
	{
		expect(
			{
				write: toolResultMetaFrom(
					{
						type: "update",
						filePath: "/a.ts",
						content: "x",
						structuredPatch: [],
						originalFile: "y",
					},
				),
				git: toolResultMetaFrom(
					{
						stdout: "",
						stderr: "",
						interrupted: false,
						isImage: false,
						gitOperation:
						{
							push:
							{
								branch: "main",
							},
						},
					},
				),
				badGit: toolResultMetaFrom(
					{
						stdout: "",
						gitOperation:
						{
							push:
							{
								branch: 3,
							},
						},
					},
				),
				plain: toolResultMetaFrom(
					{
						stdout: "ok",
					},
				),
				text: toolResultMetaFrom("Error: nope"),
				missing: toolResultMetaFrom(undefined),
			},
		).toStrictEqual(
			{
				write:
				{
					writeType: "update",
				},
				git:
				{
					gitOperation:
					{
						push:
						{
							branch: "main",
						},
					},
				},
				badGit: undefined,
				plain: undefined,
				text: undefined,
				missing: undefined,
			},
		);
	});
});

describe("toolResultMetaFrom AskUserQuestion results", () =>
{
	const questions = [
		{
			question: "Which color?",
			header: "Color",
			options: [
				{
					label: "Red",
					description: "Warm",
				},
			],
			multiSelect: false,
		},
	];

	it("keeps the answers of CLI 2.1.327's AFK, followUp and freeform results, marks the AFK one timed out, and strips unknown keys", () =>
	{
		expect(
			{
				afk: toolResultMetaFrom(
					{
						questions,
						answers:
						{
							"Which color?": "Red",
						},
						afkTimeoutMs: 300000,
					},
				),
				followUp: toolResultMetaFrom(
					{
						questions,
						answers:
						{
							"Which color?": "Red",
						},
						followUp: true,
						response: "and blue too",
					},
				),
				responded: toolResultMetaFrom(
					{
						questions,
						answers: {},
						response: "neither",
					},
				),
				unknownKey: toolResultMetaFrom(
					{
						questions,
						answers:
						{
							"Which color?": "Red",
						},
						futureKey: 1,
					},
				),
			},
		).toStrictEqual(
			{
				afk:
				{
					answers:
					{
						"Which color?":
						{
							answer: "Red",
							notes: null,
						},
					},
					timedOut: true,
				},
				followUp:
				{
					answers:
					{
						"Which color?":
						{
							answer: "Red",
							notes: null,
						},
					},
				},
				responded:
				{
					answers: {},
				},
				unknownKey:
				{
					answers:
					{
						"Which color?":
						{
							answer: "Red",
							notes: null,
						},
					},
				},
			},
		);
	});

	it("declares the AFK, followUp and response keys in the strict schema, which still rejects an unknown key", () =>
	{
		const afk =
		{
			questions,
			answers: {},
			response: "x",
			afkTimeoutMs: 60000,
			followUp: true,
		};
		expect(
			{
				known: AskUserQuestionResultSchema.parse(afk),
				unknown: AskUserQuestionResultSchema.safeParse(
					{
						...afk,
						futureKey: 1,
					},
				).success,
			},
		).toStrictEqual(
			{
				known: afk,
				unknown: false,
			},
		);
	});
});

describe("toolResultMetaFrom agent results", () =>
{
	it("reads the launched agent's id, so a later SendMessage can name its description", () =>
	{
		expect(
			{
				async: toolResultMetaFrom(
					{
						isAsync: true,
						status: "async_launched",
						agentId: "ae82c2d367f9dc313",
						description: "Do next todo task",
					},
				),
				badId: toolResultMetaFrom(
					{
						status: "completed",
						agentId: 7,
					},
				),
			},
		).toStrictEqual(
			{
				async:
				{
					agentId: "ae82c2d367f9dc313",
				},
				badId: undefined,
			},
		);
	});
});

describe("runningToolLabel", () =>
{
	it("names a busy group's running file call with its basename as one string, as upstream's group TurnStatus does", () =>
	{
		expect(
			{
				read: groupRunningText(
					call(
						"Read",
						{
							file_path: "/repo/b.ts",
						},
					),
				),
				edit: groupRunningText(
					call(
						"Edit",
						{
							file_path: "/repo/a.ts",
							old_string: "a",
							new_string: "b",
						},
					),
				),
				notebook: groupRunningText(
					call(
						"NotebookEdit",
						{
							notebook_path: "/repo/n.ipynb",
							new_source: "x",
						},
					),
				),
				bash: groupRunningText(
					call(
						"Bash",
						{
							command: "ls",
							description: "List files",
						},
					),
				),
			},
		).toStrictEqual(
			{
				read: "Reading b.ts",
				edit: "Editing a.ts",
				notebook: "Editing n.ipynb",
				bash: "Listing files",
			},
		);
	});

	it("inflects a running description as upstream ro does, keeping a queued request's description as written", () =>
	{
		const input =
		{
			command: "git push",
			description: "Push branches and open PRs",
		};
		expect(
			{
				queued: runningToolLabel(
					{
						...call("Bash", input),
						awaitingApproval: true,
					},
				),
				running: runningToolLabel(call("Bash", input)),
			},
		).toStrictEqual(
			{
				queued:
				{
					verb: "Running",
					label: "Push branches and open PRs",
				},
				running:
				{
					verb: "Running",
					label: "Pushing branches and open PRs",
				},
			},
		);
	});

	it("labels running Bash and Agent descriptions with upstream ro's running form", () =>
	{
		const bash = (description: string) =>
			runningToolLabel(
				call(
					"Bash",
					{
						command: "x",
						description,
					},
				),
			).label;
		const agent = (description: string) =>
			runningToolLabel(
				call(
					"Agent",
					{
						description,
						prompt: "p",
					},
				),
			).label;
		expect(
			{
				bashUnknown: bash("Open draft PR for the AssertJ branch"),
				bashFollower: bash("Wait and recheck DNS"),
				bashPrefix: bash("Re-run the tests"),
				bashHyphen: bash("Cherry-pick fold"),
				bashSpelling: bash("Screenshot the page"),
				bashPlural: bash("Tests pass"),
				bashIndent: bash("  Run indented"),
				agentFollower: agent("Build and test"),
				agentPrefix: agent("Re-sync the fork"),
			},
		).toStrictEqual(
			{
				bashUnknown: "Open draft PR for the AssertJ branch",
				bashFollower: "Waiting and rechecking DNS",
				bashPrefix: "Re-running the tests",
				bashHyphen: "Cherry-pick fold",
				bashSpelling: "Screenshotting the page",
				bashPlural: "Tests pass",
				bashIndent: "  Running indented",
				agentFollower: "Building and testing",
				agentPrefix: "Re-syncing the fork",
			},
		);
	});

	it("gives an in-flight call the progressive form of its label", () =>
	{
		expect(
			{
				bashDescription: runningToolLabel(
					call(
						"Bash",
						{
							command: "gh pr view 1954",
							description: "Poll PR #1954 for new activity from Don or Moh",
						},
					),
				),
				bashRun: runningToolLabel(
					call(
						"Bash",
						{
							command: "make",
							description: "Run the build",
						},
					),
				),
				bashCommit: runningToolLabel(
					call(
						"Bash",
						{
							command: "git commit",
							description: "Commit the fix",
						},
					),
				),
				bashWrite: runningToolLabel(
					call(
						"Bash",
						{
							command: "cat > a",
							description: "Write the config",
						},
					),
				),
				bashAlready: runningToolLabel(
					call(
						"Bash",
						{
							command: "x",
							description: "Polling the API",
						},
					),
				),
				bashCommand: runningToolLabel(
					call(
						"Bash",
						{
							command: "ls -la",
						},
					),
				),
				bashBare: runningToolLabel(call("Bash")),
				read: runningToolLabel(
					call(
						"Read",
						{
							file_path: "/repo/src/cache.ts",
						},
					),
				),
				write: runningToolLabel(
					call(
						"Write",
						{
							file_path: "/a/new.ts",
						},
					),
				),
				edit: runningToolLabel(
					call(
						"Edit",
						{
							file_path: "/a/x.ts",
						},
					),
				),
				grep: runningToolLabel(
					call(
						"Grep",
						{
							pattern: "TODO",
						},
					),
				),
				webSearch: runningToolLabel(
					call(
						"WebSearch",
						{
							query: "zod",
						},
					),
				),
				agent: runningToolLabel(
					call(
						"Agent",
						{
							description: "Explore the codebase",
							prompt: "p",
						},
					),
				),
				agentKnownVerb: runningToolLabel(
					call(
						"Agent",
						{
							description: "Commit the fixup",
							prompt: "p",
						},
					),
				),
				agentDoTask: runningToolLabel(
					call(
						"Agent",
						{
							description: "Do task M1-42",
							prompt: "p",
						},
					),
				),
				agentNoVerb: runningToolLabel(
					call(
						"Agent",
						{
							description: "Mobile audit: session page",
							prompt: "p",
						},
					),
				),
				agentBare: runningToolLabel(
					call(
						"Agent",
						{
							prompt: "p",
						},
					),
				),
				skill: runningToolLabel(
					call(
						"Skill",
						{
							skill: "git:commit",
						},
					),
				),
				taskStop: runningToolLabel(
					call(
						"TaskStop",
						{
							task_id: "b1",
						},
					),
				),
				mcp: runningToolLabel(call("mcp__github__get_me")),
			},
		).toStrictEqual(
			{
				bashDescription:
				{
					verb: "Running",
					label: "Polling PR #1954 for new activity from Don or Moh",
				},
				bashRun:
				{
					verb: "Running",
					label: "Running the build",
				},
				bashCommit:
				{
					verb: "Running",
					label: "Committing the fix",
				},
				bashWrite:
				{
					verb: "Running",
					label: "Writing the config",
				},
				bashAlready:
				{
					verb: "Running",
					label: "Polling the API",
				},
				bashCommand:
				{
					verb: "Running",
					label: "ls -la",
				},
				bashBare:
				{
					verb: "Running",
					meta: "a command",
				},
				read:
				{
					verb: "Reading",
				},
				write:
				{
					verb: "Writing",
				},
				edit:
				{
					verb: "Editing",
				},
				grep:
				{
					verb: "Searching",
				},
				webSearch:
				{
					verb: "Searching web",
				},
				agent:
				{
					verb: "Running agent",
					label: "Explore the codebase",
				},
				agentKnownVerb:
				{
					verb: "Running agent",
					label: "Committing the fixup",
				},
				agentDoTask:
				{
					verb: "Running agent",
					label: "Doing task M1-42",
				},
				agentNoVerb:
				{
					verb: "Running agent",
					label: "Mobile audit: session page",
				},
				agentBare:
				{
					verb: "Running agent",
				},
				skill:
				{
					verb: "Running skill",
					meta: "/git:commit",
					metaIsCode: true,
				},
				taskStop:
				{
					verb: "Stopping task",
				},
				mcp:
				{
					verb: "Using github: get me",
				},
			},
		);
	});
});

describe("toolLabel Bash past tense", () =>
{
	const done = (description: string) =>
		toolLabel(
			call(
				"Bash",
				{
					command: "x",
					description,
				},
			),
		).doneLabel;

	it.each([
		["Recheck DNS", "Rechecked DNS"],
		["Wait and recheck DNS", "Waited and rechecked DNS"],
		["Commit and move root", "Committed and moved root"],
		["Grep logs", "Grepped logs"],
		["Scan repo", "Scanned repo"],
		["Trim x", "Trimmed x"],
		["Create and run script", "Created and ran script"],
		["Test both reordered commits and get next task", "Tested both reordered commits and got next task"],
		[
			"Set repo homepage and delete stale preview environments",
			"Set repo homepage and deleted stale preview environments",
		],
		[
			"Replay the removal onto the updated branch and push",
			"Replayed the removal onto the updated branch and pushed",
		],
		["Verify task commit, gate HEAD, get next task", "Verified task commit, gate HEAD, get next task"],
		["Read config and keep going", "Read config and keep going"],
		["Check that the build and run is green", "Checked that the build and run is green"],
		["Fix the bug then verify", "Fixed the bug then verified"],
		["Sync the mirror", "Synced the mirror"],
		["Copy files", "Copied files"],
		["Re-run the suite", "Re-ran the suite"],
	])("past-tenses %j as %j", (description, expected) =>
	{
		expect(done(description)).toBe(expected);
	});

	it.each([
		"Open the page",
		"Reorder so the Markdown reformat precedes the config change",
		"Open Chase cash back page",
		"Cherry-pick fold commit",
		"Sum results",
		"Look at the logs",
		"Mark the task done",
	])("keeps a description whose first word is not a known verb verbatim: %j", (description) =>
	{
		expect(done(description)).toBe(description);
	});
});

describe("SendMessage labels", () =>
{
	const send = (input: Record<string, unknown>, recipientDescription?: string): ToolLabelCall =>
		recipientDescription === undefined
			?
				{
					name: "SendMessage",
					input,
				}
			:
				{
					name: "SendMessage",
					input,
					recipientDescription,
				};
	const longMessage = `${"word ".repeat(20)}\n\n  and   more`;

	it("names the recipient as upstream does", () =>
	{
		expect(
			{
				knownAgent: toolLabel(
					send(
						{
							to: "ae82c2d367f9dc313",
							message: "Finish the task",
						},
						"Do next todo task",
					),
				),
				agentSummary: toolLabel(
					send(
						{
							to: "ae82c2d367f9dc313",
							summary: "ping",
							message: "Finish it",
						},
					),
				),
				agentMessage: toolLabel(
					send(
						{
							to: "a1b2c3d4e",
							message: longMessage,
						},
					),
				),
				agentKind: toolLabel(
					send(
						{
							to: "worker",
							recipient_kind: "agent",
							message: "hi",
						},
					),
				),
				teammate: toolLabel(
					send(
						{
							to: "researcher",
							summary: "status?",
							message: "How is it going?",
						},
					),
				),
				teammateMessage: toolLabel(
					send(
						{
							to: "researcher",
							message: "How is it going?",
						},
					),
				),
				session: toolLabel(
					send(
						{
							to: "researcher",
							recipient_kind: "session",
							message: "hi",
						},
					),
				),
				missing: toolLabel(
					send(
						{
							message: "hi",
						},
					),
				),
				did: toolLabel(
					send(
						{
							to: "did:plc:abc",
							message: "hi",
						},
					),
				),
				uds: toolLabel(
					send(
						{
							to: "uds:/tmp/peer.sock",
							message: "hi",
						},
					),
				),
				local: toolLabel(
					send(
						{
							to: "local_0123abcd-ef",
							message: "hi",
						},
					),
				),
			},
		).toStrictEqual(
			{
				knownAgent:
				{
					verb: "Messaged agent",
					meta: "Do next todo task",
				},
				agentSummary:
				{
					verb: "Messaged agent",
					meta: "ping",
				},
				agentMessage:
				{
					verb: "Messaged agent",
					meta: `${"word ".repeat(15).trim()} word…`,
				},
				agentKind:
				{
					verb: "Messaged agent",
					meta: "hi",
				},
				teammate:
				{
					verb: "Messaged @researcher",
					meta: "status?",
				},
				teammateMessage:
				{
					verb: "Messaged @researcher",
					meta: "How is it going?",
				},
				session:
				{
					verb: "Messaged another session",
				},
				missing:
				{
					verb: "Messaged another session",
				},
				did:
				{
					verb: "Messaged another session",
				},
				uds:
				{
					verb: "Messaged another session",
				},
				local:
				{
					verb: "Messaged another session",
				},
			},
		);
	});

	it("names plan approvals and shutdown handshakes", () =>
	{
		expect(
			{
				approved: toolLabel(
					send(
						{
							to: "planner",
							message:
							{
								type: "plan_approval_response",
								request_id: "r1",
								approve: true,
							},
						},
					),
				),
				rejected: toolLabel(
					send(
						{
							to: "planner",
							message:
							{
								type: "plan_approval_response",
								request_id: "r1",
								approve: false,
								feedback: "Split it up",
							},
						},
					),
				),
				shutdown: toolLabel(
					send(
						{
							to: "worker",
							message:
							{
								type: "shutdown_request",
								reason: "Done for today",
							},
						},
					),
				),
				shutdownApproved: toolLabel(
					send(
						{
							to: "lead",
							message:
							{
								type: "shutdown_response",
								request_id: "r2",
								approve: true,
							},
						},
					),
				),
				shutdownDeclined: toolLabel(
					send(
						{
							to: "lead",
							message:
							{
								type: "shutdown_response",
								request_id: "r2",
								approve: "false",
							},
						},
					),
				),
			},
		).toStrictEqual(
			{
				approved:
				{
					verb: "Approved plan from @planner",
				},
				rejected:
				{
					verb: "Rejected plan from @planner",
					meta: "Split it up",
				},
				shutdown:
				{
					verb: "Asked @worker to shut down",
					meta: "Done for today",
				},
				shutdownApproved:
				{
					verb: "Approved shutdown request from @lead",
				},
				shutdownDeclined:
				{
					verb: "Declined shutdown request from @lead",
				},
			},
		);
	});

	it("gives an in-flight message the progressive verb", () =>
	{
		expect(
			{
				agent: runningToolLabel(
					send(
						{
							to: "ae82c2d367f9dc313",
							message: "go",
						},
						"Do next todo task",
					),
				),
				teammate: runningToolLabel(
					send(
						{
							to: "researcher",
							message: "hi",
						},
					),
				),
				session: runningToolLabel(
					send(
						{
							message: "hi",
						},
					),
				),
				plan: runningToolLabel(
					send(
						{
							to: "planner",
							message:
							{
								type: "plan_approval_response",
								request_id: "r1",
								approve: true,
							},
						},
					),
				),
			},
		).toStrictEqual(
			{
				agent:
				{
					verb: "Messaging agent",
					meta: "Do next todo task",
				},
				teammate:
				{
					verb: "Messaging @researcher",
					meta: "hi",
				},
				session:
				{
					verb: "Messaging another session",
				},
				plan:
				{
					verb: "Approving plan from @planner",
				},
			},
		);
	});
});

describe("toolResultMetaFrom Read lines", () =>
{
	it("keeps the lines a Read result reports, not its content", () =>
	{
		const file =
		{
			filePath: "/a.ts",
			content: "x\ny\n",
			numLines: 3,
			startLine: 1,
			totalLines: 3,
		};
		expect(
			{
				read: toolResultMetaFrom(
					{
						type: "text",
						file,
					},
				),
				noNewline: toolResultMetaFrom(
					{
						type: "text",
						file:
						{
							...file,
							content: "x\ny",
						},
					},
				),
				noTotal: toolResultMetaFrom(
					{
						type: "text",
						file:
						{
							filePath: "/a.ts",
							content: "",
							numLines: 0,
							startLine: 1,
						},
					},
				),
				image: toolResultMetaFrom(
					{
						type: "image",
						file:
						{
							base64: "",
							type: "image/png",
						},
					},
				),
			},
		).toStrictEqual(
			{
				read:
				{
					readFile:
					{
						filePath: "/a.ts",
						startLine: 1,
						numLines: 3,
						totalLines: 3,
						endsWithNewline: true,
					},
				},
				noNewline:
				{
					readFile:
					{
						filePath: "/a.ts",
						startLine: 1,
						numLines: 3,
						totalLines: 3,
						endsWithNewline: false,
					},
				},
				noTotal:
				{
					readFile:
					{
						filePath: "/a.ts",
						startLine: 1,
						numLines: 0,
						endsWithNewline: false,
					},
				},
				image: undefined,
			},
		);
	});
});

describe("benign tool errors", () =>
{
	const noOp = "No-op: there is no active EnterWorktree session to exit. This tool only operates on worktrees.";
	it("names a no-op ExitWorktree without failing it", () =>
	{
		expect(
			{
				noOp: toolLabel(
					{
						name: "ExitWorktree",
						input:
						{
							action: "keep",
						},
						isError: true,
						result: noOp,
					},
				),
				otherError: toolLabel(
					{
						name: "ExitWorktree",
						input:
						{
							action: "keep",
						},
						isError: true,
						result: "boom",
					},
				),
				noOpNotErrored: toolLabel(
					{
						name: "ExitWorktree",
						input:
						{
							action: "keep",
						},
						result: noOp,
					},
				),
			},
		).toStrictEqual(
			{
				noOp:
				{
					verb: "Left the worktree",
					failedVerb: "No worktree to leave",
					errorIsBenign: true,
				},
				otherError:
				{
					verb: "Left the worktree",
					failedVerb: "Failed to leave the worktree",
				},
				noOpNotErrored:
				{
					verb: "Left the worktree",
				},
			},
		);
	});
});

describe("runningToolLabel upstream running verbs", () =>
{
	it("copies the running verbs that are not the done verb's progressive", () =>
	{
		expect(
			{
				enterPlanMode: runningToolLabel(
					{
						name: "EnterPlanMode",
						input: {},
					},
				),
				clearTodos: runningToolLabel(
					{
						name: "TodoWrite",
						input:
						{
							todos: [],
						},
					},
				),
				updateTodos: runningToolLabel(
					{
						name: "TodoWrite",
						input:
						{
							todos: [
								{
									content: "x",
								},
							],
						},
					},
				),
			},
		).toStrictEqual(
			{
				enterPlanMode:
				{
					verb: "Making a plan",
				},
				clearTodos:
				{
					verb: "Updating todos",
				},
				updateTodos:
				{
					verb: "Updating todos",
				},
			},
		);
	});
});

describe("failed verbs", () =>
{
	const failed = (name: string, input: Record<string, unknown> = {}, resultMeta?: ToolLabelCall["resultMeta"]) =>
		toolLabel(
			resultMeta === undefined
				?
					{
						name,
						input,
						isError: true,
					}
				:
					{
						name,
						input,
						isError: true,
						resultMeta,
					},
		);

	it("names each errored tool with upstream's failed verb", () =>
	{
		expect(
			{
				bashDescribed: failed(
					"Bash",
					{
						command: "npm test",
						description: "Run the tests",
					},
				),
				bashRunning: failed(
					"Bash",
					{
						command: "npm test",
						description: "Running tests",
					},
				),
				bashNoVerb: failed(
					"Bash",
					{
						command: "npm test",
						description: "Mobile audit",
					},
				),
				bashBare: failed(
					"Bash",
					{
						command: "npm test",
					},
				),
				bashGit: failed(
					"Bash",
					{
						command: "git push",
					},
					{
						gitOperation:
						{
							push:
							{
								branch: "main",
							},
						},
					},
				),
				read: failed(
					"Read",
					{
						file_path: "/a/x.ts",
					},
				),
				write: failed(
					"Write",
					{
						file_path: "/a/x.ts",
					},
				),
				edit: failed(
					"Edit",
					{
						file_path: "/a/x.ts",
					},
				),
				multiEdit: failed(
					"MultiEdit",
					{
						file_path: "/a/x.ts",
					},
				),
				notebookEdit: failed(
					"NotebookEdit",
					{
						notebook_path: "/a/x.ipynb",
					},
				),
				grep: failed(
					"Grep",
					{
						pattern: "TODO",
					},
				),
				glob: failed(
					"Glob",
					{
						pattern: "*.ts",
					},
				),
				ls: failed(
					"LS",
					{
						path: "/repo",
					},
				),
				webFetch: failed(
					"WebFetch",
					{
						url: "https://x.dev",
					},
				),
				webSearch: failed(
					"WebSearch",
					{
						query: "zod",
					},
				),
				agent: failed(
					"Agent",
					{
						description: "Audit the sidebar",
						prompt: "go",
					},
				),
				agentNoVerb: failed(
					"Agent",
					{
						description: "Sidebar audit",
						prompt: "go",
					},
				),
				agentBare: failed(
					"Agent",
					{
						prompt: "go",
					},
				),
				skill: failed(
					"Skill",
					{
						skill: "git:commit",
					},
				),
				taskGet: failed(
					"TaskGet",
					{
						taskId: "3",
					},
				),
				taskList: failed("TaskList"),
				taskCreate: failed(
					"TaskCreate",
					{
						subject: "Ship it",
					},
				),
				taskUpdate: failed(
					"TaskUpdate",
					{
						taskId: "3",
						status: "completed",
					},
				),
				taskStop: failed(
					"TaskStop",
					{
						task_id: "b1",
					},
				),
				todoWrite: failed(
					"TodoWrite",
					{
						todos: [
							{
								content: "x",
							},
						],
					},
				),
				askUserQuestion: failed(
					"AskUserQuestion",
					{
						questions: [
							{
								header: "Pick",
							},
						],
					},
				),
				enterPlanMode: failed("EnterPlanMode"),
				exitPlanMode: failed(
					"ExitPlanMode",
					{
						plan: "## Plan",
					},
				),
				enterWorktreePath: failed(
					"EnterWorktree",
					{
						path: "/w/feature",
					},
				),
				enterWorktreeNew: failed(
					"EnterWorktree",
					{
						name: "feature",
					},
				),
				exitWorktreeKeep: failed(
					"ExitWorktree",
					{
						action: "keep",
					},
				),
				exitWorktreeRemove: failed(
					"ExitWorktree",
					{
						action: "remove",
					},
				),
				artifactPublish: failed(
					"Artifact",
					{
						file_path: "/a/page.html",
					},
				),
				artifactPin: failed(
					"Artifact",
					{
						action: "pin",
					},
				),
				artifactUnpin: failed(
					"Artifact",
					{
						action: "unpin",
					},
				),
				artifactList: failed(
					"Artifact",
					{
						action: "list",
					},
				),
				artifactRead: failed(
					"Artifact",
					{
						action: "read",
					},
				),
				sendUserMessage: failed(
					"SendUserMessage",
					{
						message: "hi",
					},
				),
				sendUserFile: failed("SendUserFile"),
				pushNotification: failed("PushNotification"),
				messageAgent: failed(
					"SendMessage",
					{
						to: "a0123456789abcdef",
						message: "hi",
					},
				),
				messageSession: failed(
					"SendMessage",
					{
						to: "uds:/tmp/x",
						message: "hi",
					},
				),
				messageTeammate: failed(
					"SendMessage",
					{
						to: "lead",
						message: "hi",
					},
				),
				wakeup: failed(
					"ScheduleWakeup",
					{
						reason: "poll",
					},
				),
				wakeupStop: failed(
					"ScheduleWakeup",
					{
						stop: true,
					},
				),
				cronOnce: failed(
					"CronCreate",
					{
						prompt: "<<tick>>",
						recurring: false,
					},
				),
				cronLoop: failed(
					"CronCreate",
					{
						prompt: "<<tick>>",
					},
				),
				routinesList: failed(
					"RemoteTrigger",
					{
						action: "list",
					},
				),
				routinesGet: failed(
					"RemoteTrigger",
					{
						action: "get",
					},
				),
				routinesCreate: failed(
					"RemoteTrigger",
					{
						action: "create",
					},
				),
				routinesUpdate: failed(
					"RemoteTrigger",
					{
						action: "update",
					},
				),
				routinesRun: failed(
					"RemoteTrigger",
					{
						action: "run",
					},
				),
				monitor: failed(
					"Monitor",
					{
						command: "tail",
					},
				),
				workflow: failed(
					"Workflow",
					{
						scriptPath: "/x/wf.js",
					},
				),
				cronDelete: failed(
					"CronDelete",
					{
						id: "1",
					},
				),
				cronList: failed("CronList"),
				reportFindings: failed("ReportFindings"),
				toolSearch: failed(
					"ToolSearch",
					{
						query: "x",
					},
				),
				lsp: failed("LSP"),
				listMcpResources: failed("ListMcpResourcesTool"),
				readMcpResource: failed("ReadMcpResourceTool"),
				readMcpResourceDir: failed("ReadMcpResourceDirTool"),
				taskOutput: failed("TaskOutput"),
				waitForMcpServers: failed("WaitForMcpServers"),
				refreshMcpTools: failed("RefreshMcpTools"),
				sendFeedback: failed("SendFeedback"),
				mcp: failed(
					"mcp__claude-in-chrome__navigate",
					{
						url: "https://x.dev",
					},
				),
				unknown: failed("Mystery"),
			},
		).toStrictEqual(
			{
				bashDescribed:
				{
					verb: "Ran",
					meta: "Run the tests",
					doneLabel: "Ran the tests",
					failedVerb: "Failed to run",
					failedLabel: "Failed to run the tests",
				},
				// Upstream ro reads no verb from a leading -ing word, so no failedLabel.
				bashRunning:
				{
					verb: "Ran",
					meta: "Running tests",
					doneLabel: "Running tests",
					failedVerb: "Failed to run",
				},
				bashNoVerb:
				{
					verb: "Ran",
					meta: "Mobile audit",
					doneLabel: "Mobile audit",
					failedVerb: "Failed to run",
				},
				bashBare:
				{
					verb: "Ran",
					meta: "npm test",
					doneLabel: "npm test",
					failedVerb: "Failed to run",
				},
				bashGit:
				{
					verb: "Ran",
					meta: "git push",
					doneLabel: "git push",
					failedVerb: "Failed to run",
				},
				read:
				{
					verb: "Read",
					failedVerb: "Failed to read",
				},
				write:
				{
					verb: "Created",
					failedVerb: "Failed to write",
				},
				edit:
				{
					verb: "Edited",
					failedVerb: "Failed to edit",
				},
				multiEdit:
				{
					verb: "Edited",
					failedVerb: "Failed to edit",
				},
				notebookEdit:
				{
					verb: "Edited",
					failedVerb: "Failed to edit",
				},
				grep:
				{
					verb: "Searched",
					failedVerb: "Failed to search",
				},
				glob:
				{
					verb: "Searched",
					failedVerb: "Failed to search files",
				},
				ls:
				{
					verb: "Listed",
					failedVerb: "Failed to list",
				},
				webFetch:
				{
					verb: "Fetched",
					failedVerb: "Failed to fetch",
				},
				webSearch:
				{
					verb: "Searched web",
					failedVerb: "Failed to search web",
				},
				agent:
				{
					verb: "Ran agent",
					meta: "Audit the sidebar",
					doneLabel: "Audited the sidebar",
					failedVerb: "Failed to run agent",
					failedLabel: "Failed to audit the sidebar",
				},
				agentNoVerb:
				{
					verb: "Ran agent",
					meta: "Sidebar audit",
					doneLabel: "Sidebar audit",
					failedVerb: "Failed to run agent",
				},
				agentBare:
				{
					verb: "Ran agent",
					failedVerb: "Failed to run agent",
				},
				skill:
				{
					verb: "Ran skill",
					meta: "/git:commit",
					metaIsCode: true,
					failedVerb: "Failed to run skill",
				},
				taskGet:
				{
					verb: "Read task",
					failedVerb: "Failed to read task",
				},
				taskList:
				{
					verb: "Listed tasks",
					failedVerb: "Failed to list tasks",
				},
				taskCreate:
				{
					verb: "Added task",
					failedVerb: "Failed to add task",
				},
				taskUpdate:
				{
					verb: "Completed task",
					failedVerb: "Failed to update task",
				},
				taskStop:
				{
					verb: "Stopped task",
					failedVerb: "Failed to stop task",
				},
				todoWrite:
				{
					verb: "Updated todos",
				},
				askUserQuestion:
				{
					verb: "Asked",
					meta: "“Pick”",
					doneLabel: "Asked “Pick”",
				},
				enterPlanMode:
				{
					verb: "Started planning",
					failedVerb: "Failed to start planning",
				},
				exitPlanMode:
				{
					verb: "Proposed plan",
					meta: "Plan",
					failedVerb: "Failed to propose plan",
				},
				enterWorktreePath:
				{
					verb: "Entered a worktree",
					meta: "feature",
					failedVerb: "Failed to enter the worktree",
				},
				enterWorktreeNew:
				{
					verb: "Created a worktree",
					meta: "feature",
					failedVerb: "Failed to create a worktree",
				},
				exitWorktreeKeep:
				{
					verb: "Left the worktree",
					failedVerb: "Failed to leave the worktree",
				},
				exitWorktreeRemove:
				{
					verb: "Left the worktree",
					failedVerb: "Failed to remove the worktree",
				},
				artifactPublish:
				{
					verb: "Published artifact",
					meta: "page.html",
					failedVerb: "Failed to publish artifact",
				},
				artifactPin:
				{
					verb: "Pinned artifact",
					failedVerb: "Failed to pin artifact",
				},
				artifactUnpin:
				{
					verb: "Unpinned artifact",
					failedVerb: "Failed to unpin artifact",
				},
				artifactList:
				{
					verb: "Listed artifacts",
					failedVerb: "Failed to list artifacts",
				},
				artifactRead:
				{
					verb: "Used artifact tool",
					meta: "read",
					failedVerb: "Failed to run artifact action",
				},
				sendUserMessage:
				{
					verb: "Sent",
					failedVerb: "Failed to send",
				},
				sendUserFile:
				{
					verb: "Sent",
					failedVerb: "Failed to send",
				},
				pushNotification:
				{
					verb: "Sent notification",
					failedVerb: "Failed to send notification",
				},
				messageAgent:
				{
					verb: "Messaged agent",
					meta: "hi",
					failedVerb: "Failed to message agent",
				},
				messageSession:
				{
					verb: "Messaged another session",
					failedVerb: "Failed to message another session",
				},
				messageTeammate:
				{
					verb: "Messaged @lead",
					meta: "hi",
					failedVerb: "Failed to message @lead",
				},
				wakeup:
				{
					verb: "Scheduled check-in",
					meta: "poll",
					failedVerb: "Failed to schedule check-in",
				},
				wakeupStop:
				{
					verb: "Stopped loop",
					failedVerb: "Failed to stop loop",
				},
				cronOnce:
				{
					verb: "Scheduled prompt",
					failedVerb: "Failed to schedule prompt",
				},
				cronLoop:
				{
					verb: "Started loop",
					failedVerb: "Failed to start loop",
				},
				routinesList:
				{
					verb: "Listed routines",
					failedVerb: "Failed to list routines",
				},
				routinesGet:
				{
					verb: "Read routine",
					failedVerb: "Failed to read routine",
				},
				routinesCreate:
				{
					verb: "Created routine",
					failedVerb: "Failed to create routine",
				},
				routinesUpdate:
				{
					verb: "Updated routine",
					failedVerb: "Failed to update routine",
				},
				routinesRun:
				{
					verb: "Ran routine",
					failedVerb: "Failed to start routine run",
				},
				monitor:
				{
					verb: "Started watching background command",
					failedVerb: "Failed to start watching",
				},
				workflow:
				{
					verb: "Ran workflow",
					meta: "wf",
					failedVerb: "Failed to run workflow",
				},
				cronDelete:
				{
					verb: "Stopped scheduled prompt",
					failedVerb: "Failed to stop scheduled prompt",
				},
				cronList:
				{
					verb: "Listed scheduled prompts",
					failedVerb: "Failed to list scheduled prompts",
				},
				reportFindings:
				{
					verb: "Reported review findings",
					failedVerb: "Failed to report review findings",
				},
				toolSearch:
				{
					verb: "Loaded tools",
					failedVerb: "Failed to load tools",
				},
				lsp:
				{
					verb: "Inspected code",
					failedVerb: "Failed to inspect code",
				},
				listMcpResources:
				{
					verb: "Listed resources",
					failedVerb: "Failed to list resources",
				},
				readMcpResource:
				{
					verb: "Read resource",
					failedVerb: "Failed to read resource",
				},
				readMcpResourceDir:
				{
					verb: "Listed resource folder",
					failedVerb: "Failed to list resource folder",
				},
				taskOutput:
				{
					verb: "Read task output",
					failedVerb: "Failed to read task output",
				},
				waitForMcpServers:
				{
					verb: "Loaded connectors",
					failedVerb: "Failed to load connectors",
				},
				refreshMcpTools:
				{
					verb: "Refreshed tools",
					failedVerb: "Failed to refresh tools",
				},
				sendFeedback:
				{
					verb: "Sent feedback",
					failedVerb: "Failed to send feedback",
				},
				mcp:
				{
					verb: "Used claude-in-chrome: navigate",
					failedVerb: "Failed to use claude-in-chrome: navigate",
				},
				unknown:
				{
					verb: "Used Mystery",
					failedVerb: "Failed to use Mystery",
				},
			},
		);
	});

	it("leaves the failed forms off a call that did not error", () =>
	{
		expect(
			toolLabel(
				{
					name: "Read",
					input:
					{
						file_path: "/a/x.ts",
					},
					isError: false,
				},
			),
		).toStrictEqual(
			{
				verb: "Read",
			},
		);
	});
});

describe("describeVerbForms", () =>
{
	// Every row of dumps/running-step-label-gerund-upstream-ro-outputs.jsonl: [description, running, done, infinitive].
	const UPSTREAM_RO: readonly (readonly [string, string, string, string | undefined])[] = [
		[
			"Push branches and open PRs",
			"Pushing branches and open PRs",
			"Pushed branches and open PRs",
			"push branches and open PRs",
		],
		[
			"Probe iMCP and Gmail IMAP",
			"Probing iMCP and Gmail IMAP",
			"Probed iMCP and Gmail IMAP",
			"probe iMCP and Gmail IMAP",
		],
		[
			"Open draft PR for the AssertJ branch",
			"Open draft PR for the AssertJ branch",
			"Open draft PR for the AssertJ branch",
			undefined,
		],
		["Cherry-pick fold", "Cherry-pick fold", "Cherry-pick fold", undefined],
		["Wait and recheck DNS", "Waiting and rechecking DNS", "Waited and rechecked DNS", "wait and recheck DNS"],
		["Sync the repo", "Syncing the repo", "Synced the repo", "sync the repo"],
		["Re-run the tests", "Re-running the tests", "Re-ran the tests", "re-run the tests"],
		[
			"Check status then push",
			"Checking status then pushing",
			"Checked status then pushed",
			"check status then push",
		],
		["Fix lint", "Fixing lint", "Fixed lint", "fix lint"],
		["Visit the page", "Visiting the page", "Visited the page", "visit the page"],
		["Mobile audit: session page", "Mobile audit: session page", "Mobile audit: session page", undefined],
		["Tests pass", "Tests pass", "Tests pass", undefined],
		["Build and test", "Building and testing", "Built and tested", "build and test"],
		["Screenshot the page", "Screenshotting the page", "Screenshotted the page", "screenshot the page"],
		[
			"Run tests and output results",
			"Running tests and output results",
			"Ran tests and output results",
			"run tests and output results",
		],
		["Unzip the archive", "Unzipping the archive", "Unzipped the archive", "unzip the archive"],
		["Panic", "Panic", "Panic", undefined],
		["Do task", "Doing task", "Did task", "do task"],
		["Commit the fix", "Committing the fix", "Committed the fix", "commit the fix"],
		["Write the config", "Writing the config", "Wrote the config", "write the config"],
		[
			"Poll PR #1954 for new activity",
			"Polling PR #1954 for new activity",
			"Polled PR #1954 for new activity",
			"poll PR #1954 for new activity",
		],
		["Polling the API", "Polling the API", "Polling the API", undefined],
		["Explore the codebase", "Explore the codebase", "Explore the codebase", undefined],
		[
			"Kill and restart server",
			"Killing and restarting server",
			"Killed and restarted server",
			"kill and restart server",
		],
		["Test and run is green", "Testing and run is green", "Tested and run is green", "test and run is green"],
		["  Run indented", "  Running indented", "  Ran indented", "  run indented"],
		["Rerun the suite", "Rerunning the suite", "Reran the suite", "rerun the suite"],
		["Re-sync the fork", "Re-syncing the fork", "Re-synced the fork", "re-sync the fork"],
		["Tie the knot", "Tie the knot", "Tie the knot", undefined],
		["See logs", "Seeing logs", "Saw logs", "see logs"],
		["Free memory", "Free memory", "Free memory", undefined],
	];

	it("inflects a description exactly as upstream ro does", () =>
	{
		expect(
			UPSTREAM_RO.map(([description]) => [
				description,
				describeVerbForms(description)?.running ?? description,
				pastTense(description),
				infinitive(description),
			]),
		).toStrictEqual(UPSTREAM_RO);
	});

	it("reads no verb forms from an empty description", () =>
	{
		expect(describeVerbForms("")).toBeUndefined();
	});
});

describe("completed-but-failed task calls", () =>
{
	const labelOf = (name: string, input: Record<string, unknown>, toolUseResult: unknown) =>
		toolLabel(
			{
				name,
				input,
				resultMeta: toolResultMetaFrom(
					toolUseResult,
					{
						name,
						input,
					},
				),
			},
		);

	it("names a TaskGet that found no task and a TaskUpdate that reports failure as failed, done", () =>
	{
		expect(
			{
				taskGetMissing: labelOf(
					"TaskGet",
					{
						taskId: "3",
					},
					{
						task: null,
					},
				),
				taskGetFound: labelOf(
					"TaskGet",
					{
						taskId: "3",
					},
					{
						task:
						{
							id: "3",
							subject: "Ship it",
						},
					},
				),
				taskUpdateFailed: labelOf(
					"TaskUpdate",
					{
						taskId: "3",
						status: "completed",
					},
					{
						success: false,
					},
				),
				taskUpdateOk: labelOf(
					"TaskUpdate",
					{
						taskId: "3",
						status: "completed",
					},
					{
						success: true,
					},
				),
				otherToolNullTask: labelOf(
					"TaskList",
					{},
					{
						task: null,
					},
				),
			},
		).toStrictEqual(
			{
				taskGetMissing:
				{
					verb: "Failed to read task",
				},
				taskGetFound:
				{
					verb: "Read task",
				},
				taskUpdateFailed:
				{
					verb: "Failed to update task",
				},
				taskUpdateOk:
				{
					verb: "Completed task",
				},
				otherToolNullTask:
				{
					verb: "Listed tasks",
				},
			},
		);
	});
});

describe("groupWords", () =>
{
	it("names an uncategorized tool in a group header by upstream's lowercased group words", () =>
	{
		expect(
			{
				question: groupWords(call("AskUserQuestion")),
				toolSearch: groupWords(call("ToolSearch")),
				skill: groupWords(
					call(
						"Skill",
						{
							skill: "x",
						},
					),
				),
				taskStop: groupWords(call("TaskStop")),
				mcp: groupWords(call("mcp__claude-in-chrome__computer")),
				pluginMcp: groupWords(call("mcp__plugin_yepnope_yepnope__authenticate")),
				ls: groupWords(call("LS")),
				sendUserMessage: groupWords(call("SendUserMessage")),
				sendUserFile: groupWords(call("SendUserFile")),
				slashCommand: groupWords(call("SlashCommand")),
				exitPlanMode: groupWords(call("ExitPlanMode")),
				innerCaps: groupWordCase("GitHub thing"),
				plain: groupWordCase("Loaded tools"),
			},
		).toStrictEqual(
			{
				question:
				{
					done: "asked a question",
					unfinished: "asked a question",
				},
				toolSearch:
				{
					done: "loaded tools",
					unfinished: "loading tools",
				},
				skill:
				{
					done: "ran skill",
					unfinished: "running skill",
				},
				taskStop:
				{
					done: "stopped task",
					unfinished: "stopping task",
				},
				mcp:
				{
					done: "used claude-in-chrome",
					unfinished: "using claude-in-chrome",
				},
				pluginMcp:
				{
					done: "used yepnope",
					unfinished: "using yepnope",
				},
				ls:
				{
					done: "listed files",
					unfinished: "listing files",
				},
				sendUserMessage:
				{
					done: "sent a message",
					unfinished: "sending a message",
				},
				sendUserFile:
				{
					done: "sent a message",
					unfinished: "sending a message",
				},
				slashCommand:
				{
					done: "ran a command",
					unfinished: "running a command",
				},
				exitPlanMode:
				{
					done: "proposed plan",
					unfinished: "proposed plan",
				},
				innerCaps: "GitHub thing",
				plain: "loaded tools",
			},
		);
	});
});
