import {describe, expect, it} from "vite-plus/test";
import {closeNitroRunnerOnServerClose} from "../src/lib/dev-env-runner-teardown";

function fakeRunner(log: string[], name: string) {
	return {
		close: async () => {
			log.push(`close ${name}`);
		},
	};
}

describe("closeNitroRunnerOnServerClose", () => {
	it("closes the nitro env runner of the server being closed, so a restart does not strand its worker", async () => {
		const log: string[] = [];
		const oldConfig = closeNitroRunnerOnServerClose();
		const newConfig = closeNitroRunnerOnServerClose();
		oldConfig.configureServer({environments: {nitro: {devServer: fakeRunner(log, "old")}}});
		// A restart loads the config again and configures the new server before closing the old one.
		newConfig.configureServer({environments: {nitro: {devServer: fakeRunner(log, "new")}}});

		await oldConfig.closeServer();
		await oldConfig.closeServer();

		expect(log).toStrictEqual(["close old"]);
	});

	it("leaves a runner alone while another server configured by the same plugin still uses it", async () => {
		const log: string[] = [];
		const plugin = closeNitroRunnerOnServerClose();
		const shared = fakeRunner(log, "shared");
		plugin.configureServer({environments: {nitro: {devServer: shared}}});
		plugin.configureServer({environments: {nitro: {devServer: shared}}});

		await plugin.closeServer();
		expect(log).toStrictEqual([]);

		await plugin.closeServer();
		expect(log).toStrictEqual(["close shared"]);
	});

	it("does nothing for a server without a nitro environment", async () => {
		const plugin = closeNitroRunnerOnServerClose();
		plugin.configureServer({environments: {}});

		await expect(plugin.closeServer()).resolves.toBeUndefined();
	});

	it("is registered in the vite config", async () => {
		const {default: config} = await import("../vite.config");
		const plugins: unknown[] = [...(config.plugins ?? [])];
		const names: unknown[] = [];
		while (plugins.length > 0) {
			const plugin = plugins.shift();
			if (Array.isArray(plugin)) plugins.push(...(plugin as unknown[]));
			else if (plugin !== null && typeof plugin === "object" && "name" in plugin) names.push(plugin.name);
		}

		expect(names).toContain("ccp:close-nitro-env-runner");
	});
});
