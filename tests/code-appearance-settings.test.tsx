// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {ClaudeCodeSettings} from "../src/components/settings/settings-sections";
import {ThemeProvider} from "../src/components/theme-provider";
import {requestLanguage, requestTheme} from "../src/hooks/use-shiki";
import {installLocalStorage} from "./fake-storage";

async function renderClaudeCode() {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ThemeProvider>
				<SettingsProvider>
					<ClaudeCodeSettings />
				</SettingsProvider>
			</ThemeProvider>
		</QueryClientProvider>,
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
	// The Sessions rows load /api/claude-code-settings; keep them loading and off the network.
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Promise<Response>(() => {})),
	);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({matches: false, addEventListener: () => {}, removeEventListener: () => {}})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.documentElement.style.removeProperty("--font-mono");
	document.documentElement.style.removeProperty("--epitaxy-code-font-size");
	document.documentElement.style.removeProperty("--epitaxy-code-leading");
});

describe("Claude Code settings ▸ Code appearance", () => {
	it("ids its sections code-appearance, appearance, remote-control and local-sessions, like upstream's Claude Code tab", async () => {
		await renderClaudeCode();

		expect(
			[...document.querySelectorAll("section[data-settings-section-titled]")].map((section) => section.id),
		).toStrictEqual(["code-appearance", "appearance", "remote-control", "local-sessions"]);
	});

	it("re-renders the dark preview with the chosen theme", async () => {
		// Load the lazy preview chunk, the grammar and both themes up front, so the colours below
		// depend on rendering alone and not on how fast a loaded machine finishes the async imports.
		await Promise.all([
			import("../src/components/settings/code-theme-preview"),
			requestLanguage("typescript"),
			requestTheme("claude-dark"),
			requestTheme("nord"),
		]);
		await renderClaudeCode();

		await waitFor(() => {
			expect(preview("Dark code theme preview").background).toBe("rgb(25, 25, 25)");
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
				theme: "claude-dark",
				background: "rgb(25, 25, 25)",
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
			requestTheme("claude-dark"),
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
				{
					text: '" +',
					className: "bg-[color-mix(in_srgb,var(--upstream-git-removed)_30%,transparent)]",
				},
				{
					text: "${name}!",
					className: "bg-[color-mix(in_srgb,var(--upstream-git-added)_30%,transparent)]",
				},
			],
		});
	});

	it("applies a custom code font to --font-mono and clears it when emptied", async () => {
		await renderClaudeCode();
		const input = screen.getByRole("textbox", {name: "Code font family"});

		fireEvent.change(input, {target: {value: "Fira Code"}});
		const custom = document.documentElement.style.getPropertyValue("--font-mono");
		fireEvent.change(input, {target: {value: ""}});
		const cleared = document.documentElement.style.getPropertyValue("--font-mono");

		expect({
			placeholder: input.getAttribute("placeholder"),
			className: input.className,
			custom,
			cleared,
			stored: localStorage.getItem("ccp-code-font"),
		}).toStrictEqual({
			placeholder: "e.g. JetBrains Mono",
			className:
				"h-8 w-56 rounded-r6 bg-[var(--settings-field-bg)] px-3 text-body text-primary outline-none placeholder:text-[var(--settings-muted)] shadow-field-ring transition duration-150 enabled:[&:hover:not(:focus)]:shadow-field-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
			custom: '"Fira Code", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
			cleared: "",
			stored: "",
		});
	});

	// Upstream's 2026-11 Code font size row: a device select (11-20px, default 13) without a filter whose
	// choice sets --epitaxy-code-font-size and --epitaxy-code-leading (round(px * 1.45)) in rem on <html>.
	it("renders upstream's Code font size row after Code font with a filterless size select", async () => {
		await renderClaudeCode();
		// Outside the dialog there is no tab context, so the row has its slug but no setting-<tab>- id.
		const row = document.querySelector('[data-settings-row="code-font-size"]');
		const trigger = screen.getByRole("combobox", {name: "Code font size"});
		const slugs = [...(row?.parentElement?.querySelectorAll("[data-settings-row]") ?? [])].map((element) =>
			element.getAttribute("data-settings-row"),
		);

		fireEvent.click(trigger);

		expect({
			title: row?.querySelector(".settings-row-title")?.textContent,
			description: row?.querySelector("[data-settings-desc]")?.textContent,
			wrapper: trigger.closest("[data-settings-control] > div")?.className.split(" ").includes("w-56"),
			trigger: trigger.textContent,
			lastSlugs: slugs.slice(-2),
			filter: screen.queryByRole("searchbox"),
			options: screen.getAllByRole("option").map((option) => option.textContent),
			selected: screen
				.getAllByRole("option")
				.filter((option) => option.getAttribute("aria-selected") === "true")
				.map((option) => option.textContent),
		}).toStrictEqual({
			title: "Code font size",
			description: "Applies to open files, diffs, code blocks, command output, and the terminal.",
			wrapper: true,
			trigger: "Default · 13 px",
			lastSlugs: ["code-font", "code-font-size"],
			filter: null,
			options: ["Default · 13 px", "11 px", "12 px", "13 px", "14 px", "15 px", "16 px", "18 px", "20 px"],
			selected: ["Default · 13 px"],
		});
	});

	it("stores a picked code font size and sets upstream's rem size and leading on <html>, and Default clears both", async () => {
		await renderClaudeCode();
		const style = document.documentElement.style;
		const read = () => ({
			trigger: screen.getByRole("combobox", {name: "Code font size"}).textContent,
			stored: localStorage.getItem("ccp-code-font-size"),
			size: style.getPropertyValue("--epitaxy-code-font-size"),
			leading: style.getPropertyValue("--epitaxy-code-leading"),
		});

		fireEvent.click(screen.getByRole("combobox", {name: "Code font size"}));
		fireEvent.click(screen.getByRole("option", {name: "16 px"}));
		const picked = read();
		fireEvent.click(screen.getByRole("combobox", {name: "Code font size"}));
		fireEvent.click(screen.getByRole("option", {name: "Default · 13 px"}));
		const reset = read();

		expect({picked, reset}).toStrictEqual({
			picked: {trigger: "16 px", stored: "16", size: "1rem", leading: "1.4375rem"},
			reset: {trigger: "Default · 13 px", stored: "null", size: "", leading: ""},
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
