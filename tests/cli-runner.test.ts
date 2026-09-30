import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import type {ChildProcess} from "node:child_process";
import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({spawn: spawnMock}));

import {validateClaudeLaunchArgs} from "../src/lib/claude-launch-command";
import {spawnClaude} from "../src/lib/cli-runner";
import {buildLaunchFlags} from "../src/lib/launch-options";

function fakeChildProcess(): ChildProcess {
	const child = new EventEmitter() as ChildProcess;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = vi.fn(() => true);
	return child;
}

beforeEach(() => {
	spawnMock.mockReset();
});

describe("spawnClaude", () => {
	it("preserves multi-byte UTF-8 characters split across stdout chunks", async () => {
		const child = fakeChildProcess();
		spawnMock.mockReturnValue(child);
		const expected = Buffer.from('{"message":"Alice 🌱"}\n');
		const characterStart = expected.indexOf(Buffer.from("🌱"));

		const {stream} = spawnClaude({
			sessionId: "session-test-100",
			prompt: "Review Alice's fixture",
			projectDir: "/fixture/alice-repository",
			environment: {FIXTURE: "alice"},
		});
		child.stdout!.emit("data", expected.subarray(0, characterStart + 2));
		child.stdout!.emit("data", expected.subarray(characterStart + 2));
		child.emit("close", 0);

		expect(new Uint8Array(await new Response(stream).arrayBuffer())).toStrictEqual(new Uint8Array(expected));
	});
});

describe("buildLaunchFlags", () => {
	it("emits --permission-mode, --model and --effort as separate argv entries", () => {
		expect(
			buildLaunchFlags({
				permissionMode: "acceptEdits",
				model: "claude-opus-4-8",
				effort: "xhigh",
			}),
		).toStrictEqual(["--permission-mode", "acceptEdits", "--model", "claude-opus-4-8", "--effort", "xhigh"]);
	});

	it("omits unset options", () => {
		expect({
			none: buildLaunchFlags({}),
			modelOnly: buildLaunchFlags({model: "fable"}),
		}).toStrictEqual({none: [], modelOnly: ["--model", "fable"]});
	});

	it("produces flags the herdr launch validator accepts", () => {
		expect(
			validateClaudeLaunchArgs(
				buildLaunchFlags({permissionMode: "default", model: "claude-opus-5-5", effort: "max"}),
			),
		).toBeNull();
	});
});

describe("spawnClaude launch flags", () => {
	it("appends the launch flags to the argv array without shell interpolation", () => {
		spawnMock.mockReturnValue(fakeChildProcess());

		spawnClaude({
			sessionId: "session-test-100",
			prompt: "Review $(whoami) && Alice's `fixture`",
			projectDir: "/fixture/alice-repository",
			environment: {},
			launchOptions: {permissionMode: "plan", model: "sonnet", effort: "low"},
		});

		expect(spawnMock.mock.calls[0]?.slice(0, 2)).toStrictEqual([
			"claude",
			[
				"--resume",
				"session-test-100",
				"--fork-session",
				"-p",
				"Review $(whoami) && Alice's `fixture`",
				"--output-format",
				"stream-json",
				"--verbose",
				"--include-partial-messages",
				"--permission-mode",
				"plan",
				"--model",
				"sonnet",
				"--effort",
				"low",
			],
		]);
	});
});
