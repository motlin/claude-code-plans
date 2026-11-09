// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({
		settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const prompt = {type: "user", uuid: "u-prompt", message: {role: "user", content: "Fabricated request"}};
const STOPPED =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

interface Call {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result: string;
	isError?: boolean;
	stopped?: boolean;
}

function call({id, name, input, result, isError, stopped}: Call): unknown[] {
	return [
		{
			type: "assistant",
			uuid: `a-${id}`,
			message: {id: `msg-${id}`, role: "assistant", content: [{type: "tool_use", id, name, input}]},
		},
		{
			type: "user",
			uuid: `r-${id}`,
			...(stopped === true ? {toolDenialKind: "user-rejected", toolUseResult: "User rejected tool use"} : {}),
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						content: result,
						...(isError === true ? {is_error: true} : {}),
					},
				],
			},
		},
	];
}

const failed = (name: string, input: Record<string, unknown>): Call => ({
	id: "failed",
	name,
	input,
	result: "<tool_use_error>Fabricated failure</tool_use_error>",
	isError: true,
});

const leadingBash: Call = {id: "lead", name: "Bash", input: {command: "ls"}, result: "ok"};

interface RowParts {
	label: string | undefined;
	meta: string | undefined;
	outcome: string | undefined;
	outcomeClass: string | undefined;
}

function partsOf(row: Element | null | undefined): RowParts {
	const outcome = row?.querySelector('[id$="-outcome"]');
	return {
		label: row?.querySelector('[id$="-label"]')?.textContent,
		meta: row?.querySelector('[id$="-meta"]')?.textContent,
		outcome: outcome?.textContent,
		outcomeClass: outcome?.className,
	};
}

/** The failed call's row, drawn alone or nested in a group after a successful Bash. */
function failedRow(target: Call, grouped: boolean): RowParts {
	const records = [prompt, ...(grouped ? call(leadingBash) : []), ...call(target)];
	const {lines, toolResultMap} = processTranscript(records);
	const {container} = render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			transcriptMode="normal"
			showTools
			showThinking={false}
			shouldScrollToEnd={false}
		/>,
	);
	if (grouped) {
		const toggle = container.querySelector<HTMLElement>("button[aria-expanded]");
		if (toggle === null) throw new Error("no group toggle");
		fireEvent.click(toggle);
	}
	const rows = container.querySelectorAll("[data-tool-row]");
	const parts = partsOf(rows[rows.length - 1]);
	cleanup();
	return parts;
}

const DANGER = "shrink-0 text-body text-danger";

describe("failed transcript rows read the running shape", () => {
	it("draws a failed Read as Reading + file + Failed, alone and grouped", () => {
		const read = failed("Read", {file_path: "/nonexistent/upstream-sync.txt"});
		expect({lone: failedRow(read, false), grouped: failedRow(read, true)}).toStrictEqual({
			lone: {label: "Reading", meta: "upstream-sync.txt", outcome: "Failed", outcomeClass: DANGER},
			grouped: {label: "Reading upstream-sync.txt", meta: undefined, outcome: "Failed", outcomeClass: DANGER},
		});
	});

	it("keeps a failed Bash's description as written, with no meta", () => {
		const bash = failed("Bash", {command: "npm test", description: "Run the tests"});
		expect({lone: failedRow(bash, false), grouped: failedRow(bash, true)}).toStrictEqual({
			lone: {label: "Run the tests", meta: undefined, outcome: "Failed", outcomeClass: DANGER},
			grouped: {label: "Run the tests", meta: undefined, outcome: "Failed", outcomeClass: DANGER},
		});
	});

	it("draws a failed Bash with no description as Running + command", () => {
		const bash = failed("Bash", {command: "npm test"});
		expect({lone: failedRow(bash, false), grouped: failedRow(bash, true)}).toStrictEqual({
			lone: {label: "Running", meta: "npm test", outcome: "Failed", outcomeClass: DANGER},
			grouped: {label: "Running npm test", meta: undefined, outcome: "Failed", outcomeClass: DANGER},
		});
	});

	it("keeps a failed Agent's description as written", () => {
		const agent = failed("Agent", {description: "Audit the sidebar", prompt: "Fabricated prompt"});
		expect(failedRow(agent, false)).toStrictEqual({
			label: "Audit the sidebar",
			meta: undefined,
			outcome: "Failed",
			outcomeClass: DANGER,
		});
	});

	it("draws a failed Workflow as Running workflow + name + Failed", () => {
		const workflow = failed("Workflow", {scriptPath: "/x/wf.js"});
		expect(failedRow(workflow, false)).toStrictEqual({
			label: "Running workflow",
			meta: "wf",
			outcome: "Failed",
			outcomeClass: DANGER,
		});
	});

	it("draws a failed MCP call with Using", () => {
		const mcp = failed("mcp__claude-in-chrome__navigate", {url: "https://example.invalid"});
		expect(failedRow(mcp, false)).toStrictEqual({
			label: "Using claude-in-chrome: navigate",
			meta: undefined,
			outcome: "Failed",
			outcomeClass: DANGER,
		});
	});

	it("keeps a stopped Read's success shape", () => {
		const read: Call = {
			id: "stopped",
			name: "Read",
			input: {file_path: "/repo/a.ts"},
			result: STOPPED,
			isError: true,
			stopped: true,
		};
		expect(failedRow(read, false)).toStrictEqual({
			label: "Read",
			meta: "a.ts",
			outcome: "Stopped",
			outcomeClass: "shrink-0 text-body text-secondary",
		});
	});
});

describe("benign tool errors", () => {
	it("settles a no-op ExitWorktree done as No worktree to leave", () => {
		const exit: Call = {
			id: "exit",
			name: "ExitWorktree",
			input: {action: "keep"},
			result: "No-op: there is no active EnterWorktree session to exit.",
			isError: true,
		};
		expect({lone: failedRow(exit, false), grouped: failedRow(exit, true)}).toStrictEqual({
			lone: {label: "No worktree to leave", meta: undefined, outcome: undefined, outcomeClass: undefined},
			grouped: {label: "No worktree to leave", meta: undefined, outcome: undefined, outcomeClass: undefined},
		});
	});
});
