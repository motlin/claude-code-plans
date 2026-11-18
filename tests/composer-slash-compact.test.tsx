// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import type {ComposerState} from "../src/lib/composer-state";
import type {SlashCommand} from "../src/lib/slash-commands";
import type {SlashRemoteControl} from "../src/lib/slash-compact-menu";
import {resetSlashUsageThrottle} from "../src/lib/slash-usage";
import {CompactScope} from "./fizzy-lake-off";

beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
	localStorage.clear();
	resetSlashUsageThrottle();
});

const CHIN: ComposerState =
{
	mode:
	{
		id: "default",
		label: "Manual",
	},
	model: "Opus 5.5",
	modelId: "claude-opus-5-5",
	settingsModelId: "claude-opus-5-5",
	settingsDefault: null,
	availableModels: null,
	fastMode: false,
	fastModeBlocked: null,
	effort:
	{
		id: "high",
		label: "High",
	},
	usage: null,
};

function command(name: string, source: SlashCommand["source"]): SlashCommand
{
	return {
		name,
		description: `${name} description`,
		source,
	};
}

const COMMANDS: SlashCommand[] = [
	command("clear", "builtin"),
	command("compact", "builtin"),
	command("standup", "personal-command"),
	command("review", "personal-skill"),
	command("dataviz", "plugin-skill"),
	command("alpha", "project-skill"),
	command("beta", "personal-skill"),
];

function setup({
	compact = true,
	remoteControl = null,
	variant = "session",
}:
{
	compact?: boolean;
	remoteControl?: SlashRemoteControl | null;
	variant?: "session" | "home";
} = {})
{
	const onSend = vi.fn<(prompt: string) => void>();
	render(
		<CompactScope>
			<Composer
				variant={variant}
				draftKey={variant === "home" ? "home" : "session-alice"}
				onSend={onSend}
				chin={CHIN}
				slashCommands={COMMANDS}
				compactSlashMenu={compact}
				slashRemoteControl={remoteControl}
			/>
		</CompactScope>,
	);
	const textarea = screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
	return {
		textarea,
		onSend,
	};
}

function type(textarea: HTMLTextAreaElement, value: string)
{
	fireEvent.change(
		textarea,
		{
			target:
			{
				value,
			},
		},
	);
}

function slashMenu(): HTMLElement | null
{
	return screen.queryByRole(
		"menu",
		{
			name: "Slash commands",
		},
	);
}

/* Each main-list row as role, text and state; nested rows are left out. */
function mainRows(): string[]
{
	const menu = slashMenu();
	if (menu === null) return [];
	return [...menu.children].map((row) =>
	{
		const role = row.getAttribute("role") ?? "div";
		const flags = [
			row.hasAttribute("data-highlighted") && "highlighted",
			row.getAttribute("aria-expanded") === "true" && "expanded",
			row.getAttribute("aria-checked") === "true" && "checked",
			row.getAttribute("aria-disabled") === "true" && "disabled",
		].filter(Boolean);
		return `${role}:${row.textContent}${flags.length === 0 ? "" : ` [${flags.join(",")}]`}`;
	});
}

function nestedRows(): string[]
{
	const nested = document.querySelector("[data-slash-submenu] [role=menu]");
	if (nested === null) return [];
	return [...nested.children].map(
		(row) => `${row.textContent}${row.hasAttribute("data-highlighted") ? " [highlighted]" : ""}`,
	);
}

function key(textarea: HTMLTextAreaElement, name: string)
{
	fireEvent.keyDown(
		textarea,
		{
			key: name,
		},
	);
}

describe("grouped slash menu (upstream compactSlashMenuHost, __gb__3159821575)", () =>
{
	it("groups the bare / as Skills top 3 + All skills, host rows with Compact session, then All commands", () =>
	{
		const {textarea} = setup(
			{
				remoteControl:
				{
					on: true,
					toggle: () =>
					{
					},
				},
			},
		);
		type(textarea, "/");
		expect(mainRows()).toStrictEqual([
			"div:Skills",
			"menuitem:review [highlighted]",
			"menuitem:dataviz",
			"menuitem:alpha",
			"menuitem:All skills",
			"div:",
			"menuitem:ModelOpus 5.5",
			"menuitem:Environment, Set when the session startedLocal [disabled]",
			"menuitemcheckbox:Remote Control [checked]",
			"menuitem:Compact session",
			"div:",
			"menuitem:All commands",
		]);
	});

	it("keeps the flat list with the gate off", () =>
	{
		const {textarea} = setup(
			{
				compact: false,
			},
		);
		type(textarea, "/");
		expect(mainRows()).toStrictEqual([
			"menuitem:clear [highlighted]",
			"menuitem:compact",
			"menuitem:standup",
			"menuitem:review",
			"menuitem:dataviz",
			"menuitem:alpha",
			"menuitem:beta",
		]);
	});

	it("sizes the popup at a fixed 260px, uncapped while grouped and capped at 480px for a query", () =>
	{
		const {textarea} = setup();
		const sizes = () =>
		{
			const classes = slashMenu()?.parentElement?.className.split(" ") ?? [];
			return classes.filter((name) => /^(w-|max-h-)/.test(name));
		};
		type(textarea, "/");
		const grouped = sizes();
		type(textarea, "/re");
		const query = sizes();
		cleanup();
		const {textarea: flat} = setup(
			{
				compact: false,
			},
		);
		type(flat, "/");
		expect(
			{
				grouped,
				query,
				flat: sizes(),
			},
		).toStrictEqual(
			{
				grouped: ["w-[260px]"],
				query: ["w-[260px]", "max-h-[480px]"],
				flat: ["w-max", "max-h-96"],
			},
		);
	});

	it("draws submenu, host and toggle rows with upstream's label, suffix, caret and inert switch markup", () =>
	{
		const {textarea} = setup(
			{
				remoteControl:
				{
					on: true,
					toggle: null,
					reason: "A turn is running",
				},
			},
		);
		type(textarea, "/");
		const row = (name: RegExp) =>
		{
			const found = [...document.querySelectorAll<HTMLElement>("[role=menuitem],[role=menuitemcheckbox]")].find(
				(el) => name.test(el.textContent),
			);
			if (found === undefined) throw new Error(`no row ${name}`);
			return found;
		};
		const allSkills = row(/^All skills$/);
		const model = row(/^Model/);
		const environment = row(/^Environment/);
		const remote = row(/^Remote Control/);
		expect(
			{
				allSkills: [
					allSkills.getAttribute("aria-haspopup"),
					allSkills.getAttribute("aria-expanded"),
					allSkills.children[0]?.className,
					allSkills.children[1]?.getAttribute("class"),
				],
				model: [model.children[0]?.className, model.children[1]?.className, model.children[1]?.innerHTML],
				environment: [
					environment.getAttribute("aria-disabled"),
					environment.className.includes("opacity-disabled"),
					environment.querySelector(".sr-only")?.textContent,
				],
				remote: [
					remote.getAttribute("aria-checked"),
					remote.getAttribute("aria-disabled"),
					remote.className.includes("opacity-disabled"),
					remote.querySelector("[inert] [role=switch]")?.getAttribute("data-size"),
				],
			},
		).toStrictEqual(
			{
				allSkills: [
					"menu",
					"false",
					"min-w-0 flex-1 truncate text-secondary",
					"lucide lucide-chevron-right -me-1 shrink-0 text-muted-as-secondary",
				],
				model: [
					"min-w-0 flex-1 truncate",
					"shrink-0 text-caption text-muted-as-secondary",
					'<span class="flex items-center gap-xs"><span class="max-w-40 truncate">Opus 5.5</span></span>',
				],
				environment: ["true", false, ", Set when the session started"],
				remote: ["true", "true", true, "sm"],
			},
		);
	});

	it("opens a highlighted submenu after exactly 150ms, then →, ↑/↓, ← and Enter move in and pick", () =>
	{
		vi.useFakeTimers();
		const {textarea} = setup();
		type(textarea, "/");
		for (let i = 0; i < 3; i++) key(textarea, "ArrowDown");
		act(() =>
		{
			vi.advanceTimersByTime(149);
		});
		const before = nestedRows();
		act(() =>
		{
			vi.advanceTimersByTime(1);
		});
		const opened = nestedRows();
		key(textarea, "ArrowRight");
		const entered = nestedRows();
		key(textarea, "ArrowDown");
		const moved = nestedRows();
		const activeDescendant = textarea.getAttribute("aria-activedescendant");
		key(textarea, "ArrowLeft");
		const left = [mainRows()[4], nestedRows()[0]];
		key(textarea, "ArrowRight");
		key(textarea, "ArrowDown");
		key(textarea, "Enter");
		expect(
			{
				before,
				opened,
				entered,
				moved,
				activeDescendant: activeDescendant?.endsWith("-submenu-option-1"),
				left,
				prompt: textarea.value,
				closed: slashMenu(),
			},
		).toStrictEqual(
			{
				before: [],
				opened: ["alpha", "beta", "dataviz", "review"],
				entered: ["alpha [highlighted]", "beta", "dataviz", "review"],
				moved: ["alpha", "beta [highlighted]", "dataviz", "review"],
				activeDescendant: true,
				left: ["menuitem:All skills [highlighted,expanded]", "alpha"],
				prompt: "/beta ",
				closed: null,
			},
		);
	});

	it("opens and enters a submenu at once on Enter, and closes it when the highlight moves off", () =>
	{
		const {textarea} = setup();
		type(textarea, "/");
		for (let i = 0; i < 3; i++) key(textarea, "ArrowDown");
		key(textarea, "Enter");
		const entered = nestedRows()[0];
		key(textarea, "ArrowLeft");
		key(textarea, "ArrowUp");
		expect(
			{
				entered,
				after: nestedRows(),
			},
		).toStrictEqual(
			{
				entered: "alpha [highlighted]",
				after: [],
			},
		);
	});

	it("flips Remote Control on click and keeps the menu open", () =>
	{
		const toggle = vi.fn<() => void>();
		const {textarea} = setup(
			{
				remoteControl:
				{
					on: false,
					toggle,
				},
			},
		);
		type(textarea, "/");
		fireEvent.mouseDown(screen.getByRole("menuitemcheckbox"));
		expect(
			{
				calls: toggle.mock.calls.length,
				open: slashMenu() !== null,
			},
		).toStrictEqual(
			{
				calls: 1,
				open: true,
			},
		);
	});

	it("inserts /compact from Compact session, and leaves it out of the home draft", () =>
	{
		const {textarea} = setup();
		type(textarea, "/");
		fireEvent.mouseDown(screen.getByText("Compact session"));
		const prompt = textarea.value;
		cleanup();
		const {textarea: home} = setup(
			{
				variant: "home",
			},
		);
		type(home, "/");
		expect(
			{
				prompt,
				home: mainRows().filter((row) => row.includes("Compact")),
			},
		).toStrictEqual(
			{
				prompt: "/compact ",
				home: [],
			},
		);
	});

	it("opens the chin's model menu beside the Model row on →, and a pick closes the / menu", async () =>
	{
		const {textarea} = setup();
		type(textarea, "/");
		for (let i = 0; i < 4; i++) key(textarea, "ArrowDown");
		const highlighted = mainRows().find((row) => row.includes("highlighted"));
		key(textarea, "ArrowRight");
		const popups = (await screen.findAllByRole("menu")).map((menu) => [
			menu.getAttribute("aria-label") ?? menu.getAttribute("data-cds"),
			menu.getAttribute("data-side"),
		]);
		const selector = document.querySelector<HTMLElement>("[role=menu][data-cds=ModelSelector]");
		const sonnet = [...(selector?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])].find(
			(row) => row.querySelector("[data-menu-item-label]")?.textContent.startsWith("Sonnet") === true,
		);
		if (sonnet === undefined) throw new Error("no Sonnet row");
		fireEvent.click(sonnet);
		expect(
			{
				highlighted,
				popups,
				slashOpen: slashMenu() !== null,
				trigger: screen
					.getByRole(
						"button",
						{
							name: /^Model: /,
						},
					)
					.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				highlighted: "menuitem:ModelOpus 5.5 [highlighted]",
				popups: [
					["Slash commands", null],
					["ModelSelector", "inline-end"],
				],
				slashOpen: false,
				trigger: "Model: Sonnet 5.5 High",
			},
		);
	});

	it("shows the no-match header instead of closing, but closes for a query with a space", () =>
	{
		const {textarea} = setup();
		type(textarea, "/zzzz");
		const noMatch = mainRows();
		type(textarea, "/zz zz");
		expect(
			{
				noMatch,
				spaced: slashMenu(),
			},
		).toStrictEqual(
			{
				noMatch: ["div:No matching commands"],
				spaced: null,
			},
		);
	});

	it("opens a bare mid-message / at once only with the gate on", () =>
	{
		const {textarea} = setup();
		type(textarea, "hi /");
		const on = slashMenu() !== null;
		cleanup();
		const {textarea: off} = setup(
			{
				compact: false,
			},
		);
		type(off, "hi /");
		expect(
			{
				on,
				off: slashMenu() !== null,
			},
		).toStrictEqual(
			{
				on: true,
				off: false,
			},
		);
	});

	it("records picks and ranks typed queries by usage only with the gate on", () =>
	{
		const {textarea} = setup();
		type(textarea, "/beta");
		key(textarea, "Enter");
		const stored = JSON.parse(localStorage.getItem("slash-command-skill-usage:local") ?? "null") as Record<
			string,
			{
				usageCount: number;
			}
		>;
		type(textarea, "/");
		const top = mainRows()[1];
		cleanup();
		localStorage.clear();
		const {textarea: off} = setup(
			{
				compact: false,
			},
		);
		type(off, "/beta");
		key(off, "Enter");
		expect(
			{
				count: stored["beta"]?.usageCount,
				top,
				off: localStorage.length,
			},
		).toStrictEqual(
			{
				count: 1,
				top: "menuitem:beta [highlighted]",
				off: 0,
			},
		);
	});
});
