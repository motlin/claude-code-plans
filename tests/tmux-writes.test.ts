import {afterEach, describe, expect, it} from "vite-plus/test";
import type {ActiveSessionEntry} from "../src/lib/active-session-store";
import {sessionAnswerRoute} from "../src/hooks/use-question-answer-route";
import {clearAllPendingQuestions, setPendingQuestion} from "../src/lib/pending-question-store";
import {createTmuxTerminalHost, resolveTerminalHost} from "../src/lib/terminal-host";
import {createTmuxPaneTable} from "../src/lib/tmux/pane-table";
import type {TmuxSessionPaneSources} from "../src/lib/tmux/session-panes";
import {readTmuxScreen, tmuxKeyName, type TmuxWriteIo} from "../src/lib/tmux/writes";
import type {HerdrPaneIndexData} from "../src/lib/api/herdr";

const SOCKET = "/private/tmp/tmux-501/default";
const SESSION_ID = "session-test-tmux-1";

function entry(overrides: Partial<ActiveSessionEntry> = {}): ActiveSessionEntry {
	return {
		sessionId: SESSION_ID,
		state: "idle",
		cwd: "/tmp/test/alice-project",
		model: "claude-test-model",
		startedAt: 0,
		lastActivity: 0,
		claudeEnv: {},
		tmuxPane: "%7",
		tmuxServerSocket: SOCKET,
		herdrPane: "",
		herdrWorkspace: "",
		herdrSocketPath: "",
		lastSubagentActivityAt: null,
		backgroundTasks: [],
		...overrides,
	};
}

function paneLine(paneId: string, panePid: number): string {
	return [paneId, String(panePid), SOCKET, "main", "0", "zsh", "1", "1", "/tmp/test"].join("\t");
}

/** Sources whose entry and pane list can change between calls, as a live tmux server would. */
function liveSources(initial: ActiveSessionEntry): {
	sources: TmuxSessionPaneSources;
	set: (next: {entry?: ActiveSessionEntry | null; panes?: string}) => void;
} {
	let current: ActiveSessionEntry | null = initial;
	let panes = paneLine("%7", 700);
	return {
		sources: {
			entries: () => (current === null ? [] : [current]),
			registry: () => [],
			listPanes: async () => Promise.resolve(panes),
			processTable: async () => Promise.resolve(""),
		},
		set: (next) => {
			if (next.entry !== undefined) current = next.entry;
			if (next.panes !== undefined) panes = next.panes;
		},
	};
}

function recordingIo(onRun?: (args: readonly string[]) => void): {io: TmuxWriteIo; calls: string[][]} {
	const calls: string[][] = [];
	return {
		calls,
		io: {
			run: async (args) => {
				calls.push([...args]);
				onRun?.(args);
				return Promise.resolve();
			},
			pause: async () => Promise.resolve(),
			writesEnabled: () => true,
			createBufferName: () => "ccp-test-buffer",
		},
	};
}

function post(path: string, body: unknown): Request {
	return new Request(`http://127.0.0.1:7526${path}`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(body),
	});
}

async function describeResponse(response: Response): Promise<{status: number; body: unknown}> {
	return {status: response.status, body: await response.json()};
}

afterEach(() => {
	clearAllPendingQuestions();
});

describe("tmuxKeyName", () => {
	it("maps the herdr key names ccp sends to tmux send-keys names, and refuses others", () => {
		expect(
			["esc", "enter", "tab", "shift+tab", "down", "up", "ctrl+c", "1", "9", "f13", "ctrl+shift+x", ""].map(
				tmuxKeyName,
			),
		).toStrictEqual(["Escape", "Enter", "Tab", "BTab", "Down", "Up", "C-c", "1", "9", null, null, null]);
	});
});

describe("tmux host writes", () => {
	it("types a prompt into the session's pane as literal text, then Enter, while the session is idle", async () => {
		const {sources} = liveSources(entry());
		const {io, calls} = recordingIo();
		const host = createTmuxTerminalHost(sources, io);

		const response = await host.prompt(post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "run the tests"}));

		expect({response: await describeResponse(response), canWrite: host.canWrite, calls}).toStrictEqual({
			response: {status: 200, body: {ok: true}},
			canWrite: true,
			calls: [
				["-S", SOCKET, "send-keys", "-t", "%7", "-l", "--", "run the tests"],
				["-S", SOCKET, "send-keys", "-t", "%7", "Enter"],
			],
		});
	});

	it("pastes a multi-line prompt with bracketed paste so its newlines do not submit early", async () => {
		const {sources} = liveSources(entry());
		const {io, calls} = recordingIo();
		const host = createTmuxTerminalHost(sources, io);

		const response = await host.prompt(post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "one\ntwo"}));

		expect({status: response.status, calls}).toStrictEqual({
			status: 200,
			calls: [
				["-S", SOCKET, "set-buffer", "-b", "ccp-test-buffer", "--", "one\ntwo"],
				["-S", SOCKET, "paste-buffer", "-p", "-d", "-b", "ccp-test-buffer", "-t", "%7"],
				["-S", SOCKET, "send-keys", "-t", "%7", "Enter"],
			],
		});
	});

	it("refuses a prompt with agent_not_ready unless the hook says idle, typing nothing", async () => {
		const results: unknown[] = [];
		for (const state of ["working", "waiting", "unknown"] as const) {
			const {sources} = liveSources(entry({state}));
			const {io, calls} = recordingIo();
			const response = await createTmuxTerminalHost(sources, io).prompt(
				post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "hi"}),
			);
			results.push({state, response: await describeResponse(response), calls});
		}

		expect(results).toStrictEqual(
			["working", "waiting", "unknown"].map((state) => ({
				state,
				response: {
					status: 409,
					body: {error: `The session is ${state}; tmux input needs it idle`, code: "agent_not_ready"},
				},
				calls: [],
			})),
		);
	});

	it("types a mid-turn prompt right after a skipped question while the hook says working with no dialog", async () => {
		const {sources} = liveSources(entry({state: "working"}));
		const {io, calls} = recordingIo();

		const response = await createTmuxTerminalHost(sources, io).prompt(
			post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "use the second plan", midTurn: true}),
		);

		expect({response: await describeResponse(response), calls}).toStrictEqual({
			response: {status: 200, body: {ok: true}},
			calls: [
				["-S", SOCKET, "send-keys", "-t", "%7", "-l", "--", "use the second plan"],
				["-S", SOCKET, "send-keys", "-t", "%7", "Enter"],
			],
		});
	});

	it("pastes a multi-line mid-turn prompt through a tmux paste buffer, re-checking readiness before the paste and before Enter", async () => {
		const {sources} = liveSources(entry({state: "working"}));
		const listings: string[] = [];
		const {io, calls} = recordingIo();
		const host = createTmuxTerminalHost(
			{
				...sources,
				listPanes: async (socket) => {
					listings.push(`list-panes after ${calls.length} commands`);
					return sources.listPanes(socket);
				},
			},
			io,
		);

		const response = await host.prompt(
			post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "one\ntwo", midTurn: true}),
		);

		expect({response: await describeResponse(response), calls, listings}).toStrictEqual({
			response: {status: 200, body: {ok: true}},
			calls: [
				["-S", SOCKET, "set-buffer", "-b", "ccp-test-buffer", "--", "one\ntwo"],
				["-S", SOCKET, "paste-buffer", "-p", "-d", "-b", "ccp-test-buffer", "-t", "%7"],
				["-S", SOCKET, "send-keys", "-t", "%7", "Enter"],
			],
			listings: ["list-panes after 0 commands", "list-panes after 0 commands", "list-panes after 2 commands"],
		});
	});

	it("refuses a mid-turn prompt while a question or permission waits or the state is not working, typing nothing", async () => {
		const cases = [
			{name: "question", entry: entry({state: "working"}), question: true},
			{name: "waiting", entry: entry({state: "waiting"}), question: false},
			{
				name: "permission",
				entry: entry({state: "working", pendingPermissionRequest: {toolName: "Bash", suggestions: []}}),
				question: false,
			},
			{name: "unknown", entry: entry({state: "unknown"}), question: false},
		];
		const results: unknown[] = [];
		for (const testCase of cases) {
			clearAllPendingQuestions();
			if (testCase.question) {
				setPendingQuestion(SESSION_ID, {
					toolUseId: "toolu_test_1",
					questions: [{question: "Which plan?", options: [{label: "First"}]}],
				});
			}
			const {sources} = liveSources(testCase.entry);
			const {io, calls} = recordingIo();
			const response = await createTmuxTerminalHost(sources, io).prompt(
				post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "hi", midTurn: true}),
			);
			results.push({name: testCase.name, status: response.status, calls});
		}

		expect(results).toStrictEqual(
			["question", "waiting", "permission", "unknown"].map((name) => ({name, status: 409, calls: []})),
		);
	});

	it("types a mid-turn prompt the usual way once the session is idle", async () => {
		const {sources} = liveSources(entry({state: "idle"}));
		const {io, calls} = recordingIo();

		const response = await createTmuxTerminalHost(sources, io).prompt(
			post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "one\ntwo", midTurn: true}),
		);

		expect({status: response.status, calls}).toStrictEqual({
			status: 200,
			calls: [
				["-S", SOCKET, "set-buffer", "-b", "ccp-test-buffer", "--", "one\ntwo"],
				["-S", SOCKET, "paste-buffer", "-p", "-d", "-b", "ccp-test-buffer", "-t", "%7"],
				["-S", SOCKET, "send-keys", "-t", "%7", "Enter"],
			],
		});
	});

	it("refuses a write when no hook has reported the session's state", async () => {
		const {sources, set} = liveSources(entry());
		const host = createTmuxTerminalHost(
			{...sources, registry: () => [{sessionId: SESSION_ID, pid: 700, cwd: "/tmp/test"}]},
			recordingIo().io,
		);
		set({entry: null});

		const response = await host.interrupt(post("/api/herdr/interrupt", {sessionId: SESSION_ID}));

		expect(await describeResponse(response)).toStrictEqual({
			status: 409,
			body: {error: "No hook has reported this session's state; tmux input refuses to type blind"},
		});
	});

	it("interrupts a working session with Escape, or ctrl+c when forced, and refuses an idle one", async () => {
		const {sources, set} = liveSources(entry({state: "working"}));
		const {io, calls} = recordingIo();
		const host = createTmuxTerminalHost(sources, io);

		const esc = await host.interrupt(post("/api/herdr/interrupt", {sessionId: SESSION_ID}));
		const force = await host.interrupt(post("/api/herdr/interrupt", {sessionId: SESSION_ID, force: true}));
		set({entry: entry({state: "idle"})});
		const idle = await host.interrupt(post("/api/herdr/interrupt", {sessionId: SESSION_ID}));

		expect({
			esc: esc.status,
			force: force.status,
			idle: await describeResponse(idle),
			calls,
		}).toStrictEqual({
			esc: 200,
			force: 200,
			idle: {status: 409, body: {error: "The session is idle; tmux input needs it working or waiting"}},
			calls: [
				["-S", SOCKET, "send-keys", "-t", "%7", "Escape"],
				["-S", SOCKET, "send-keys", "-t", "%7", "C-c"],
			],
		});
	});

	it("answers a pending question with the dialog keys and Other text, only while the session waits", async () => {
		setPendingQuestion(SESSION_ID, {
			toolUseId: "toolu_test_1",
			questions: [{question: "Which runner?", options: [{label: "Vitest"}, {label: "Jest"}]}],
		});
		const {sources} = liveSources(entry({state: "waiting"}));
		const {io, calls} = recordingIo();
		const host = createTmuxTerminalHost(sources, io);

		const response = await host.answerQuestion(
			post("/api/herdr/question", {
				sessionId: SESSION_ID,
				toolUseId: "toolu_test_1",
				answers: [{selected: [], other: "Mocha"}],
			}),
		);

		expect({response: await describeResponse(response), calls}).toStrictEqual({
			response: {status: 200, body: {ok: true}},
			calls: [
				["-S", SOCKET, "send-keys", "-t", "%7", "3"],
				["-S", SOCKET, "send-keys", "-t", "%7", "-l", "--", "Mocha"],
				["-S", SOCKET, "send-keys", "-t", "%7", "Enter"],
			],
		});
	});

	it("stops typing a question answer when the session's pane moves on mid-answer", async () => {
		setPendingQuestion(SESSION_ID, {
			toolUseId: "toolu_test_2",
			questions: [{question: "Which runner?", options: [{label: "Vitest"}, {label: "Jest"}]}],
		});
		const live = liveSources(entry({state: "waiting"}));
		const {io, calls} = recordingIo(() => {
			// After the first key, the session resumes elsewhere: %7 now belongs to nobody.
			live.set({
				entry: entry({state: "waiting", tmuxPane: "%9"}),
				panes: [paneLine("%7", 700), paneLine("%9", 900)].join("\n"),
			});
		});
		const host = createTmuxTerminalHost(live.sources, io);

		const response = await host.answerQuestion(
			post("/api/herdr/question", {
				sessionId: SESSION_ID,
				toolUseId: "toolu_test_2",
				answers: [{selected: [], other: "Mocha"}],
			}),
		);

		expect({response: await describeResponse(response), calls}).toStrictEqual({
			response: {status: 502, body: {error: "The session's tmux pane moved on from %7"}},
			calls: [["-S", SOCKET, "send-keys", "-t", "%7", "3"]],
		});
	});

	it("applies a model change as a /model prompt and a mode change as BTab presses, while idle", async () => {
		const {sources} = liveSources(entry());
		const {io, calls} = recordingIo();
		const host = createTmuxTerminalHost(sources, io);

		const model = await host.applyLiveOption(
			post("/api/herdr/live-option", {sessionId: SESSION_ID, change: {kind: "model", model: "opus"}}),
		);
		const mode = await host.applyLiveOption(
			post("/api/herdr/live-option", {sessionId: SESSION_ID, change: {kind: "mode", presses: 2}}),
		);

		expect({model: model.status, mode: mode.status, calls}).toStrictEqual({
			model: 200,
			mode: 200,
			calls: [
				["-S", SOCKET, "send-keys", "-t", "%7", "-l", "--", "/model opus"],
				["-S", SOCKET, "send-keys", "-t", "%7", "Enter"],
				["-S", SOCKET, "send-keys", "-t", "%7", "BTab", "BTab"],
			],
		});
	});

	it("refuses every write while Live terminal input is off", async () => {
		const {sources} = liveSources(entry());
		const {io, calls} = recordingIo();
		const host = createTmuxTerminalHost(sources, {...io, writesEnabled: () => false});

		const response = await host.prompt(post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "hi"}));

		expect({response: await describeResponse(response), calls}).toStrictEqual({
			response: {status: 403, body: {error: "herdr writes are disabled"}},
			calls: [],
		});
	});

	it("refuses a session that has no tmux pane", async () => {
		const {sources, set} = liveSources(entry());
		set({panes: paneLine("%3", 300)});
		const {io, calls} = recordingIo();

		const response = await createTmuxTerminalHost(sources, io).prompt(
			post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "hi"}),
		);

		expect({response: await describeResponse(response), calls}).toStrictEqual({
			response: {
				status: 502,
				body: {error: "session is not attached to a live tmux pane", code: "session-not-found"},
			},
			calls: [],
		});
	});
});

describe("tmux host writes with the poller's pane table", () => {
	function tableSaying(paneId: string, panePid: number) {
		const table = createTmuxPaneTable();
		table.hold([
			{
				sessionId: SESSION_ID,
				cwd: "/tmp/test/alice-project",
				via: "env",
				pane: {
					paneId,
					panePid,
					socketPath: SOCKET,
					sessionName: "main",
					windowIndex: 0,
					windowName: "zsh",
					windowActive: true,
					paneActive: true,
					currentPath: "/tmp/test",
				},
			},
		]);
		return table;
	}

	function countingSources(paneTable: ReturnType<typeof createTmuxPaneTable>, panes: string) {
		const listed: Array<string | null> = [];
		const sources: TmuxSessionPaneSources = {
			entries: () => [entry({tmuxPane: "%8"})],
			registry: () => [],
			listPanes: async (socket) => {
				listed.push(socket);
				return Promise.resolve(panes);
			},
			processTable: async () => Promise.resolve(""),
			paneTable,
		};
		return {sources, listed};
	}

	it("finds the write target in the table, then re-resolves with tmux right before typing", async () => {
		const {sources, listed} = countingSources(tableSaying("%8", 800), paneLine("%8", 800));
		const {io, calls} = recordingIo();

		const response = await createTmuxTerminalHost(sources, io).prompt(
			post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "hi"}),
		);

		expect({response: await describeResponse(response), listed, calls}).toStrictEqual({
			response: {status: 200, body: {ok: true}},
			listed: [null],
			calls: [
				["-S", SOCKET, "send-keys", "-t", "%8", "-l", "--", "hi"],
				["-S", SOCKET, "send-keys", "-t", "%8", "Enter"],
			],
		});
	});

	it("refuses to type when tmux says the pane moved on since the table's poll", async () => {
		const {sources} = countingSources(tableSaying("%7", 700), paneLine("%8", 800));
		const {io, calls} = recordingIo();

		const response = await createTmuxTerminalHost(sources, io).prompt(
			post("/api/herdr/prompt", {sessionId: SESSION_ID, prompt: "hi"}),
		);

		expect({status: response.status, calls}).toStrictEqual({status: 502, calls: []});
	});
});

describe("answer routing for tmux sessions", () => {
	it("resolves the tmux host for the tmux setting, which can write and stream", async () => {
		const host = await resolveTerminalHost("tmux", {
			herdrAvailable: async () => Promise.resolve(true),
			tmuxAvailable: async () => Promise.resolve(true),
		});

		expect({id: host.id, canWrite: host.canWrite, canStream: host.canStream}).toStrictEqual({
			id: "tmux",
			canWrite: true,
			canStream: true,
		});
	});

	it("routes a live session's question card to its tmux pane when writes are on", () => {
		const herdr: HerdrPaneIndexData = {
			panes: [
				{
					host: "tmux",
					paneId: "%7",
					terminalId: `tmux:${SOCKET}:%7`,
					workspaceId: "main",
					tabId: "main:0",
					focused: true,
					cwd: "/tmp/test",
					foregroundCwd: "/tmp/test",
					agentStatus: "unknown",
					agent: "claude",
					terminalTitle: "zsh",
					agentSessionId: null,
					revision: 0,
					sessionId: SESSION_ID,
					via: "env",
					viewedState: {
						currentMessageIndex: 0,
						lastViewedMessageIndex: 0,
						reviewTargetMessageIndex: 0,
						newMessageCount: 0,
						viewedInCcp: true,
						viewedInHerdr: false,
						viewedAnywhere: true,
					},
				},
			],
			writesEnabled: true,
		};

		expect(
			[true, false].map((writesEnabled) =>
				sessionAnswerRoute({
					sessionId: SESSION_ID,
					hookActive: true,
					summary: {state: "waiting"},
					herdr: {...herdr, writesEnabled},
				}),
			),
		).toStrictEqual(["live-pane", "read-only"]);
	});
});

describe("tmux plan approval", () => {
	it("reads the pane's visible screen with capture-pane, refusing a pane that moved on", async () => {
		const {sources} = liveSources(entry({state: "waiting"}));
		const captures: string[][] = [];
		const capture = async (args: readonly string[]) => {
			captures.push([...args]);
			return Promise.resolve("screen text");
		};
		expect({
			current: await readTmuxScreen(SESSION_ID, "%7", sources, capture),
			moved: await readTmuxScreen(SESSION_ID, "%8", sources, capture),
			captures,
		}).toStrictEqual({
			current: {ok: true, value: "screen text"},
			moved: {ok: false, code: "pane-moved", message: "The session's tmux pane moved on from %8"},
			captures: [["-S", SOCKET, "capture-pane", "-p", "-t", "%7"]],
		});
	});

	it("refuses to answer when the session's hook state has no pending ExitPlanMode", async () => {
		const {sources} = liveSources(
			entry({state: "waiting", pendingPermissionRequest: {toolName: "Bash", suggestions: []}}),
		);
		const {io, calls} = recordingIo();
		const response = await createTmuxTerminalHost(sources, io).answerPlan(
			post("/api/herdr/plan", {sessionId: SESSION_ID, decision: {kind: "accept", mode: "auto"}}),
		);
		expect({response: await describeResponse(response), calls}).toStrictEqual({
			response: {status: 409, body: {error: "No plan approval is pending"}},
			calls: [],
		});
	});
});
