// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
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

function prompt(content: string): unknown {
	return {type: "user", uuid: "user-plain-1", message: {role: "user", content}};
}

function bubble(container: HTMLElement): Element {
	const found = container.querySelector(".user-message-bubble");
	if (found === null) throw new Error("no user bubble");
	return found;
}

describe("SessionChat user bubbles as plain text", () => {
	it("keeps markdown syntax literal and styles only inline code", () => {
		const el = bubble(renderRecords([prompt("**bold** and `code` see x.y/z")]));

		expect({
			text: el.textContent,
			strong: el.querySelectorAll("strong").length,
			code: Array.from(el.querySelectorAll("code")).map((code) => ({
				text: code.textContent,
				className: code.className,
			})),
			paragraphClass: el.querySelector("p")?.className ?? null,
		}).toStrictEqual({
			text: "**bold** and code see x.y/z",
			strong: 0,
			code: [
				{
					text: "code",
					className:
						"font-mono text-[12px]/[12px] text-code-ink bg-alpha-1 border-[0.5px] border-border rounded-[4.8px] px-[3px] py-[0.75px]",
				},
			],
			paragraphClass: "text-body whitespace-pre-wrap [overflow-wrap:anywhere]",
		});
	});

	it("renders a heading line as literal text", () => {
		const el = bubble(renderRecords([prompt("# Heading\nbody")]));

		expect({headings: el.querySelectorAll("h1, h2, h3").length, text: el.textContent}).toStrictEqual({
			headings: 0,
			text: "# Heading\nbody",
		});
	});

	it("lifts a bullet list out of the prompt, keeping a paragraph line literal and a later number its start", () => {
		const el = bubble(
			renderRecords([prompt("Plan:\n- **one** `a`\n  wrapped\n- two\n\n3. three\n4. four\nafter")]),
		);

		expect(
			Array.from(el.querySelectorAll("p, ul, ol"), (block) => ({
				tag: block.tagName,
				start: block.getAttribute("start"),
				texts: block.tagName === "P" ? [block.textContent] : Array.from(block.children, (li) => li.textContent),
			})),
		).toStrictEqual([
			{tag: "P", start: null, texts: ["Plan:"]},
			{tag: "UL", start: null, texts: ["**one** a\nwrapped", "two"]},
			{tag: "OL", start: "3", texts: ["three", "four\nafter"]},
		]);
	});

	it("does not turn markdown links into session links", () => {
		const el = bubble(renderRecords([prompt("[t](URL)")]));

		expect({
			sessionLinks: el.querySelectorAll('a[href="/session/URL"]').length,
			text: el.textContent,
		}).toStrictEqual({sessionLinks: 0, text: "[t](URL)"});
	});

	it("keeps the slash chip and leaves the rest of the prompt literal", () => {
		const el = bubble(renderRecords([prompt("/loop **every** `5m`")]));

		expect({
			chips: el.querySelectorAll("[data-slash-command-chip]").length,
			strong: el.querySelectorAll("strong").length,
			code: Array.from(el.querySelectorAll("code")).map((code) => code.textContent),
			text: el.textContent.replace(/\s+/g, " ").trim(),
		}).toStrictEqual({chips: 1, strong: 0, code: ["5m"], text: "/loop **every** 5m"});
	});

	it("autolinks bare URLs as accent links opening in a new tab", () => {
		const el = bubble(
			renderRecords([
				prompt(
					"review https://github.com/eclipse-collections/eclipse-collections/pull/1954. and http://x.y/z)",
				),
			]),
		);

		expect({
			text: el.textContent,
			links: Array.from(el.querySelectorAll("a")).map((a) => ({
				href: a.getAttribute("href"),
				text: a.textContent,
				target: a.getAttribute("target"),
				rel: a.getAttribute("rel"),
				className: a.className,
			})),
		}).toStrictEqual({
			text: "review https://github.com/eclipse-collections/eclipse-collections/pull/1954. and http://x.y/z)",
			links: [
				{
					href: "https://github.com/eclipse-collections/eclipse-collections/pull/1954",
					text: "https://github.com/eclipse-collections/eclipse-collections/pull/1954",
					target: "_blank",
					rel: "noopener noreferrer",
					className: "text-link",
				},
				{
					href: "http://x.y/z",
					text: "http://x.y/z",
					target: "_blank",
					rel: "noopener noreferrer",
					className: "text-link",
				},
			],
		});
	});

	it("leaves URLs inside code spans unlinked", () => {
		const el = bubble(renderRecords([prompt("run `curl https://x.y/z` now")]));

		expect({
			links: el.querySelectorAll("a").length,
			code: Array.from(el.querySelectorAll("code")).map((code) => code.textContent),
		}).toStrictEqual({links: 0, code: ["curl https://x.y/z"]});
	});

	it("hides a teammate-message element in a peer message bubble, as upstream does", () => {
		const el = bubble(
			renderRecords([
				prompt(
					'Another Claude session sent a message:\n<teammate-message teammate_id="fix-ordered-map-indexed" color="cyan">\n{"type":"idle_notification"}\n</teammate-message>\n\nThis came from another Claude session.',
				),
			]),
		);

		expect(Array.from(el.querySelectorAll("p"), (p) => p.textContent)).toStrictEqual([
			"Another Claude session sent a message:\nThis came from another Claude session.",
		]);
	});

	it("shows a pasted block's text inline in the bubble, without the pasted_content tag lines", () => {
		const el = bubble(
			renderRecords([
				prompt(
					'\n\n<pasted_content id="5216">\nYes go ahead and commit the .gitignore change.\n\n1. rebase\n2. fix the maze\n</pasted_content id="5216">\n',
				),
			]),
		);

		expect(
			Array.from(el.querySelectorAll("p, ul, ol"), (block) => ({
				tag: block.tagName,
				texts: block.tagName === "P" ? [block.textContent] : Array.from(block.children, (li) => li.textContent),
			})),
		).toStrictEqual([
			{tag: "P", texts: ["Yes go ahead and commit the .gitignore change."]},
			{tag: "OL", texts: ["rebase", "fix the maze"]},
		]);
	});
});
