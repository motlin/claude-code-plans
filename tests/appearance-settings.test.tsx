// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {
	InterfaceFontSchema,
	SYSTEM_FONT_STACK,
	TRANSCRIPT_TEXT_SIZES,
	TranscriptTextSizeSchema,
} from "../src/lib/appearance";
import {DEFAULTS, SettingsProvider} from "../src/components/settings-provider";
import {ClaudeCodeSettings, TranscriptSettings} from "../src/components/settings/settings-sections";
import {ThemeProvider} from "../src/components/theme-provider";
import {installLocalStorage} from "./fake-storage";

const HTML_VARS = ["--font-sans", "--max-content-width", "--transcript-text-size", "--transcript-leading"] as const;

function htmlVars(): Record<(typeof HTML_VARS)[number], string> {
	const style = document.documentElement.style;
	return Object.fromEntries(HTML_VARS.map((name) => [name, style.getPropertyValue(name)])) as Record<
		(typeof HTML_VARS)[number],
		string
	>;
}

async function renderTab(tab: React.ReactNode) {
	render(
		<ThemeProvider>
			<SettingsProvider>{tab}</SettingsProvider>
		</ThemeProvider>,
	);
	await act(async () => {});
}

function pick(group: string, option: string) {
	fireEvent.click(within(screen.getByRole("radiogroup", {name: group})).getByRole("radio", {name: option}));
}

function checked(group: string): string | null {
	return (
		within(screen.getByRole("radiogroup", {name: group}))
			.getAllByRole("radio")
			.find((radio) => radio.getAttribute("aria-checked") === "true")?.textContent ?? null
	);
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
	for (const name of HTML_VARS) document.documentElement.style.removeProperty(name);
});

describe("appearance setting schemas", () => {
	it("accepts only the upstream interface fonts and transcript text sizes", () => {
		expect({
			fonts: ["sans", "system", "opendyslexic", ""].map((value) => InterfaceFontSchema.safeParse(value).success),
			sizes: ["sm", "md", "lg", "xl", "medium"].map((value) => TranscriptTextSizeSchema.safeParse(value).success),
			sizePx: TRANSCRIPT_TEXT_SIZES,
			defaults: {
				interfaceFont: DEFAULTS.interfaceFont,
				transcriptTextSize: DEFAULTS.transcriptTextSize,
				transcriptWidth: DEFAULTS.transcriptWidth,
				verbosity: DEFAULTS.verbosity,
			},
		}).toStrictEqual({
			fonts: [true, true, false, false],
			sizes: [true, true, true, false, false],
			sizePx: {
				sm: {fontSize: 13, lineHeight: 18},
				md: {fontSize: 14, lineHeight: 20},
				lg: {fontSize: 16, lineHeight: 24},
			},
			defaults: {
				interfaceFont: "sans",
				transcriptTextSize: "md",
				transcriptWidth: "narrow",
				verbosity: "normal",
			},
		});
	});
});

describe("Claude Code settings ▸ Appearance", () => {
	it("applies interface font, transcript text size and width as CSS variables on <html>", async () => {
		await renderTab(<ClaudeCodeSettings />);
		const initial = htmlVars();

		pick("Interface font", "System");
		pick("Transcript text size", "Large");
		pick("Transcript width", "Wide");
		const changed = htmlVars();
		const stored = {
			font: localStorage.getItem("ccp-interface-font"),
			size: localStorage.getItem("ccp-transcript-text-size"),
			width: localStorage.getItem("ccp-transcript-width"),
		};

		pick("Interface font", "Sans");
		pick("Transcript text size", "Small");

		expect({initial, changed, stored, reverted: htmlVars()}).toStrictEqual({
			initial: {
				"--font-sans": "",
				"--max-content-width": "768px",
				"--transcript-text-size": "14px",
				"--transcript-leading": "20px",
			},
			changed: {
				"--font-sans": SYSTEM_FONT_STACK,
				"--max-content-width": "1280px",
				"--transcript-text-size": "16px",
				"--transcript-leading": "24px",
			},
			stored: {font: "system", size: "lg", width: "wide"},
			reverted: {
				"--font-sans": "",
				"--max-content-width": "1280px",
				"--transcript-text-size": "13px",
				"--transcript-leading": "18px",
			},
		});
	});

	it("reads stored appearance values and ignores unknown ones", async () => {
		localStorage.setItem("ccp-interface-font", "system");
		localStorage.setItem("ccp-transcript-text-size", "huge");
		await renderTab(<ClaudeCodeSettings />);

		expect({
			font: checked("Interface font"),
			size: checked("Transcript text size"),
			width: checked("Transcript width"),
			view: checked("Default transcript view"),
			fontSans: document.documentElement.style.getPropertyValue("--font-sans"),
		}).toStrictEqual({
			font: "System",
			size: "Medium",
			width: "Narrow",
			view: "Normal",
			fontSans: SYSTEM_FONT_STACK,
		});
	});

	it("writes the default transcript view to verbosity with the upstream description", async () => {
		await renderTab(<ClaudeCodeSettings />);

		pick("Default transcript view", "Verbose");

		const row = screen.getByRole("group", {name: "Default transcript view"});
		expect({
			stored: localStorage.getItem("ccp-verbosity"),
			thinking: localStorage.getItem("ccp-show-thinking"),
			checked: checked("Default transcript view"),
			description: row.getAttribute("aria-describedby") === null ? null : row.textContent,
		}).toStrictEqual({
			stored: "verbose",
			thinking: "true",
			checked: "Verbose",
			description:
				"Default transcript viewThe view sessions open in. Picking a view from a session’s Transcript view menu changes only that session.NormalThinkingVerbose",
		});
	});
});

describe("Transcript settings ▸ Custom state", () => {
	it("notes when the toggles no longer match a default transcript view preset", async () => {
		await renderTab(<TranscriptSettings />);
		const before = screen.queryByText(/Custom/);

		fireEvent.click(screen.getByRole("switch", {name: "Debug"}));
		const unaffected = screen.queryByText(/Custom/);
		fireEvent.click(screen.getByRole("switch", {name: "Passed hooks"}));

		expect({
			before,
			unaffected,
			after: screen.getByRole("status").textContent,
		}).toStrictEqual({
			before: null,
			unaffected: null,
			after: "Custom: these toggles differ from the Normal default transcript view (Claude Code ▸ Appearance).",
		});
	});
});
