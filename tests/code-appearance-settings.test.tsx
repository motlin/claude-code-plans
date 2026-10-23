// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {ClaudeCodeSettings} from "../src/components/settings/settings-sections";
import {ThemeProvider} from "../src/components/theme-provider";
import {requestLanguage, requestTheme} from "../src/hooks/use-shiki";
import {installLocalStorage} from "./fake-storage";

async function renderClaudeCode() {
	render(
		<ThemeProvider>
			<SettingsProvider>
				<ClaudeCodeSettings />
			</SettingsProvider>
		</ThemeProvider>,
	);
	await act(async () => {});
}

function preview(name: string) {
	const figure = screen.getByRole("figure", {name});
	return {
		theme: figure.getAttribute("data-code-theme"),
		background: figure.style.backgroundColor,
		text: figure.textContent,
	};
}

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({matches: false, addEventListener: () => {}, removeEventListener: () => {}})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.documentElement.style.removeProperty("--font-mono");
});

describe("Claude Code settings ▸ Code appearance", () => {
	it("ids its sections code-appearance and appearance, like upstream's Claude Code tab", async () => {
		await renderClaudeCode();

		expect(
			[...document.querySelectorAll("section[data-settings-section-titled]")].map((section) => section.id),
		).toStrictEqual(["code-appearance", "appearance"]);
	});

	it("re-renders the dark preview with the chosen theme", async () => {
		// Load the lazy preview chunk, the grammar and both themes up front, so the colours below
		// depend on rendering alone and not on how fast a loaded machine finishes the async imports.
		await Promise.all([
			import("../src/components/settings/code-theme-preview"),
			requestLanguage("typescript"),
			requestTheme("github-dark"),
			requestTheme("nord"),
		]);
		await renderClaudeCode();

		await waitFor(() => {
			expect(preview("Dark code theme preview").background).toBe("rgb(36, 41, 46)");
		});
		const before = preview("Dark code theme preview");

		fireEvent.click(screen.getByRole("combobox", {name: "Dark code theme"}));
		fireEvent.click(screen.getByRole("option", {name: "Nord"}));

		await waitFor(() => {
			expect(preview("Dark code theme preview").background).toBe("rgb(46, 52, 64)");
		});

		expect({
			before,
			after: preview("Dark code theme preview"),
			stored: localStorage.getItem("ccp-code-theme-dark"),
			light: preview("Light code theme preview").theme,
		}).toStrictEqual({
			before: {
				theme: "github-dark",
				background: "rgb(36, 41, 46)",
				text: '1function greet(name: string) {2-  return "Hello, " + name;2+  return `Hello, ${name}!`;3}',
			},
			after: {
				theme: "nord",
				background: "rgb(46, 52, 64)",
				text: '1function greet(name: string) {2-  return "Hello, " + name;2+  return `Hello, ${name}!`;3}',
			},
			stored: "nord",
			light: "claude-light",
		});
	});

	it("lays out the theme grid and diff preview with upstream's comfortable classes", async () => {
		await Promise.all([
			import("../src/components/settings/code-theme-preview"),
			requestLanguage("typescript"),
			requestTheme("claude-light"),
			requestTheme("github-dark"),
		]);
		await renderClaudeCode();
		await waitFor(() => {
			expect(screen.getByRole("figure", {name: "Light code theme preview"}).style.backgroundColor).not.toBe("");
		});

		const grid = document.querySelector('[data-settings-row="code-theme"]');
		const figure = screen.getByRole("figure", {name: "Light code theme preview"});
		const rows = [...figure.children];

		expect({
			grid: grid?.className,
			columns: [...(grid?.children ?? [])].map((column) => column.className),
			wrapper: figure.parentElement?.className,
			numbers: rows.map((row) => row.firstElementChild?.className),
			words: [...figure.querySelectorAll("[data-diff-word]")].map((word) => ({
				text: word.textContent,
				className: word.className,
			})),
		}).toStrictEqual({
			grid: "grid grid-cols-2 gap-4 py-3",
			columns: ["flex min-w-0 flex-col gap-2", "flex min-w-0 flex-col gap-2"],
			wrapper: "min-h-[94px] overflow-clip rounded-lg border",
			numbers: [
				"w-8 shrink-0 pr-2 text-right opacity-50 select-none",
				"w-8 shrink-0 pr-2 text-right text-[var(--upstream-git-removed)] select-none",
				"w-8 shrink-0 pr-2 text-right text-[var(--upstream-git-added)] select-none",
				"w-8 shrink-0 pr-2 text-right opacity-50 select-none",
			],
			words: [
				{text: '" +', className: "bg-[color-mix(in_srgb,var(--upstream-git-removed)_30%,transparent)]"},
				{text: "${name}!", className: "bg-[color-mix(in_srgb,var(--upstream-git-added)_30%,transparent)]"},
			],
		});
	});

	it("applies a custom code font to --font-mono and clears it when emptied", async () => {
		await renderClaudeCode();
		const input = screen.getByRole("textbox", {name: "Code font"});

		fireEvent.change(input, {target: {value: "Fira Code"}});
		const custom = document.documentElement.style.getPropertyValue("--font-mono");
		fireEvent.change(input, {target: {value: ""}});
		const cleared = document.documentElement.style.getPropertyValue("--font-mono");

		expect({
			placeholder: input.getAttribute("placeholder"),
			custom,
			cleared,
			stored: localStorage.getItem("ccp-code-font"),
		}).toStrictEqual({
			placeholder: "e.g. JetBrains Mono",
			custom: '"Fira Code", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
			cleared: "",
			stored: "",
		});
	});

	it("lets the terminal use the Ghostty config instead of the code theme", async () => {
		await renderClaudeCode();
		const select = screen.getByRole("combobox", {name: "Terminal colors"});
		const initial = select.textContent;

		fireEvent.click(select);
		const options = screen.getAllByRole("option").map((option) => option.textContent);
		fireEvent.click(screen.getByRole("option", {name: "Ghostty config"}));

		expect({
			initial,
			options,
			selected: screen.getByRole("combobox", {name: "Terminal colors"}).textContent,
			stored: localStorage.getItem("ccp-terminal-appearance"),
		}).toStrictEqual({
			initial: "Code theme",
			options: ["Code theme", "Ghostty config"],
			selected: "Ghostty config",
			stored: "ghostty",
		});
	});
});
