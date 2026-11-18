import {describe, expect, it} from "vite-plus/test";

import {HeadlessRegistry, type HeadlessRegistryIo} from "../src/lib/headless/registry";
import {FakeCli} from "./helpers/fake-headless-cli";

const SESSION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

interface Harness
{
	registry: HeadlessRegistry;
	spawned:
	{
		args: readonly string[];
		cwd: string;
		cli: FakeCli;
	}[];
	written: unknown[];
	killed: number[];
	broadcasts: string[];
}

function harness(overrides: Partial<HeadlessRegistryIo> = {}): Harness
{
	const spawned: Harness["spawned"] = [];
	const written: unknown[] = [];
	const killed: number[] = [];
	const broadcasts: string[] = [];
	let next = 0;
	const registry = new HeadlessRegistry(
		{
			spawnCli: (args, cwd) =>
			{
				const cli = new FakeCli();
				spawned.push(
					{
						args,
						cwd,
						cli,
					},
				);
				return cli;
			},
			createSessionId: () => SESSION_ID,
			createRequestId: () => `req-${++next}`,
			readState: () => [],
			writeState: (entries) =>
			{
				written.push(entries);
			},
			processCommand: async () => Promise.resolve(null),
			killPid: (pid) =>
			{
				killed.push(pid);
			},
			broadcast: (sessionId) =>
			{
				broadcasts.push(sessionId);
			},
			...overrides,
		},
	);
	return {
		registry,
		spawned,
		written,
		killed,
		broadcasts,
	};
}

describe("HeadlessRegistry", () =>
{
	it("spawns one stream-json CLI per launch with its own session id, permission prompts over stdio and the launch flags", () =>
	{
		const {registry, spawned, written} = harness();

		const session = registry.launch(
			{
				cwd: "/fixture/alice-project",
				prompt: "Say pong",
				args: ["--model", "haiku"],
			},
		);

		expect(
			spawned.map(({args, cwd}) => (
			{
				args,
				cwd,
			})),
		).toStrictEqual([
			{
				args: [
					"-p",
					"--input-format",
					"stream-json",
					"--output-format",
					"stream-json",
					"--verbose",
					"--permission-prompt-tool",
					"stdio",
					"--session-id",
					SESSION_ID,
					"--model",
					"haiku",
				],
				cwd: "/fixture/alice-project",
			},
		]);
		expect(registry.get(SESSION_ID)).toBe(session);
		expect(written).toStrictEqual([
			[
				{
					sessionId: SESSION_ID,
					cwd: "/fixture/alice-project",
					pid: 4242,
				},
			],
		]);
	});

	it("drops a session whose CLI exits, persists the shorter list and tells browsers", () =>
	{
		const {registry, spawned, written, broadcasts} = harness();
		registry.launch(
			{
				cwd: "/fixture/bob-project",
			},
		);
		broadcasts.length = 0;

		spawned[0]?.cli.exit(
			{
				code: 0,
				signal: null,
				error: null,
			},
		);

		expect(registry.get(SESSION_ID)).toBeUndefined();
		expect(registry.list()).toStrictEqual([]);
		expect(written.at(-1)).toStrictEqual([]);
		expect(broadcasts).toStrictEqual([SESSION_ID]);
	});

	it("closes every session's stdin on shutdown", () =>
	{
		const {registry, spawned} = harness();
		registry.launch(
			{
				cwd: "/fixture/carol-project",
			},
		);

		registry.closeAll();

		expect(spawned[0]?.cli.ended).toBe(true);
	});

	it("after a restart marks the previous sessions ended and stops only a CLI still running under its own session id", async () =>
	{
		const commands = new Map<number, string>([
			[101, `claude -p --input-format stream-json --session-id ${SESSION_ID}`],
			[202, "vim notes.md"],
		]);
		const {registry, killed, written} = harness(
			{
				readState: () => [
					{
						sessionId: SESSION_ID,
						cwd: "/fixture/alice-project",
						pid: 101,
					},
					{
						sessionId: "99999999-8888-4777-8666-555555555555",
						cwd: "/fixture/bob-project",
						pid: 202,
					},
					{
						sessionId: "12121212-3434-4565-8787-909090909090",
						cwd: "/fixture/carol-project",
						pid: 303,
					},
				],
				processCommand: async (pid) => Promise.resolve(commands.get(pid) ?? null),
			},
		);

		const ended = await registry.recoverAfterRestart();

		expect(ended).toStrictEqual([
			SESSION_ID,
			"99999999-8888-4777-8666-555555555555",
			"12121212-3434-4565-8787-909090909090",
		]);
		expect(killed).toStrictEqual([101]);
		expect(registry.list()).toStrictEqual([]);
		expect(written).toStrictEqual([[]]);
	});
});
