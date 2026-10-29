import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {clearSessionRegistry, refreshSessionRegistry} from "../src/lib/session-registry-store";
import {Route as OpenInRoute} from "../src/routes/api/sessions.$id.open-in";

const SESSION_ID = "session-test-100";
let db: AppDb;
let directory: string;

vi.mock("../src/lib/db", () => ({getDb: () => db}));

type ApiHandler = (context: {params: {id: string}}) => Promise<Response>;

async function remoteControlFor(entry: {bridgeSessionId: string | null} | null): Promise<unknown> {
	const registryDir = join(directory, "sessions");
	rmSync(registryDir, {recursive: true, force: true});
	if (entry !== null) {
		mkdirSync(registryDir, {recursive: true});
		writeFileSync(
			join(registryDir, "4242.json"),
			JSON.stringify({
				pid: 4242,
				sessionId: SESSION_ID,
				cwd: "/tmp/test/alice-project",
				startedAt: 946_598_400_000,
				procStart: "Fri Dec 31 00:00:00 1999",
				version: "2.0.0",
				kind: "interactive",
				entrypoint: "cli",
				pidDomain: "darwin",
				status: "idle",
				updatedAt: 946_598_401_000,
				statusUpdatedAt: 946_598_401_000,
				bridgeSessionId: entry.bridgeSessionId,
			}),
		);
	}
	await refreshSessionRegistry(registryDir, {isAlive: () => true, readStartTimes: async () => Promise.resolve(null)});
	const {handlers} = (OpenInRoute as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options
		.server;
	const response = await handlers["GET"]!({params: {id: SESSION_ID}});
	return ((await response.json()) as {remoteControl: unknown}).remoteControl;
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "api-session-open-in-test-"));
	vi.stubEnv("HOME", directory);
	db = openTestDb();
	clearSessionRegistry();
});

afterEach(() => {
	clearSessionRegistry();
	vi.unstubAllEnvs();
	rmSync(directory, {recursive: true, force: true});
});

describe("GET /api/sessions/$id/open-in", () => {
	it("reports the live registry entry's Remote Control bridge: on with its url, off once torn down, null without a process", async () => {
		expect({
			on: await remoteControlFor({bridgeSessionId: "session_bridge"}),
			off: await remoteControlFor({bridgeSessionId: null}),
			ended: await remoteControlFor(null),
		}).toStrictEqual({
			on: {state: "on", url: "https://claude.ai/code/session_bridge"},
			off: {state: "off", url: null},
			ended: null,
		});
	});

	it("reports unsynced remote history from the transcript's bridge-session and history-suppression records", async () => {
		const projectDir = join(directory, ".claude", "projects", "-tmp-test-alice-project");
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(
			join(projectDir, `${SESSION_ID}.jsonl`),
			[
				{
					type: "history-suppression",
					sessionId: SESSION_ID,
					cause: "chokepoint_veto",
					ts: "2026-10-23T00:29:58.293Z",
				},
				{
					type: "bridge-session",
					sessionId: SESSION_ID,
					bridgeSessionId: "cse_alice_100",
					noHistoryBackfill: true,
				},
			]
				.map((record) => JSON.stringify(record))
				.join("\n") + "\n",
		);
		const {handlers} = (OpenInRoute as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}})
			.options.server;
		const response = await handlers["GET"]!({params: {id: SESSION_ID}});
		expect(await response.json()).toStrictEqual({
			cwd: null,
			bridgeSessionId: "cse_alice_100",
			remoteControl: null,
			remoteHistory: {reason: "Vetoed for another account"},
			githubUrl: null,
		});
	});
});
