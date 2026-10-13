// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {FormEditor} from "../src/components/settings/settings-editors";

const promptHook = {type: "prompt", prompt: "Is this command safe?", timeout: 30};
const agentHook = {type: "agent", agent: "reviewer", extra: {nested: [1, 2]}};
const commandHook = {type: "command", command: "echo hi", timeout: 5};

const settings = {
	env: {A: "1", N: 5, B: "2"},
	permissions: {allow: ["Bash(ls:*)", {weird: 1}, "Read"], deny: [], ask: []},
	hooks: {
		PreToolUse: [{matcher: "Bash", hooks: [commandHook, promptHook, agentHook], note: "kept"}, "legacy-matcher"],
		Stop: {not: "a list"},
	},
	enabledPlugins: {"alpha@market": true, "beta@market": "yes"},
	additionalDirectories: ["/one", 42, "/two"],
	extraKnownMarketplaces: {
		good: {source: {source: "github", repo: "o/r"}, autoUpdate: true, pinned: "v1"},
		odd: {source: "not-an-object"},
	},
};

let savedBodies: string[] = [];

beforeEach(() => {
	savedBodies = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			savedBodies.push(typeof init?.body === "string" ? init.body : "");
			return new Response(JSON.stringify({path: "/home/test/.claude/settings.json"}), {
				status: 200,
				headers: {"Content-Type": "application/json"},
			});
		}),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderEditor(): void {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<FormEditor
				filename="settings.json"
				initialContent={JSON.stringify(settings)}
				path="/home/test/.claude/settings.json"
			/>
		</QueryClientProvider>,
	);
}

async function save(): Promise<unknown> {
	fireEvent.click(screen.getByRole("button", {name: "Save"}));
	await waitFor(() => {
		expect(savedBodies).toHaveLength(1);
	});
	return JSON.parse(savedBodies[0] ?? "");
}

describe("FormEditor preserves entries it does not understand", () => {
	it("shows a prompt-type hook's prompt text", () => {
		renderEditor();
		fireEvent.click(screen.getByRole("button", {name: /PreToolUse/}));
		expect(screen.getByText("Is this command safe?")).toBeTruthy();
	});

	it("round-trips prompt hooks and unrecognized hook entries when a command is edited", async () => {
		renderEditor();
		fireEvent.click(screen.getByRole("button", {name: /PreToolUse/}));
		fireEvent.change(screen.getByRole("textbox", {name: "PreToolUse rule 1 command 1"}), {
			target: {value: "echo bye"},
		});
		const saved = await save();
		expect(JSON.stringify(saved)).toBe(
			JSON.stringify({
				...settings,
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{...commandHook, command: "echo bye"}, promptHook, agentHook],
							note: "kept",
						},
						"legacy-matcher",
					],
					Stop: {not: "a list"},
				},
			}),
		);
	});

	it("round-trips unrecognized env, permission, plugin, list and marketplace entries when siblings are edited", async () => {
		renderEditor();
		fireEvent.change(screen.getByRole("textbox", {name: "Value of environment variable A"}), {
			target: {value: "changed"},
		});
		fireEvent.click(screen.getByRole("switch", {name: "alpha@market"}));
		fireEvent.change(screen.getByRole("textbox", {name: "Allow entry 2"}), {target: {value: "Write"}});
		fireEvent.click(screen.getByRole("button", {name: "good"}));
		fireEvent.click(screen.getByRole("switch", {name: "Auto-update"}));
		const saved = await save();
		expect(JSON.stringify(saved)).toBe(
			JSON.stringify({
				...settings,
				env: {A: "changed", N: 5, B: "2"},
				permissions: {allow: ["Bash(ls:*)", {weird: 1}, "Write"], deny: [], ask: []},
				enabledPlugins: {"alpha@market": false, "beta@market": "yes"},
				extraKnownMarketplaces: {
					good: {source: {source: "github", repo: "o/r"}, autoUpdate: false, pinned: "v1"},
					odd: {source: "not-an-object"},
				},
			}),
		);
	});

	it("keeps non-string list items in place when a string item is removed", async () => {
		renderEditor();
		const row = screen.getByRole("textbox", {name: "Additional directories entry 1"}).parentElement;
		fireEvent.click(row?.querySelector("button") ?? document.body);
		const saved = await save();
		expect(JSON.stringify(saved)).toBe(JSON.stringify({...settings, additionalDirectories: [42, "/two"]}));
	});
});
