// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
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
						"inline-flex items-baseline rounded-md text-accent-000 hover:bg-accent-900 cursor-pointer align-baseline",
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

	it("opens a popover with /name and the known skill description on click", async () => {
		const container = renderRecords([LOOP_PROMPT], {slashCommands: [LOOP_COMMAND]});

		fireEvent.click(container.querySelector("[data-slash-command-chip]")!);

		const popup = await screen.findByTestId("slash-command-popover");
		expect({
			name: popup.querySelector("[data-slash-command-popover-name]")?.textContent ?? null,
			description: popup.querySelector("[data-slash-command-popover-description]")?.textContent ?? null,
		}).toStrictEqual({
			name: "/loop",
			description: "Run a fabricated prompt on a recurring interval",
		});
	});

	it("opens a popover with only /name when the command is unknown", async () => {
		const container = renderRecords([LOOP_PROMPT]);

		fireEvent.click(container.querySelector("[data-slash-command-chip]")!);

		const popup = await screen.findByTestId("slash-command-popover");
		expect({
			name: popup.querySelector("[data-slash-command-popover-name]")?.textContent ?? null,
			description: popup.querySelector("[data-slash-command-popover-description]")?.textContent ?? null,
		}).toStrictEqual({name: "/loop", description: null});
	});
});
