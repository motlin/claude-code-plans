import {describe, expect, it} from "vite-plus/test";
import {HookEventEnvelope, type PermissionUpdate} from "../src/lib/hook-events";
import {PERSISTENT_ALLOW_LABELS, permissionDialogKey, persistentAllowKind} from "../src/lib/permission-suggestions";

const baseEnvelope = {
	session_id: "session-test-200",
	transcript_path: "/Users/user/.claude/projects/-Users-user-project/session-test-200.jsonl",
	cwd: "/Users/user/project",
	permission_mode: "default",
	hook_event_name: "PermissionRequest",
};

/** A Bash ask as Claude Code 2.1.301 sends it: one rule persisted to local settings. */
const bashRequest = {
	...baseEnvelope,
	tool_name: "Bash",
	tool_input: {command: "rm -rf dist", description: "Remove the build output"},
	permission_suggestions: [
		{
			type: "addRules",
			rules: [{toolName: "Bash", ruleContent: "rm -rf dist"}],
			behavior: "allow",
			destination: "localSettings",
		},
	],
};

/** An Edit outside the working directory: accept edits and add the directory, both for the session. */
const editRequest = {
	...baseEnvelope,
	tool_name: "Edit",
	tool_input: {file_path: "/tmp/outside/a.ts", old_string: "a", new_string: "b"},
	permission_suggestions: [
		{type: "setMode", mode: "acceptEdits", destination: "session"},
		{type: "addDirectories", directories: ["/tmp/outside"], destination: "session"},
	],
};

describe("PermissionRequest hook schema", () => {
	it("parses a Bash request with its addRules suggestion", () => {
		const result = HookEventEnvelope.safeParse(bashRequest);
		expect(result.success ? result.data : result.error.issues).toStrictEqual(bashRequest);
	});

	it("parses an Edit request with setMode and addDirectories suggestions", () => {
		const result = HookEventEnvelope.safeParse(editRequest);
		expect(result.success ? result.data : result.error.issues).toStrictEqual(editRequest);
	});

	it("parses a request without suggestions", () => {
		const {permission_suggestions: _omitted, ...request} = bashRequest;
		const result = HookEventEnvelope.safeParse(request);
		expect(result.success ? result.data : result.error.issues).toStrictEqual(request);
	});

	it("parses an MCP tool request with its server", () => {
		const request = {
			...baseEnvelope,
			tool_name: "mcp__github__create_issue",
			tool_input: {title: "Bug"},
			mcp_server: {name: "github", source: "user"},
			permission_suggestions: [
				{
					type: "addRules",
					rules: [{toolName: "mcp__github__create_issue"}],
					behavior: "allow",
					destination: "localSettings",
				},
			],
		};
		const result = HookEventEnvelope.safeParse(request);
		expect(result.success ? result.data : result.error.issues).toStrictEqual(request);
	});

	it.each([
		{
			name: "an unknown suggestion type",
			suggestion: {type: "grantEverything", destination: "session"},
		},
		{
			name: "an unknown destination",
			suggestion: {type: "addDirectories", directories: ["/tmp"], destination: "everywhere"},
		},
		{
			name: "an unknown rule behavior",
			suggestion: {type: "addRules", rules: [{toolName: "Bash"}], behavior: "maybe", destination: "session"},
		},
		{
			name: "an extra suggestion field",
			suggestion: {type: "setMode", mode: "acceptEdits", destination: "session", sticky: true},
		},
	])("rejects $name", ({suggestion}) => {
		expect(HookEventEnvelope.safeParse({...bashRequest, permission_suggestions: [suggestion]}).success).toBe(false);
	});
});

describe("persistentAllowKind", () => {
	it.each<{name: string; suggestions: PermissionUpdate[] | undefined; kind: string | null}>([
		{name: "no suggestions", suggestions: undefined, kind: null},
		{name: "an empty list", suggestions: [], kind: null},
		{
			name: "a rule persisted to local settings",
			suggestions: bashRequest.permission_suggestions as PermissionUpdate[],
			kind: "always",
		},
		{
			name: "a rule persisted to user settings",
			suggestions: [
				{type: "addRules", rules: [{toolName: "WebFetch"}], behavior: "allow", destination: "userSettings"},
			],
			kind: "always",
		},
		{
			name: "session-scoped edits and directories",
			suggestions: editRequest.permission_suggestions as PermissionUpdate[],
			kind: "perChat",
		},
		{
			name: "a session-scoped read rule",
			suggestions: [
				{
					type: "addRules",
					rules: [{toolName: "Read", ruleContent: "//tmp/**"}],
					behavior: "allow",
					destination: "session",
				},
			],
			kind: "perChat",
		},
		{
			name: "only rule removals, which the dialog never offers",
			suggestions: [
				{type: "removeRules", rules: [{toolName: "Bash"}], behavior: "deny", destination: "localSettings"},
			],
			kind: null,
		},
		{
			name: "a deny rule, which is not an allow option",
			suggestions: [
				{type: "addRules", rules: [{toolName: "Bash"}], behavior: "deny", destination: "localSettings"},
			],
			kind: null,
		},
	])("is $kind for $name", ({suggestions, kind}) => {
		expect(persistentAllowKind(suggestions)).toStrictEqual(kind);
	});

	it("labels each kind with upstream's copy", () => {
		expect(PERSISTENT_ALLOW_LABELS).toStrictEqual({
			always: "Always allow",
			perChat: "Allow for this session",
		});
	});
});

describe("permissionDialogKey", () => {
	it.each([
		{shape: "no persistent option", persistent: null, decision: "allow", key: "1"},
		{shape: "no persistent option", persistent: null, decision: "deny", key: "esc"},
		{shape: "no persistent option", persistent: null, decision: "always", key: null},
		{shape: "an always-allow option", persistent: "always", decision: "allow", key: "1"},
		{shape: "an always-allow option", persistent: "always", decision: "always", key: "2"},
		{shape: "an always-allow option", persistent: "always", decision: "deny", key: "esc"},
		{shape: "a session option", persistent: "perChat", decision: "always", key: "2"},
	] as const)("sends $key for $decision on a dialog with $shape", ({persistent, decision, key}) => {
		expect(permissionDialogKey(decision, persistent)).toStrictEqual(key);
	});
});
