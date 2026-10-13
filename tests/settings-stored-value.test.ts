// @vitest-environment jsdom
import {DEFAULTS, readStoredValue, settingStorageKey, type Settings} from "../src/components/settings-context";

function store(key: keyof Settings, raw: string): void {
	localStorage.setItem(settingStorageKey(key), raw);
}

describe("readStoredValue", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("returns undefined for a key with nothing stored", () => {
		expect(readStoredValue("showTools")).toBeUndefined();
		expect(readStoredValue("verbosity")).toBeUndefined();
	});

	it("reads booleans, numbers and free-form strings", () => {
		store("showTools", "false");
		store("filesTreeWidth", "320");
		store("codeFont", "Iosevka");
		expect([readStoredValue("showTools"), readStoredValue("filesTreeWidth"), readStoredValue("codeFont")]).toEqual([
			false,
			320,
			"Iosevka",
		]);
	});

	it("drops a non-finite number", () => {
		store("activeTimeoutSec", "soon");
		expect(readStoredValue("activeTimeoutSec")).toBeUndefined();
	});

	it("reads valid enum strings and drops unknown ones", () => {
		store("verbosity", "thinking");
		store("sessionSort", "stable");
		store("sessionsGrouping", "bogus");
		store("defaultSubagentView", "bogus");
		store("diffStyle", "bogus");
		expect([
			readStoredValue("verbosity"),
			readStoredValue("sessionSort"),
			readStoredValue("sessionsGrouping"),
			readStoredValue("defaultSubagentView"),
			readStoredValue("diffStyle"),
		]).toEqual(["thinking", "stable", undefined, undefined, undefined]);
	});

	it("parses JSON link category rules and drops malformed JSON", () => {
		store("linkCategoryRules", JSON.stringify([{label: "Docs", hostPattern: "docs.*"}]));
		expect(readStoredValue("linkCategoryRules")).toEqual([{label: "Docs", hostPattern: "docs.*"}]);
		store("linkCategoryRules", "{not json");
		expect(readStoredValue("linkCategoryRules")).toBeUndefined();
	});

	it("migrates session list prefs even when nothing is stored", () => {
		expect(readStoredValue("sessionListPrefs")).toEqual(DEFAULTS.sessionListPrefs);
	});
});
