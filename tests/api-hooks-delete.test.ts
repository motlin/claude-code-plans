import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Route as HooksRoute} from "../src/routes/api/hooks";

type ApiHandler = (context: {request: Request}) => Promise<Response>;

const managed = {hooks: [{type: "command", command: "curl http://localhost:7526/api/hook"}]};
const user = {hooks: [{type: "command", command: "echo mine"}]};

let directory: string;

function settingsPath(): string {
	return join(directory, ".claude", "settings.json");
}

async function deleteHooks(settings: Record<string, unknown>): Promise<unknown> {
	writeFileSync(settingsPath(), JSON.stringify(settings));
	const handlers = (HooksRoute as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options
		.server.handlers;
	const response = await handlers["DELETE"]!({
		request: new Request("http://localhost/api/hooks", {method: "DELETE"}),
	});
	expect(response.status).toBe(200);
	return JSON.parse(readFileSync(settingsPath(), "utf-8")) as unknown;
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "api-hooks-delete-test-"));
	mkdirSync(join(directory, ".claude"));
	vi.stubEnv("HOME", directory);
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(directory, {recursive: true, force: true});
});

describe("DELETE /api/hooks", () => {
	it("removes managed hooks, drops emptied managed events, and keeps everything else", async () => {
		expect(
			await deleteHooks({
				model: "opus",
				hooks: {Stop: [managed, user], PreToolUse: [managed], Custom: [], Unmanaged: [managed]},
			}),
		).toStrictEqual({
			model: "opus",
			hooks: {Stop: [user], Custom: [], Unmanaged: [managed]},
		});
	});

	it("removes the hooks key when no hooks remain", async () => {
		expect(await deleteHooks({model: "opus", hooks: {Stop: [managed]}})).toStrictEqual({model: "opus"});
	});
});
