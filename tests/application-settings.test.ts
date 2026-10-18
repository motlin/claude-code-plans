import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	AppConfigSchema,
	DEFAULT_IGNORED_DIR_NAMES,
	readApplicationSettings,
	readConfig,
	shellPaneEnabled,
	terminalWritesEnabled,
	updateApplicationSettings,
} from "../src/lib/config";
import {handleGetApplicationSettings, handlePutApplicationSettings} from "../src/lib/application-settings-handler";

describe("persisted application settings", () => {
	let directory: string;
	let configPath: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "application-settings-test-"));
		configPath = join(directory, "config.json");
	});

	afterEach(async () => {
		await rm(directory, {recursive: true, force: true});
	});

	it("keeps the default ignored directory names in alphabetical order", () => {
		expect(DEFAULT_IGNORED_DIR_NAMES).toStrictEqual(DEFAULT_IGNORED_DIR_NAMES.toSorted());
	});

	it("strictly validates every persisted setting", () => {
		expect([
			AppConfigSchema.safeParse({
				terminal_writes_enabled: true,
				herdr_writes_enabled: true,
				terminal_host: "tmux",
				shell_pane_enabled: false,
				show_herdr_section: true,
				show_tmux_section: false,
				visible_nav_sections: ["herdr", "plans"],
				ignored_dirs: ["node_modules"],
			}).success,
			AppConfigSchema.safeParse({visible_nav_sections: ["nope"]}).success,
			AppConfigSchema.safeParse({visible_nav_sections: ["plans", "plans"]}).success,
			AppConfigSchema.safeParse({herdr_writes_enabled: "1"}).success,
			AppConfigSchema.safeParse({terminal_writes_enabled: "1"}).success,
			AppConfigSchema.safeParse({terminal_host: "screen"}).success,
			AppConfigSchema.safeParse({shell_pane_enabled: "on"}).success,
			AppConfigSchema.safeParse({show_herdr_section: "true"}).success,
			AppConfigSchema.safeParse({show_tmux_section: 1}).success,
			AppConfigSchema.safeParse({watcher_polling: 1}).success,
			AppConfigSchema.safeParse({ignored_dirs: [""]}).success,
			AppConfigSchema.safeParse({ignored_dirs: []}).success,
			AppConfigSchema.safeParse({unknown_policy: true}).success,
		]).toStrictEqual([true, false, false, false, false, false, false, false, false, false, false, false, false]);
	});

	it("strips the legacy watcher polling key while parsing persisted config", async () => {
		await writeFile(configPath, JSON.stringify({watcher_polling: true, show_herdr_section: false}));

		expect(readConfig(configPath)).toStrictEqual({show_herdr_section: false});
	});

	it("uses safe defaults and ignores retired CCP environment aliases", () => {
		process.env["CCP_ENABLE_HERDR_WRITES"] = "1";
		process.env["CCP_WATCHER_IGNORED_DIRS"] = "vendor";
		try {
			expect({
				settings: readApplicationSettings(configPath),
				terminalWritesEnabled: terminalWritesEnabled(configPath),
				shellPaneEnabled: shellPaneEnabled(configPath),
			}).toStrictEqual({
				settings: {
					terminalWritesEnabled: false,
					terminalHost: "auto",
					shellPaneEnabled: true,
					visibleNavSections: ["projects", "artifacts", "plans", "memories", "customize"],
					ignoredDirs: [...DEFAULT_IGNORED_DIR_NAMES],
				},
				terminalWritesEnabled: false,
				shellPaneEnabled: true,
			});
		} finally {
			delete process.env["CCP_ENABLE_HERDR_WRITES"];
			delete process.env["CCP_WATCHER_IGNORED_DIRS"];
		}
	});

	it("migrates the retired Herdr and Tmux flags (Tmux now Terminals) into the pinned nav sections", async () => {
		await writeFile(configPath, JSON.stringify({show_herdr_section: true, show_tmux_section: true}));

		expect(readApplicationSettings(configPath).visibleNavSections).toStrictEqual([
			"projects",
			"artifacts",
			"herdr",
			"plans",
			"memories",
			"customize",
		]);
	});

	it("pins Terminals for the retired Tmux flag, since the Tmux Windows page folded into it", async () => {
		await writeFile(configPath, JSON.stringify({show_tmux_section: true}));

		expect(readApplicationSettings(configPath).visibleNavSections).toStrictEqual([
			"projects",
			"artifacts",
			"herdr",
			"plans",
			"memories",
			"customize",
		]);
	});

	it("carries a saved Tmux Windows pin over to Terminals without duplicating it", async () => {
		await writeFile(
			configPath,
			JSON.stringify({visible_nav_sections: ["tmux", "plans"], show_herdr_section: false}),
		);
		const single = readApplicationSettings(configPath).visibleNavSections;
		await writeFile(configPath, JSON.stringify({visible_nav_sections: ["herdr", "tmux", "plans"]}));

		expect({single, both: readApplicationSettings(configPath).visibleNavSections}).toStrictEqual({
			single: ["herdr", "plans"],
			both: ["herdr", "plans"],
		});
	});

	it("renames a saved Plugins nav section to Customize", async () => {
		await writeFile(
			configPath,
			JSON.stringify({herdr_writes_enabled: true, visible_nav_sections: ["plans", "plugins"]}),
		);

		expect(readApplicationSettings(configPath)).toStrictEqual({
			terminalWritesEnabled: true,
			terminalHost: "auto",
			shellPaneEnabled: true,
			visibleNavSections: ["plans", "customize"],
			ignoredDirs: [...DEFAULT_IGNORED_DIR_NAMES],
		});
	});

	it("drops a saved Starred nav section now that pins live in the sidebar", async () => {
		await writeFile(configPath, JSON.stringify({visible_nav_sections: ["starred", "plans"]}));

		expect(readApplicationSettings(configPath).visibleNavSections).toStrictEqual(["plans"]);
	});

	it("prefers saved nav sections over the retired flags", async () => {
		await writeFile(configPath, JSON.stringify({show_herdr_section: true, visible_nav_sections: ["tasks"]}));

		expect(readApplicationSettings(configPath).visibleNavSections).toStrictEqual(["tasks"]);
	});

	it("drops saved Settings, Claude Config and Setup nav sections now that they live in the account menu", async () => {
		await writeFile(configPath, JSON.stringify({visible_nav_sections: ["settings", "plans", "config", "setup"]}));

		expect(readApplicationSettings(configPath).visibleNavSections).toStrictEqual(["plans"]);
	});

	it("drops the retired flags on the next save", async () => {
		await writeFile(configPath, JSON.stringify({show_herdr_section: true, show_tmux_section: false}));

		await updateApplicationSettings(
			{...readApplicationSettings(configPath), visibleNavSections: ["herdr", "plans"]},
			configPath,
		);

		expect(JSON.parse(await readFile(configPath, "utf8"))).toStrictEqual({
			terminal_writes_enabled: false,
			terminal_host: "auto",
			shell_pane_enabled: true,
			ignored_dirs: [...DEFAULT_IGNORED_DIR_NAMES],
			visible_nav_sections: ["herdr", "plans"],
		});
	});

	it("sorts ignored directories while atomically preserving unrelated config fields", async () => {
		await writeFile(
			configPath,
			JSON.stringify({
				image_roots: ["/tmp/images"],
				file_roots: ["/tmp/files"],
				watcher_polling: true,
			}),
		);

		const saved = await updateApplicationSettings(
			{
				terminalWritesEnabled: true,
				terminalHost: "auto",
				shellPaneEnabled: false,
				visibleNavSections: ["herdr", "plans"],
				ignoredDirs: ["vendor", "output"],
			},
			configPath,
		);

		expect({
			saved,
			file: JSON.parse(await readFile(configPath, "utf8")),
			temporaryFiles: await readdir(directory),
		}).toStrictEqual({
			saved: {
				terminalWritesEnabled: true,
				terminalHost: "auto",
				shellPaneEnabled: false,
				visibleNavSections: ["herdr", "plans"],
				ignoredDirs: ["output", "vendor"],
			},
			file: {
				image_roots: ["/tmp/images"],
				file_roots: ["/tmp/files"],
				ignored_dirs: ["output", "vendor"],
				terminal_writes_enabled: true,
				terminal_host: "auto",
				shell_pane_enabled: false,
				visible_nav_sections: ["herdr", "plans"],
			},
			temporaryFiles: ["config.json"],
		});
	});

	it("refuses to overwrite an existing invalid config", async () => {
		const invalidConfig = JSON.stringify({existing_unknown_key: "keep me"});
		await writeFile(configPath, invalidConfig);

		await expect(
			updateApplicationSettings(
				{
					terminalWritesEnabled: true,
					terminalHost: "auto",
					shellPaneEnabled: true,
					visibleNavSections: ["plans"],
					ignoredDirs: ["node_modules"],
				},
				configPath,
			),
		).rejects.toThrow("Cannot update an invalid application config");
		expect(await readFile(configPath, "utf8")).toBe(invalidConfig);
	});

	it("reads and writes the same validated settings through the API handlers", async () => {
		await writeFile(configPath, JSON.stringify({image_roots: ["/tmp/images"]}));
		const request = new Request("http://127.0.0.1:7526/api/application-settings", {
			method: "PUT",
			headers: {"Content-Type": "application/json", Origin: "http://127.0.0.1:7526"},
			body: JSON.stringify({
				terminalWritesEnabled: true,
				terminalHost: "auto",
				shellPaneEnabled: true,
				visibleNavSections: ["herdr", "plans"],
				ignoredDirs: ["node_modules", "build"],
			}),
		});

		const savedResponse = await handlePutApplicationSettings(request, configPath);
		const readResponse = handleGetApplicationSettings(configPath);

		expect({
			savedStatus: savedResponse.status,
			saved: await savedResponse.json(),
			readStatus: readResponse.status,
			read: await readResponse.json(),
			persisted: JSON.parse(await readFile(configPath, "utf8")),
		}).toStrictEqual({
			savedStatus: 200,
			saved: {
				terminalWritesEnabled: true,
				terminalHost: "auto",
				shellPaneEnabled: true,
				visibleNavSections: ["herdr", "plans"],
				ignoredDirs: ["build", "node_modules"],
			},
			readStatus: 200,
			read: {
				terminalWritesEnabled: true,
				terminalHost: "auto",
				shellPaneEnabled: true,
				visibleNavSections: ["herdr", "plans"],
				ignoredDirs: ["build", "node_modules"],
			},
			persisted: {
				image_roots: ["/tmp/images"],
				ignored_dirs: ["build", "node_modules"],
				terminal_writes_enabled: true,
				terminal_host: "auto",
				shell_pane_enabled: true,
				visible_nav_sections: ["herdr", "plans"],
			},
		});
	});

	it("rejects malformed API settings without changing the config", async () => {
		await writeFile(configPath, JSON.stringify({herdr_writes_enabled: false}));
		const response = await handlePutApplicationSettings(
			new Request("http://127.0.0.1:7526/api/application-settings", {
				method: "PUT",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({
					terminalWritesEnabled: "yes",
					visibleNavSections: ["plans"],
					ignoredDirs: [],
				}),
			}),
			configPath,
		);

		expect({
			status: response.status,
			persisted: JSON.parse(await readFile(configPath, "utf8")),
		}).toStrictEqual({status: 400, persisted: {herdr_writes_enabled: false}});
	});

	it("reads the retired Live herdr input key as Live terminal input", async () => {
		await writeFile(configPath, JSON.stringify({herdr_writes_enabled: true}));

		expect({
			settings: readApplicationSettings(configPath),
			terminalWritesEnabled: terminalWritesEnabled(configPath),
		}).toStrictEqual({
			settings: {
				terminalWritesEnabled: true,
				terminalHost: "auto",
				shellPaneEnabled: true,
				visibleNavSections: ["projects", "artifacts", "plans", "memories", "customize"],
				ignoredDirs: [...DEFAULT_IGNORED_DIR_NAMES],
			},
			terminalWritesEnabled: true,
		});
	});

	it("prefers the Live terminal input key over the retired one", async () => {
		await writeFile(configPath, JSON.stringify({herdr_writes_enabled: true, terminal_writes_enabled: false}));

		expect(terminalWritesEnabled(configPath)).toBe(false);
	});

	it("moves the retired Live herdr input key to the new key on the next save", async () => {
		await writeFile(configPath, JSON.stringify({herdr_writes_enabled: true}));

		await updateApplicationSettings({...readApplicationSettings(configPath), terminalHost: "herdr"}, configPath);

		expect(JSON.parse(await readFile(configPath, "utf8"))).toStrictEqual({
			terminal_writes_enabled: true,
			terminal_host: "herdr",
			shell_pane_enabled: true,
			ignored_dirs: [...DEFAULT_IGNORED_DIR_NAMES],
			visible_nav_sections: ["projects", "artifacts", "plans", "memories", "customize"],
		});
	});
});
