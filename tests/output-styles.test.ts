import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {outputStyleOptions} from "../src/lib/output-style-options";
import {enabledPlugins, listOutputStyles} from "../src/lib/output-styles";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "output-styles-"));
});

afterEach(async () => {
	await rm(root, {recursive: true, force: true});
});

async function put(path: string, content: string) {
	await mkdir(join(path, ".."), {recursive: true});
	await writeFile(path, content);
}

describe("listOutputStyles", () => {
	it("returns the CLI built-ins, the user dir's styles by plain name and plugin styles as plugin:style", async () => {
		const claudeDir = join(root, "claude");
		await put(
			join(claudeDir, "output-styles", "terse.md"),
			"---\nname: Terse\ndescription: Short\n---\nBe brief.\n",
		);
		await put(join(claudeDir, "output-styles", "plain.md"), "No frontmatter.\n");
		await put(join(claudeDir, "output-styles", "notes.txt"), "not a style\n");
		const pluginDir = join(root, "plugin-a");
		await put(join(pluginDir, "output-styles", "pirate.md"), "---\nname: Pirate\n---\nArr.\n");

		await put(join(pluginDir, "output-styles", "shanty.md"), "No frontmatter.\n");

		expect(
			await listOutputStyles(claudeDir, [
				{name: "plugin-a", dir: pluginDir},
				{name: "no-such-plugin", dir: join(root, "no-such-plugin")},
			]),
		).toStrictEqual({
			builtIns: ["Explanatory", "Learning"],
			customs: ["plain", "Terse", "plugin-a:Pirate", "plugin-a:shanty"],
		});
	});

	it("has no customs when no output-styles directories exist", async () => {
		expect(await listOutputStyles(join(root, "missing"), [])).toStrictEqual({
			builtIns: ["Explanatory", "Learning"],
			customs: [],
		});
	});
});

describe("enabledPlugins", () => {
	it("returns the names and install paths of the plugins settings.json enables", async () => {
		const claudeDir = join(root, "claude");
		await put(
			join(claudeDir, "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: {
					"on@market": [{installPath: "/plugins/on", version: "1.0.0"}],
					"renamed@market": [{installPath: join(root, "renamed"), version: "1.0.0"}],
					"off@market": [{installPath: "/plugins/off", version: "1.0.0"}],
					"unlisted@market": [{installPath: "/plugins/unlisted", version: "1.0.0"}],
				},
			}),
		);
		await put(
			join(claudeDir, "settings.json"),
			JSON.stringify({enabledPlugins: {"on@market": true, "renamed@market": true, "off@market": false}}),
		);
		await put(join(root, "renamed", ".claude-plugin", "plugin.json"), JSON.stringify({name: "manifest-name"}));

		expect(await enabledPlugins(claudeDir)).toStrictEqual([
			{name: "on", dir: "/plugins/on"},
			{name: "manifest-name", dir: join(root, "renamed")},
		]);
	});

	it("returns nothing without a plugin registry", async () => {
		expect(await enabledPlugins(join(root, "missing"))).toStrictEqual([]);
	});
});

describe("outputStyleOptions", () => {
	it("lists Default, then built-ins, then customs, deduplicated case-insensitively", () => {
		expect(
			outputStyleOptions(
				{builtIns: ["Explanatory", "Learning"], customs: ["default", "learning", "", "Terse"]},
				"",
			),
		).toStrictEqual({
			value: "",
			options: [
				{value: "", label: "Default"},
				{value: "Explanatory", label: "Explanatory"},
				{value: "Learning", label: "Learning"},
				{value: "Terse", label: "Terse"},
			],
		});
	});

	it("reads default in any case as Default", () => {
		expect(outputStyleOptions({builtIns: ["Explanatory"], customs: []}, "DEFAULT")).toStrictEqual({
			value: "",
			options: [
				{value: "", label: "Default"},
				{value: "Explanatory", label: "Explanatory"},
			],
		});
	});

	it("appends an uninstalled current value as a disabled item", () => {
		expect(outputStyleOptions({builtIns: ["Explanatory"], customs: []}, "Gone")).toStrictEqual({
			value: "Gone",
			options: [
				{value: "", label: "Default"},
				{value: "Explanatory", label: "Explanatory"},
				{value: "Gone", label: "Gone", disabled: true},
			],
		});
	});

	it("shows the current value before the styles load", () => {
		expect(outputStyleOptions(undefined, "Explanatory")).toStrictEqual({
			value: "Explanatory",
			options: [
				{value: "", label: "Default"},
				{value: "Explanatory", label: "Explanatory", disabled: true},
			],
		});
	});
});
