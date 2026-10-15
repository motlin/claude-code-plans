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
			toolSearch: {verb: "Loaded tools"},
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

	it('labels AskUserQuestion "Asked" with the first header, however many questions it asks', () => {
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
			one: {verb: "Asked", meta: "Auth method", doneLabel: "Asked Auth method"},
			many: {verb: "Asked", meta: "A", doneLabel: "Asked A"},
		});
	});

	it("past-tenses a subagent description by the Bash rule, keeping one that opens with an unknown verb", () => {
		expect({
			known: toolLabel(call("Agent", {description: "Commit lazy allocation fixup"})),
			compound: toolLabel(call("Task", {description: "Test the fix and push"})),
			unknown: toolLabel(call("Agent", {description: "Open the PR form"})),
		}).toStrictEqual({
			known: {
				verb: "Ran agent",
				meta: "Commit lazy allocation fixup",
				doneLabel: "Committed lazy allocation fixup",
			},
			compound: {verb: "Ran agent", meta: "Test the fix and push", doneLabel: "Tested the fix and pushed"},
			unknown: {verb: "Ran agent", meta: "Open the PR form", doneLabel: "Open the PR form"},
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

	it('uses "server: tool name" for MCP tools, the server lowercase as upstream keeps it, and "Used {name}" for anything unknown', () => {
		expect({
			mcp: toolLabel(call("mcp__sentry__search_issues", {query: "x"})),
			hyphenatedMcp: toolLabel(call("mcp__claude-in-chrome__javascript_tool")),
			pluginMcp: toolLabel(call("mcp__plugin_github_github__list_issues")),
			unknown: toolLabel(call("Frobnicate")),
		}).toStrictEqual({
			mcp: {
				verb: "Used sentry: search issues",
			},
			hyphenatedMcp: {
				verb: "Used claude-in-chrome: javascript tool",
			},
			pluginMcp: {
				verb: "Used github: list issues",
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

describe("toolResultMetaFrom agent results", () => {
	it("reads the launched agent's id, so a later SendMessage can name its description", () => {
		expect({
			async: toolResultMetaFrom({
				isAsync: true,
				status: "async_launched",
				agentId: "ae82c2d367f9dc313",
				description: "Do next todo task",
			}),
			badId: toolResultMetaFrom({status: "completed", agentId: 7}),
		}).toStrictEqual({async: {agentId: "ae82c2d367f9dc313"}, badId: undefined});
	});
});

describe("runningToolLabel", () => {
	it("keeps a Bash description as written while the call waits on its permission prompt, as upstream does", () => {
		const input = {command: "gh pr create --draft", description: "Open draft PR for the AssertJ branch"};
		expect({
			awaiting: runningToolLabel({...call("Bash", input), awaitingPermission: true}),
			running: runningToolLabel(call("Bash", input)),
		}).toStrictEqual({
			awaiting: {verb: "Running", label: "Open draft PR for the AssertJ branch"},
			running: {verb: "Running", label: "Opening draft PR for the AssertJ branch"},
		});
	});

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
			agentKnownVerb: runningToolLabel(call("Agent", {description: "Commit the fixup", prompt: "p"})),
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
			agentKnownVerb: {verb: "Running agent", label: "Commit the fixup"},
			agentBare: {verb: "Running agent"},
			skill: {verb: "Running skill", meta: "/git:commit", metaIsCode: true},
			taskStop: {verb: "Stopping task"},
			mcp: {verb: "Using github: get me"},
		});
	});
});

describe("toolLabel Bash past tense", () => {
	const done = (description: string) => toolLabel(call("Bash", {command: "x", description})).doneLabel;

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
	])("past-tenses %j as %j", (description, expected) => {
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
	])("keeps a description whose first word is not a known verb verbatim: %j", (description) => {
		expect(done(description)).toBe(description);
	});
});

describe("SendMessage labels", () => {
	const send = (input: Record<string, unknown>, recipientDescription?: string): ToolLabelCall =>
		recipientDescription === undefined
			? {name: "SendMessage", input}
			: {name: "SendMessage", input, recipientDescription};
	const longMessage = `${"word ".repeat(20)}\n\n  and   more`;

	it("names the recipient as upstream does", () => {
		expect({
			knownAgent: toolLabel(send({to: "ae82c2d367f9dc313", message: "Finish the task"}, "Do next todo task")),
			agentSummary: toolLabel(send({to: "ae82c2d367f9dc313", summary: "ping", message: "Finish it"})),
			agentMessage: toolLabel(send({to: "a1b2c3d4e", message: longMessage})),
			agentKind: toolLabel(send({to: "worker", recipient_kind: "agent", message: "hi"})),
			teammate: toolLabel(send({to: "researcher", summary: "status?", message: "How is it going?"})),
			teammateMessage: toolLabel(send({to: "researcher", message: "How is it going?"})),
			session: toolLabel(send({to: "researcher", recipient_kind: "session", message: "hi"})),
			missing: toolLabel(send({message: "hi"})),
			did: toolLabel(send({to: "did:plc:abc", message: "hi"})),
			uds: toolLabel(send({to: "uds:/tmp/peer.sock", message: "hi"})),
			local: toolLabel(send({to: "local_0123abcd-ef", message: "hi"})),
		}).toStrictEqual({
			knownAgent: {verb: "Messaged agent", meta: "Do next todo task"},
			agentSummary: {verb: "Messaged agent", meta: "ping"},
			agentMessage: {verb: "Messaged agent", meta: `${"word ".repeat(15).trim()} word…`},
			agentKind: {verb: "Messaged agent", meta: "hi"},
			teammate: {verb: "Messaged @researcher", meta: "status?"},
			teammateMessage: {verb: "Messaged @researcher", meta: "How is it going?"},
			session: {verb: "Messaged another session"},
			missing: {verb: "Messaged another session"},
			did: {verb: "Messaged another session"},
			uds: {verb: "Messaged another session"},
			local: {verb: "Messaged another session"},
		});
	});

	it("names plan approvals and shutdown handshakes", () => {
		expect({
			approved: toolLabel(
				send({to: "planner", message: {type: "plan_approval_response", request_id: "r1", approve: true}}),
			),
			rejected: toolLabel(
				send({
					to: "planner",
					message: {
						type: "plan_approval_response",
						request_id: "r1",
						approve: false,
						feedback: "Split it up",
					},
				}),
			),
			shutdown: toolLabel(send({to: "worker", message: {type: "shutdown_request", reason: "Done for today"}})),
			shutdownApproved: toolLabel(
				send({to: "lead", message: {type: "shutdown_response", request_id: "r2", approve: true}}),
			),
			shutdownDeclined: toolLabel(
				send({to: "lead", message: {type: "shutdown_response", request_id: "r2", approve: "false"}}),
			),
		}).toStrictEqual({
			approved: {verb: "Approved plan from @planner"},
			rejected: {verb: "Rejected plan from @planner", meta: "Split it up"},
			shutdown: {verb: "Asked @worker to shut down", meta: "Done for today"},
			shutdownApproved: {verb: "Approved shutdown request from @lead"},
			shutdownDeclined: {verb: "Declined shutdown request from @lead"},
		});
	});

	it("gives an in-flight message the progressive verb", () => {
		expect({
			agent: runningToolLabel(send({to: "ae82c2d367f9dc313", message: "go"}, "Do next todo task")),
			teammate: runningToolLabel(send({to: "researcher", message: "hi"})),
			session: runningToolLabel(send({message: "hi"})),
			plan: runningToolLabel(
				send({to: "planner", message: {type: "plan_approval_response", request_id: "r1", approve: true}}),
			),
		}).toStrictEqual({
			agent: {verb: "Messaging agent", meta: "Do next todo task"},
			teammate: {verb: "Messaging @researcher", meta: "hi"},
			session: {verb: "Messaging another session"},
			plan: {verb: "Approving plan from @planner"},
		});
	});
});
