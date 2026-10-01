// @vitest-environment jsdom

import {cleanup, fireEvent, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import type {SlashCommand} from "../src/lib/slash-commands";
import type {TranscriptMode} from "../src/lib/transcript-mode";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
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
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

interface RenderOptions {
	transcriptMode?: TranscriptMode;
	slashCommands?: readonly SlashCommand[];
}

function renderRecords(records: unknown[], options: RenderOptions = {}): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode={options.transcriptMode ?? "normal"}
			{...(options.slashCommands === undefined ? {} : {slashCommands: options.slashCommands})}
		/>,
	).container;
}

const LOOP_PROMPT = {
	type: "user",
	uuid: "user-loop-1",
	message: {role: "user", content: "/loop Check PR 1954 for fabricated activity"},
};

const SKILL_BODY = {
	type: "user",
	uuid: "user-meta-skill",
	isMeta: true,
	message: {
		role: "user",
		content: [{type: "text", text: "# /loop — schedule a fabricated recurring prompt\n\nFabricated skill body."}],
	},
};

const WAKEUP_NOTE = {
	type: "user",
	uuid: "user-meta-note",
	isMeta: true,
	message: {role: "user", content: "[16 prior /loop wakeups found nothing fabricated]"},
};

const COMMAND_INVOCATION = {
	type: "user",
	uuid: "user-command-1",
	message: {
		role: "user",
		content: "<command-name>/loop</command-name><command-args>Check PR 1954</command-args>",
	},
};

const LOOP_COMMAND: SlashCommand = {
	name: "loop",
	description: "Run a fabricated prompt on a recurring interval",
	source: "builtin",
};

function userBubbleTexts(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll(".user-message-bubble")).map((bubble) =>
		(bubble.textContent ?? "").replace(/\s+/g, " ").trim(),
	);
}

function chipSummary(container: HTMLElement): {tag: string; text: string; label: string; className: string}[] {
	return Array.from(container.querySelectorAll("[data-slash-command-chip]")).map((chip) => ({
		tag: chip.tagName,
		text: chip.textContent ?? "",
		label: chip.querySelector("[data-slash-command-label]")?.textContent ?? "",
		className: chip.className,
	}));
}

async function hoverChip(container: HTMLElement): Promise<HTMLElement> {
	const chip = container.querySelector("[data-slash-command-chip]");
	if (!(chip instanceof HTMLElement)) throw new Error("no chip");
	fireEvent.pointerEnter(chip, {pointerType: "mouse"});
	fireEvent.mouseEnter(chip);
	fireEvent.mouseMove(chip);
	return waitFor(() => {
		const card = document.querySelector("[data-slash-command-card]");
		if (!(card instanceof HTMLElement)) throw new Error("no card");
		return card;
	});
}

describe("SessionChat isMeta slash-command bodies", () => {
	it.each(["normal", "thinking", "verbose"] as const)("hides skill bodies and meta notes in %s mode", (mode) => {
		const container = renderRecords([LOOP_PROMPT, SKILL_BODY, WAKEUP_NOTE], {transcriptMode: mode});

		expect({
			bubbles: userBubbleTexts(container),
			hasLabel: container.textContent?.includes("Slash command body") ?? false,
			hasSkillBody: container.textContent?.includes("Fabricated skill body") ?? false,
			hasWakeupNote: container.textContent?.includes("prior /loop wakeups") ?? false,
		}).toStrictEqual({
			bubbles: ["/loop Check PR 1954 for fabricated activity"],
			hasLabel: false,
			hasSkillBody: false,
			hasWakeupNote: false,
		});
	});
});

describe("SessionChat slash-command chip", () => {
	it("turns a leading /loop in prompt text into an accent chip followed by the rest of the text", () => {
		const container = renderRecords([LOOP_PROMPT]);

		expect({
			chips: chipSummary(container),
			bubbles: userBubbleTexts(container),
		}).toStrictEqual({
			chips: [
				{
					tag: "BUTTON",
					text: "/loop",
					label: "loop",
					className:
						"group relative inline-flex items-baseline rounded-r5 text-upstream-accent cursor-pointer align-baseline",
				},
			],
			bubbles: ["/loop Check PR 1954 for fabricated activity"],
		});
	});

	it("renders a <command-name> invocation as the same chip followed by its args", () => {
		const container = renderRecords([COMMAND_INVOCATION]);

		expect({
			chips: chipSummary(container).map(({text, label}) => ({text, label})),
			bubbles: userBubbleTexts(container),
		}).toStrictEqual({
			chips: [{text: "/loop", label: "loop"}],
			bubbles: ["/loop Check PR 1954"],
		});
	});

	it("leaves a leading absolute path as plain text", () => {
		const container = renderRecords([
			{type: "user", uuid: "user-path", message: {role: "user", content: "/Users/fabricated/file.ts is broken"}},
		]);

		expect(chipSummary(container)).toStrictEqual([]);
	});

	it("opens the hover card with /name and the known skill description on hover, without a click", async () => {
		const container = renderRecords([LOOP_PROMPT], {slashCommands: [LOOP_COMMAND]});

		const card = await hoverChip(container);
		expect({
			name: card.querySelector("[data-slash-command-card-name]")?.textContent ?? null,
			description: card.querySelector("[data-slash-command-card-description]")?.textContent ?? null,
			side: card.getAttribute("data-side"),
			className: card.className,
		}).toStrictEqual({
			name: "/loop",
			description: "Run a fabricated prompt on a recurring interval",
			side: "top",
			className:
				"flex w-[280px] max-w-[calc(100vw-16px)] flex-col gap-1 rounded-r7 bg-[var(--menu-bg)] p-3 text-[13px]/[19px] text-primary shadow-[var(--menu-shadow)] outline-none",
		});
	});

	it("opens the hover card with only /name when the command is unknown", async () => {
		const container = renderRecords([LOOP_PROMPT]);

		const card = await hoverChip(container);
		expect({
			name: card.querySelector("[data-slash-command-card-name]")?.textContent ?? null,
			description: card.querySelector("[data-slash-command-card-description]")?.textContent ?? null,
		}).toStrictEqual({name: "/loop", description: null});
	});

	it("has no click-to-open trigger, so clicking the chip opens nothing", () => {
		const container = renderRecords([LOOP_PROMPT], {slashCommands: [LOOP_COMMAND]});
		const chip = container.querySelector("[data-slash-command-chip]")!;

		fireEvent.click(chip);

		expect({
			hasPopup: chip.getAttribute("aria-haspopup"),
			expanded: chip.getAttribute("aria-expanded"),
			card: document.querySelector("[data-slash-command-card]"),
		}).toStrictEqual({hasPopup: null, expanded: null, card: null});
	});

	it("draws the hover highlight as an absolute accent-muted span behind a 13px/500 half-opacity slash", () => {
		const container = renderRecords([LOOP_PROMPT]);
		const chip = container.querySelector("[data-slash-command-chip]")!;

		expect({
			highlight: chip.querySelector("[data-slash-command-highlight]")?.className ?? null,
			slash: chip.querySelector("[data-slash-command-slash]")?.className ?? null,
		}).toStrictEqual({
			highlight:
				"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 bg-upstream-accent-muted opacity-0 group-hover:opacity-100",
			slash: "relative inline-block w-2 text-[13px] font-medium opacity-50",
		});
	});
});
