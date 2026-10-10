import {runningToolLabel, toolLabel, toolResultMetaFrom} from "../src/lib/tool-labels";
import type {ToolLabelCall} from "../src/lib/tool-labels";

const call = (
	name: string,
	input: Record<string, unknown> = {},
	resultMeta?: ToolLabelCall["resultMeta"],
): ToolLabelCall => (resultMeta === undefined ? {name, input} : {name, input, resultMeta});

describe("toolLabel", () => {
	it.each([
		"Gate HEAD with the new test and archive the task list",
		"Gate the example branch",
		"gate example checks",
		"Map PR numbers to branches",
	])("keeps the entire unsupported leading description unchanged: %s", (description) => {
		expect(toolLabel(call("Bash", {command: "echo example", description}))).toStrictEqual({
			verb: "Ran",
			meta: description,
			doneLabel: description,
		});
	});

	it.each([
		{description: "Map PR numbers to branches", doneLabel: "Map PR numbers to branches"},
		{description: "map example paths", doneLabel: "map example paths"},
		{description: "MAP example paths", doneLabel: "MAP example paths"},
		{description: "Mapped example paths", doneLabel: "Mapped example paths"},
		{description: "Check example status", doneLabel: "Checked example status"},
		{description: "Run example tests", doneLabel: "Ran example tests"},
		{description: "Write example config", doneLabel: "Wrote example config"},
	])("keeps authored Map labels without changing established verbs: $description", ({description, doneLabel}) => {
		expect(toolLabel(call("Bash", {command: "echo example", description}))).toStrictEqual({
			verb: "Ran",
			meta: description,
			doneLabel,
		});
	});

	it("labels each tool with the upstream verb and meta", () => {
		expect({
			read: toolLabel(call("Read", {file_path: "/repo/src/cache.ts"})),
			writeCreate: toolLabel(call("Write", {file_path: "/a/new.ts"}, {writeType: "create"})),
			writeUpdate: toolLabel(call("Write", {file_path: "/a/old.ts"}, {writeType: "update"})),
			writeUnknown: toolLabel(call("Write", {file_path: "/a/x.ts"})),
			edit: toolLabel(call("Edit", {file_path: "/a/x.ts"})),
			multiEdit: toolLabel(call("MultiEdit", {file_path: "/a/x.ts"})),
			notebookEdit: toolLabel(call("NotebookEdit", {notebook_path: "/a/x.ipynb"})),
			grep: toolLabel(call("Grep", {pattern: "TODO"})),
			glob: toolLabel(call("Glob", {pattern: "*.ts"})),
			ls: toolLabel(call("LS", {path: "/repo"})),
			webFetch: toolLabel(call("WebFetch", {url: "https://x.dev"})),
			webSearch: toolLabel(call("WebSearch", {query: "zod v4"})),
			skill: toolLabel(call("Skill", {skill: "git:commit"})),
			taskGet: toolLabel(call("TaskGet", {taskId: "3"})),
			taskList: toolLabel(call("TaskList")),
			taskCreate: toolLabel(call("TaskCreate", {subject: "Ship it"})),
			taskStop: toolLabel(call("TaskStop", {task_id: "b1"})),
			enterPlanMode: toolLabel(call("EnterPlanMode")),
			exitPlanMode: toolLabel(call("ExitPlanMode", {plan: "## Plan"})),
			toolSearch: toolLabel(call("ToolSearch", {query: "select:Read"})),
		}).toStrictEqual({
			read: {verb: "Read"},
			writeCreate: {verb: "Created"},
			writeUpdate: {verb: "Updated"},
			writeUnknown: {verb: "Created"},
			edit: {verb: "Edited"},
			multiEdit: {verb: "Edited"},
			notebookEdit: {verb: "Edited"},
			grep: {verb: "Searched"},
			glob: {verb: "Searched"},
			ls: {verb: "Listed"},
			webFetch: {verb: "Fetched"},
			webSearch: {verb: "Searched web"},
			skill: {
				verb: "Ran skill",
				meta: "/git:commit",
				metaIsCode: true,
			},
			taskGet: {verb: "Read task"},
			taskList: {verb: "Listed tasks"},
			taskCreate: {verb: "Added task"},
			taskStop: {verb: "Stopped task"},
			enterPlanMode: {verb: "Started planning"},
			exitPlanMode: {verb: "Proposed plan"},
			toolSearch: {verb: "Searched tools"},
		});
	});

	it("picks the TaskUpdate verb from what the update changes", () => {
		const update = (input: Record<string, unknown>) => toolLabel(call("TaskUpdate", {taskId: "1", ...input})).verb;

		expect({
			completed: update({status: "completed"}),
			inProgress: update({status: "in_progress"}),
			pending: update({status: "pending"}),
			deleted: update({status: "deleted"}),
			otherStatus: update({status: "blocked"}),
			renamed: update({subject: "New name"}),
			updated: update({description: "More detail"}),
		}).toStrictEqual({
			completed: "Completed task",
			inProgress: "Started task",
			pending: "Reset task to pending",
			deleted: "Removed task",
			otherStatus: "Updated task status",
			renamed: "Renamed task",
			updated: "Updated task",
		});
	});

	it("says Cleared todos for an empty TodoWrite list", () => {
		expect({
			updated: toolLabel(call("TodoWrite", {todos: [{content: "a", status: "pending"}]})),
			cleared: toolLabel(call("TodoWrite", {todos: []})),
		}).toStrictEqual({
			updated: {verb: "Updated todos"},
			cleared: {verb: "Cleared todos"},
		});
	});

	it('labels AskUserQuestion "Asked" with the first header or a question count', () => {
		expect({
			one: toolLabel(
				call("AskUserQuestion", {
					questions: [{header: "Auth method", question: "Which?", options: []}],
				}),
			),
			many: toolLabel(
				call("AskUserQuestion", {
					questions: [
						{header: "A", question: "a?", options: []},
						{header: "B", question: "b?", options: []},
					],
				}),
			),
		}).toStrictEqual({
			one: {verb: "Asked", meta: "Auth method"},
			many: {verb: "Asked", meta: "2 questions"},
		});
	});

	it("names the subagent row by its description", () => {
		expect(toolLabel(call("Agent", {description: "Explore Drizzle setup"}))).toStrictEqual({
			verb: "Ran agent",
			meta: "Explore Drizzle setup",
			doneLabel: "Explore Drizzle setup",
		});
	});

	it("past-tenses a Bash description, or falls back to the command", () => {
		expect({
			described: toolLabel(call("Bash", {command: "git status", description: "Check status"})),
			bare: toolLabel(call("Bash", {command: "pnpm run build"})),
		}).toStrictEqual({
			described: {
				verb: "Ran",
				meta: "Check status",
				doneLabel: "Checked status",
			},
			bare: {
				verb: "Ran",
				meta: "pnpm run build",
				doneLabel: "pnpm run build",
			},
		});
	});

	it("labels Bash git operations from the tool result", () => {
		const git = (gitOperation: NonNullable<ToolLabelCall["resultMeta"]>["gitOperation"]) =>
			toolLabel(
				call(
					"Bash",
					{command: "git ...", description: "Run git"},
					gitOperation === undefined ? {} : {gitOperation},
				),
			);

		expect({
			committed: git({commit: {sha: "abc1234def", kind: "committed", branch: "main"}}),
			amended: git({commit: {sha: "abc1234def", kind: "amended"}}),
			cherryPicked: git({commit: {sha: "abc1234def", kind: "cherry-picked"}}),
			pushed: git({push: {branch: "feature/x"}}),
			commitAndPush: git({
				commit: {sha: "abc1234def", kind: "committed"},
				push: {branch: "main"},
			}),
			rebased: git({branch: {ref: "origin/main", action: "rebased"}}),
			merged: git({branch: {ref: "origin/main", action: "merged"}}),
			prCreated: git({
				pr: {number: 42, url: "https://github.com/o/r/pull/42", action: "created"},
			}),
			prMerged: git({pr: {number: 7, action: "merged"}}),
		}).toStrictEqual({
			committed: {verb: "Committed", meta: "abc1234"},
			amended: {verb: "Amended commit", meta: "abc1234"},
			cherryPicked: {verb: "Cherry-picked", meta: "abc1234"},
			pushed: {verb: "Pushed", meta: "feature/x"},
			commitAndPush: {verb: "Committed", meta: "abc1234"},
			rebased: {verb: "Rebased onto", meta: "origin/main"},
			merged: {verb: "Merged", meta: "origin/main"},
			prCreated: {
				verb: "Created PR",
				meta: "#42",
				metaHref: "https://github.com/o/r/pull/42",
			},
			prMerged: {verb: "Merged PR", meta: "#7"},
		});
	});

	it('uses "Server: tool name" for MCP tools and "Used {name}" for anything unknown', () => {
		expect({
			mcp: toolLabel(call("mcp__sentry__search_issues", {query: "x"})),
			pluginMcp: toolLabel(call("mcp__plugin_github_github__list_issues")),
			unknown: toolLabel(call("Frobnicate")),
		}).toStrictEqual({
			mcp: {
				verb: "Used Sentry: search issues",
			},
			pluginMcp: {
				verb: "Used Github: list issues",
			},
			unknown: {verb: "Used Frobnicate"},
		});
	});

	it("uses the generic upstream phrase table", () => {
		const verbs = (name: string) => {
			const {verb} = toolLabel(call(name));
			return verb;
		};

		expect({
			ReportFindings: verbs("ReportFindings"),
			TaskOutput: verbs("TaskOutput"),
			Monitor: verbs("Monitor"),
			LSP: verbs("LSP"),
			ListMcpResourcesTool: verbs("ListMcpResourcesTool"),
			ReadMcpResourceTool: verbs("ReadMcpResourceTool"),
			Workflow: verbs("Workflow"),
		}).toStrictEqual({
			ReportFindings: "Reported review findings",
			TaskOutput: "Read task output",
			Monitor: "Started watching background command",
			LSP: "Inspected code",
			ListMcpResourcesTool: "Listed resources",
			ReadMcpResourceTool: "Read resource",
			Workflow: "Ran workflow",
		});
	});
});

describe("toolResultMetaFrom", () => {
	it("reads the Write type and the Bash git operation through strict schemas", () => {
		expect({
			write: toolResultMetaFrom({
				type: "update",
				filePath: "/a.ts",
				content: "x",
				structuredPatch: [],
				originalFile: "y",
			}),
			git: toolResultMetaFrom({
				stdout: "",
				stderr: "",
				interrupted: false,
				isImage: false,
				gitOperation: {push: {branch: "main"}},
			}),
			badGit: toolResultMetaFrom({stdout: "", gitOperation: {push: {branch: 3}}}),
			plain: toolResultMetaFrom({stdout: "ok"}),
			text: toolResultMetaFrom("Error: nope"),
			missing: toolResultMetaFrom(undefined),
		}).toStrictEqual({
			write: {writeType: "update"},
			git: {gitOperation: {push: {branch: "main"}}},
			badGit: undefined,
			plain: undefined,
			text: undefined,
			missing: undefined,
		});
	});
});

describe("runningToolLabel", () => {
	it("gives an in-flight call the progressive form of its label", () => {
		expect({
			bashDescription: runningToolLabel(
				call("Bash", {
					command: "gh pr view 1954",
					description: "Poll PR #1954 for new activity from Don or Moh",
				}),
			),
			bashRun: runningToolLabel(call("Bash", {command: "make", description: "Run the build"})),
			bashCommit: runningToolLabel(call("Bash", {command: "git commit", description: "Commit the fix"})),
			bashWrite: runningToolLabel(call("Bash", {command: "cat > a", description: "Write the config"})),
			bashAlready: runningToolLabel(call("Bash", {command: "x", description: "Polling the API"})),
			bashCommand: runningToolLabel(call("Bash", {command: "ls -la"})),
			bashBare: runningToolLabel(call("Bash")),
			read: runningToolLabel(call("Read", {file_path: "/repo/src/cache.ts"})),
			write: runningToolLabel(call("Write", {file_path: "/a/new.ts"})),
			edit: runningToolLabel(call("Edit", {file_path: "/a/x.ts"})),
			grep: runningToolLabel(call("Grep", {pattern: "TODO"})),
			webSearch: runningToolLabel(call("WebSearch", {query: "zod"})),
			agent: runningToolLabel(call("Agent", {description: "Explore the codebase", prompt: "p"})),
			agentBare: runningToolLabel(call("Agent", {prompt: "p"})),
			skill: runningToolLabel(call("Skill", {skill: "git:commit"})),
			taskStop: runningToolLabel(call("TaskStop", {task_id: "b1"})),
			mcp: runningToolLabel(call("mcp__github__get_me")),
		}).toStrictEqual({
			bashDescription: {verb: "Running", label: "Polling PR #1954 for new activity from Don or Moh"},
			bashRun: {verb: "Running", label: "Running the build"},
			bashCommit: {verb: "Running", label: "Committing the fix"},
			bashWrite: {verb: "Running", label: "Writing the config"},
			bashAlready: {verb: "Running", label: "Polling the API"},
			bashCommand: {verb: "Running", label: "ls -la"},
			bashBare: {verb: "Running", meta: "a command"},
			read: {verb: "Reading"},
			write: {verb: "Writing"},
			edit: {verb: "Editing"},
			grep: {verb: "Searching"},
			webSearch: {verb: "Searching web"},
			agent: {verb: "Running agent", label: "Explore the codebase"},
			agentBare: {verb: "Running agent"},
			skill: {verb: "Running skill", meta: "/git:commit", metaIsCode: true},
			taskStop: {verb: "Stopping task"},
			mcp: {verb: "Using Github: get me"},
		});
	});
});
