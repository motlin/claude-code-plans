import {describe, expect, it} from "vite-plus/test";
import {markSessionActive, markSessionEnded, setSessionState} from "../src/lib/active-session-store";
import {
	buildRewindFilesCommand,
	defaultRewindFilesDependencies,
	handleRewindFiles,
	parseRewindFilesResult,
	type RewindFilesDependencies,
	type RewindFilesRun,
} from "../src/lib/rewind-files";
import {rejectCrossSite} from "../src/lib/same-origin-guard";

const SESSION = "b80e9253-e2d9-4bfb-a09d-bff56f80ddce";
const MESSAGE = "2beb107c-74ea-43d9-b616-7057300e4f96";
const CWD = "/Users/someone/project";

/** Output of `claude --resume … --rewind-files …` as CLI 2.1.310 printed it in a throwaway session. */
const REWOUND = {code: 0, stdout: `Files rewound to state at message ${MESSAGE}\n`, stderr: ""};
const SKIPPED = {
	code: 0,
	stdout: `Files rewound to state at message ${MESSAGE}\n`,
	stderr: "Warning: 2 tracked paths were skipped: the tracked path is (or became) a link or other non-regular file, its directory changed since the checkpoint, or its backup could not be safely read. Run with --debug for the paths.\n",
};
const NOT_ENABLED = {code: 1, stdout: "", stderr: "Error: File rewinding is not enabled.\n"};
const NO_CHECKPOINT = {code: 1, stdout: "", stderr: "Error: No file checkpoint found for this message.\n"};
const NOT_A_USER_MESSAGE = {
	code: 1,
	stdout: "",
	stderr: `Error: --rewind-files requires a user message UUID, but ${MESSAGE} is not a user message in this session\n`,
};

describe("buildRewindFilesCommand", () => {
	it("resumes the session with --rewind-files from its cwd, with SDK file checkpointing on", () => {
		expect(buildRewindFilesCommand({sessionId: SESSION, message: MESSAGE, cwd: CWD})).toStrictEqual({
			command: "claude",
			args: ["--resume", SESSION, "--rewind-files", MESSAGE],
			cwd: CWD,
			env: {CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1"},
		});
	});
});

describe("parseRewindFilesResult", () => {
	it("reads a restore", () => {
		expect(parseRewindFilesResult(REWOUND)).toStrictEqual({kind: "restored", skipped: 0});
	});

	it("reads the skipped-path count from the warning", () => {
		expect([
			parseRewindFilesResult(SKIPPED),
			parseRewindFilesResult({...SKIPPED, stderr: "Warning: 1 tracked path was skipped: …\n"}),
		]).toStrictEqual([
			{kind: "restored", skipped: 2},
			{kind: "restored", skipped: 1},
		]);
	});

	it("tells checkpointing being off from a message without a checkpoint", () => {
		expect([
			parseRewindFilesResult(NOT_ENABLED),
			parseRewindFilesResult(NO_CHECKPOINT),
			parseRewindFilesResult(NOT_A_USER_MESSAGE),
			parseRewindFilesResult({code: null, stdout: "", stderr: ""}),
		]).toStrictEqual([
			{kind: "not-enabled"},
			{kind: "no-checkpoint"},
			{
				kind: "failed",
				message: `--rewind-files requires a user message UUID, but ${MESSAGE} is not a user message in this session`,
			},
			{kind: "failed", message: "claude exited without restoring the files"},
		]);
	});
});

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
	return new Request(`http://127.0.0.1:7526/api/sessions/${SESSION}/rewind-files`, {
		method: "POST",
		headers: {"Content-Type": "application/json", ...headers},
		body: JSON.stringify(body),
	});
}

function dependencies(
	result: RewindFilesRun | Promise<RewindFilesRun>,
	overrides: Partial<RewindFilesDependencies> = {},
): RewindFilesDependencies & {runs: unknown[]} {
	const runs: unknown[] = [];
	return {
		runs,
		rejectRequest: rejectCrossSite,
		findCwd: (sessionId) => (sessionId === SESSION ? CWD : null),
		ready: () => true,
		run: async (command) => {
			runs.push(command);
			return result;
		},
		...overrides,
	};
}

async function answer(response: Response): Promise<{status: number; body: unknown}> {
	return {status: response.status, body: await response.json()};
}

describe("handleRewindFiles", () => {
	it("runs the command and answers with the skipped count", async () => {
		const deps = dependencies(SKIPPED);
		expect(await answer(await handleRewindFiles(SESSION, postRequest({message: MESSAGE}), deps))).toStrictEqual({
			status: 200,
			body: {restored: true, skipped: 2},
		});
		expect(deps.runs).toStrictEqual([buildRewindFilesCommand({sessionId: SESSION, message: MESSAGE, cwd: CWD})]);
	});

	it("refuses while the pane is working, without running anything", async () => {
		const deps = dependencies(REWOUND, {ready: () => false});
		expect(await answer(await handleRewindFiles(SESSION, postRequest({message: MESSAGE}), deps))).toStrictEqual({
			status: 409,
			body: {error: "Rewind is unavailable while Claude is working"},
		});
		expect(deps.runs).toStrictEqual([]);
	});

	it("maps a failed restore to upstream's copy with the reason", async () => {
		const results = [];
		for (const result of [NOT_ENABLED, NO_CHECKPOINT, NOT_A_USER_MESSAGE]) {
			results.push(
				await answer(await handleRewindFiles(SESSION, postRequest({message: MESSAGE}), dependencies(result))),
			);
		}
		const error = "Couldn’t restore the code from this point. Try again.";
		expect(results).toStrictEqual([
			{status: 422, body: {error, reason: "not-enabled"}},
			{status: 422, body: {error, reason: "no-checkpoint"}},
			{status: 422, body: {error, reason: "failed"}},
		]);
	});

	it("refuses a second restore for the session while one is running", async () => {
		let finish: (result: RewindFilesRun) => void = () => undefined;
		const pending = new Promise<RewindFilesRun>((resolve) => {
			finish = resolve;
		});
		const deps = dependencies(pending);
		const first = handleRewindFiles(SESSION, postRequest({message: MESSAGE}), deps);
		const second = await answer(await handleRewindFiles(SESSION, postRequest({message: MESSAGE}), deps));
		finish(REWOUND);
		expect([second, await answer(await first), deps.runs.length]).toStrictEqual([
			{
				status: 409,
				body: {
					error: "Restoring the code is taking longer than expected. Your files may still change.",
					inFlight: true,
				},
			},
			{status: 200, body: {restored: true, skipped: 0}},
			1,
		]);
	});

	it("rejects a message that is not a UUID, an unknown session and a cross-site post", async () => {
		const deps = dependencies(REWOUND);
		const results = [
			await answer(await handleRewindFiles(SESSION, postRequest({message: "--help"}), deps)),
			await answer(await handleRewindFiles("missing", postRequest({message: MESSAGE}), deps)),
			(await handleRewindFiles(SESSION, postRequest({message: MESSAGE}, {Origin: "https://evil.example"}), deps))
				.status,
		];
		expect(results).toStrictEqual([
			{status: 400, body: {error: "A user message UUID is required"}},
			{status: 404, body: {error: "Session not found"}},
			403,
		]);
		expect(deps.runs).toStrictEqual([]);
	});
});

describe("defaultRewindFilesDependencies.ready", () => {
	it("allows a session with no live pane or an idle one, and refuses a working or unreported one", () => {
		const ready = (): boolean => defaultRewindFilesDependencies.ready(SESSION);
		const states = [ready()];
		markSessionActive(SESSION, {cwd: CWD});
		states.push(ready());
		setSessionState(SESSION, "working");
		states.push(ready());
		setSessionState(SESSION, "idle");
		states.push(ready());
		markSessionEnded(SESSION);
		expect(states).toStrictEqual([true, false, false, true]);
	});
});
