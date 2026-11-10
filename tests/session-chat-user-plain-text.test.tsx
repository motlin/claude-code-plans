// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {FileRefsProvider} from "../src/components/file-refs-context";
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
				parent: code.parentElement?.tagName,
				dir: code.parentElement?.getAttribute("dir"),
			})),
			paragraphClass: el.querySelector("p")?.className ?? null,
		}).toStrictEqual({
			text: "**bold** and code see x.y/z",
			strong: 0,
			code: [
				{
					text: "code",
					className:
						"text-code leading-none text-danger bg-alpha-1 border-0.5 border-border rounded-[0.4em] px-[0.25em] py-[0.0625em] [overflow-wrap:anywhere]",
					parent: "BDI",
					dir: "ltr",
				},
			],
			paragraphClass:
				"text-prose whitespace-pre-wrap [overflow-wrap:anywhere] text-pretty [unicode-bidi:plaintext]",
		});
	});

	it("grows the bubble to upstream's comfortable 8px gap, 16/12 padding and 12px card radius (the 15/20 type is text-heading's comfortable token)", () => {
		const el = bubble(renderRecords([prompt("hello")]));

		expect(
			(el.getAttribute("class") ?? "").split(" ").filter((name) => name.startsWith("comfortable:")),
		).toStrictEqual(["comfortable:gap-[8px]", "comfortable:rounded-card", "comfortable:px-4", "comfortable:py-3"]);
	});

	it("opens the user row's bubble gap from 6px to upstream's comfortable 8px (coarse pointer)", () => {
		const column = bubble(renderRecords([prompt("hello")])).parentElement;

		expect(
			(column?.getAttribute("class") ?? "").split(" ").filter((name) => name.startsWith("comfortable:")),
		).toStrictEqual(["comfortable:gap-g6"]);
	});

	it("renders a heading line as literal text", () => {
		const el = bubble(renderRecords([prompt("# Heading\nbody")]));

		expect({headings: el.querySelectorAll("h1, h2, h3").length, text: el.textContent}).toStrictEqual({
			headings: 0,
			text: "# Heading\nbody",
		});
	});

	function blocks(el: Element) {
		return Array.from(el.querySelectorAll("p, ul, ol"))
			.filter((block) => block.parentElement?.closest("li") == null)
			.map((block) => ({
				tag: block.tagName,
				start: block.getAttribute("start"),
				texts: block.tagName === "P" ? [block.textContent] : Array.from(block.children, (li) => li.textContent),
			}));
	}

	it("lifts '*' and 'N.' lists that start the prompt or follow a blank line, keeping a later number its start", () => {
		const el = bubble(
			renderRecords([prompt("Plan:\n\n* **one** `a`\n  wrapped\n* two\n\n3. three\n4. four\nafter")]),
		);

		expect(blocks(el)).toStrictEqual([
			{tag: "P", start: null, texts: ["Plan:"]},
			{tag: "UL", start: null, texts: ["**one** a\nwrapped", "two"]},
			{tag: "OL", start: "3", texts: ["three", "four\nafter"]},
		]);
	});

	it("keeps upstream's non-list lines as typed: a bullet straight after text, a 1-space indent, '-' and '+' bullets, '01.'", () => {
		const texts = [
			"From github.com:motlin/prettier-java-next-line\n * branch            main       -> FETCH_HEAD\nmise ERROR",
			"Plan:\n1. a\n2. b",
			"- one\n- two",
			"+ one",
			"Plan:\n\n * one",
			"01. one",
		];

		expect(texts.map((text) => blocks(bubble(renderRecords([prompt(text)]))))).toStrictEqual(
			texts.map((text) => [{tag: "P", start: null, texts: [text]}]),
		);
	});

	it("draws a ``` fence as upstream's code snippet, its body verbatim, parsing lists only between fences", () => {
		const text = "Run this:\n\n```sh\n\n* x\n1. y\n```\n\n* after";
		const el = bubble(renderRecords([prompt(text)]));
		const block = el.querySelector("[data-user-code-block]");

		expect({
			lists: Array.from(el.querySelectorAll("ul, ol"), (list) => list.textContent),
			paragraphs: Array.from(el.querySelectorAll("p"), (paragraph) => paragraph.textContent),
			lang: block?.getAttribute("data-user-code-block"),
			body: block?.textContent,
			shell: block?.className,
		}).toStrictEqual({
			lists: ["after"],
			paragraphs: ["Run this:"],
			lang: "sh",
			body: "\n* x\n1. y",
			shell: "epitaxy-diff overflow-clip rounded-r4",
		});
	});

	it("keeps an unclosed fence as typed, as upstream's fence regex needs its closing run", () => {
		const el = bubble(renderRecords([prompt("```sh\nnpm test")]));

		expect({
			blocks: el.querySelectorAll("[data-user-code-block]").length,
			text: el.querySelector("p")?.textContent,
		}).toStrictEqual({blocks: 0, text: "```sh\nnpm test"});
	});

	it("nests items indented by 3 spaces per level, and ends a list at a blank line", () => {
		const el = bubble(renderRecords([prompt("* a\n   1. b\n   2. c\n* d\n\nafter")]));
		const list = el.querySelector("ul");

		expect({
			top: Array.from(list?.children ?? [], (item) => item.firstChild?.textContent),
			nested: Array.from(list?.querySelector("ol")?.children ?? [], (item) => item.textContent),
			after: Array.from(el.querySelectorAll("p"), (paragraph) => paragraph.textContent),
		}).toStrictEqual({top: ["a", "d"], nested: ["b", "c"], after: ["after"]});
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

	it("links a path-shaped code span after the slash chip inside a session's file refs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				const {paths} = JSON.parse(String(init?.body)) as {paths: string[]};
				return Promise.resolve(
					Response.json({statuses: Object.fromEntries(paths.map((path) => [path, "exists"]))}),
				);
			}),
		);
		const {lines, toolResultMap} = processTranscript([prompt("/review `src/a.ts` and `npm test`")]);
		const {container} = render(
			<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
				<FileRefsProvider
					value={{sessionId: "slash-refs", cwd: "/repo", sessionPaths: [], open: vi.fn<() => void>()}}
				>
					<SessionChat
						sessionId="slash-refs"
						lines={lines}
						toolResultMap={toolResultMap}
						showCompactSummaries={true}
						showTranscriptOnly={true}
						shouldScrollToEnd={false}
						transcriptMode="normal"
					/>
				</FileRefsProvider>
			</QueryClientProvider>,
		);
		const el = bubble(container);
		await waitFor(() => {
			expect(el.querySelector("bdi > [data-file-ref]")).not.toBeNull();
		});

		expect({
			chips: el.querySelectorAll("[data-slash-command-chip]").length,
			links: Array.from(el.querySelectorAll("bdi > [data-file-ref]"), (link) => [
				link.getAttribute("data-file-path"),
				link.textContent,
			]),
			code: Array.from(el.querySelectorAll("bdi > code"), (code) => code.textContent),
		}).toStrictEqual({chips: 1, links: [["/repo/src/a.ts", "src/a.ts"]], code: ["npm test"]});
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

	it("pairs single backticks within one line, as upstream's /`([^`\\n]+)`/g does", () => {
		const codes = (text: string) => {
			cleanup();
			const el = bubble(renderRecords([prompt(text)]));
			return {
				text: el.textContent,
				code: Array.from(el.querySelectorAll("code")).map((code) => code.textContent),
			};
		};

		expect({
			runs: codes("x ``double `tick` span`` y"),
			newline: codes("a `one\ntwo` b"),
			unclosed: codes("`unclosed"),
		}).toStrictEqual({
			runs: {text: "x `double tick span` y", code: ["double ", " span"]},
			newline: {text: "a `one\ntwo` b", code: []},
			unclosed: {text: "`unclosed", code: []},
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

function describeTree(el: Element | null): unknown {
	if (el === null) return null;
	const attrs = Object.fromEntries(
		Array.from(el.attributes)
			.filter((attr) => attr.name.startsWith("data-") || attr.name === "class")
			.map((attr) => [attr.name, attr.value]),
	);
	return {tag: el.tagName, ...attrs};
}

describe("SessionChat user row DOM structure (upstream [data-take-back-entry] > [data-transcript-row] > [data-cds=UserMessage])", () => {
	it("keys a prompt row by its uuid through take-back entry, transcript row, user scope and UserMessage", () => {
		const container = renderRecords([prompt("hello")]);
		const message = bubble(container).closest("[data-cds='UserMessage']");
		const scope = message?.parentElement ?? null;
		const row = scope?.parentElement ?? null;
		const entry = row?.parentElement ?? null;

		expect({
			entry: describeTree(entry),
			row: describeTree(row),
			rowChildren: Array.from(row?.children ?? []).map((child) => child.tagName),
			scope: scope?.hasAttribute("data-user-scope") ?? null,
			messageAttrs: {
				turnKey: message?.getAttribute("data-turn-key") ?? null,
				textSize: message?.getAttribute("data-text-size") ?? null,
			},
		}).toStrictEqual({
			entry: {
				tag: "DIV",
				"data-take-back-entry": "user-plain-1",
				"data-row-gap": "none",
				class: "[&>[data-transcript-row]]:!mt-0",
			},
			row: {
				tag: "DIV",
				"data-transcript-row": "",
				class: "mt-6 compact:mt-5 [&>[data-turn-key]]:!my-0 [&>[data-reply-scope]>[data-turn-key]]:!my-0 [&:has(>[data-reserves-actions-gap]:not(:empty))]:pb-md [&:has(>[data-reply-scope]>[data-reserves-actions-gap]:not(:empty))]:pb-md",
			},
			rowChildren: ["H2", "DIV"],
			scope: true,
			messageAttrs: {turnKey: "user-plain-1", textSize: null},
		});
	});

	it("gives a slash-command prompt row the same keyed tree", () => {
		const container = renderRecords([
			{
				type: "user",
				uuid: "user-slash-1",
				message: {
					role: "user",
					content: "<command-name>/loop</command-name><command-args>Check PR 1954</command-args>",
				},
			},
		]);
		const message = container.querySelector("[data-cds='UserMessage']");

		expect({
			turnKey: message?.getAttribute("data-turn-key") ?? null,
			entry: message?.closest("[data-take-back-entry]")?.getAttribute("data-take-back-entry") ?? null,
		}).toStrictEqual({turnKey: "user-slash-1", entry: "user-slash-1"});
	});

	it("puts no trailing strip on a plain prompt row, only its frame's Copy toolbar", () => {
		const container = renderRecords([prompt("hello")]);

		expect({
			strips: container.querySelectorAll("[data-user-trailing]").length,
			reserved: container.querySelectorAll("[data-reserves-actions-gap]").length,
			...copyToolbars(container),
		}).toStrictEqual({strips: 0, reserved: 0, toolbars: 1, copyButtons: 1});
	});
});

const STRIP = {
	tag: "DIV",
	"data-user-trailing": "",
	"data-reserves-actions-gap": "",
	class: "flex w-full flex-col gap-5 compact:gap-4 print:block print:[&>:where(:not(:first-child))]:!mt-5 compact:print:[&>:where(:not(:first-child))]:!mt-4 empty:hidden [&>*]:!my-0 items-end",
};

/** Upstream's user Copy toolbar and its Copy button, by their test ids. */
function copyToolbars(container: HTMLElement) {
	return {
		toolbars: container.querySelectorAll('[data-testid="user-message-actions"]').length,
		copyButtons: container.querySelectorAll('[data-testid="user-message-copy"]').length,
	};
}

/** A carded turn's keyed tree: entry, row, the row's children and the strip's children. */
function cardedTree(container: HTMLElement) {
	const entries = Array.from(container.querySelectorAll("[data-take-back-entry]"));
	const row = entries[0]?.firstElementChild ?? null;
	const strip = row?.lastElementChild ?? null;
	return {
		entries: entries.map((entry) => entry.getAttribute("data-take-back-entry")),
		row: describeTree(row),
		rowChildren: Array.from(row?.children ?? []).map((child) => child.tagName),
		strip: describeTree(strip),
		stripChildren: strip?.children.length ?? null,
	};
}

const ROW = {
	tag: "DIV",
	"data-transcript-row": "",
	class: "mt-6 compact:mt-5 [&>[data-turn-key]]:!my-0 [&>[data-reply-scope]>[data-turn-key]]:!my-0 [&:has(>[data-reserves-actions-gap]:not(:empty))]:pb-md [&:has(>[data-reply-scope]>[data-reserves-actions-gap]:not(:empty))]:pb-md",
};

describe("SessionChat carded user turns reserve the actions gap (upstream div[data-user-trailing][data-reserves-actions-gap])", () => {
	it("routes a `!` bash command through the keyed row with the bash card as the strip's only child", () => {
		const container = renderRecords([
			{type: "user", uuid: "user-bash-1", message: {role: "user", content: "<bash-input>echo hi</bash-input>"}},
		]);

		expect({
			...cardedTree(container),
			heading: container.querySelector("[data-transcript-row] > h2")?.textContent ?? null,
			command: container.querySelector("[data-user-trailing] > *")?.textContent.includes("echo hi") ?? null,
			...copyToolbars(container),
		}).toStrictEqual({
			entries: ["user-bash-1"],
			row: ROW,
			rowChildren: ["H2", "DIV"],
			strip: STRIP,
			stripChildren: 1,
			heading: "You said: echo hi",
			command: true,
			toolbars: 0,
			copyButtons: 0,
		});
	});

	it("routes an agent-message hand-back through the keyed row with the Message from row as the strip's only child", () => {
		const container = renderRecords([
			{
				type: "user",
				uuid: "user-handback-1",
				isMeta: true,
				message: {role: "user", content: '<agent-message from="fake-agent-1">\nall done\n</agent-message>'},
			},
		]);

		expect({
			...cardedTree(container),
			card: container.querySelector("[data-user-trailing] > [data-agent-message-from]") !== null,
			...copyToolbars(container),
		}).toStrictEqual({
			entries: ["user-handback-1"],
			row: ROW,
			rowChildren: ["H2", "DIV"],
			strip: STRIP,
			stripChildren: 1,
			card: true,
			toolbars: 0,
			copyButtons: 0,
		});
	});

	it("renders nothing for a bash record with no command, stdout or stderr, so no empty strip mounts", () => {
		const container = renderRecords([
			{
				type: "user",
				uuid: "user-bash-empty",
				message: {role: "user", content: "<bash-stdout></bash-stdout><bash-stderr></bash-stderr>"},
			},
		]);

		expect({
			entries: container.querySelectorAll("[data-take-back-entry]").length,
			rows: container.querySelectorAll("[data-transcript-row]").length,
			strips: container.querySelectorAll("[data-user-trailing]").length,
		}).toStrictEqual({entries: 0, rows: 0, strips: 0});
	});

	it("never marks an assistant message in Code: only the bash turn's strip carries the attribute", () => {
		const container = renderRecords([
			{type: "user", uuid: "user-bash-2", message: {role: "user", content: "<bash-input>ls</bash-input>"}},
			{
				type: "assistant",
				uuid: "assistant-1",
				message: {
					role: "assistant",
					content: [
						{type: "text", text: "Listing again."},
						{type: "tool_use", id: "toolu_fake_1", name: "Bash", input: {command: "ls"}},
					],
				},
			},
			{
				type: "user",
				uuid: "user-result-1",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "toolu_fake_1", content: "a.txt"}],
				},
			},
			{
				type: "assistant",
				uuid: "assistant-2",
				message: {role: "assistant", content: [{type: "text", text: "One file."}]},
			},
		]);

		expect(
			Array.from(container.querySelectorAll("[data-reserves-actions-gap]"), (el) =>
				el.hasAttribute("data-user-trailing"),
			),
		).toStrictEqual([true]);
	});
});
