import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {
	parsePermissionDialog,
	permissionDialogSteps,
	showsPermissionQuestion,
	type PermissionDialogRows,
} from "../src/lib/herdr/permission-screen";
import {
	BASH_ASK_RULE,
	BASH_COMPOUND_ADD_DIR,
	BASH_FULL,
	BASH_FULL_FOCUS_NO,
	BASH_FULL_FOCUS_PREFIX_ROW,
	BASH_FULL_NO_FEEDBACK_TYPED,
	BASH_FULL_NO_INPUT_MODE,
	BASH_HOOK_ASK,
	BASH_UNICODE_WHITESPACE,
	BASH_WITHHELD,
	CLASSIFIER_FALLBACK,
	EDIT_ACCEPT_EDITS_ROW,
	EDIT_CLAUDE_MD,
	EDIT_HOOK_ASK,
	READ_OUTSIDE_AUTO_FIRST_PROMPT,
	READ_OUTSIDE_SESSION_DIR,
	WEBFETCH,
	WEBFETCH_FOCUS_NO,
	WRITE_CREATE,
} from "./fixtures/permission-screens";

const PLAN_DIALOG = readFileSync(join(import.meta.dirname, "fixtures/plan-approval-dialog.txt"), "utf8");

const YES = {kind: "yes", label: "Yes"} as const;
const NO = {kind: "no", label: "No"} as const;
const AUTO = {kind: "auto", label: "Yes, and switch to auto mode"} as const;
const NPM_PREFIX = {kind: "persistent", label: "Yes, and don’t ask again for: npm run *"} as const;
const ACCEPT_EDITS = {
	kind: "persistent",
	label: "Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)",
} as const;

function bashFull(focused: number, no: {kind: "no"; label: string} = NO): PermissionDialogRows {
	return {indexed: true, focused, rows: [YES, NPM_PREFIX, AUTO, no]};
}

const YES_NO: PermissionDialogRows = {indexed: true, focused: 0, rows: [YES, NO]};
const ACCEPT_EDITS_DIALOG: PermissionDialogRows = {indexed: true, focused: 0, rows: [YES, ACCEPT_EDITS, NO]};

describe("parsePermissionDialog", () => {
	it.each([
		{name: "BASH_FULL", screen: BASH_FULL, expected: bashFull(0)},
		{name: "BASH_FULL_FOCUS_PREFIX_ROW", screen: BASH_FULL_FOCUS_PREFIX_ROW, expected: bashFull(1)},
		{name: "BASH_FULL_FOCUS_NO", screen: BASH_FULL_FOCUS_NO, expected: bashFull(3)},
		{
			name: "BASH_FULL_NO_INPUT_MODE",
			screen: BASH_FULL_NO_INPUT_MODE,
			expected: bashFull(3, {kind: "no", label: "No, and tell Claude what to do differently"}),
		},
		{
			name: "BASH_FULL_NO_FEEDBACK_TYPED",
			screen: BASH_FULL_NO_FEEDBACK_TYPED,
			expected: bashFull(3, {kind: "no", label: "No, try x"}),
		},
		{name: "BASH_ASK_RULE", screen: BASH_ASK_RULE, expected: YES_NO},
		{name: "BASH_HOOK_ASK", screen: BASH_HOOK_ASK, expected: YES_NO},
		{name: "BASH_WITHHELD", screen: BASH_WITHHELD, expected: YES_NO},
		{name: "EDIT_CLAUDE_MD", screen: EDIT_CLAUDE_MD, expected: YES_NO},
		{
			name: "BASH_UNICODE_WHITESPACE",
			screen: BASH_UNICODE_WHITESPACE,
			expected: {indexed: true, focused: 0, rows: [YES, AUTO, NO]},
		},
		{
			name: "BASH_COMPOUND_ADD_DIR",
			screen: BASH_COMPOUND_ADD_DIR,
			expected: {
				indexed: true,
				focused: 0,
				rows: [
					YES,
					{kind: "persistent", label: "Yes, allow reading from /private/tmp from this project"},
					AUTO,
					NO,
				],
			},
		},
		{name: "EDIT_ACCEPT_EDITS_ROW", screen: EDIT_ACCEPT_EDITS_ROW, expected: ACCEPT_EDITS_DIALOG},
		{name: "EDIT_HOOK_ASK", screen: EDIT_HOOK_ASK, expected: ACCEPT_EDITS_DIALOG},
		{name: "WRITE_CREATE", screen: WRITE_CREATE, expected: ACCEPT_EDITS_DIALOG},
		{
			name: "READ_OUTSIDE_SESSION_DIR",
			screen: READ_OUTSIDE_SESSION_DIR,
			expected: {
				indexed: true,
				focused: 0,
				rows: [
					YES,
					{
						kind: "persistent",
						label: "Yes, allow reading from /private/tmp/claude-501/-Users-craig-projects-claude-code-plans/10e1d0 ca-19a8-4418-990a-f66008edde61/scratchpad/spike/outside during this session",
					},
					NO,
				],
			},
		},
		{
			name: "WEBFETCH",
			screen: WEBFETCH,
			expected: {
				indexed: true,
				focused: 0,
				rows: [
					YES,
					{kind: "persistent", label: "Yes, and don't ask again for example.com"},
					{kind: "no", label: "No, and tell Claude what to do differently"},
				],
			},
		},
		{
			name: "WEBFETCH_FOCUS_NO",
			screen: WEBFETCH_FOCUS_NO,
			expected: {
				indexed: true,
				focused: 2,
				rows: [
					YES,
					{kind: "persistent", label: "Yes, and don't ask again for example.com"},
					{kind: "no", label: "No, and tell Claude what to do differently"},
				],
			},
		},
		{
			name: "CLASSIFIER_FALLBACK",
			screen: CLASSIFIER_FALLBACK,
			expected: {indexed: false, focused: 0, rows: [NO, YES]},
		},
	])("reads $name", ({screen, expected}) => {
		expect(parsePermissionDialog(screen)).toStrictEqual(expected);
	});

	it.each([
		{name: "the plan approval dialog", screen: PLAN_DIALOG},
		{name: "BASH_FULL without its footer", screen: BASH_FULL.replace(" Esc to cancel · Tab to amend\n", "")},
		{
			name: "the auto-mode outside-read first prompt, which has its own shape",
			screen: READ_OUTSIDE_AUTO_FIRST_PROMPT,
		},
		{
			name: "ten indexed rows",
			screen: [
				" Do you want to proceed?",
				" ❯ 1. Yes",
				...Array.from({length: 8}, (_, index) => `   ${index + 2}. Yes, option ${index + 2}`),
				"   10. No",
				"",
				" Esc to cancel",
			].join("\n"),
		},
		{
			name: "rows numbered out of order",
			screen: " Do you want to proceed?\n ❯ 1. Yes\n   3. No\n\n Esc to cancel",
		},
		{
			name: "a first row that is not Yes",
			screen: " Do you want to proceed?\n ❯ 1. Maybe\n   2. No\n\n Esc to cancel",
		},
		{
			name: "two persistent rows",
			screen: " Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, a\n   3. Yes, b\n   4. No\n\n Esc to cancel",
		},
	])("refuses $name", ({screen}) => {
		expect(parsePermissionDialog(screen)).toBeNull();
	});
});

describe("showsPermissionQuestion", () => {
	it.each([
		{name: "BASH_FULL", screen: BASH_FULL, expected: true},
		{name: "WEBFETCH", screen: WEBFETCH, expected: true},
		{
			name: "BASH_FULL without its footer",
			screen: BASH_FULL.replace(" Esc to cancel · Tab to amend\n", ""),
			expected: true,
		},
		{name: "the plan approval dialog", screen: PLAN_DIALOG, expected: false},
		{name: "the auto-mode outside-read first prompt", screen: READ_OUTSIDE_AUTO_FIRST_PROMPT, expected: false},
	])("is $expected for $name", ({screen, expected}) => {
		expect(showsPermissionQuestion(screen)).toStrictEqual(expected);
	});
});

describe("permissionDialogSteps", () => {
	const unicode: PermissionDialogRows = {indexed: true, focused: 0, rows: [YES, AUTO, NO]};
	const hidden: PermissionDialogRows = {indexed: false, focused: 0, rows: [NO, YES]};

	it.each([
		{name: "allow on BASH_FULL", rows: bashFull(0), decision: "allow", expected: [["1"]]},
		{name: "always on BASH_FULL", rows: bashFull(0), decision: "always", expected: [["2"]]},
		{name: "deny on BASH_FULL", rows: bashFull(0), decision: "deny", expected: [["esc"]]},
		{name: "always without a persistent row", rows: unicode, decision: "always", expected: null},
		{name: "allow on the hidden form", rows: hidden, decision: "allow", expected: [["down"], ["enter"]]},
		{name: "always on the hidden form", rows: hidden, decision: "always", expected: null},
		{name: "deny on the hidden form", rows: hidden, decision: "deny", expected: [["esc"]]},
	] as const)("$name", ({rows, decision, expected}) => {
		expect(permissionDialogSteps(rows, decision)).toStrictEqual(expected);
	});
});
