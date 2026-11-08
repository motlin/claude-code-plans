// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {SendingUserRow} from "../src/components/pending-user-row";
import {SessionChat} from "../src/components/session-chat";
import {StreamingMessage} from "../src/components/streaming-message";
import {DensityProvider} from "../src/components/ui/density";
import {AUTO_BUBBLE_CLASS, USER_BUBBLE_CLASS, USER_MESSAGE_CLASS} from "../src/components/user-bubble";
import {WaitingUserTurn} from "../src/components/waiting-user-turn";
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
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[]): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

const USER_MESSAGE_COLUMN =
	"group/message-row flex w-full min-w-0 flex-col gap-g5 comfortable:gap-g6 font-sans ms-auto items-end";

function shape(container: HTMLElement) {
	const column = container.querySelector('[data-cds="UserMessage"]');
	const bubble = column?.querySelector(".user-message-bubble");
	const classes = (bubble?.getAttribute("class") ?? "").split(" ");
	return {
		column: column?.getAttribute("class") ?? null,
		bubbleHasWFull: classes.includes("w-full"),
		bubbleHasMaxW85: classes.includes("max-w-[85%]"),
	};
}

describe("user row CDS structure (upstream UserMessage width model)", () => {
	it("puts the 85% cap on a plain prompt's bubble and makes the column full-width like upstream", () => {
		expect(shape(renderRecords([{type: "user", uuid: "u-ok", message: {role: "user", content: "ok"}}]))).toEqual({
			column: USER_MESSAGE_COLUMN,
			bubbleHasWFull: false,
			bubbleHasMaxW85: true,
		});
	});

	it("puts the 85% cap on a slash-command prompt's bubble too", () => {
		expect(
			shape(
				renderRecords([
					{
						type: "user",
						uuid: "u-cmd",
						message: {
							role: "user",
							content:
								"<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>now</command-args>",
						},
					},
				]),
			),
		).toEqual({column: USER_MESSAGE_COLUMN, bubbleHasWFull: false, bubbleHasMaxW85: true});
	});
});

const USER_BUBBLE =
	"user-message-bubble relative flex min-w-0 flex-col gap-[6px] comfortable:gap-[8px] rounded-r7 comfortable:rounded-card px-3 py-2 comfortable:px-4 comfortable:py-3 text-heading font-normal break-words select-text text-user-msg-text max-w-[85%] bg-user-msg-bg";
const AUTO_BUBBLE = USER_BUBBLE.replace("text-user-msg-text", "text-auto-msg-text").replace(
	"bg-user-msg-bg",
	"bg-auto-msg-bg",
);
const PARAGRAPH = "text-prose whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]";

/** The element chain from the bubble down to the first paragraph, as {tag, className, testid, id?}. */
function chainToParagraph(container: HTMLElement) {
	const bubble = container.querySelector(".user-message-bubble");
	const chain: {tag: string; className: string; testid: string | null; hasId: boolean}[] = [];
	for (let el: Element | null = container.querySelector(".user-message-bubble p"); el !== null && el !== bubble;) {
		chain.unshift({
			tag: el.tagName,
			className: el.getAttribute("class") ?? "",
			testid: el.getAttribute("data-testid"),
			hasId: el.id !== "",
		});
		el = el.parentElement;
	}
	return chain;
}

describe("user bubble body (upstream UserMessage bubble > div#id > cds-user-message-body > user-message grid)", () => {
	it("draws upstream's wrapper chain and bubble class with no overflow clip at rest", () => {
		const container = renderRecords([{type: "user", uuid: "u-ok", message: {role: "user", content: "ok"}}]);
		expect({
			bubble: container.querySelector(".user-message-bubble")?.getAttribute("class"),
			chain: chainToParagraph(container),
		}).toEqual({
			bubble: USER_BUBBLE,
			chain: [
				{tag: "DIV", className: "", testid: null, hasId: true},
				{tag: "DIV", className: "cds-user-message-body", testid: null, hasId: false},
				{
					tag: "DIV",
					className: "relative grid min-w-0 grid-cols-1 gap-2",
					testid: "user-message",
					hasId: false,
				},
				{tag: "DIV", className: "flex min-w-0 flex-col gap-1.25", testid: null, hasId: false},
				{tag: "P", className: PARAGRAPH, testid: null, hasId: false},
			],
		});
	});

	it("clamps a long prompt on the div#id, not on the bubble", () => {
		vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
		const text = Array.from({length: 40}, (_, i) => `line ${i}`).join("\n");
		const container = renderRecords([{type: "user", uuid: "u-long", message: {role: "user", content: text}}]);
		const bubble = container.querySelector(".user-message-bubble");
		const body = container.querySelector(".cds-user-message-body")?.parentElement;
		expect({
			bubbleClipped: bubble?.classList.contains("overflow-hidden"),
			bodyClass: body?.getAttribute("class"),
			showMore: [...(bubble?.querySelectorAll(":scope > button") ?? [])].map((b) => b.textContent),
		}).toEqual({
			bubbleClipped: false,
			bodyClass:
				"max-h-[16rem] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_calc(100%-3rem),transparent)]",
			showMore: ["Show more"],
		});
	});
});

describe("user row scope and heading", () => {
	it("gives [data-user-scope] upstream's group/message-row class and the heading data-find-omitted", () => {
		const container = renderRecords([{type: "user", uuid: "u-ok", message: {role: "user", content: "ok"}}]);
		const scope = container.querySelector("[data-user-scope]");
		const heading = scope?.parentElement?.querySelector(":scope > h2");
		expect({
			scope: scope?.getAttribute("class"),
			heading: heading?.getAttribute("class"),
			findOmitted: heading?.getAttribute("data-find-omitted"),
		}).toEqual({scope: "group/msg group/message-row min-w-0", heading: "sr-only select-none", findOmitted: ""});
	});
});

describe("user row density type", () => {
	it("drops data-text-size in comfortable and sets it to md in compact", () => {
		const record = {type: "user", uuid: "u-ok", message: {role: "user", content: "ok"}};
		const comfortable = renderRecords([record]);
		const comfortableSize = comfortable.querySelector('[data-cds="UserMessage"]')?.getAttribute("data-text-size");
		cleanup();
		const {lines, toolResultMap} = processTranscript([record]);
		const compact = render(
			<DensityProvider density="compact">
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					showCompactSummaries={true}
					showTranscriptOnly={true}
					shouldScrollToEnd={false}
					transcriptMode="normal"
				/>
			</DensityProvider>,
		).container;
		expect({
			comfortable: comfortableSize ?? null,
			compact: compact.querySelector('[data-cds="UserMessage"]')?.getAttribute("data-text-size") ?? null,
		}).toEqual({comfortable: null, compact: "md"});
	});

	it("defines text-prose and text-heading per density, prose following the transcript size settings", () => {
		const css = readFileSync(join(process.cwd(), "src", "styles", "globals.css"), "utf8");
		expect({
			prose: css.includes("--text-prose: var(--upstream-text-prose);"),
			proseLeading: css.includes("--text-prose--line-height: var(--upstream-leading-prose);"),
			heading: css.includes("--text-heading: var(--upstream-text-heading);"),
			headingLeading: css.includes("--text-heading--line-height: var(--upstream-leading-heading);"),
			transcriptProse: css.includes("--upstream-text-prose: var(--transcript-text-size, 0.875rem);"),
			transcriptComfortableProse: css.includes(
				"--upstream-text-prose: var(--transcript-comfortable-text-size, 1rem);",
			),
		}).toEqual({
			prose: true,
			proseLeading: true,
			heading: true,
			headingLeading: true,
			transcriptProse: true,
			transcriptComfortableProse: true,
		});
	});
});

describe("one shared bubble for every user-row variant", () => {
	it("draws every user bubble with USER_BUBBLE_CLASS and every column with USER_MESSAGE_CLASS", () => {
		const bubbleOf = (container: HTMLElement) => {
			const bubble = container.querySelector(".user-message-bubble");
			return {bubble: bubble?.getAttribute("class"), column: bubble?.parentElement?.getAttribute("class")};
		};
		const rows: Record<string, ReturnType<typeof bubbleOf>> = {};
		rows["plain"] = bubbleOf(renderRecords([{type: "user", uuid: "u", message: {role: "user", content: "hi"}}]));
		cleanup();
		rows["command"] = bubbleOf(
			renderRecords([
				{type: "user", uuid: "c", message: {role: "user", content: "<command-name>/loop</command-name>"}},
			]),
		);
		cleanup();
		rows["waiting"] = bubbleOf(render(<WaitingUserTurn entryId="w" text="hi" head />).container);
		cleanup();
		rows["sending"] = bubbleOf(render(<SendingUserRow prompt="hi" />).container);
		cleanup();
		rows["streaming"] = bubbleOf(render(<StreamingMessage text="" isComplete={false} sentPrompt="hi" />).container);
		expect(rows).toEqual({
			plain: {bubble: USER_BUBBLE, column: USER_MESSAGE_COLUMN},
			command: {bubble: USER_BUBBLE, column: USER_MESSAGE_COLUMN},
			waiting: {bubble: USER_BUBBLE, column: USER_MESSAGE_COLUMN},
			sending: {bubble: USER_BUBBLE, column: USER_MESSAGE_COLUMN},
			streaming: {bubble: USER_BUBBLE, column: `${USER_MESSAGE_COLUMN} mb-6`},
		});
	});

	it("exports the shared classes with the auto rows swapping only the ink pair", () => {
		expect({USER_BUBBLE_CLASS, AUTO_BUBBLE_CLASS, USER_MESSAGE_CLASS}).toEqual({
			USER_BUBBLE_CLASS: USER_BUBBLE,
			AUTO_BUBBLE_CLASS: AUTO_BUBBLE,
			USER_MESSAGE_CLASS: USER_MESSAGE_COLUMN,
		});
	});
});
