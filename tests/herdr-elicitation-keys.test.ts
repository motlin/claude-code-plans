import {describe, expect, it} from "vite-plus/test";
import {elicitationSteps, parseElicitationDialog} from "../src/lib/herdr/elicitation-keys";
import {
	EMPTY_SCHEMA,
	URL_ACCEPT_FOCUSED,
	URL_DECLINE_FOCUSED,
	VERDICT_DECLINE_FOCUSED,
	VERDICT_EXPANDED,
	VERDICT_FIELD_FOCUSED,
	VERDICT_PICKED,
	VERDICT_REQUIRED_ERROR,
} from "./fixtures/elicitation-screens";

const verdictSchema = {
	type: "object",
	properties: {verdict: {type: "string", enum: ["allow", "deny", "always_allow"]}},
	required: ["verdict"],
};
const allowDenySchema = {
	type: "object",
	properties: {verdict: {type: "string", enum: ["allow", "deny"]}},
	required: ["verdict"],
};

function parsed(screen: string) {
	const dialog = parseElicitationDialog(screen);
	if (dialog === null) throw new Error("fixture did not parse");
	return dialog;
}

describe("parseElicitationDialog", () => {
	it("reads the verdict form as it opens, field 0 focused and collapsed", () => {
		expect(parseElicitationDialog(VERDICT_FIELD_FOCUSED)).toStrictEqual({
			kind: "form",
			server: "spike-elicit",
			message: "Allow spike-tool to run? (verdict-allow)",
			focus: {stop: "field", index: 0},
			expanded: false,
			fieldCount: 1,
		});
	});

	it("sees the expanded enum list without counting its options as fields", () => {
		expect(parseElicitationDialog(VERDICT_EXPANDED)).toStrictEqual({
			kind: "form",
			server: "spike-elicit",
			message: "Allow spike-tool to run? (verdict-allow)",
			focus: {stop: "field", index: 0},
			expanded: true,
			fieldCount: 1,
		});
	});

	it("reads focus on Accept once the verdict is picked", () => {
		expect(parseElicitationDialog(VERDICT_PICKED)).toStrictEqual({
			kind: "form",
			server: "spike-elicit",
			message: "Allow spike-tool to run? (verdict-allow)",
			focus: {stop: "accept"},
			expanded: false,
			fieldCount: 1,
		});
	});

	it("reads focus on the Decline stop", () => {
		expect(parseElicitationDialog(VERDICT_DECLINE_FOCUSED)).toStrictEqual({
			kind: "form",
			server: "spike-elicit",
			message: "Allow spike-tool to run? (verdict-decline-row)",
			focus: {stop: "decline"},
			expanded: false,
			fieldCount: 1,
		});
	});

	it("keeps the required-error field focused and skips its error line", () => {
		expect(parseElicitationDialog(VERDICT_REQUIRED_ERROR)).toStrictEqual({
			kind: "form",
			server: "spike-elicit",
			message: "Allow spike-tool to run? (verdict-accept-unset)",
			focus: {stop: "field", index: 0},
			expanded: false,
			fieldCount: 1,
		});
	});

	it("reads a form with no fields that starts on Accept", () => {
		expect(parseElicitationDialog(EMPTY_SCHEMA)).toStrictEqual({
			kind: "form",
			server: "spike-elicit",
			message: "Just confirm (empty-schema)",
			focus: {stop: "accept"},
			expanded: false,
			fieldCount: 0,
		});
	});

	it("reads the URL dialog's message apart from its URL line", () => {
		expect(parseElicitationDialog(URL_ACCEPT_FOCUSED)).toStrictEqual({
			kind: "url",
			server: "spike-elicit",
			message: "Open the spike page (url-decline)",
			focus: {stop: "accept"},
			expanded: false,
			fieldCount: 0,
		});
		expect(parseElicitationDialog(URL_DECLINE_FOCUSED)).toStrictEqual({
			kind: "url",
			server: "spike-elicit",
			message: "Open the spike page (url-decline)",
			focus: {stop: "decline"},
			expanded: false,
			fieldCount: 0,
		});
	});

	it("joins a wrapped message and reads the task suffix off the title", () => {
		const screen = [
			"  MCP server “files” requests your input (task 1a2b3c4d)",
			"",
			"  Allow the files server to read",
			"  your home directory?",
			"",
			"  ❯ * verdict: ▸ not set",
			"",
			"    Accept    Decline",
			"",
			"  Esc to cancel · ↑/↓ to navigate · Backspace to unset · → to expand",
		].join("\n");
		expect(parseElicitationDialog(screen)).toStrictEqual({
			kind: "form",
			server: "files",
			message: "Allow the files server to read your home directory?",
			focus: {stop: "field", index: 0},
			expanded: false,
			fieldCount: 1,
		});
	});

	it("reports no focus when nothing carries the pointer", () => {
		const screen = [
			"  MCP server “plugin” requests your input",
			"  Allow it?",
			"    * verdict: not set",
			"    Accept    Decline",
			"  Esc to cancel · ↑/↓ to navigate",
		].join("\n");
		expect(parseElicitationDialog(screen)).toStrictEqual({
			kind: "form",
			server: "plugin",
			message: "Allow it?",
			focus: null,
			expanded: false,
			fieldCount: 1,
		});
	});

	it("returns null for a screen without an elicitation dialog", () => {
		expect(parseElicitationDialog("  ❯ 1. Yes\n    2. No\n")).toBeNull();
		expect(parseElicitationDialog("  MCP server “x” requests your input\n  Allow?\n")).toBeNull();
	});
});

describe("elicitationSteps", () => {
	const fieldFocused = parsed(VERDICT_FIELD_FOCUSED);

	it("allows by expanding the verdict, picking allow, pausing past the Accept guard, then accepting", () => {
		expect(elicitationSteps(verdictSchema, "allow", fieldFocused)).toStrictEqual([
			{key: "right"},
			{key: "enter"},
			{pause: 200},
			{key: "enter"},
		]);
	});

	it("always-allows by moving down to always_allow's index", () => {
		expect(elicitationSteps(verdictSchema, "always", fieldFocused)).toStrictEqual([
			{key: "right"},
			{key: "down"},
			{key: "down"},
			{key: "enter"},
			{pause: 200},
			{key: "enter"},
		]);
	});

	it("denies through the Decline stop, not the deny option", () => {
		expect(elicitationSteps(verdictSchema, "deny", fieldFocused)).toStrictEqual([
			{key: "down"},
			{key: "down"},
			{pause: 200},
			{key: "enter"},
		]);
		expect(elicitationSteps(verdictSchema, "deny", parsed(VERDICT_PICKED))).toStrictEqual([
			{key: "down"},
			{pause: 200},
			{key: "enter"},
		]);
		expect(elicitationSteps(verdictSchema, "deny", parsed(VERDICT_DECLINE_FOCUSED))).toStrictEqual([
			{pause: 200},
			{key: "enter"},
		]);
	});

	it("refuses always when the schema offers no always_allow", () => {
		expect(elicitationSteps(allowDenySchema, "always", fieldFocused)).toBeNull();
	});

	it("refuses allow unless the collapsed verdict field is focused", () => {
		expect(elicitationSteps(verdictSchema, "allow", parsed(VERDICT_EXPANDED))).toBeNull();
		expect(elicitationSteps(verdictSchema, "allow", parsed(VERDICT_PICKED))).toBeNull();
		expect(
			elicitationSteps({type: "object", properties: {name: {type: "string"}}}, "allow", fieldFocused),
		).toBeNull();
	});

	it("refuses deny while a list is expanded, since down would move through its options", () => {
		expect(elicitationSteps(verdictSchema, "deny", parsed(VERDICT_EXPANDED))).toBeNull();
	});

	it("cancels with esc, collapsing an open list first", () => {
		expect(elicitationSteps(verdictSchema, "cancel", fieldFocused)).toStrictEqual([{key: "esc"}]);
		expect(elicitationSteps(verdictSchema, "cancel", parsed(VERDICT_EXPANDED))).toStrictEqual([
			{key: "left"},
			{key: "esc"},
		]);
		expect(elicitationSteps(undefined, "cancel", parsed(URL_ACCEPT_FOCUSED))).toStrictEqual([{key: "esc"}]);
	});

	it("opens a URL only when the CLI put focus on Accept", () => {
		expect(elicitationSteps(undefined, "allow", parsed(URL_ACCEPT_FOCUSED))).toStrictEqual([{key: "enter"}]);
		expect(elicitationSteps(undefined, "allow", parsed(URL_DECLINE_FOCUSED))).toBeNull();
		expect(elicitationSteps(undefined, "always", parsed(URL_ACCEPT_FOCUSED))).toBeNull();
	});

	it("declines a URL from either stop", () => {
		expect(elicitationSteps(undefined, "deny", parsed(URL_ACCEPT_FOCUSED))).toStrictEqual([
			{key: "right"},
			{pause: 200},
			{key: "enter"},
		]);
		expect(elicitationSteps(undefined, "deny", parsed(URL_DECLINE_FOCUSED))).toStrictEqual([{key: "enter"}]);
	});
});
