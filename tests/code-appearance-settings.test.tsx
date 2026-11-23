// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {GeneralSettings} from "../src/components/settings/settings-sections";
import {ThemeProvider} from "../src/components/theme-provider";
import {requestLanguage, requestTheme} from "../src/hooks/use-shiki";
import {installLocalStorage} from "./fake-storage";

async function renderAppearance()
{
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ThemeProvider>
				<SettingsProvider>
					<GeneralSettings />
				</SettingsProvider>
			</ThemeProvider>
		</QueryClientProvider>,
	);
	await act(async () => {});
}

function preview(name: string)
{
	const figure = screen.getByRole(
		"figure",
		{
			name,
		},
	);
	const root = figure.querySelector("diffs-container")?.shadowRoot;
	return {
		theme: figure.getAttribute("data-code-theme"),
		background: /--diffs-bg:([^;]*)/.exec(root?.querySelector("style[data-theme-css]")?.textContent ?? "")?.[1],
		rows: [...(root?.querySelectorAll("[data-content] > [data-line]") ?? [])].map((row) => row.textContent),
	};
}

class FakeResizeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
	takeRecords()
	{
		return [];
	}
}

beforeEach(() =>
{
	installLocalStorage();
	// The preview's pierre FileDiff observes its size, which jsdom lacks.
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	// The Sessions rows load /api/claude-code-settings; keep them loading and off the network.
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Promise<Response>(() => {})),
	);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => (
		{
			matches: false,
			addEventListener: () =>
			{
			},
			removeEventListener: () =>
			{
			},
		})),
	);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	document.documentElement.style.removeProperty("--font-mono");
	document.documentElement.style.removeProperty("--epitaxy-code-font-size");
	document.documentElement.style.removeProperty("--epitaxy-code-leading");
	delete document.documentElement.dataset["codeFontSize"];
});

describe("Appearance settings ▸ Code", () =>
{
	it("ids its sections general and code-appearance, like upstream's grouped Appearance tab (GeneralCodeLooks)", async () =>
	{
		await renderAppearance();

		expect(
			[...document.querySelectorAll("section[data-settings-section-titled]")].map((section) => [
				section.id,
				section.querySelector("h3")?.textContent,
			]),
		).toStrictEqual([
			["general", "General"],
			["code-appearance", "Code"],
		]);
	});

	it("re-renders the dark preview with the chosen theme", async () =>
	{
		// Load the lazy preview chunk, the grammar and both themes up front, so the colours below
		// depend on rendering alone and not on how fast a loaded machine finishes the async imports.
		await Promise.all([
			import("../src/components/settings/code-theme-preview"),
			requestLanguage("typescript"),
			requestTheme("claude-dark"),
			requestTheme("nord"),
		]);
		await renderAppearance();

		await waitFor(() =>
		{
			expect(preview("Dark code theme preview").background).toBe("#191919");
		});
		const before = preview("Dark code theme preview");

		fireEvent.click(
			screen.getByRole(
				"combobox",
				{
					name: "Dark code theme",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: "Nord",
				},
			),
		);

		await waitFor(() =>
		{
			expect(preview("Dark code theme preview").background).toBe("#2e3440ff");
		});

		expect(
			{
				before,
				after: preview("Dark code theme preview"),
				stored: localStorage.getItem("ccp-code-theme-dark"),
				light: preview("Light code theme preview").theme,
			},
		).toStrictEqual(
			{
				before:
				{
					theme: "claude-dark",
					background: "#191919",
					rows: [
						"function greet(name: string) {",
						'  return "Hello, " + name;',
						"  return `Hello, ${name}!`;",
						"}",
					],
				},
				after:
				{
					theme: "nord",
					background: "#2e3440ff",
					rows: [
						"function greet(name: string) {",
						'  return "Hello, " + name;',
						"  return `Hello, ${name}!`;",
						"}",
					],
				},
				stored: "nord",
				light: "claude-light",
			},
		);
	});

	// Upstream cda9efc49: the preview is a pierre FileDiff through ne() = Q(true, false), so rails, never the add button.
	it("lays out the theme grid and draws the preview as a pierre diff with change rails", async () =>
	{
		await Promise.all([
			import("../src/components/settings/code-theme-preview"),
			requestLanguage("typescript"),
			requestTheme("claude-light"),
			requestTheme("claude-dark"),
		]);
		await renderAppearance();
		const figure = screen.getByRole(
			"figure",
			{
				name: "Light code theme preview",
			},
		);
		const grid = document.querySelector('[data-settings-row="code-theme"]');

		await waitFor(() =>
		{
			const host = figure.querySelector("diffs-container");
			const root = host?.shadowRoot;
			if (!root?.querySelector("[data-gutter] > [data-line-type]")) throw new Error("no rendered rows yet");
			expect(
				{
					grid: grid?.className,
					columns: [...(grid?.children ?? [])].map((column) => column.className),
					wrapper: figure.parentElement?.className,
					rails: root.adoptedStyleSheets.some((sheet) =>
						[...sheet.cssRules].some((rule) => rule.cssText.includes("--diff-rail-added")),
					),
					marks: [...root.querySelectorAll("[data-gutter] > [data-line-type]")].map((row) =>
						[
							row.getAttribute("data-line-type"),
							row.hasAttribute("data-rail-start") ? "start" : "",
							row.hasAttribute("data-rail-end") ? "end" : "",
						]
							.filter(Boolean)
							.join(":"),
					),
					rows: [...root.querySelectorAll("[data-content] > [data-line]")].map((row) => row.textContent),
					addButton: host?.hasAttribute("data-add-button"),
				},
			).toStrictEqual(
				{
					grid: "grid grid-cols-2 gap-4 py-3",
					columns: ["flex min-w-0 flex-col gap-2", "flex min-w-0 flex-col gap-2"],
					wrapper: "epitaxy-codeblock overflow-clip rounded-lg border",
					rails: true,
					marks: ["context", "change-deletion:start", "change-addition:end", "context"],
					rows: [
						"function greet(name: string) {",
						'  return "Hello, " + name;',
						"  return `Hello, ${name}!`;",
						"}",
					],
					addButton: false,
				},
			);
		});
	});

	// Upstream `JG`: the preview's min-height is 4 code lines + 18px, the leading round(px * 1.45), 19px at Default.
	it("scales the code theme preview's min-height and leading with Code font size", async () =>
	{
		await import("../src/components/settings/code-theme-preview");
		await renderAppearance();
		const read = () =>
		{
			const figure = screen.getByRole(
				"figure",
				{
					name: "Light code theme preview",
				},
			);
			return {
				minHeight: figure.style.minHeight,
				leading: figure.classList.contains("leading-[var(--code-leading,20px)]"),
				hook: figure.parentElement?.classList.contains("epitaxy-codeblock"),
			};
		};

		const initial = read();
		fireEvent.click(
			screen.getByRole(
				"combobox",
				{
					name: "Code font size",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: "20 px",
				},
			),
		);
		const picked = read();

		expect(
			{
				initial,
				picked,
			},
		).toStrictEqual(
			{
				initial:
				{
					minHeight: "94px",
					leading: true,
					hook: true,
				},
				picked:
				{
					minHeight: "134px",
					leading: true,
					hook: true,
				},
			},
		);
	});

	it("applies a custom code font to --font-mono and clears it when emptied", async () =>
	{
		await renderAppearance();
		const input = screen.getByRole(
			"textbox",
			{
				name: "Code font family",
			},
		);

		fireEvent.change(
			input,
			{
				target:
				{
					value: "Fira Code",
				},
			},
		);
		const custom = document.documentElement.style.getPropertyValue("--font-mono");
		fireEvent.change(
			input,
			{
				target:
				{
					value: "",
				},
			},
		);
		const cleared = document.documentElement.style.getPropertyValue("--font-mono");

		expect(
			{
				placeholder: input.getAttribute("placeholder"),
				cds: input.getAttribute("data-cds"),
				className: input.className,
				custom,
				cleared,
				stored: localStorage.getItem("ccp-code-font"),
			},
		).toStrictEqual(
			{
				placeholder: "e.g. JetBrains Mono",
				cds: "TextInput",
				className:
					"cds-input cds-reset h-control ps-md rounded bg-fill-field shadow-field-ring field-fill data-[invalid]:shadow-field-invalid font-sans text-body font-normal text-primary transition duration-fast pe-md placeholder:text-ink-muted outline-none focus-visible:outline-hidden enabled:[&:hover:not(:focus):not([data-invalid])]:shadow-field-hover disabled:opacity-disabled focus-visible:shadow-focus data-[invalid]:focus-visible:shadow-focus-danger field-fill-hover w-56",
				custom: '"Fira Code", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
				cleared: "",
				stored: "",
			},
		);
	});

	// Upstream's 2026-11 Code font size row: a device select (11-20px, default 13) without a filter whose
	// choice sets --epitaxy-code-font-size and --epitaxy-code-leading (round(px * 1.45)) in rem on <html>.
	it("renders upstream's Code font size row after Code font with a filterless size select", async () =>
	{
		await renderAppearance();
		// Outside the dialog there is no tab context, so the row has its slug but no setting-<tab>- id.
		const row = document.querySelector('[data-settings-row="code-font-size"]');
		const trigger = screen.getByRole(
			"combobox",
			{
				name: "Code font size",
			},
		);
		const slugs = [...(row?.parentElement?.querySelectorAll("[data-settings-row]") ?? [])].map((element) =>
			element.getAttribute("data-settings-row"),
		);

		fireEvent.click(trigger);

		expect(
			{
				title: row?.querySelector(".settings-row-title")?.textContent,
				description: row?.querySelector("[data-settings-desc]")?.textContent,
				wrapper: trigger.closest("[data-settings-control] > div")?.className.split(" ").includes("w-56"),
				trigger: trigger.textContent,
				lastSlugs: slugs.slice(-2),
				codeFontDescription: document.querySelector('[data-settings-row="code-font"] [data-settings-desc]')
					?.textContent,
				filter: screen.queryByRole("searchbox"),
				options: screen.getAllByRole("option").map((option) => option.textContent),
				selected: screen
					.getAllByRole("option")
					.filter((option) => option.getAttribute("aria-selected") === "true")
					.map((option) => option.textContent),
			},
		).toStrictEqual(
			{
				title: "Code font size",
				description: "Applies to open files, diffs, code blocks, command output, and the terminal.",
				wrapper: true,
				trigger: "Default · 13 px",
				lastSlugs: ["code-font", "code-font-size"],
				codeFontDescription: "Use your own monospace font for code and the terminal.",
				filter: null,
				options: ["Default · 13 px", "11 px", "12 px", "13 px", "14 px", "15 px", "16 px", "18 px", "20 px"],
				selected: ["Default · 13 px"],
			},
		);
	});

	it("stores a picked code font size and sets upstream's rem size and leading on <html>, and Default clears both", async () =>
	{
		await renderAppearance();
		const style = document.documentElement.style;
		const read = () => (
		{
			trigger: screen.getByRole(
				"combobox",
				{
					name: "Code font size",
				},
			).textContent,
			stored: localStorage.getItem("ccp-code-font-size"),
			size: style.getPropertyValue("--epitaxy-code-font-size"),
			leading: style.getPropertyValue("--epitaxy-code-leading"),
			attribute: document.documentElement.dataset["codeFontSize"] ?? null,
		});

		fireEvent.click(
			screen.getByRole(
				"combobox",
				{
					name: "Code font size",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: "16 px",
				},
			),
		);
		const picked = read();
		fireEvent.click(
			screen.getByRole(
				"combobox",
				{
					name: "Code font size",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: "Default · 13 px",
				},
			),
		);
		const reset = read();

		expect(
			{
				picked,
				reset,
			},
		).toStrictEqual(
			{
				picked:
				{
					trigger: "16 px",
					stored: "16",
					size: "1rem",
					leading: "1.4375rem",
					attribute: "16",
				},
				reset:
				{
					trigger: "Default · 13 px",
					stored: "null",
					size: "",
					leading: "",
					attribute: null,
				},
			},
		);
	});

	it("marks a changed Code font and Code font size with upstream's dot labels, and Reset restores the defaults", async () =>
	{
		await renderAppearance();
		const chrome = (name: string) =>
		{
			const row = screen.getByRole(
				"group",
				{
					name,
				},
			);
			return {
				dot: row.querySelector("[data-testid=setting-modified-dot]")?.getAttribute("aria-label") ?? null,
				reset: row.querySelector("button[data-cds=Button]")?.getAttribute("aria-label") ?? null,
			};
		};
		const pickSize = (name: string) =>
		{
			fireEvent.click(
				screen.getByRole(
					"combobox",
					{
						name: "Code font size",
					},
				),
			);
			fireEvent.click(
				screen.getByRole(
					"option",
					{
						name,
					},
				),
			);
		};
		const atDefaults = [chrome("Code font"), chrome("Code font size")];

		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Code font family",
				},
			),
			{
				target:
				{
					value: "Iosevka",
				},
			},
		);
		pickSize("13 px");
		const atThirteen = [chrome("Code font"), chrome("Code font size")];
		pickSize("15 px");
		const atFifteen = chrome("Code font size");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Reset Code font to default",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Reset Code font size to default",
				},
			),
		);

		expect(
			{
				atDefaults,
				atThirteen,
				atFifteen,
				afterReset: [chrome("Code font"), chrome("Code font size")],
				stored: [localStorage.getItem("ccp-code-font"), localStorage.getItem("ccp-code-font-size")],
			},
		).toStrictEqual(
			{
				atDefaults: [
					{
						dot: null,
						reset: null,
					},
					{
						dot: null,
						reset: null,
					},
				],
				atThirteen: [
					{
						dot: "Changed from the default",
						reset: "Reset Code font to default",
					},
					{
						dot: "Changed from the default",
						reset: "Reset Code font size to default",
					},
				],
				atFifteen:
				{
					dot: "Changed from the default (13 px)",
					reset: "Reset Code font size to default",
				},
				afterReset: [
					{
						dot: null,
						reset: null,
					},
					{
						dot: null,
						reset: null,
					},
				],
				stored: ["", "null"],
			},
		);
	});

	it("lets the terminal use the Ghostty config instead of the code theme", async () =>
	{
		await renderAppearance();
		const select = screen.getByRole(
			"combobox",
			{
				name: "Terminal colors",
			},
		);
		const initial = select.textContent;

		fireEvent.click(select);
		const options = screen.getAllByRole("option").map((option) => option.textContent);
		fireEvent.click(
			screen.getByRole(
				"option",
				{
					name: "Ghostty config",
				},
			),
		);

		expect(
			{
				initial,
				options,
				selected: screen.getByRole(
					"combobox",
					{
						name: "Terminal colors",
					},
				).textContent,
				stored: localStorage.getItem("ccp-terminal-appearance"),
			},
		).toStrictEqual(
			{
				initial: "Code theme",
				options: ["Code theme", "Ghostty config"],
				selected: "Ghostty config",
				stored: "ghostty",
			},
		);
	});
});
