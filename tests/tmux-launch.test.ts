import {describe, expect, it} from "vite-plus/test";
import {createTmuxTerminalHost} from "../src/lib/terminal-host";
import {
	chooseTmuxLaunchSession,
	launchClaudeInTmux,
	type TmuxLaunchIo,
	type TmuxLaunchTarget,
} from "../src/lib/tmux/launch";
import type {TmuxSessionPaneSources} from "../src/lib/tmux/session-panes";
import type {TmuxWriteIo} from "../src/lib/tmux/writes";

const CWD = "/tmp/test/alice-project";
const NEW_WINDOW_OUTPUT = "@12\t%34\n";

const LIST_CLIENTS = ["list-clients", "-F", "#{client_activity}\t#{client_control_mode}\t#{client_session}"];
const LIST_SESSIONS = ["list-sessions", "-F", "#{session_name}"];
const PRINT_IDS = ["-P", "-F", "#{window_id}\t#{pane_id}"];

/** A fake tmux: each subcommand answers from `outputs`, or fails like tmux with no server when absent. */
function fakeTmux(outputs: Partial<Record<string, string>>): {io: TmuxLaunchIo; calls: string[][]} {
	const calls: string[][] = [];
	return {
		calls,
		io: {
			output: async (args) => {
				calls.push([...args]);
				const output = outputs[args[0] ?? ""];
				return output === undefined
					? Promise.reject(new Error("no server running on /private/tmp/tmux-501/default"))
					: Promise.resolve(output);
			},
		},
	};
}

describe("chooseTmuxLaunchSession", () => {
	it("picks the session of the most recently active client", async () => {
		const {io, calls} = fakeTmux({
			"list-clients": "1760600000\t0\twork\n1760600300\t0\tside project\n1760600100\t0\tmain\n",
		});

		expect({target: await chooseTmuxLaunchSession(io), calls}).toStrictEqual({
			target: {session: "side project", exists: true} satisfies TmuxLaunchTarget,
			calls: [LIST_CLIENTS],
		});
	});

	it("skips control-mode clients, such as ccp's own live terminal streams", async () => {
		const {io, calls} = fakeTmux({
			"list-clients": "1760600000\t0\twork\n1760600900\t1\twatched\n",
		});

		expect({target: await chooseTmuxLaunchSession(io), calls}).toStrictEqual({
			target: {session: "work", exists: true} satisfies TmuxLaunchTarget,
			calls: [LIST_CLIENTS],
		});
	});

	it("falls back to the claude session when only control-mode clients are attached", async () => {
		const {io, calls} = fakeTmux({"list-clients": "1760600900\t1\twatched\n", "list-sessions": "watched\n"});

		expect({target: await chooseTmuxLaunchSession(io), calls}).toStrictEqual({
			target: {session: "claude", exists: false} satisfies TmuxLaunchTarget,
			calls: [LIST_CLIENTS, LIST_SESSIONS],
		});
	});

	it("falls back to an existing detached claude session when no client is attached", async () => {
		const {io, calls} = fakeTmux({"list-clients": "", "list-sessions": "work\nclaude\n"});

		expect({target: await chooseTmuxLaunchSession(io), calls}).toStrictEqual({
			target: {session: "claude", exists: true} satisfies TmuxLaunchTarget,
			calls: [LIST_CLIENTS, LIST_SESSIONS],
		});
	});

	it("creates the claude session when no client is attached and it is missing", async () => {
		const {io, calls} = fakeTmux({"list-clients": "", "list-sessions": "work\nclaude-old\n"});

		expect({target: await chooseTmuxLaunchSession(io), calls}).toStrictEqual({
			target: {session: "claude", exists: false} satisfies TmuxLaunchTarget,
			calls: [LIST_CLIENTS, LIST_SESSIONS],
		});
	});

	it("creates the claude session when no tmux server is running", async () => {
		const {io, calls} = fakeTmux({});

		expect({target: await chooseTmuxLaunchSession(io), calls}).toStrictEqual({
			target: {session: "claude", exists: false} satisfies TmuxLaunchTarget,
			calls: [LIST_CLIENTS, LIST_SESSIONS],
		});
	});
});

describe("launchClaudeInTmux", () => {
	it("opens a detached window in the active client's session running the herdr launch's command line", async () => {
		const {io, calls} = fakeTmux({"list-clients": "1760600300\t0\twork\n", "new-window": NEW_WINDOW_OUTPUT});

		const result = await launchClaudeInTmux(
			{cwd: CWD, prompt: "Fix the bug\nit's in main.ts", args: ["--model", "opus", "--effort", "high"]},
			io,
		);

		expect({result, calls}).toStrictEqual({
			result: {ok: true, value: {tabId: "@12", paneId: "%34", sessionId: null}},
			calls: [
				LIST_CLIENTS,
				[
					"new-window",
					"-d",
					"-t",
					"work:",
					"-c",
					CWD,
					...PRINT_IDS,
					"claude --model opus --effort high 'Fix the bug\nit'\\''s in main.ts'",
				],
			],
		});
	});

	it("starts a detached claude session running the fork when none exists", async () => {
		const {io, calls} = fakeTmux({"new-session": NEW_WINDOW_OUTPUT});

		const result = await launchClaudeInTmux({cwd: CWD, args: ["--resume", "session-test-1", "--fork-session"]}, io);

		expect({result, calls}).toStrictEqual({
			result: {ok: true, value: {tabId: "@12", paneId: "%34", sessionId: null}},
			calls: [
				LIST_CLIENTS,
				LIST_SESSIONS,
				[
					"new-session",
					"-d",
					"-s",
					"claude",
					"-c",
					CWD,
					...PRINT_IDS,
					"claude --resume session-test-1 --fork-session",
				],
			],
		});
	});

	it("reports a tmux failure and output it cannot read", async () => {
		const failed = await launchClaudeInTmux({cwd: CWD}, fakeTmux({"list-sessions": "claude\n"}).io);
		const unreadable = await launchClaudeInTmux(
			{cwd: CWD},
			fakeTmux({"list-sessions": "claude\n", "new-window": "garbage\n"}).io,
		);

		expect({failed, unreadable}).toStrictEqual({
			failed: {ok: false, code: "tmux-failed", message: "no server running on /private/tmp/tmux-501/default"},
			unreadable: {ok: false, code: "bad-response", message: "tmux did not print the new window's ids"},
		});
	});
});

describe("tmux host launch", () => {
	const sources: TmuxSessionPaneSources = {
		entries: () => [],
		registry: () => [],
		listPanes: async () => Promise.resolve(""),
		processTable: async () => Promise.resolve(""),
	};

	function writeIo(writesEnabled: boolean): TmuxWriteIo {
		return {
			run: async () => Promise.resolve(),
			pause: async () => Promise.resolve(),
			writesEnabled: () => writesEnabled,
			createBufferName: () => "ccp-test-buffer",
		};
	}

	function launchRequest(body: unknown): Request {
		return new Request("http://127.0.0.1:7526/api/herdr/launch", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify(body),
		});
	}

	it("answers the launch API with the new window and pane", async () => {
		const {io, calls} = fakeTmux({"list-clients": "1760600300\t0\twork\n", "new-window": NEW_WINDOW_OUTPUT});
		const response = await createTmuxTerminalHost(sources, writeIo(true), io).launch(
			launchRequest({cwd: CWD, prompt: "hello"}),
		);

		expect({status: response.status, body: await response.json(), calls}).toStrictEqual({
			status: 200,
			body: {ok: true, tabId: "@12", paneId: "%34", sessionId: null},
			calls: [LIST_CLIENTS, ["new-window", "-d", "-t", "work:", "-c", CWD, ...PRINT_IDS, "claude 'hello'"]],
		});
	});

	it("refuses to launch while Live terminal input is off, without running tmux", async () => {
		const {io, calls} = fakeTmux({"list-clients": "1760600300\t0\twork\n", "new-window": NEW_WINDOW_OUTPUT});
		const response = await createTmuxTerminalHost(sources, writeIo(false), io).launch(launchRequest({cwd: CWD}));

		expect({status: response.status, body: await response.json(), calls}).toStrictEqual({
			status: 403,
			body: {error: "herdr writes are disabled"},
			calls: [],
		});
	});

	it("answers 502 when tmux fails", async () => {
		const {io} = fakeTmux({"list-sessions": "claude\n"});
		const response = await createTmuxTerminalHost(sources, writeIo(true), io).launch(launchRequest({cwd: CWD}));

		expect({status: response.status, body: await response.json()}).toStrictEqual({
			status: 502,
			body: {error: "no server running on /private/tmp/tmux-501/default"},
		});
	});
});
