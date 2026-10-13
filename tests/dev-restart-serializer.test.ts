import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {createServer, type Plugin, type ViteDevServer} from "vite-plus";
import {newRestartQueue, serializeDevServerRestarts, serializeRestarts} from "../src/lib/dev-restart-serializer";

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function deferred(): {promise: Promise<void>; resolve: () => void} {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return {promise, resolve};
}

describe("serializeRestarts", () => {
	it("runs one follow-up restart for every request made while a restart is in flight", async () => {
		const log: string[] = [];
		const gates = [deferred(), deferred()];
		let calls = 0;
		const restart = serializeRestarts(async (forceOptimize) => {
			const call = calls++;
			log.push(`start ${call} ${String(forceOptimize)}`);
			await gates[call]?.promise;
			log.push(`end ${call}`);
		}, newRestartQueue());

		const first = restart(false);
		const second = restart(true);
		const third = restart(false);
		await Promise.resolve();
		expect(log).toStrictEqual(["start 0 false"]);

		gates[0]?.resolve();
		await first;
		gates[1]?.resolve();
		await Promise.all([second, third]);

		expect(log).toStrictEqual(["start 0 false", "end 0", "start 1 true", "end 1"]);
	});

	it("shares one queue between the wrappers of an old server and the server its restart is creating", async () => {
		const log: string[] = [];
		const gate = deferred();
		const queue = newRestartQueue();
		const oldServer = serializeRestarts(async () => {
			log.push("old start");
			await gate.promise;
			log.push("old end");
		}, queue);
		const newServer = serializeRestarts(async () => {
			log.push("new start");
			await Promise.resolve();
			log.push("new end");
		}, queue);

		const first = oldServer();
		const second = newServer();
		gate.resolve();
		await Promise.all([first, second]);

		expect(log).toStrictEqual(["old start", "old end", "new start", "new end"]);
	});

	it("still runs the follow-up when the restart in flight fails", async () => {
		const log: string[] = [];
		let calls = 0;
		const restart = serializeRestarts(async () => {
			const call = calls++;
			log.push(`start ${call}`);
			await Promise.resolve();
			if (call === 0) throw new Error("listen failed");
		}, newRestartQueue());

		const first = restart();
		const second = restart();

		await expect(first).rejects.toThrow("listen failed");
		await second;
		expect(log).toStrictEqual(["start 0", "start 1"]);
	});
});

describe("serializeDevServerRestarts with a real dev server", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
	});

	// A burst of config edits (a git checkout) asks for a restart again while one is under way, sometimes from the
	// watcher of the half-built server the restart is creating. Vite drops its own in-flight guard on that server, so
	// two restarts run at once and race to listen on the same port.
	it.each(["new", "current"] as const)(
		"keeps serving when the %s server asks for a restart during a restart",
		async (asker) => {
			const root = mkdtempSync(path.join(tmpdir(), "ccp-restart-"));
			roots.push(root);
			const errors: unknown[] = [];
			let configured = 0;
			let closed = 0;
			let current: ViteDevServer | undefined;
			const burst: Plugin = {
				name: "config-edit-burst",
				configureServer(server) {
					configured++;
					if (configured !== 2) return;
					const target = asker === "new" ? server : current;
					setTimeout(() => {
						target?.restart().catch((error: unknown) => {
							errors.push(error);
						});
					}, 10);
				},
				async buildEnd() {
					// Closing the old server takes a while in the real app (nitro's worker), which widens the race.
					closed++;
					if (closed <= 2) await sleep(100);
				},
			};
			current = await createServer({
				root,
				configFile: false,
				logLevel: "silent",
				server: {
					port: 20_000 + Math.floor(Math.random() * 30_000),
					strictPort: true,
					host: "127.0.0.1",
					watch: null,
				},
				plugins: [burst, serializeDevServerRestarts()],
			});
			await current.listen();
			await current.restart().catch((error: unknown) => {
				errors.push(error);
			});
			await sleep(500);

			const url = current.resolvedUrls?.local[0];
			const status = url === undefined ? undefined : (await fetch(`${url}@vite/client`)).status;
			await current.close();

			expect({errors: errors.map(String), configured, status}).toStrictEqual({
				errors: [],
				configured: 3,
				status: 200,
			});
		},
		20_000,
	);
});
