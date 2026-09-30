import {afterEach, describe, expect, it} from "vite-plus/test";
import {onServerShutdown, runServerShutdownHooks} from "../src/lib/server-shutdown";

afterEach(async () => {
	await runServerShutdownHooks();
});

describe("server shutdown hooks", () => {
	it("runs every registered hook once, even when one throws", async () => {
		const calls: string[] = [];
		onServerShutdown(() => {
			calls.push("sync");
		});
		onServerShutdown(() => {
			throw new Error("boom");
		});
		onServerShutdown(async () => {
			await Promise.resolve();
			calls.push("async");
		});

		await runServerShutdownHooks();
		await runServerShutdownHooks();

		expect(calls.sort()).toStrictEqual(["async", "sync"]);
	});

	it("shares hooks across separately bundled module instances", async () => {
		const calls: string[] = [];
		const registry = Symbol.for("claude-code-browser.server-shutdown-hooks");
		onServerShutdown(() => {
			calls.push("registered");
		});

		expect((globalThis as Record<symbol, unknown>)[registry]).toBeInstanceOf(Set);
		await runServerShutdownHooks();
		expect(calls).toStrictEqual(["registered"]);
	});

	it("returns an unregister function", async () => {
		const calls: string[] = [];
		const unregister = onServerShutdown(() => {
			calls.push("removed");
		});
		unregister();

		await runServerShutdownHooks();

		expect(calls).toStrictEqual([]);
	});
});
