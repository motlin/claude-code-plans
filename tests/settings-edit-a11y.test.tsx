// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {FIELD_DEFINITIONS, OBJECT_EDITORS} from "../src/lib/settings-fields";
import {FormEditor} from "../src/components/settings/settings-editors";

function scalarFixture(): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const field of FIELD_DEFINITIONS) {
		switch (field.type) {
			case "boolean":
				result[field.key] = true;
				break;
			case "number":
				result[field.key] = 7;
				break;
			case "enum":
				result[field.key] = field.options?.[0]?.value ?? "";
				break;
			case "string":
				result[field.key] = "value";
				break;
		}
	}
	return result;
}

function objectEditorsFixture(): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const def of OBJECT_EDITORS) {
		const value: Record<string, unknown> = {};
		for (const subField of def.fields) {
			switch (subField.type) {
				case "boolean":
					value[subField.key] = true;
					break;
				case "number":
					value[subField.key] = 3;
					break;
				case "string":
					value[subField.key] = "text";
					break;
				case "stringList":
					value[subField.key] = ["one", "two"];
					break;
			}
		}
		result[def.key] = value;
	}
	return result;
}

const settings = {
	...scalarFixture(),
	env: {FOO: "bar", BAZ: "qux"},
	permissions: {allow: ["Bash(ls:*)"], deny: ["Read(.env)"], ask: ["Write"], defaultMode: "plan"},
	statusLine: {type: "command", command: "~/.claude/statusline.sh", padding: 1},
	hooks: {PreToolUse: [{matcher: "Bash", hooks: [{type: "command", command: "echo hi"}]}]},
	enabledPlugins: {"alpha@market": true, "beta@market": false},
	enabledMcpjsonServers: ["server-a"],
	additionalDirectories: ["/path/to/dir"],
	extraKnownMarketplaces: {
		"motlin/claude-code-plugins": {
			source: {source: "github", repo: "motlin/claude-code-plugins"},
			autoUpdate: true,
		},
	},
	...objectEditorsFixture(),
};

function renderEditor(): void {
	const queryClient = new QueryClient();
	render(
		<QueryClientProvider client={queryClient}>
			<FormEditor
				filename="settings.json"
				initialContent={JSON.stringify(settings)}
				path="/home/test/.claude/settings.json"
			/>
		</QueryClientProvider>,
	);
	fireEvent.click(screen.getByRole("button", {name: /PreToolUse/}));
	fireEvent.click(screen.getByRole("button", {name: "motlin/claude-code-plugins"}));
}

function unnamed(role: string): string[] {
	return screen.queryAllByRole(role, {name: (name) => name.trim() === ""}).map((el) => el.outerHTML.slice(0, 120));
}

afterEach(() => {
	cleanup();
});

describe("settings form editor accessible names", () => {
	it("renders the controls being checked", () => {
		renderEditor();
		expect(screen.getAllByRole("switch").length).toBeGreaterThan(10);
		expect(screen.getAllByRole("textbox").length).toBeGreaterThan(20);
	});

	it("gives every form control a non-empty accessible name", () => {
		renderEditor();
		expect({
			switch: unnamed("switch"),
			textbox: unnamed("textbox"),
			combobox: unnamed("combobox"),
			spinbutton: unnamed("spinbutton"),
		}).toStrictEqual({switch: [], textbox: [], combobox: [], spinbutton: []});
	});

	it("names switches and fields after their setting labels", () => {
		renderEditor();
		expect(screen.getByRole("switch", {name: "Enabled"}).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("switch", {name: "alpha@market"}).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("switch", {name: "Auto-update"}).getAttribute("aria-checked")).toBe("true");
		expect((screen.getByRole("textbox", {name: "Command"}) as HTMLInputElement).value).toBe(
			"~/.claude/statusline.sh",
		);
		expect((screen.getByRole("textbox", {name: "Repo"}) as HTMLInputElement).value).toBe(
			"motlin/claude-code-plugins",
		);
	});
});
