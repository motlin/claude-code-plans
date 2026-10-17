import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {generateHooksConfig} from "../src/lib/hook-config";
import {Route as HooksRoute} from "../src/routes/api/hooks";

type ApiHandler = (context: {request: Request}) => Promise<Response>;

const HERDR = {hooks: [{type: "command", command: "bash '/Users/test/.claude/hooks/herdr-agent-state.sh' session"}]};
const CURRENT = generateHooksConfig().hooks;
const OLDER = {hooks: [{type: "command", command: "jq -c . | curl -sX POST http://localhost:7000/api/hook || true"}]};

let directory: string;

function settingsPath(): string {
	return join(directory, ".claude", "settings.json");
}

async function call(
	method: "POST" | "DELETE",
	raw: string,
): Promise<{body: unknown; written: unknown; backup: string}> {
	writeFileSync(settingsPath(), raw);
	const handlers = (HooksRoute as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options
		.server.handlers;
	const response = await handlers[method]!({
		request: new Request("http://localhost/api/hooks", {
			method,
			body: "{}",
			headers: {"Content-Type": "application/json"},
		}),
	});
	expect(response.status).toBe(200);
	return {
		body: (await response.json()) as unknown,
		written: JSON.parse(readFileSync(settingsPath(), "utf-8")) as unknown,
		backup: readFileSync(`${settingsPath()}.bak`, "utf-8"),
	};
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "api-hooks-install-test-"));
	mkdirSync(join(directory, ".claude"));
	vi.stubEnv("HOME", directory);
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(directory, {recursive: true, force: true});
});

describe("POST /api/hooks", () => {
	it("keeps herdr's SessionStart hook, replaces an older forwarder, removes stray worktree hooks, and backs up the file", async () => {
		const raw = JSON.stringify({
			model: "opus",
			hooks: {SessionStart: [HERDR], Stop: [OLDER], WorktreeCreate: [OLDER], WorktreeRemove: [OLDER, HERDR]},
		});
		const result = await call("POST", raw);
		expect(result).toStrictEqual({
			body: {ok: true, settingsPath: settingsPath(), backupPath: `${settingsPath()}.bak`},
			written: {
				model: "opus",
				hooks: {...CURRENT, SessionStart: [HERDR, ...CURRENT["SessionStart"]!], WorktreeRemove: [HERDR]},
			},
			backup: raw,
		});
	});
});

describe("DELETE /api/hooks", () => {
	it("also strips forwarders left under never-installed events and backs up the file", async () => {
		const raw = JSON.stringify({
			hooks: {WorktreeCreate: [OLDER], SessionStart: [HERDR, ...CURRENT["SessionStart"]!]},
		});
		const result = await call("DELETE", raw);
		expect(result).toStrictEqual({
			body: {ok: true, settingsPath: settingsPath(), backupPath: `${settingsPath()}.bak`},
			written: {hooks: {SessionStart: [HERDR]}},
			backup: raw,
		});
	});
});
