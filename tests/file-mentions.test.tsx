// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {preloadFileTypeIcons} from "../src/components/file-mention-menu";
import {ToastProvider} from "../src/components/toast";
import type {SessionFilesResponse} from "../src/lib/api/session-files";
import {
	FILE_MENTION_DEBOUNCE_MS,
	fileMentionMenuPosition,
	fileMentionTrigger,
	insertFileMention,
	isMentionSuppressed,
} from "../src/lib/file-mentions";

describe("fileMentionTrigger", () => {
	it("triggers on @ at the start of the text or after whitespace", () => {
		expect([
			fileMentionTrigger("@", 1),
			fileMentionTrigger("look at @src/li", 15),
			fileMentionTrigger("line one\n@read", 14),
		]).toStrictEqual([
			{start: 0, query: ""},
			{start: 8, query: "src/li"},
			{start: 9, query: "read"},
		]);
	});

	it("ignores @ inside a word, such as an email address", () => {
		expect([fileMentionTrigger("mail alice@example.com", 22), fileMentionTrigger("a@", 2)]).toStrictEqual([
			null,
			null,
		]);
	});

	it("closes once the token is followed by whitespace before the caret", () => {
		expect([
			fileMentionTrigger("@src/index.ts ", 14),
			fileMentionTrigger("@src more", 9),
			fileMentionTrigger("no mention here", 15),
		]).toStrictEqual([null, null, null]);
	});

	it("reads only the token up to the caret", () => {
		expect(fileMentionTrigger("see @src/index.ts now", 8)).toStrictEqual({
			start: 4,
			query: "src",
		});
	});
});

describe("isMentionSuppressed", () => {
	it("suppresses while the token extends the dismissed one, but a bare @ only exactly", () => {
		expect({
			extended: isMentionSuppressed("@skill", "@skills"),
			same: isMentionSuppressed("@skill", "@skill"),
			shortened: isMentionSuppressed("@skill", "@skil"),
			bare: isMentionSuppressed("@", "@"),
			bareExtended: isMentionSuppressed("@", "@a"),
			none: isMentionSuppressed(null, "@a"),
		}).toStrictEqual({
			extended: true,
			same: true,
			shortened: false,
			bare: true,
			bareExtended: false,
			none: false,
		});
	});
});

describe("fileMentionMenuPosition", () => {
	// Upstream: a zero-size anchor at {@.left, @.bottom + 4}, side top, sideOffset 24, collisionPadding 16.
	it("puts the popup's bottom 20px above the @ glyph's bottom, left-aligned to the @", () => {
		expect(
			fileMentionMenuPosition({
				at: {left: 397.5, bottom: 695.5},
				container: {left: 300, bottom: 720},
				width: 560,
				viewportWidth: 1400,
			}),
		).toStrictEqual({left: 97.5, bottom: 44.5});
	});

	it("clamps the popup inside the viewport's 16px collision padding", () => {
		expect([
			fileMentionMenuPosition({
				at: {left: 1000, bottom: 500},
				container: {left: 200, bottom: 520},
				width: 560,
				viewportWidth: 1400,
			}),
			fileMentionMenuPosition({
				at: {left: 4, bottom: 500},
				container: {left: 0, bottom: 520},
				width: 420,
				viewportWidth: 1400,
			}),
			// A popup wider than the viewport shrinks to it (max-w-[calc(100vw-2rem)]) and sits at the padding.
			fileMentionMenuPosition({
				at: {left: 200, bottom: 500},
				container: {left: 10, bottom: 520},
				width: 420,
				viewportWidth: 390,
			}),
		]).toStrictEqual([
			{left: 624, bottom: 40},
			{left: 16, bottom: 40},
			{left: 6, bottom: 40},
		]);
	});
});

describe("insertFileMention", () => {
	it("replaces the token with @<relative path> and a trailing space", () => {
		expect(insertFileMention("see @sr", {start: 4, query: "sr"}, 7, "src/index.ts")).toStrictEqual({
			text: "see @src/index.ts ",
			caret: 18,
		});
	});

	it("keeps the text after the caret", () => {
		expect(insertFileMention("see @sr and more", {start: 4, query: "sr"}, 7, "src/index.ts")).toStrictEqual({
			text: "see @src/index.ts  and more",
			caret: 18,
		});
	});

	it("quotes paths that contain whitespace", () => {
		expect(insertFileMention("@my", {start: 0, query: "my"}, 3, "docs/my notes.md")).toStrictEqual({
			text: '@"docs/my notes.md" ',
			caret: 20,
		});
	});
});

function listing(entries: {relPath: string; isDirectory: boolean; ignored?: boolean}[]) {
	return {
		kind: "listing",
		dir: "",
		entries: entries.map(({relPath, isDirectory, ignored}) => ({
			name: relPath.slice(relPath.lastIndexOf("/") + 1),
			relPath,
			isDirectory,
			...(ignored === true ? {ignored} : {}),
		})),
		partial: false,
	} satisfies SessionFilesResponse;
}

function search(query: string, relPaths: string[]) {
	return {
		kind: "search",
		dir: "",
		query,
		results: relPaths.map((relPath) => ({
			name: relPath.slice(relPath.lastIndexOf("/") + 1),
			relPath,
			isDirectory: false,
		})),
		partial: false,
		capped: false,
	} satisfies SessionFilesResponse;
}

// The menu draws a placeholder until the lazily loaded icon set arrives; load it up front so rows render their icons.
beforeAll(async () => {
	await preloadFileTypeIcons();
});

let responses: Map<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

beforeEach(() => {
	vi.useFakeTimers();
	responses = new Map();
	fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
		const body = responses.get(url);
		return Promise.resolve(
			body === undefined ? Response.json({error: "unexpected"}, {status: 500}) : Response.json(body),
		);
	});
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const TOP_URL = "/api/sessions/session-alice/files?markIgnored=1";
const searchUrl = (query: string) => `/api/sessions/session-alice/files?q=${encodeURIComponent(query)}&markIgnored=1`;

function setup({mentionSessionId}: {mentionSessionId?: string} = {mentionSessionId: "session-alice"}) {
	const onSend = vi.fn<(prompt: string) => void>();
	render(<Composer variant="session" draftKey="session-alice" onSend={onSend} mentionSessionId={mentionSessionId} />);
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	return {textarea, onSend};
}

async function type(textarea: HTMLTextAreaElement, value: string) {
	fireEvent.change(textarea, {target: {value}});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS);
	});
}

function rows() {
	return screen.getAllByRole("option").map((row) => ({
		text: row.textContent,
		selected: row.getAttribute("aria-selected") === "true",
		muted: row.hasAttribute("data-muted"),
	}));
}

describe("Composer @ file mentions", () => {
	it("lists top-level entries for a bare @ without muting gitignored or dot entries", async () => {
		responses.set(
			TOP_URL,
			listing([
				{relPath: ".llm", isDirectory: true, ignored: true},
				{relPath: "node_modules", isDirectory: true, ignored: true},
				{relPath: "src", isDirectory: true},
				{relPath: "README.md", isDirectory: false},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");

		expect({
			rows: rows(),
		}).toStrictEqual({
			rows: [
				{text: ".llm", selected: true, muted: false},
				{text: "node_modules", selected: false, muted: false},
				{text: "src", selected: false, muted: false},
				{text: "README.md", selected: false, muted: false},
			],
		});
	});

	it("hides VCS and OS junk entries such as .git and .DS_Store", async () => {
		responses.set(
			TOP_URL,
			listing([
				{relPath: ".git", isDirectory: true, ignored: true},
				{relPath: ".DS_Store", isDirectory: false, ignored: true},
				{relPath: "src", isDirectory: true},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");

		expect(rows()).toStrictEqual([{text: "src", selected: true, muted: false}]);
	});

	it("drops junk search results before the 15-row cap", async () => {
		const junk = [".svn", ".hg", "CVS", "__MACOSX", "Thumbs.db", "desktop.ini", "a/.git"];
		const paths = Array.from({length: 15}, (_, i) => `src/file-${i}.ts`);
		responses.set(searchUrl("f"), search("f", [...junk, ...paths]));
		const {textarea} = setup();

		await type(textarea, "@f");

		expect(screen.getAllByRole("option").map((row) => row.querySelector("bdi")?.textContent)).toStrictEqual(
			paths.map((path) => path.slice("src/".length)),
		);
	});

	it("renders the label and dirname caption in bdi-wrapped spans like upstream", async () => {
		responses.set(searchUrl("a"), search("a", ["src/lib/a.ts", "a.md"]));
		const {textarea} = setup();

		await type(textarea, "@a");

		const spans = (row: HTMLElement) =>
			[...row.querySelectorAll(":scope > span > span")].map((span) => ({
				className: span.className,
				html: span.innerHTML,
			}));
		const [nested, top] = screen.getAllByRole("option");
		expect({
			nestedWrapper: nested?.querySelector(":scope > span:last-child")?.className,
			nested: nested ? spans(nested) : [],
			topWrapper: top?.querySelector(":scope > span:last-child")?.className,
			top: top ? spans(top) : [],
		}).toStrictEqual({
			nestedWrapper: "flex min-w-0 flex-1 items-baseline gap-1.5 text-start",
			nested: [
				{className: "truncate text-primary max-w-full shrink-0", html: "<bdi>a.ts</bdi>"},
				{className: "truncate text-[11px]/[17px] text-ink-muted", html: "<bdi>src/lib</bdi>"},
			],
			topWrapper: "flex min-w-0 flex-1 items-baseline gap-1.5 text-start",
			top: [{className: "truncate text-primary", html: "<bdi>a.md</bdi>"}],
		});
	});

	it("draws file rows with upstream's file-type icons and directory rows with the Folder glyph", async () => {
		responses.set(
			TOP_URL,
			listing([
				{relPath: "SKILL.md", isDirectory: false},
				{relPath: "x.java", isDirectory: false},
				{relPath: "src", isDirectory: true},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");

		expect(
			screen.getAllByRole("option").map((row) => {
				const typed = row.querySelector("svg[data-file-type-icon]");
				const lucide = row.querySelector("svg.lucide");
				return {
					typed:
						typed === null
							? null
							: {
									width: typed.getAttribute("style"),
									fills: [...typed.querySelectorAll("path")].map((path) => path.getAttribute("fill")),
								},
					lucide: lucide?.getAttribute("class") ?? null,
				};
			}),
		).toStrictEqual([
			{
				typed: {
					width: "width: 16px; height: 16px;",
					fills: ["var(--fti-markdown)", "var(--fti-markdown)"],
				},
				lucide: null,
			},
			{typed: null, lucide: "lucide lucide-file-code shrink-0"},
			{typed: null, lucide: "lucide lucide-folder size-4 shrink-0 text-ink-muted"},
		]);
	});

	it("shows the basename with the dirname caption and caps the list at 15", async () => {
		const paths = Array.from({length: 20}, (_, i) => `src/lib/file-${i}.ts`);
		responses.set(searchUrl("file"), search("file", paths));
		const {textarea} = setup();

		await type(textarea, "see @file");

		const options = screen.getAllByRole("option");
		expect({
			count: options.length,
			first: [...(options[0]?.querySelectorAll(":scope > span > span") ?? [])].map((span) => span.textContent),
		}).toStrictEqual({count: 15, first: ["file-0.ts", "src/lib"]});
	});

	it("anchors the popup over the line, left-aligned to the @ glyph mid-text", async () => {
		responses.set(searchUrl("sk"), search("sk", ["skills/a.md"]));
		const {textarea} = setup();
		const box = (left: number, top: number, width: number, height: number) =>
			({
				left,
				top,
				width,
				height,
				x: left,
				y: top,
				right: left + width,
				bottom: top + height,
				toJSON: () => ({}),
			}) as DOMRect;
		const measured: string[] = [];
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			if (this.dataset["textareaCaretMarker"] !== undefined) {
				measured.push(this.textContent);
				return box(157, 10, 9, 18);
			}
			if (this.dataset["textareaCaretMirror"] !== undefined) return box(100, 4, 600, 24);
			if (this === textarea) return box(130, 400, 600, 24);
			if (this === textarea.parentElement) return box(100, 400, 660, 28);
			return box(0, 0, 0, 0);
		});

		await type(textarea, "hello @sk");

		const popup = screen.getByRole("listbox", {name: "Mention suggestions"});
		// @ at viewport left 130 + 57 = 187, bottom 400 + 6 + 18 = 424; popup bottom = 424 + 4 - 24 = 404.
		expect({
			measured,
			left: popup.style.left,
			bottom: popup.style.bottom,
			composerAnchored: ["bottom-full", "left-0", "mb-2"].filter((c) => popup.className.split(" ").includes(c)),
		}).toStrictEqual({measured: ["@"], left: "87px", bottom: "24px", composerAnchored: []});
	});

	it("sizes the popup 420px without dirnames and 560px when any row has one", async () => {
		responses.set(
			TOP_URL,
			listing([
				{relPath: "a.ts", isDirectory: false},
				{relPath: "b", isDirectory: true},
			]),
		);
		responses.set(searchUrl("a"), search("a", ["src/a.ts"]));
		const {textarea} = setup();

		await type(textarea, "@");
		const top = screen.getByRole("listbox", {name: "Mention suggestions"});
		const narrow = {
			width: top.style.width,
			clamped: top.className.split(" ").includes("max-w-[calc(100vw-2rem)]"),
		};

		await type(textarea, "@a");
		const wide = screen.getByRole("listbox", {name: "Mention suggestions"});
		expect({
			narrow,
			wide: {
				width: wide.style.width,
				clamped: wide.className.split(" ").includes("max-w-[calc(100vw-2rem)]"),
			},
			fixedWidth: wide.className.split(" ").includes("w-[560px]"),
		}).toStrictEqual({
			narrow: {width: "420px", clamped: true},
			wide: {width: "560px", clamped: true},
			fixedWidth: false,
		});
	});

	it("uses upstream's default-density popup and row metrics", async () => {
		responses.set(searchUrl("ind"), search("ind", ["src/index.ts", "src/lib/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "open @ind");

		const popup = screen.getByRole("listbox", {name: "Mention suggestions"}).className.split(" ");
		const popupWants = ["rounded-r7", "max-h-[min(24rem,calc(100svh-2rem))]", "p-1"];
		const popupBans = ["rounded-card", "max-h-96"];
		const rowWants = [
			"h-6",
			"gap-1.5",
			"rounded-r5",
			"px-2",
			"py-[2.5px]",
			"text-[13px]/[19px]",
			"cursor-pointer",
			"text-left",
		];
		const rowBans = ["px-2.5", "py-1.5", "cursor-default"];
		expect({
			popup: {
				has: popupWants.filter((c) => popup.includes(c)),
				banned: popupBans.filter((c) => popup.includes(c)),
			},
			rows: screen.getAllByRole("option").map((row) => {
				const classes = row.className.split(" ");
				return {
					tag: row.tagName,
					type: row.getAttribute("type"),
					index: row.dataset["optionIndex"],
					has: rowWants.filter((c) => classes.includes(c)),
					banned: rowBans.filter((c) => classes.includes(c)),
				};
			}),
		}).toStrictEqual({
			popup: {has: popupWants, banned: []},
			rows: [0, 1].map((index) => ({
				tag: "BUTTON",
				type: "button",
				index: String(index),
				has: rowWants,
				banned: [],
			})),
		});
	});

	it("accepts the highlighted row with Enter, inserting @<path> without sending", async () => {
		responses.set(searchUrl("ind"), search("ind", ["src/index.ts", "src/lib/index.ts"]));
		const {textarea, onSend} = setup();

		await type(textarea, "open @ind");
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			value: textarea.value,
			caret: textarea.selectionStart,
			sent: onSend.mock.calls,
			open: screen.queryByRole("listbox"),
		}).toStrictEqual({
			value: "open @src/lib/index.ts ",
			caret: 23,
			sent: [],
			open: null,
		});
	});

	it("clamps ArrowUp and ArrowDown at the list ends instead of wrapping, like upstream", async () => {
		responses.set(searchUrl("ind"), search("ind", ["src/a/index.ts", "src/b/index.ts", "src/c/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "@ind");
		const activeOption = () => textarea.getAttribute("aria-activedescendant")?.replace(/^.*-(option-\d+)$/, "$1");
		fireEvent.keyDown(textarea, {key: "ArrowUp"});
		const afterUp = activeOption();
		for (let i = 0; i < 5; i++) fireEvent.keyDown(textarea, {key: "ArrowDown"});

		expect({afterUp, afterDowns: activeOption()}).toStrictEqual({
			afterUp: "option-0",
			afterDowns: "option-2",
		});
	});

	it("keeps the hover index separate from the keyboard index, restoring the keyboard row when the pointer leaves", async () => {
		responses.set(
			searchUrl("ind"),
			search("ind", ["src/a/index.ts", "src/b/index.ts", "src/c/index.ts", "src/d/index.ts"]),
		);
		const {textarea} = setup();

		await type(textarea, "@ind");
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		const highlightedRows = () =>
			screen.getAllByRole("option").map((row) => ({
				highlighted: row.hasAttribute("data-highlighted"),
				selected: row.getAttribute("aria-selected"),
			}));
		const only = (index: number) =>
			[0, 1, 2, 3].map((i) => ({highlighted: i === index, selected: String(i === index)}));
		const hovered = screen.getAllByRole("option")[3];
		if (hovered === undefined) throw new Error("missing row 3");
		fireEvent.mouseEnter(hovered);
		const whileHovering = highlightedRows();
		fireEvent.mouseLeave(screen.getByRole("listbox"));
		const afterLeave = highlightedRows();
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({whileHovering, afterLeave, value: textarea.value}).toStrictEqual({
			whileHovering: only(3),
			afterLeave: only(1),
			value: "@src/b/index.ts ",
		});
	});

	it("shows the row's full path as a 200ms tooltip 8px to its right, with a ZWSP after every slash", async () => {
		responses.set(
			TOP_URL,
			listing([
				{relPath: "src/lib", isDirectory: true},
				{relPath: "README.md", isDirectory: false},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");
		const [dir, file] = screen.getAllByRole("option");
		if (dir === undefined || file === undefined) throw new Error("missing rows");
		const tip = () => {
			const tooltip = screen.queryByRole("tooltip");
			return tooltip === null
				? null
				: {
						text: tooltip.textContent,
						side: tooltip.dataset["side"],
						classes: ["max-w-[360px]", "ml-2", "max-w-[320px]", "ml-1"].filter((c) =>
							tooltip.className.split(" ").includes(c),
						),
					};
		};

		fireEvent.pointerEnter(dir);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});
		const at150 = tip();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});
		const at200 = tip();
		fireEvent.pointerLeave(dir);
		const afterLeave = tip();
		fireEvent.pointerEnter(file);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(200);
		});
		const topLevel = tip();

		expect({at150, at200, afterLeave, topLevel}).toStrictEqual({
			at150: null,
			at200: {text: "src/​lib/​", side: "right", classes: ["max-w-[360px]", "ml-2"]},
			afterLeave: null,
			topLevel: {text: "README.md", side: "right", classes: ["ml-2"]},
		});
	});

	it("accepts the clicked row", async () => {
		responses.set(searchUrl("ind"), search("ind", ["src/a/index.ts", "src/b/index.ts", "src/c/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "@ind");
		const row = screen.getAllByRole("option")[2];
		if (row === undefined) throw new Error("missing row 2");
		fireEvent.mouseEnter(row);
		fireEvent.mouseDown(row);
		// Finish the click inside the React root (the accepted row is gone): React suppresses onSelect until the mouseup.
		fireEvent.mouseUp(textarea);

		expect(textarea.value).toBe("@src/c/index.ts ");
	});

	it("stays closed after Escape while the token extends the dismissed one, and reopens when it shrinks", async () => {
		responses.set(searchUrl("sk"), search("sk", ["skills/a.md"]));
		responses.set(searchUrl("ski"), search("ski", ["skills/a.md"]));
		responses.set(searchUrl("s"), search("s", ["skills/a.md"]));
		const {textarea} = setup();

		await type(textarea, "@sk");
		fireEvent.keyDown(textarea, {key: "Escape"});
		const afterEscape = screen.queryByRole("listbox");
		await type(textarea, "@ski");
		const afterExtend = screen.queryByRole("listbox");
		await type(textarea, "@s");
		const afterShrink = screen.getAllByRole("option").map((row) => row.textContent);
		await type(textarea, "@sk");

		expect({
			afterEscape,
			afterExtend,
			afterShrink,
			afterRetype: screen.getAllByRole("option").map((row) => row.textContent),
		}).toStrictEqual({
			afterEscape: null,
			afterExtend: null,
			afterShrink: ["a.mdskills"],
			afterRetype: ["a.mdskills"],
		});
	});

	it("does not open for an @ inside an email address", async () => {
		const {textarea} = setup();

		await type(textarea, "mail alice@example");

		expect({open: screen.queryByRole("listbox"), fetches: fetchMock.mock.calls}).toStrictEqual({
			open: null,
			fetches: [],
		});
	});

	it("debounces queries so only the settled token is fetched", async () => {
		responses.set(searchUrl("src"), search("src", ["src/index.ts"]));
		const {textarea} = setup();

		fireEvent.change(textarea, {target: {value: "@s"}});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS - 50);
		});
		fireEvent.change(textarea, {target: {value: "@sr"}});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS - 50);
		});
		await type(textarea, "@src");

		expect({
			fetched: fetchMock.mock.calls.map(([url]) => url),
			rows: rows().map((row) => row.text),
		}).toStrictEqual({fetched: [searchUrl("src")], rows: ["index.tssrc"]});
	});

	it("stays off without a session to search", async () => {
		const {textarea} = setup({});

		await type(textarea, "@");

		expect({open: screen.queryByRole("listbox"), fetches: fetchMock.mock.calls}).toStrictEqual({
			open: null,
			fetches: [],
		});
	});
});

function chips() {
	return screen.queryAllByTestId("composer-mention-chip").map((chip) => ({
		path: chip.dataset["path"],
		directory: chip.dataset["directory"],
		text: chip.textContent,
		title: chip.lastElementChild?.getAttribute("title"),
	}));
}

describe("Composer accepted @ mention chips", () => {
	async function acceptIndex(textarea: HTMLTextAreaElement, value = "open @ind") {
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, value);
		fireEvent.keyDown(textarea, {key: "Enter"});
	}

	it("paints an accepted file as an accent chip over the unchanged textarea text", async () => {
		const {textarea} = setup();

		await acceptIndex(textarea);

		const chip = screen.getByTestId("composer-mention-chip");
		const highlight = chip.firstElementChild;
		const label = chip.lastElementChild;
		expect({
			value: textarea.value,
			transparent: textarea.classList.contains("text-transparent"),
			path: chip.dataset["path"],
			directory: chip.dataset["directory"],
			chipClass: chip.className,
			text: chip.textContent,
			childCount: chip.childElementCount,
			highlight: {
				tag: highlight?.tagName,
				hidden: highlight?.getAttribute("aria-hidden"),
				className: highlight?.className,
			},
			label: {title: label?.getAttribute("title"), className: label?.className},
		}).toStrictEqual({
			value: "open @src/lib/index.ts ",
			transparent: true,
			path: "src/lib/index.ts",
			directory: undefined,
			chipClass:
				"group/mention relative cursor-interactive pointer-events-auto text-upstream-accent [overflow-wrap:anywhere]",
			text: "@src/lib/index.ts",
			childCount: 2,
			highlight: {
				tag: "SPAN",
				hidden: "true",
				className:
					"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 [@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover",
			},
			label: {title: "src/lib/index.ts", className: "relative [&::selection]:bg-transparent"},
		});
	});

	it("titles a directory chip with its trailing slash", async () => {
		responses.set(TOP_URL, listing([{relPath: "src", isDirectory: true}]));
		const {textarea} = setup();

		await type(textarea, "@");
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({value: textarea.value, chips: chips()}).toStrictEqual({
			value: "@src ",
			chips: [{path: "src", directory: "", text: "@src", title: "src/"}],
		});
	});

	it("keeps one chip per accepted mention", async () => {
		const {textarea} = setup();

		await acceptIndex(textarea);
		await acceptIndex(textarea, "open @src/lib/index.ts and @ind");

		expect({value: textarea.value, chips: chips().map((chip) => chip.path)}).toStrictEqual({
			value: "open @src/lib/index.ts and @src/lib/index.ts ",
			chips: ["src/lib/index.ts", "src/lib/index.ts"],
		});
	});

	it("drops a chip when its token is edited but keeps it when text follows it", async () => {
		const {textarea} = setup();

		await acceptIndex(textarea);
		await type(textarea, "open @src/lib/index.ts x");
		const afterTyping = chips().map((chip) => chip.path);
		await type(textarea, "open @src/lib/inde.ts x");

		expect({afterTyping, afterEditInside: chips()}).toStrictEqual({
			afterTyping: ["src/lib/index.ts"],
			afterEditInside: [],
		});
	});

	it("clears every chip on send", async () => {
		const {textarea, onSend} = setup();

		await acceptIndex(textarea);
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({sent: onSend.mock.calls.map(([prompt]) => prompt), chips: chips()}).toStrictEqual({
			sent: ["open @src/lib/index.ts"],
			chips: [],
		});
	});

	it("does not restore chips when the composer remounts with the saved draft", async () => {
		const {textarea} = setup();
		await acceptIndex(textarea);
		cleanup();

		const remounted = setup();

		expect({value: remounted.textarea.value, chips: chips()}).toStrictEqual({
			value: "open @src/lib/index.ts ",
			chips: [],
		});
	});
});

describe("Composer accepted @ mention chips edit atomically", () => {
	const SELECTED_HIGHLIGHT =
		"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 bg-upstream-accent-pressed";
	const HOVER_HIGHLIGHT =
		"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 [@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover";

	/** Accepts `src/lib/index.ts` at the start, then sets the text around the 17-char chip. */
	async function chipThen(textarea: HTMLTextAreaElement, value: string, caret: number) {
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, "@ind");
		fireEvent.keyDown(textarea, {key: "Enter"});
		await type(textarea, value);
		select(textarea, caret, caret);
	}

	function select(textarea: HTMLTextAreaElement, start: number, end: number) {
		textarea.setSelectionRange(start, end);
		fireEvent.select(textarea);
	}

	function state(textarea: HTMLTextAreaElement) {
		return {
			value: textarea.value,
			selection: [textarea.selectionStart, textarea.selectionEnd],
			highlights: screen
				.queryAllByTestId("composer-mention-chip")
				.map((chip) => chip.firstElementChild?.className),
		};
	}

	it("deletes the whole chip with one Backspace right after it", async () => {
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts", 17);

		const notPrevented = fireEvent.keyDown(textarea, {key: "Backspace"});

		expect({notPrevented, ...state(textarea)}).toStrictEqual({
			notPrevented: false,
			value: "",
			selection: [0, 0],
			highlights: [],
		});
	});

	it("deletes the whole chip with Delete right before it", async () => {
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts b", 0);

		const notPrevented = fireEvent.keyDown(textarea, {key: "Delete"});

		expect({notPrevented, ...state(textarea)}).toStrictEqual({
			notPrevented: false,
			value: " b",
			selection: [0, 0],
			highlights: [],
		});
	});

	it("keeps the caret out of the chip, jumping to its start only when stepping left from its end", async () => {
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts ", 17);

		select(textarea, 5, 5);
		const fromInside = [textarea.selectionStart, textarea.selectionEnd];
		select(textarea, 16, 16);
		const steppedLeft = [textarea.selectionStart, textarea.selectionEnd];
		select(textarea, 3, 18);
		const expanded = [textarea.selectionStart, textarea.selectionEnd];

		expect({fromInside, steppedLeft, expanded}).toStrictEqual({
			fromInside: [17, 17],
			steppedLeft: [0, 0],
			expanded: [0, 18],
		});
	});

	it("selects the chip with ArrowLeft, collapses after it with ArrowRight, and deletes it with Backspace when selected", async () => {
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts", 17);

		const leftNotPrevented = fireEvent.keyDown(textarea, {key: "ArrowLeft"});
		const selected = state(textarea);
		const rightNotPrevented = fireEvent.keyDown(textarea, {key: "ArrowRight"});
		const collapsed = state(textarea);
		fireEvent.keyDown(textarea, {key: "ArrowLeft"});
		fireEvent.keyDown(textarea, {key: "Backspace"});

		expect({
			leftNotPrevented,
			selected,
			rightNotPrevented,
			collapsed,
			deleted: state(textarea),
		}).toStrictEqual({
			leftNotPrevented: false,
			selected: {
				value: "@src/lib/index.ts",
				selection: [0, 17],
				highlights: [SELECTED_HIGHLIGHT],
			},
			rightNotPrevented: false,
			collapsed: {value: "@src/lib/index.ts", selection: [17, 17], highlights: [HOVER_HIGHLIGHT]},
			deleted: {value: "", selection: [0, 0], highlights: []},
		});
	});

	it("leaves Backspace after the trailing space to the textarea", async () => {
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts ", 18);

		const notPrevented = fireEvent.keyDown(textarea, {key: "Backspace"});

		expect({notPrevented, ...state(textarea)}).toStrictEqual({
			notPrevented: true,
			value: "@src/lib/index.ts ",
			selection: [18, 18],
			highlights: [HOVER_HIGHLIGHT],
		});
	});
});

describe("Composer accepted @ mention chip context menu", () => {
	/** Accepts `src/lib/index.ts` after `see `, then types ` x` after the chip's trailing space. */
	async function chipMidText(textarea: HTMLTextAreaElement) {
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, "see @ind");
		fireEvent.keyDown(textarea, {key: "Enter"});
		await type(textarea, "see @src/lib/index.ts x");
		return screen.getByTestId("composer-mention-chip");
	}

	function openChipMenu(chip: HTMLElement): HTMLElement {
		fireEvent.contextMenu(chip, {clientX: 10, clientY: 10});
		return screen.getByRole("menu");
	}

	it("opens a menu holding only a danger Delete item at the compact metrics", async () => {
		const {textarea} = setup();
		const chip = await chipMidText(textarea);

		const menu = openChipMenu(chip);
		const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];

		expect({
			popupOpen: chip.hasAttribute("data-popup-open"),
			items: items.map((item) => ({text: item.textContent, variant: item.dataset["variant"]})),
			density: menu.parentElement?.dataset["density"],
			popupMinWidth: menu.classList.contains("min-w-[128px]"),
			itemMetrics: ["h-6", "px-2", "py-[2.5px]", "rounded-r5"].map((token) =>
				items[0]?.classList.contains(token),
			),
		}).toStrictEqual({
			popupOpen: true,
			items: [{text: "Delete", variant: "danger"}],
			density: "compact",
			popupMinWidth: true,
			itemMetrics: [true, true, true, true],
		});
	});

	it("Delete removes only the token, keeps the trailing space, refocuses the textarea and closes the menu", async () => {
		const {textarea} = setup();
		const chip = await chipMidText(textarea);

		const menu = openChipMenu(chip);
		const deleteItem = menu.querySelector<HTMLElement>('[role="menuitem"]');
		if (deleteItem === null) throw new Error("no Delete item");
		fireEvent.click(deleteItem);
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		expect({
			value: textarea.value,
			chips: chips(),
			focused: document.activeElement === textarea,
			selection: [textarea.selectionStart, textarea.selectionEnd],
			menus: screen.queryAllByRole("menu").length,
		}).toStrictEqual({
			value: "see  x",
			chips: [],
			focused: true,
			selection: [4, 4],
			menus: 0,
		});
	});

	it("keeps the right-click and its mousedown from reaching ancestors", async () => {
		const onContextMenu = vi.fn<() => void>();
		const onMouseDown = vi.fn<() => void>();
		render(
			<div role="presentation" onContextMenu={onContextMenu} onMouseDown={onMouseDown}>
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={vi.fn<(prompt: string) => void>()}
					mentionSessionId="session-alice"
				/>
			</div>,
		);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		const chip = await chipMidText(textarea);

		fireEvent.mouseDown(chip, {button: 2});
		fireEvent.contextMenu(chip, {clientX: 10, clientY: 10});

		expect({
			contextMenus: onContextMenu.mock.calls.length,
			mouseDowns: onMouseDown.mock.calls.length,
			menus: screen.queryAllByRole("menu").length,
		}).toStrictEqual({contextMenus: 0, mouseDowns: 0, menus: 1});
	});

	it("selects the whole chip on a left press, as upstream's click selects the atom", async () => {
		const {textarea} = setup();
		const chip = await chipMidText(textarea);

		const notPrevented = fireEvent.mouseDown(chip, {button: 0});

		expect({
			notPrevented,
			focused: document.activeElement === textarea,
			selection: [textarea.selectionStart, textarea.selectionEnd],
			highlight: chip.firstElementChild?.className,
		}).toStrictEqual({
			notPrevented: false,
			focused: true,
			selection: [4, 21],
			highlight:
				"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 bg-upstream-accent-pressed",
		});
	});
});

describe("Composer accepted @ mention chip file actions", () => {
	function setupWithCwd() {
		render(
			<ToastProvider>
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={vi.fn<(prompt: string) => void>()}
					mentionSessionId="session-alice"
					mentionCwd="/w"
				/>
			</ToastProvider>,
		);
		return screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	}

	/** The newest open menu's rows, top to bottom: item labels, with "─" for separators. */
	function menuRows(): string[] {
		const menu = screen.getAllByRole("menu").at(-1);
		if (menu === undefined) throw new Error("no menu open");
		return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
		);
	}

	async function openSubmenu(label: string): Promise<string[]> {
		const trigger = screen
			.getAllByRole("menuitem")
			.find((row) => (row.firstElementChild?.textContent ?? row.textContent) === label);
		if (trigger === undefined) throw new Error(`no item ${label}`);
		fireEvent.click(trigger);
		await act(async () => {
			await vi.runAllTimersAsync();
		});
		return menuRows();
	}

	it("a file chip lists Copy ▸ · ─ · Open in ▸ · Show in Finder · ─ · Delete, without Attach as context", async () => {
		const textarea = setupWithCwd();
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, "see @ind");
		fireEvent.keyDown(textarea, {key: "Enter"});
		fireEvent.contextMenu(screen.getByTestId("composer-mention-chip"), {
			clientX: 10,
			clientY: 10,
		});
		const rows = menuRows();
		const copyRows = await openSubmenu("Copy");

		expect({rows, copyRows}).toStrictEqual({
			rows: ["Copy", "─", "Open in", "Show in Finder", "─", "Delete"],
			copyRows: ["Absolute path", "Relative path", "Filename"],
		});
	});

	it("a directory chip opens in VS Code only, with no Default app row", async () => {
		responses.set(TOP_URL, listing([{relPath: "src", isDirectory: true}]));
		const textarea = setupWithCwd();
		await type(textarea, "@");
		fireEvent.keyDown(textarea, {key: "Enter"});
		fireEvent.contextMenu(screen.getByTestId("composer-mention-chip"), {
			clientX: 10,
			clientY: 10,
		});

		expect(await openSubmenu("Open in")).toStrictEqual(["VS Code"]);
	});
});

describe("Composer accepted @ mention chips: keyboard-only and touch parity", () => {
	const SELECTED_HIGHLIGHT =
		"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 bg-upstream-accent-pressed";
	const HOVER_HIGHLIGHT =
		"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 [@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover";

	async function acceptIndex(textarea: HTMLTextAreaElement, value: string) {
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, value);
		fireEvent.keyDown(textarea, {key: "Enter"});
	}

	function state(textarea: HTMLTextAreaElement) {
		return {
			selection: [textarea.selectionStart, textarea.selectionEnd],
			highlights: screen
				.queryAllByTestId("composer-mention-chip")
				.map((chip) => chip.firstElementChild?.className),
		};
	}

	it("gates the hover fill behind (hover: hover), so a touch-only pointer never shows it", async () => {
		const {textarea} = setup();
		await acceptIndex(textarea, "@ind");

		const chip = screen.getByTestId("composer-mention-chip");
		const hoverTokens = [chip, ...chip.querySelectorAll("*")]
			.flatMap((el) => [...el.classList])
			.filter((token) => token.includes("hover"));

		expect(hoverTokens).toStrictEqual(["[@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover"]);
	});

	it("is not a tab stop, and Tab from the textarea is left to the browser", async () => {
		const {textarea} = setup();
		await acceptIndex(textarea, "@ind");

		const chip = screen.getByTestId("composer-mention-chip");
		const tabStops = [chip, ...chip.querySelectorAll("*")].filter((el) => el.hasAttribute("tabindex"));
		const tabNotPrevented = fireEvent.keyDown(textarea, {key: "Tab"});

		expect({
			tabStops: tabStops.length,
			tabNotPrevented,
			value: textarea.value,
			menus: screen.queryAllByRole("menu").length,
		}).toStrictEqual({
			tabStops: 0,
			tabNotPrevented: true,
			value: "@src/lib/index.ts ",
			menus: 0,
		});
	});

	it("selects two adjacent chips one at a time with ArrowLeft and ArrowRight", async () => {
		const {textarea} = setup();
		await acceptIndex(textarea, "@ind");
		await acceptIndex(textarea, "@src/lib/index.ts @ind");
		// "@src/lib/index.ts @src/lib/index.ts ": chips at [0,17) and [18,35).
		textarea.setSelectionRange(35, 35);
		fireEvent.select(textarea);

		fireEvent.keyDown(textarea, {key: "ArrowLeft"});
		const secondSelected = state(textarea);
		fireEvent.keyDown(textarea, {key: "ArrowLeft"});
		const beforeSecond = state(textarea);
		// The textarea's own ArrowLeft steps over the separating space.
		const spaceNotPrevented = fireEvent.keyDown(textarea, {key: "ArrowLeft"});
		textarea.setSelectionRange(17, 17);
		fireEvent.select(textarea);
		fireEvent.keyDown(textarea, {key: "ArrowLeft"});
		const firstSelected = state(textarea);
		fireEvent.keyDown(textarea, {key: "ArrowRight"});
		const afterFirst = state(textarea);

		expect({
			secondSelected,
			beforeSecond,
			spaceNotPrevented,
			firstSelected,
			afterFirst,
		}).toStrictEqual({
			secondSelected: {selection: [18, 35], highlights: [HOVER_HIGHLIGHT, SELECTED_HIGHLIGHT]},
			beforeSecond: {selection: [18, 18], highlights: [HOVER_HIGHLIGHT, HOVER_HIGHLIGHT]},
			spaceNotPrevented: true,
			firstSelected: {selection: [0, 17], highlights: [SELECTED_HIGHLIGHT, HOVER_HIGHLIGHT]},
			afterFirst: {selection: [17, 17], highlights: [HOVER_HIGHLIGHT, HOVER_HIGHLIGHT]},
		});
	});
});
