import {describe, expect, it} from "vite-plus/test";
import {customizeHash, parseCustomizeHash, parseSettingsHash, settingsHash} from "../src/lib/settings-hash";

describe("parseSettingsHash", () => {
	const cases: ReadonlyArray<readonly [string, ReturnType<typeof parseSettingsHash>]> = [
		["#settings/general", {tab: "general", row: null}],
		["settings/general", {tab: "general", row: null}],
		["#settings/usage", {tab: "usage", row: null}],
		["#settings/claude-code/code-font", {tab: "claude-code", row: "code-font"}],
		["#settings/ai-features", {tab: "ai-features", row: null}],
		["#settings/claude-config", {tab: "claude-config", row: null}],
		["#settings/setup", {tab: "setup", row: null}],
		["#settings/transcript/", {tab: "transcript", row: null}],
		["", null],
		["#", null],
		["#settings", null],
		["#settings/", null],
		["#settings/account", null],
		["#settings/notifications", null],
		["#settings/General", null],
		["#settings/general/Code Font", null],
		["#settings/general/code-font/extra", null],
		["#other/general", null],
		["#message-42", null],
	];

	it.each(cases)("parses %j", (hash, expected) => {
		expect(parseSettingsHash(hash)).toEqual(expected);
	});
});

describe("settingsHash", () => {
	it("builds the hash for a tab", () => {
		expect(settingsHash("sessions")).toBe("settings/sessions");
	});

	it("builds the hash for a tab row", () => {
		expect(settingsHash("claude-code", "code-font")).toBe("settings/claude-code/code-font");
	});
});

describe("parseCustomizeHash", () => {
	const cases: ReadonlyArray<readonly [string, ReturnType<typeof parseCustomizeHash>]> = [
		[
			"#customize/skills/yours/id/personal%3Afoo/contents",
			{section: "skills", view: "yours", id: "personal:foo", tab: "contents", file: null},
		],
		["#customize/skills", {section: "skills", view: "yours", id: null, tab: null, file: null}],
		["customize/skills/discover", {section: "skills", view: "discover", id: null, tab: null, file: null}],
		["#customize/connectors/yours", {section: "connectors", view: "yours", id: null, tab: null, file: null}],
		["#customize/plugins/discover", {section: "plugins", view: "discover", id: null, tab: null, file: null}],
		[
			"#customize/skills/yours/id/personal%3Afoo",
			{section: "skills", view: "yours", id: "personal:foo", tab: null, file: null},
		],
		[
			"#customize/connectors/yours/id/user--linear",
			{section: "connectors", view: "yours", id: "user--linear", tab: null, file: null},
		],
		[
			"#customize/plugins/yours/id/kit%40market/hooks",
			{section: "plugins", view: "yours", id: "kit@market", tab: "hooks", file: null},
		],
		[
			"#customize/plugins/yours/id/kit%40market/contents/agents%2Freviewer.md",
			{section: "plugins", view: "yours", id: "kit@market", tab: "contents", file: "agents/reviewer.md"},
		],
		["#customize", null],
		["#customize/", null],
		["#customize/routines/yours", null],
		["#customize/skills/mine", null],
		["#customize/connectors/discover", null],
		["#customize/skills/yours/id/", null],
		["#customize/skills/yours/id/foo/hooks", null],
		["#customize/skills/yours/id/foo/contents/SKILL.md", null],
		["#customize/connectors/yours/id/foo/contents", null],
		["#customize/plugins/yours/id/kit/hooks/extra", null],
		["#customize/skills/yours/id/%E0%A4%A", null],
		["#settings/general", null],
	];

	it.each(cases)("parses %j", (hash, expected) => {
		expect(parseCustomizeHash(hash)).toEqual(expected);
	});
});

describe("customizeHash", () => {
	it.each<[Parameters<typeof customizeHash>[0], string]>([
		[{section: "skills"}, "customize/skills/yours"],
		[{section: "plugins", view: "discover"}, "customize/plugins/discover"],
		[{section: "skills", id: "personal:foo", tab: "contents"}, "customize/skills/yours/id/personal%3Afoo/contents"],
		[
			{section: "plugins", id: "kit@market", tab: "contents", file: "agents/reviewer.md"},
			"customize/plugins/yours/id/kit%40market/contents/agents%2Freviewer.md",
		],
	])("builds %j", (location, expected) => {
		expect(customizeHash(location)).toBe(expected);
	});

	it("round-trips through the parser", () => {
		expect(parseCustomizeHash(customizeHash({section: "skills", id: "plugin:kit@m:a b", tab: null}))).toEqual({
			section: "skills",
			view: "yours",
			id: "plugin:kit@m:a b",
			tab: null,
			file: null,
		});
	});
});
