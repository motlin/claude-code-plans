// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {preloadFileTypeIcons} from "../src/components/file-type-icons-loader";
import {ToastProvider} from "../src/components/toast";
import type {SessionFilesResponse} from "../src/lib/api/session-files";
import
{
	FILE_MENTION_DEBOUNCE_MS,
	fileMentionMenuPosition,
	fileMentionTrigger,
	insertFileMention,
	isMentionSuppressed,
} from "../src/lib/file-mentions";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {PanelsOff} from "./fizzy-lake-off";
import {MentionMenu} from "../src/components/mention-menu";
import {DensityProvider} from "../src/components/ui/density";
import
{
	fileMentionOption,
	type MentionOption,
	type MentionPendingBlock,
	type MentionProvider,
} from "../src/lib/mention-options";

// The deferred chunks these tests render, loaded up front as the page warms them before first use.
beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

describe("fileMentionTrigger", () =>
{
	it("triggers on @ at the start of the text or after whitespace", () =>
	{
		expect([
			fileMentionTrigger("@", 1),
			fileMentionTrigger("look at @src/li", 15),
			fileMentionTrigger("line one\n@read", 14),
		]).toStrictEqual([
			{
				start: 0,
				query: "",
			},
			{
				start: 8,
				query: "src/li",
			},
			{
				start: 9,
				query: "read",
			},
		]);
	});

	it("ignores @ inside a word, such as an email address", () =>
	{
		expect([fileMentionTrigger("mail alice@example.com", 22), fileMentionTrigger("a@", 2)]).toStrictEqual([
			null,
			null,
		]);
	});

	it("closes once the token is followed by whitespace before the caret", () =>
	{
		expect([
			fileMentionTrigger("@src/index.ts ", 14),
			fileMentionTrigger("@src more", 9),
			fileMentionTrigger("no mention here", 15),
		]).toStrictEqual([null, null, null]);
	});

	it("reads only the token up to the caret", () =>
	{
		expect(fileMentionTrigger("see @src/index.ts now", 8)).toStrictEqual(
			{
				start: 4,
				query: "src",
			},
		);
	});

	it("matches only within the last 50 characters of the line before the caret, like upstream's textBetween window", () =>
	{
		const fortyNine = "a".repeat(49);
		expect(
			{
				fiftyCharToken: fileMentionTrigger(`@${fortyNine}`, 50),
				fiftyOneCharToken: fileMentionTrigger(`@${fortyNine}a`, 51),
				longLine: fileMentionTrigger(`${"x ".repeat(40)}@ab`, 83),
				windowCutsWord: fileMentionTrigger(`${"b".repeat(10)}@${fortyNine}`, 60),
				previousLine: fileMentionTrigger(`${"c".repeat(60)}\n@ab`, 64),
			},
		).toStrictEqual(
			{
				fiftyCharToken:
				{
					start: 0,
					query: fortyNine,
				},
				fiftyOneCharToken: null,
				longLine:
				{
					start: 80,
					query: "ab",
				},
				windowCutsWord:
				{
					start: 10,
					query: fortyNine,
				},
				previousLine:
				{
					start: 61,
					query: "ab",
				},
			},
		);
	});
});

describe("isMentionSuppressed", () =>
{
	it("suppresses while the token extends the dismissed one, but a bare @ only exactly", () =>
	{
		expect(
			{
				extended: isMentionSuppressed("@skill", "@skills"),
				same: isMentionSuppressed("@skill", "@skill"),
				shortened: isMentionSuppressed("@skill", "@skil"),
				bare: isMentionSuppressed("@", "@"),
				bareExtended: isMentionSuppressed("@", "@a"),
				none: isMentionSuppressed(null, "@a"),
				hintOnlyExtended: isMentionSuppressed("@ab", "@abc", true),
				hintOnlySame: isMentionSuppressed("@ab", "@ab", true),
			},
		).toStrictEqual(
			{
				extended: true,
				same: true,
				shortened: false,
				bare: true,
				bareExtended: false,
				none: false,
				hintOnlyExtended: false,
				hintOnlySame: true,
			},
		);
	});
});

describe("fileMentionMenuPosition", () =>
{
	// Upstream: a zero-size anchor at {@.left, @.bottom + 4}, side top, sideOffset 24, collisionPadding 16.
	it("puts the popup's bottom 20px above the @ glyph's bottom, left-aligned to the @", () =>
	{
		expect(
			fileMentionMenuPosition(
				{
					at:
					{
						left: 397.5,
						bottom: 695.5,
					},
					editor:
					{
						top: 600,
						bottom: 700,
					},
					lineHeight: 20,
					container:
					{
						left: 300,
						bottom: 720,
					},
					width: 560,
					viewportWidth: 1400,
				},
			),
		).toStrictEqual(
			{
				left: 97.5,
				bottom: 44.5,
			},
		);
	});

	it("clamps the popup inside the viewport's 16px collision padding", () =>
	{
		expect([
			fileMentionMenuPosition(
				{
					at:
					{
						left: 1000,
						bottom: 500,
					},
					editor:
					{
						top: 400,
						bottom: 520,
					},
					lineHeight: 20,
					container:
					{
						left: 200,
						bottom: 520,
					},
					width: 560,
					viewportWidth: 1400,
				},
			),
			fileMentionMenuPosition(
				{
					at:
					{
						left: 4,
						bottom: 500,
					},
					editor:
					{
						top: 400,
						bottom: 520,
					},
					lineHeight: 20,
					container:
					{
						left: 0,
						bottom: 520,
					},
					width: 420,
					viewportWidth: 1400,
				},
			),
			// A popup wider than the viewport shrinks to it (max-w-[calc(100vw-2rem)]) and sits at the padding.
			fileMentionMenuPosition(
				{
					at:
					{
						left: 200,
						bottom: 500,
					},
					editor:
					{
						top: 400,
						bottom: 520,
					},
					lineHeight: 20,
					container:
					{
						left: 10,
						bottom: 520,
					},
					width: 420,
					viewportWidth: 390,
				},
			),
		]).toStrictEqual([
			{
				left: 624,
				bottom: 40,
			},
			{
				left: 16,
				bottom: 40,
			},
			{
				left: 6,
				bottom: 40,
			},
		]);
	});
});

describe("fileMentionMenuPosition editor clamp", () =>
{
	// Upstream clamps the @ glyph's bottom to [editorScroll.top, editorScroll.bottom + lineHeight] before anchoring.
	const at = (bottom: number) =>
		fileMentionMenuPosition(
			{
				at:
				{
					left: 100,
					bottom,
				},
				editor:
				{
					top: 200,
					bottom: 400,
				},
				lineHeight: 20,
				container:
				{
					left: 0,
					bottom: 600,
				},
				width: 420,
				viewportWidth: 1200,
			},
		);

	it("pins the popup to the editor box when the @ line scrolls out, and leaves an in-range @ alone", () =>
	{
		expect(
			{
				above: at(50),
				below: at(900),
				inRange: at(300),
			},
		).toStrictEqual(
			{
				above:
				{
					left: 100,
					bottom: 420,
				},
				below:
				{
					left: 100,
					bottom: 200,
				},
				inRange:
				{
					left: 100,
					bottom: 320,
				},
			},
		);
	});
});

describe("insertFileMention", () =>
{
	it("replaces the token with @<relative path> and a trailing space", () =>
	{
		expect(
			insertFileMention(
				"see @sr",
				{
					start: 4,
					query: "sr",
				},
				7,
				"src/index.ts",
			),
		).toStrictEqual(
			{
				text: "see @src/index.ts ",
				caret: 18,
			},
		);
	});

	it("keeps the text after the caret", () =>
	{
		expect(
			insertFileMention(
				"see @sr and more",
				{
					start: 4,
					query: "sr",
				},
				7,
				"src/index.ts",
			),
		).toStrictEqual(
			{
				text: "see @src/index.ts  and more",
				caret: 18,
			},
		);
	});

	it("quotes paths that contain whitespace", () =>
	{
		expect(
			insertFileMention(
				"@my",
				{
					start: 0,
					query: "my",
				},
				3,
				"docs/my notes.md",
			),
		).toStrictEqual(
			{
				text: '@"docs/my notes.md" ',
				caret: 20,
			},
		);
	});
});

function listing(
	entries:
	{
		relPath: string;
		isDirectory: boolean;
		ignored?: boolean;
	}[],
)
{
	return {
		kind: "listing",
		dir: "",
		entries: entries.map(({relPath, isDirectory, ignored}) => (
		{
			name: relPath.slice(relPath.lastIndexOf("/") + 1),
			relPath,
			isDirectory,
			...(ignored === true
				?
					{
						ignored,
					}
				: {}),
		})),
		partial: false,
	} satisfies SessionFilesResponse;
}

function search(query: string, relPaths: string[])
{
	return {
		kind: "search",
		dir: "",
		query,
		results: relPaths.map((relPath) => (
		{
			name: relPath.slice(relPath.lastIndexOf("/") + 1),
			relPath,
			isDirectory: false,
		})),
		partial: false,
		capped: false,
	} satisfies SessionFilesResponse;
}

// The menu draws a placeholder until the lazily loaded icon set arrives; load it up front so rows render their icons.
beforeAll(async () =>
{
	await preloadFileTypeIcons();
});

let responses: Map<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

beforeEach(() =>
{
	vi.useFakeTimers();
	responses = new Map();
	fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) =>
	{
		const body = responses.get(url);
		return Promise.resolve(
			body === undefined
				? Response.json(
						{
							error: "unexpected",
						},
						{
							status: 500,
						},
					)
				: Response.json(body),
		);
	});
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() =>
{
	cleanup();
	// Base UI's scroll lock releases on a 0ms timer; flush it so a fake clock can't strand the lock for later files in this worker.
	vi.runOnlyPendingTimers();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const TOP_URL = "/api/sessions/session-alice/files?markIgnored=1";
const searchUrl = (query: string) => `/api/sessions/session-alice/files?q=${encodeURIComponent(query)}&markIgnored=1`;

function setup(
	{
		mentionSessionId,
	}:
	{
		mentionSessionId?: string;
	} =
	{
		mentionSessionId: "session-alice",
	},
)
{
	const onSend = vi.fn<(prompt: string) => void>();
	render(
		<PanelsOff>
			<Composer variant="session" draftKey="session-alice" onSend={onSend} mentionSessionId={mentionSessionId} />
		</PanelsOff>,
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

async function type(textarea: HTMLTextAreaElement, value: string)
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
	await act(async () =>
	{
		await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS);
	});
}

/** The positioned popup around the "Mention suggestions" listbox. */
function mentionPopup(): HTMLElement
{
	const listbox = screen.getByRole(
		"listbox",
		{
			name: "Mention suggestions",
		},
	);
	if (listbox.parentElement === null) throw new Error("listbox has no popup");
	return listbox.parentElement;
}

function rows()
{
	return screen.getAllByRole("option").map((row) => (
	{
		text: row.textContent,
		selected: row.getAttribute("aria-selected") === "true",
		muted: row.hasAttribute("data-muted"),
	}));
}

describe("Composer @ file mentions", () =>
{
	it("lists top-level entries for a bare @ without muting gitignored or dot entries", async () =>
	{
		responses.set(
			TOP_URL,
			listing([
				{
					relPath: ".llm",
					isDirectory: true,
					ignored: true,
				},
				{
					relPath: "node_modules",
					isDirectory: true,
					ignored: true,
				},
				{
					relPath: "src",
					isDirectory: true,
				},
				{
					relPath: "README.md",
					isDirectory: false,
				},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");

		expect(
			{
				rows: rows(),
			},
		).toStrictEqual(
			{
				rows: [
					{
						text: ".llm",
						selected: true,
						muted: false,
					},
					{
						text: "node_modules",
						selected: false,
						muted: false,
					},
					{
						text: "src",
						selected: false,
						muted: false,
					},
					{
						text: "README.md",
						selected: false,
						muted: false,
					},
				],
			},
		);
	});

	it("hides VCS and OS junk entries such as .git and .DS_Store", async () =>
	{
		responses.set(
			TOP_URL,
			listing([
				{
					relPath: ".git",
					isDirectory: true,
					ignored: true,
				},
				{
					relPath: ".DS_Store",
					isDirectory: false,
					ignored: true,
				},
				{
					relPath: "src",
					isDirectory: true,
				},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");

		expect(rows()).toStrictEqual([
			{
				text: "src",
				selected: true,
				muted: false,
			},
		]);
	});

	it("drops junk search results before the 15-row cap", async () =>
	{
		const junk = [".svn", ".hg", "CVS", "__MACOSX", "Thumbs.db", "desktop.ini", "a/.git"];
		const paths = Array.from(
			{
				length: 15,
			},
			(_, i) => `src/file-${i}.ts`,
		);
		responses.set(searchUrl("f"), search("f", [...junk, ...paths]));
		const {textarea} = setup();

		await type(textarea, "@f");

		expect(screen.getAllByRole("option").map((row) => row.querySelector("bdi")?.textContent)).toStrictEqual(
			paths.map((path) => path.slice("src/".length)),
		);
	});

	it("renders the label and dirname caption in bdi-wrapped spans like upstream", async () =>
	{
		responses.set(searchUrl("a"), search("a", ["src/lib/a.ts", "a.md"]));
		const {textarea} = setup();

		await type(textarea, "@a");

		const spans = (row: HTMLElement) =>
			[...row.querySelectorAll(":scope > span > span")].map((span) => (
			{
				className: span.className,
				html: span.innerHTML,
			}));
		const [nested, top] = screen.getAllByRole("option");
		expect(
			{
				nestedWrapper: nested?.querySelector(":scope > span:last-child")?.className,
				nested: nested ? spans(nested) : [],
				topWrapper: top?.querySelector(":scope > span:last-child")?.className,
				top: top ? spans(top) : [],
			},
		).toStrictEqual(
			{
				nestedWrapper: "flex min-w-0 flex-1 items-baseline gap-1.5 text-start",
				nested: [
					{
						className: "truncate text-primary max-w-full shrink-0",
						html: "<bdi>a.ts</bdi>",
					},
					{
						className: "truncate text-[11px]/[17px] text-ink-muted",
						html: "<bdi>src/lib</bdi>",
					},
				],
				topWrapper: "flex min-w-0 flex-1 items-baseline gap-1.5 text-start",
				top: [
					{
						className: "truncate text-primary",
						html: "<bdi>a.md</bdi>",
					},
				],
			},
		);
	});

	it("draws file rows with upstream's monochrome glyphs whatever the code theme, and directory rows with the Folder glyph", async () =>
	{
		localStorage.setItem("ccp-code-theme-light", "github-light");
		responses.set(
			TOP_URL,
			listing([
				{
					relPath: "SKILL.md",
					isDirectory: false,
				},
				{
					relPath: "x.java",
					isDirectory: false,
				},
				{
					relPath: "src",
					isDirectory: true,
				},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");

		expect(
			screen.getAllByRole("option").map((row) =>
			{
				const typed = row.querySelector("svg[data-file-type-icon]");
				const lucide = row.querySelector("svg.lucide");
				return {
					typed:
						typed === null
							? null
							:
								{
									width: typed.getAttribute("style"),
									fills: [...typed.querySelectorAll("path")].map((path) => path.getAttribute("fill")),
								},
					lucide: lucide?.getAttribute("class") ?? null,
				};
			}),
		).toStrictEqual([
			{
				typed: null,
				lucide: "lucide lucide-scroll shrink-0",
			},
			{
				typed: null,
				lucide: "lucide lucide-code-xml lucide-code-2 shrink-0",
			},
			{
				typed: null,
				lucide: "lucide lucide-folder size-4 shrink-0 text-ink-muted",
			},
		]);
	});

	it("shows the basename with the dirname caption and caps the list at 15", async () =>
	{
		const paths = Array.from(
			{
				length: 20,
			},
			(_, i) => `src/lib/file-${i}.ts`,
		);
		responses.set(searchUrl("file"), search("file", paths));
		const {textarea} = setup();

		await type(textarea, "see @file");

		const options = screen.getAllByRole("option");
		expect(
			{
				count: options.length,
				first: [...(options[0]?.querySelectorAll(":scope > span > span") ?? [])].map(
					(span) => span.textContent,
				),
			},
		).toStrictEqual(
			{
				count: 15,
				first: ["file-0.ts", "src/lib"],
			},
		);
	});

	it("anchors the popup over the line, left-aligned to the @ glyph mid-text", async () =>
	{
		responses.set(searchUrl("sk"), search("sk", ["skills/a.md"]));
		const {textarea} = setup();
		const box = (left: number, top: number, width: number, height: number) =>
			(
			{
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
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
		{
			if (this.dataset["textareaCaretMarker"] !== undefined)
			{
				measured.push(this.textContent);
				return box(157, 10, 9, 18);
			}
			if (this.dataset["textareaCaretMirror"] !== undefined) return box(100, 4, 600, 24);
			if (this === textarea) return box(130, 400, 600, 24);
			if (this === textarea.parentElement) return box(100, 400, 660, 28);
			return box(0, 0, 0, 0);
		});

		await type(textarea, "hello @sk");

		const popup = mentionPopup();
		// @ at viewport left 130 + 57 = 187, bottom 400 + 6 + 18 = 424; popup bottom = 424 + 4 - 24 = 404.
		expect(
			{
				measured,
				left: popup.style.left,
				bottom: popup.style.bottom,
				composerAnchored: ["bottom-full", "left-0", "mb-2"].filter((c) =>
					popup.className.split(" ").includes(c),
				),
			},
		).toStrictEqual(
			{
				measured: ["@"],
				left: "87px",
				bottom: "24px",
				composerAnchored: [],
			},
		);
	});

	it("re-anchors the popup when the textarea scrolls, pinned to the textarea's box", async () =>
	{
		responses.set(searchUrl("sk"), search("sk", ["skills/a.md"]));
		const {textarea} = setup();
		const box = (left: number, top: number, width: number, height: number) =>
			(
			{
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
		// The @ sits 60px down a 120px-tall mirror; scrolling moves it 100px up, above the textarea's top.
		let markerTop = 60;
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement)
		{
			if (this.dataset["textareaCaretMarker"] !== undefined) return box(157, markerTop, 9, 18);
			if (this.dataset["textareaCaretMirror"] !== undefined) return box(100, 0, 600, 120);
			if (this === textarea) return box(130, 400, 600, 100);
			if (this === textarea.parentElement) return box(100, 400, 660, 104);
			return box(0, 0, 0, 0);
		});

		await type(textarea, "line\nline\nline\n@sk");
		const popup = mentionPopup();
		const before = popup.style.bottom;
		markerTop = -40;
		fireEvent.scroll(textarea);

		// Before: @ bottom 400 + 60 + 18 = 478, popup bottom 478 - 20 = 458, container bottom 504 → 46px.
		// After: @ bottom 400 - 40 + 18 = 378 clamps to the textarea top 400 → 380 → 124px.
		expect(
			{
				before,
				after: popup.style.bottom,
			},
		).toStrictEqual(
			{
				before: "46px",
				after: "124px",
			},
		);
	});

	it("sizes the popup 420px without dirnames and 560px when any row has one", async () =>
	{
		responses.set(
			TOP_URL,
			listing([
				{
					relPath: "a.ts",
					isDirectory: false,
				},
				{
					relPath: "b",
					isDirectory: true,
				},
			]),
		);
		responses.set(searchUrl("a"), search("a", ["src/a.ts"]));
		const {textarea} = setup();

		await type(textarea, "@");
		const top = mentionPopup();
		const narrow =
		{
			width: top.style.width,
			clamped: top.className.split(" ").includes("max-w-[calc(100vw-2rem)]"),
		};

		await type(textarea, "@a");
		const wide = mentionPopup();
		expect(
			{
				narrow,
				wide:
				{
					width: wide.style.width,
					clamped: wide.className.split(" ").includes("max-w-[calc(100vw-2rem)]"),
				},
				fixedWidth: wide.className.split(" ").includes("w-[560px]"),
			},
		).toStrictEqual(
			{
				narrow:
				{
					width: "420px",
					clamped: true,
				},
				wide:
				{
					width: "560px",
					clamped: true,
				},
				fixedWidth: false,
			},
		);
	});

	it("uses upstream's default-density popup and row metrics", async () =>
	{
		responses.set(searchUrl("ind"), search("ind", ["src/index.ts", "src/lib/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "open @ind");

		const popup = mentionPopup().className.split(" ");
		const popupWants = ["rounded-r7", "max-h-[min(24rem,calc(100svh-2rem))]"];
		const popupBans = ["rounded-card", "max-h-96"];
		const rowWants = [
			"h-6",
			"gap-1.5",
			"rounded-r5",
			"px-2",
			"py-[2.5px]",
			"text-body",
			"cursor-pointer",
			"text-start",
		];
		const rowBans = ["px-2.5", "py-1.5", "cursor-default", "text-left"];
		const listbox = screen.getByRole(
			"listbox",
			{
				name: "Mention suggestions",
			},
		);
		expect(
			{
				listbox:
				{
					cds: listbox.dataset["cds"],
					tabIndex: listbox.getAttribute("tabindex"),
					gutter: listbox.className,
				},
				popup:
				{
					has: popupWants.filter((c) => popup.includes(c)),
					banned: popupBans.filter((c) => popup.includes(c)),
				},
				rows: screen.getAllByRole("option").map((row) =>
				{
					const classes = row.className.split(" ");
					return {
						tag: row.tagName,
						type: row.getAttribute("type"),
						index: row.dataset["optionIndex"],
						has: rowWants.filter((c) => classes.includes(c)),
						banned: rowBans.filter((c) => classes.includes(c)),
					};
				}),
			},
		).toStrictEqual(
			{
				listbox:
				{
					cds: "MentionDropdown",
					tabIndex: "-1",
					gutter: "p-1",
				},
				popup:
				{
					has: popupWants,
					banned: [],
				},
				rows: [0, 1].map((index) => (
				{
					tag: "BUTTON",
					type: "button",
					index: String(index),
					has: rowWants,
					banned: [],
				})),
			},
		);
	});

	it("accepts the highlighted row with Enter, inserting @<path> without sending", async () =>
	{
		responses.set(searchUrl("ind"), search("ind", ["src/index.ts", "src/lib/index.ts"]));
		const {textarea, onSend} = setup();

		await type(textarea, "open @ind");
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowDown",
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				value: textarea.value,
				caret: textarea.selectionStart,
				sent: onSend.mock.calls,
				open: screen.queryByRole("listbox"),
			},
		).toStrictEqual(
			{
				value: "open @src/lib/index.ts ",
				caret: 23,
				sent: [],
				open: null,
			},
		);
	});

	it("clamps ArrowUp and ArrowDown at the list ends instead of wrapping, like upstream", async () =>
	{
		responses.set(searchUrl("ind"), search("ind", ["src/a/index.ts", "src/b/index.ts", "src/c/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "@ind");
		const activeOption = () => textarea.getAttribute("aria-activedescendant")?.replace(/^.*-(option-\d+)$/, "$1");
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowUp",
			},
		);
		const afterUp = activeOption();
		for (let i = 0; i < 5; i++)
			fireEvent.keyDown(
				textarea,
				{
					key: "ArrowDown",
				},
			);

		expect(
			{
				afterUp,
				afterDowns: activeOption(),
			},
		).toStrictEqual(
			{
				afterUp: "option-0",
				afterDowns: "option-2",
			},
		);
	});

	it("hovering a row makes it the selected row, kept when the pointer leaves, and ↓ continues from it", async () =>
	{
		responses.set(
			searchUrl("ind"),
			search("ind", ["src/a/index.ts", "src/b/index.ts", "src/c/index.ts", "src/d/index.ts", "src/e/index.ts"]),
		);
		const {textarea} = setup();

		await type(textarea, "@ind");
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowDown",
			},
		);
		const highlightedRows = () =>
			screen.getAllByRole("option").map((row) => (
			{
				highlighted: row.hasAttribute("data-highlighted"),
				selected: row.getAttribute("aria-selected"),
			}));
		const only = (index: number) =>
			[0, 1, 2, 3, 4].map((i) => (
			{
				highlighted: i === index,
				selected: String(i === index),
			}));
		const activeOption = () => textarea.getAttribute("aria-activedescendant")?.replace(/^.*-(option-\d+)$/, "$1");
		const row = (index: number) =>
		{
			const found = screen.getAllByRole("option")[index];
			if (found === undefined) throw new Error(`missing row ${index}`);
			return found;
		};
		fireEvent.mouseMove(
			row(3),
			{
				movementX: 1,
				movementY: 0,
			},
		);
		const whileHovering =
		{
			rows: highlightedRows(),
			active: activeOption(),
		};
		// The synthetic move a browser fires when the list scrolls under a still pointer carries no movement.
		fireEvent.mouseMove(
			row(2),
			{
				movementX: 0,
				movementY: 0,
			},
		);
		const afterStillMove = highlightedRows();
		fireEvent.mouseLeave(screen.getByRole("listbox"));
		const afterLeave = highlightedRows();
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowDown",
			},
		);
		const afterDown = highlightedRows();
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				whileHovering,
				afterStillMove,
				afterLeave,
				afterDown,
				value: textarea.value,
			},
		).toStrictEqual(
			{
				whileHovering:
				{
					rows: only(3),
					active: "option-3",
				},
				afterStillMove: only(3),
				afterLeave: only(3),
				afterDown: only(4),
				value: "@src/e/index.ts ",
			},
		);
	});

	it("scrolls the highlighted row into view for keyboard moves but not for hover", async () =>
	{
		responses.set(searchUrl("ind"), search("ind", ["src/a/index.ts", "src/b/index.ts", "src/c/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "@ind");
		const scrolled: (string | undefined)[] = [];
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element)
		{
			scrolled.push((this as HTMLElement).dataset["optionIndex"]);
		});
		const row = screen.getAllByRole("option")[2];
		if (row === undefined) throw new Error("missing row 2");
		fireEvent.mouseMove(
			row,
			{
				movementX: 0,
				movementY: 1,
			},
		);
		const afterHover = [...scrolled];
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowUp",
			},
		);

		expect(
			{
				afterHover,
				afterKey: scrolled,
			},
		).toStrictEqual(
			{
				afterHover: [],
				afterKey: ["1"],
			},
		);
	});

	it("shows the row's full path as a 200ms tooltip 8px to its right, with a ZWSP after every slash", async () =>
	{
		responses.set(
			TOP_URL,
			listing([
				{
					relPath: "src/lib",
					isDirectory: true,
				},
				{
					relPath: "README.md",
					isDirectory: false,
				},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");
		const [dir, file] = screen.getAllByRole("option");
		if (dir === undefined || file === undefined) throw new Error("missing rows");
		const tip = () =>
		{
			const tooltip = screen.queryByRole("tooltip");
			return tooltip === null
				? null
				:
					{
						text: tooltip.textContent,
						side: tooltip.dataset["side"],
						classes: ["max-w-[360px]", "ml-2", "max-w-[320px]", "ml-1"].filter((c) =>
							tooltip.className.split(" ").includes(c),
						),
					};
		};

		fireEvent.pointerEnter(dir);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(150);
		});
		const at150 = tip();
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(50);
		});
		const at200 = tip();
		fireEvent.pointerLeave(dir);
		const afterLeave = tip();
		fireEvent.pointerEnter(file);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(200);
		});
		const topLevel = tip();

		expect(
			{
				at150,
				at200,
				afterLeave,
				topLevel,
			},
		).toStrictEqual(
			{
				at150: null,
				at200:
				{
					text: "src/​lib/​",
					side: "right",
					classes: ["max-w-[360px]", "ml-2"],
				},
				afterLeave: null,
				topLevel:
				{
					text: "README.md",
					side: "right",
					classes: ["ml-2"],
				},
			},
		);
	});

	it("accepts the clicked row", async () =>
	{
		responses.set(searchUrl("ind"), search("ind", ["src/a/index.ts", "src/b/index.ts", "src/c/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "@ind");
		const row = screen.getAllByRole("option")[2];
		if (row === undefined) throw new Error("missing row 2");
		fireEvent.mouseDown(row);
		fireEvent.mouseUp(row);
		fireEvent.click(row);

		expect(textarea.value).toBe("@src/c/index.ts ");
	});

	it("does not accept a press that drags off the row, like upstream's onClick", async () =>
	{
		responses.set(searchUrl("ind"), search("ind", ["src/a/index.ts", "src/b/index.ts", "src/c/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "@ind");
		const row = screen.getAllByRole("option")[2];
		if (row === undefined) throw new Error("missing row 2");
		fireEvent.mouseDown(row);
		fireEvent.mouseUp(textarea);

		expect(
			{
				value: textarea.value,
				rows: screen.getAllByRole("option").length,
			},
		).toStrictEqual(
			{
				value: "@ind",
				rows: 3,
			},
		);
	});

	it("stays closed after Escape while the token extends the dismissed one, and reopens when it shrinks", async () =>
	{
		responses.set(searchUrl("sk"), search("sk", ["skills/a.md"]));
		responses.set(searchUrl("ski"), search("ski", ["skills/a.md"]));
		responses.set(searchUrl("s"), search("s", ["skills/a.md"]));
		const {textarea} = setup();

		await type(textarea, "@sk");
		fireEvent.keyDown(
			textarea,
			{
				key: "Escape",
			},
		);
		const afterEscape = screen.queryByRole("listbox");
		await type(textarea, "@ski");
		const afterExtend = screen.queryByRole("listbox");
		await type(textarea, "@s");
		const afterShrink = screen.getAllByRole("option").map((row) => row.textContent);
		await type(textarea, "@sk");

		expect(
			{
				afterEscape,
				afterExtend,
				afterShrink,
				afterRetype: screen.getAllByRole("option").map((row) => row.textContent),
			},
		).toStrictEqual(
			{
				afterEscape: null,
				afterExtend: null,
				afterShrink: ["a.mdskills"],
				afterRetype: ["a.mdskills"],
			},
		);
	});

	it("does not open for an @ inside an email address", async () =>
	{
		const {textarea} = setup();

		await type(textarea, "mail alice@example");

		expect(
			{
				open: screen.queryByRole("listbox"),
				fetches: fetchMock.mock.calls,
			},
		).toStrictEqual(
			{
				open: null,
				fetches: [],
			},
		);
	});

	it("debounces queries so only the settled token is fetched", async () =>
	{
		responses.set(searchUrl("src"), search("src", ["src/index.ts"]));
		const {textarea} = setup();

		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "@s",
				},
			},
		);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS - 50);
		});
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "@sr",
				},
			},
		);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS - 50);
		});
		await type(textarea, "@src");

		expect(
			{
				fetched: fetchMock.mock.calls.map(([url]) => url),
				rows: rows().map((row) => row.text),
			},
		).toStrictEqual(
			{
				fetched: [searchUrl("src")],
				rows: ["index.tssrc"],
			},
		);
	});

	it("stays off without a session to search", async () =>
	{
		const {textarea} = setup({});

		await type(textarea, "@");

		expect(
			{
				open: screen.queryByRole("listbox"),
				fetches: fetchMock.mock.calls,
			},
		).toStrictEqual(
			{
				open: null,
				fetches: [],
			},
		);
	});
});

function chips()
{
	return screen.queryAllByTestId("composer-mention-chip").map((chip) => (
	{
		path: chip.dataset["path"],
		directory: chip.dataset["directory"],
		text: chip.textContent,
		title: chip.lastElementChild?.getAttribute("title"),
	}));
}

describe("Composer accepted @ mention chips", () =>
{
	async function acceptIndex(textarea: HTMLTextAreaElement, value = "open @ind")
	{
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, value);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);
	}

	it("paints an accepted file as an accent chip over the unchanged textarea text", async () =>
	{
		const {textarea} = setup();

		await acceptIndex(textarea);

		const chip = screen.getByTestId("composer-mention-chip");
		const highlight = chip.firstElementChild;
		const label = chip.lastElementChild;
		expect(
			{
				value: textarea.value,
				transparent: textarea.classList.contains("text-transparent"),
				path: chip.dataset["path"],
				directory: chip.dataset["directory"],
				chipClass: chip.className,
				text: chip.textContent,
				childCount: chip.childElementCount,
				highlight:
				{
					tag: highlight?.tagName,
					hidden: highlight?.getAttribute("aria-hidden"),
					className: highlight?.className,
				},
				label:
				{
					title: label?.getAttribute("title"),
					className: label?.className,
				},
			},
		).toStrictEqual(
			{
				value: "open @src/lib/index.ts ",
				transparent: true,
				path: "src/lib/index.ts",
				directory: undefined,
				chipClass:
					"group/mention relative cursor-interactive pointer-events-auto text-upstream-accent [overflow-wrap:anywhere]",
				text: "@src/lib/index.ts",
				childCount: 2,
				highlight:
				{
					tag: "SPAN",
					hidden: "true",
					className:
						"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 [@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover",
				},
				label:
				{
					title: "src/lib/index.ts",
					className: "relative [&::selection]:bg-transparent",
				},
			},
		);
	});

	it("titles a directory chip with its trailing slash", async () =>
	{
		responses.set(
			TOP_URL,
			listing([
				{
					relPath: "src",
					isDirectory: true,
				},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				value: textarea.value,
				chips: chips(),
			},
		).toStrictEqual(
			{
				value: "@src ",
				chips: [
					{
						path: "src",
						directory: "",
						text: "@src",
						title: "src/",
					},
				],
			},
		);
	});

	it("keeps one chip per accepted mention", async () =>
	{
		const {textarea} = setup();

		await acceptIndex(textarea);
		await acceptIndex(textarea, "open @src/lib/index.ts and @ind");

		expect(
			{
				value: textarea.value,
				chips: chips().map((chip) => chip.path),
			},
		).toStrictEqual(
			{
				value: "open @src/lib/index.ts and @src/lib/index.ts ",
				chips: ["src/lib/index.ts", "src/lib/index.ts"],
			},
		);
	});

	it("drops a chip when its token is edited but keeps it when text follows it", async () =>
	{
		const {textarea} = setup();

		await acceptIndex(textarea);
		await type(textarea, "open @src/lib/index.ts x");
		const afterTyping = chips().map((chip) => chip.path);
		await type(textarea, "open @src/lib/inde.ts x");

		expect(
			{
				afterTyping,
				afterEditInside: chips(),
			},
		).toStrictEqual(
			{
				afterTyping: ["src/lib/index.ts"],
				afterEditInside: [],
			},
		);
	});

	it("clears every chip on send", async () =>
	{
		const {textarea, onSend} = setup();

		await acceptIndex(textarea);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				sent: onSend.mock.calls.map(([prompt]) => prompt),
				chips: chips(),
			},
		).toStrictEqual(
			{
				sent: ["open @src/lib/index.ts"],
				chips: [],
			},
		);
	});

	it("does not restore chips when the composer remounts with the saved draft", async () =>
	{
		const {textarea} = setup();
		await acceptIndex(textarea);
		cleanup();

		const remounted = setup();

		expect(
			{
				value: remounted.textarea.value,
				chips: chips(),
			},
		).toStrictEqual(
			{
				value: "open @src/lib/index.ts ",
				chips: [],
			},
		);
	});
});

describe("Composer accepted @ mention chips edit atomically", () =>
{
	const SELECTED_HIGHLIGHT =
		"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 bg-upstream-accent-pressed";
	const HOVER_HIGHLIGHT =
		"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 [@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover";

	/** Accepts `src/lib/index.ts` at the start, then sets the text around the 17-char chip. */
	async function chipThen(textarea: HTMLTextAreaElement, value: string, caret: number)
	{
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, "@ind");
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);
		await type(textarea, value);
		select(textarea, caret, caret);
	}

	function select(textarea: HTMLTextAreaElement, start: number, end: number)
	{
		textarea.setSelectionRange(start, end);
		fireEvent.select(textarea);
	}

	function state(textarea: HTMLTextAreaElement)
	{
		return {
			value: textarea.value,
			selection: [textarea.selectionStart, textarea.selectionEnd],
			highlights: screen
				.queryAllByTestId("composer-mention-chip")
				.map((chip) => chip.firstElementChild?.className),
		};
	}

	it("deletes the whole chip with one Backspace right after it", async () =>
	{
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts", 17);

		const notPrevented = fireEvent.keyDown(
			textarea,
			{
				key: "Backspace",
			},
		);

		expect(
			{
				notPrevented,
				...state(textarea),
			},
		).toStrictEqual(
			{
				notPrevented: false,
				value: "",
				selection: [0, 0],
				highlights: [],
			},
		);
	});

	it("deletes the whole chip with Delete right before it", async () =>
	{
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts b", 0);

		const notPrevented = fireEvent.keyDown(
			textarea,
			{
				key: "Delete",
			},
		);

		expect(
			{
				notPrevented,
				...state(textarea),
			},
		).toStrictEqual(
			{
				notPrevented: false,
				value: " b",
				selection: [0, 0],
				highlights: [],
			},
		);
	});

	it("keeps the caret out of the chip, jumping to its start only when stepping left from its end", async () =>
	{
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts ", 17);

		select(textarea, 5, 5);
		const fromInside = [textarea.selectionStart, textarea.selectionEnd];
		select(textarea, 16, 16);
		const steppedLeft = [textarea.selectionStart, textarea.selectionEnd];
		select(textarea, 3, 18);
		const expanded = [textarea.selectionStart, textarea.selectionEnd];

		expect(
			{
				fromInside,
				steppedLeft,
				expanded,
			},
		).toStrictEqual(
			{
				fromInside: [17, 17],
				steppedLeft: [0, 0],
				expanded: [0, 18],
			},
		);
	});

	it("selects the chip with ArrowLeft, collapses after it with ArrowRight, and deletes it with Backspace when selected", async () =>
	{
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts", 17);

		const leftNotPrevented = fireEvent.keyDown(
			textarea,
			{
				key: "ArrowLeft",
			},
		);
		const selected = state(textarea);
		const rightNotPrevented = fireEvent.keyDown(
			textarea,
			{
				key: "ArrowRight",
			},
		);
		const collapsed = state(textarea);
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowLeft",
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Backspace",
			},
		);

		expect(
			{
				leftNotPrevented,
				selected,
				rightNotPrevented,
				collapsed,
				deleted: state(textarea),
			},
		).toStrictEqual(
			{
				leftNotPrevented: false,
				selected:
				{
					value: "@src/lib/index.ts",
					selection: [0, 17],
					highlights: [SELECTED_HIGHLIGHT],
				},
				rightNotPrevented: false,
				collapsed:
				{
					value: "@src/lib/index.ts",
					selection: [17, 17],
					highlights: [HOVER_HIGHLIGHT],
				},
				deleted:
				{
					value: "",
					selection: [0, 0],
					highlights: [],
				},
			},
		);
	});

	it("leaves Backspace after the trailing space to the textarea", async () =>
	{
		const {textarea} = setup();
		await chipThen(textarea, "@src/lib/index.ts ", 18);

		const notPrevented = fireEvent.keyDown(
			textarea,
			{
				key: "Backspace",
			},
		);

		expect(
			{
				notPrevented,
				...state(textarea),
			},
		).toStrictEqual(
			{
				notPrevented: true,
				value: "@src/lib/index.ts ",
				selection: [18, 18],
				highlights: [HOVER_HIGHLIGHT],
			},
		);
	});
});

describe("Composer accepted @ mention chip context menu", () =>
{
	/** Accepts `src/lib/index.ts` after `see `, then types ` x` after the chip's trailing space. */
	async function chipMidText(textarea: HTMLTextAreaElement)
	{
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, "see @ind");
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);
		await type(textarea, "see @src/lib/index.ts x");
		return screen.getByTestId("composer-mention-chip");
	}

	function openChipMenu(chip: HTMLElement): HTMLElement
	{
		fireEvent.contextMenu(
			chip,
			{
				clientX: 10,
				clientY: 10,
			},
		);
		return screen.getByRole("menu");
	}

	it("opens a menu holding only a danger Delete item at the compact metrics", async () =>
	{
		const {textarea} = setup();
		const chip = await chipMidText(textarea);

		const menu = openChipMenu(chip);
		const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];

		expect(
			{
				popupOpen: chip.hasAttribute("data-popup-open"),
				items: items.map((item) => (
				{
					text: item.textContent,
					variant: item.dataset["variant"],
				})),
				density: menu.parentElement?.dataset["density"],
				popupMinWidth: menu.classList.contains("min-w-[128px]"),
				itemMetrics: ["h-6", "px-2", "py-[2.5px]", "rounded-r5"].map((token) =>
					items[0]?.classList.contains(token),
				),
			},
		).toStrictEqual(
			{
				popupOpen: true,
				items: [
					{
						text: "Delete",
						variant: "danger",
					},
				],
				density: "compact",
				popupMinWidth: true,
				itemMetrics: [true, true, true, true],
			},
		);
	});

	it("Delete removes only the token, keeps the trailing space, refocuses the textarea and closes the menu", async () =>
	{
		const {textarea} = setup();
		const chip = await chipMidText(textarea);

		const menu = openChipMenu(chip);
		const deleteItem = menu.querySelector<HTMLElement>('[role="menuitem"]');
		if (deleteItem === null) throw new Error("no Delete item");
		fireEvent.click(deleteItem);
		await act(async () =>
		{
			await vi.runAllTimersAsync();
		});

		expect(
			{
				value: textarea.value,
				chips: chips(),
				focused: document.activeElement === textarea,
				selection: [textarea.selectionStart, textarea.selectionEnd],
				menus: screen.queryAllByRole("menu").length,
			},
		).toStrictEqual(
			{
				value: "see  x",
				chips: [],
				focused: true,
				selection: [4, 4],
				menus: 0,
			},
		);
	});

	it("keeps the right-click and its mousedown from reaching ancestors", async () =>
	{
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
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
		const chip = await chipMidText(textarea);

		fireEvent.mouseDown(
			chip,
			{
				button: 2,
			},
		);
		fireEvent.contextMenu(
			chip,
			{
				clientX: 10,
				clientY: 10,
			},
		);

		expect(
			{
				contextMenus: onContextMenu.mock.calls.length,
				mouseDowns: onMouseDown.mock.calls.length,
				menus: screen.queryAllByRole("menu").length,
			},
		).toStrictEqual(
			{
				contextMenus: 0,
				mouseDowns: 0,
				menus: 1,
			},
		);
	});

	it("selects the whole chip on a left press, as upstream's click selects the atom", async () =>
	{
		const {textarea} = setup();
		const chip = await chipMidText(textarea);

		const notPrevented = fireEvent.mouseDown(
			chip,
			{
				button: 0,
			},
		);

		expect(
			{
				notPrevented,
				focused: document.activeElement === textarea,
				selection: [textarea.selectionStart, textarea.selectionEnd],
				highlight: chip.firstElementChild?.className,
			},
		).toStrictEqual(
			{
				notPrevented: false,
				focused: true,
				selection: [4, 21],
				highlight:
					"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 bg-upstream-accent-pressed",
			},
		);
	});
});

describe("Composer accepted @ mention chip file actions", () =>
{
	function setupWithCwd()
	{
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
		return screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
	}

	/** The newest open menu's rows, top to bottom: item labels, with "─" for separators. */
	function menuRows(): string[]
	{
		const menu = screen.getAllByRole("menu").at(-1);
		if (menu === undefined) throw new Error("no menu open");
		return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
		);
	}

	async function openSubmenu(label: string): Promise<string[]>
	{
		const trigger = screen
			.getAllByRole("menuitem")
			.find((row) => (row.firstElementChild?.textContent ?? row.textContent) === label);
		if (trigger === undefined) throw new Error(`no item ${label}`);
		fireEvent.click(trigger);
		await act(async () =>
		{
			await vi.runAllTimersAsync();
		});
		return menuRows();
	}

	it("a file chip lists Copy ▸ · ─ · Open in ▸ · Show in Finder · ─ · Delete, without Attach as context", async () =>
	{
		const textarea = setupWithCwd();
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, "see @ind");
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);
		fireEvent.contextMenu(
			screen.getByTestId("composer-mention-chip"),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		const rows = menuRows();
		const copyRows = await openSubmenu("Copy");

		expect(
			{
				rows,
				copyRows,
			},
		).toStrictEqual(
			{
				rows: ["Copy", "─", "Open in", "Show in Finder", "─", "Delete"],
				copyRows: ["Absolute path", "Relative path", "Filename"],
			},
		);
	});

	it("a directory chip opens in VS Code only, with no Default app row", async () =>
	{
		responses.set(
			TOP_URL,
			listing([
				{
					relPath: "src",
					isDirectory: true,
				},
			]),
		);
		const textarea = setupWithCwd();
		await type(textarea, "@");
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);
		fireEvent.contextMenu(
			screen.getByTestId("composer-mention-chip"),
			{
				clientX: 10,
				clientY: 10,
			},
		);

		expect(await openSubmenu("Open in")).toStrictEqual(["VS Code"]);
	});
});

describe("Composer accepted @ mention chips: keyboard-only and touch parity", () =>
{
	const SELECTED_HIGHLIGHT =
		"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 bg-upstream-accent-pressed";
	const HOVER_HIGHLIGHT =
		"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 [@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover";

	async function acceptIndex(textarea: HTMLTextAreaElement, value: string)
	{
		responses.set(searchUrl("ind"), search("ind", ["src/lib/index.ts"]));
		await type(textarea, value);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);
	}

	function state(textarea: HTMLTextAreaElement)
	{
		return {
			selection: [textarea.selectionStart, textarea.selectionEnd],
			highlights: screen
				.queryAllByTestId("composer-mention-chip")
				.map((chip) => chip.firstElementChild?.className),
		};
	}

	it("gates the hover fill behind (hover: hover), so a touch-only pointer never shows it", async () =>
	{
		const {textarea} = setup();
		await acceptIndex(textarea, "@ind");

		const chip = screen.getByTestId("composer-mention-chip");
		const hoverTokens = [chip, ...chip.querySelectorAll("*")]
			.flatMap((el) => [...el.classList])
			.filter((token) => token.includes("hover"));

		expect(hoverTokens).toStrictEqual(["[@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover"]);
	});

	it("is not a tab stop, and Tab from the textarea is left to the browser", async () =>
	{
		const {textarea} = setup();
		await acceptIndex(textarea, "@ind");

		const chip = screen.getByTestId("composer-mention-chip");
		const tabStops = [chip, ...chip.querySelectorAll("*")].filter((el) => el.hasAttribute("tabindex"));
		const tabNotPrevented = fireEvent.keyDown(
			textarea,
			{
				key: "Tab",
			},
		);

		expect(
			{
				tabStops: tabStops.length,
				tabNotPrevented,
				value: textarea.value,
				menus: screen.queryAllByRole("menu").length,
			},
		).toStrictEqual(
			{
				tabStops: 0,
				tabNotPrevented: true,
				value: "@src/lib/index.ts ",
				menus: 0,
			},
		);
	});

	it("selects two adjacent chips one at a time with ArrowLeft and ArrowRight", async () =>
	{
		const {textarea} = setup();
		await acceptIndex(textarea, "@ind");
		await acceptIndex(textarea, "@src/lib/index.ts @ind");
		// "@src/lib/index.ts @src/lib/index.ts ": chips at [0,17) and [18,35).
		textarea.setSelectionRange(35, 35);
		fireEvent.select(textarea);

		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowLeft",
			},
		);
		const secondSelected = state(textarea);
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowLeft",
			},
		);
		const beforeSecond = state(textarea);
		// The textarea's own ArrowLeft steps over the separating space.
		const spaceNotPrevented = fireEvent.keyDown(
			textarea,
			{
				key: "ArrowLeft",
			},
		);
		textarea.setSelectionRange(17, 17);
		fireEvent.select(textarea);
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowLeft",
			},
		);
		const firstSelected = state(textarea);
		fireEvent.keyDown(
			textarea,
			{
				key: "ArrowRight",
			},
		);
		const afterFirst = state(textarea);

		expect(
			{
				secondSelected,
				beforeSecond,
				spaceNotPrevented,
				firstSelected,
				afterFirst,
			},
		).toStrictEqual(
			{
				secondSelected:
				{
					selection: [18, 35],
					highlights: [HOVER_HIGHLIGHT, SELECTED_HIGHLIGHT],
				},
				beforeSecond:
				{
					selection: [18, 18],
					highlights: [HOVER_HIGHLIGHT, HOVER_HIGHLIGHT],
				},
				spaceNotPrevented: true,
				firstSelected:
				{
					selection: [0, 17],
					highlights: [SELECTED_HIGHLIGHT, HOVER_HIGHLIGHT],
				},
				afterFirst:
				{
					selection: [17, 17],
					highlights: [HOVER_HIGHLIGHT, HOVER_HIGHLIGHT],
				},
			},
		);
	});
});

const SESSION_OPTION: MentionOption =
{
	id: "session-bob",
	providerId: "ccp-sessions",
	label: "Fix bug",
	description: "repo · main",
	tooltip: "Fix bug",
	renderedText: "[Fix bug]",
	category: "Sessions",
	kind: "session",
};

const README_OPTION = fileMentionOption(
	{
		name: "README.md",
		relPath: "README.md",
		isDirectory: false,
	},
);

function renderMenu(props: Partial<React.ComponentProps<typeof MentionMenu>>)
{
	return render(
		<MentionMenu
			id="mentions"
			options={[]}
			highlighted={0}
			onHighlight={() => undefined}
			onAccept={() => undefined}
			{...props}
		/>,
	);
}

describe("MentionMenu providers", () =>
{
	it("lists every provider's rows in order with no category headers, a chat glyph on session rows, and the wide width", () =>
	{
		renderMenu(
			{
				options: [SESSION_OPTION, README_OPTION],
			},
		);

		const listbox = screen.getByRole(
			"listbox",
			{
				name: "Mention suggestions",
			},
		);
		const [session] = screen.getAllByRole("option");
		const glyph = session?.firstElementChild;
		expect(
			{
				rows: screen.getAllByRole("option").map((row) => (
				{
					provider: row.dataset["provider"],
					text: row.textContent,
				})),
				children: listbox.children.length,
				glyph:
				{
					tag: glyph?.tagName.toLowerCase(),
					cds: glyph?.getAttribute("data-cds"),
					chat: glyph?.classList.contains("lucide-message-square"),
					fontSize: (glyph as SVGElement | null | undefined)?.style.fontSize,
				},
				width: mentionPopup().style.width,
			},
		).toStrictEqual(
			{
				rows: [
					{
						provider: "ccp-sessions",
						text: "Fix bugrepo · main",
					},
					{
						provider: "ccp-files",
						text: "README.md",
					},
				],
				children: 2,
				glyph:
				{
					tag: "svg",
					cds: "Icon",
					chat: true,
					fontSize: "calc(1rem * var(--cds-rem-scale, 1))",
				},
				width: "560px",
			},
		);
	});

	it("sizes an agent row's glyph auto (20px comfortable, 16px compact) and keeps session glyphs at 16px", () =>
	{
		const agent: MentionOption =
		{
			id: "code-reviewer",
			providerId: "ccp-agents",
			label: "code-reviewer",
			renderedText: "code-reviewer",
			category: "Agents",
			kind: "agent",
		};
		const glyphSizes = () =>
			screen.getAllByRole("option").map((row) => (row.firstElementChild as SVGElement | null)?.style.fontSize);
		const menu = (
			<MentionMenu
				id="mentions"
				options={[agent, SESSION_OPTION]}
				highlighted={0}
				onHighlight={() => undefined}
				onAccept={() => undefined}
			/>
		);
		const {rerender} = render(<DensityProvider density="comfortable">{menu}</DensityProvider>);
		const comfortable = glyphSizes();
		rerender(<DensityProvider density="compact">{menu}</DensityProvider>);

		expect(
			{
				comfortable,
				compact: glyphSizes(),
			},
		).toStrictEqual(
			{
				comfortable: ["calc(1.25rem * var(--cds-rem-scale, 1))", "calc(1rem * var(--cds-rem-scale, 1))"],
				compact: ["calc(1rem * var(--cds-rem-scale, 1))", "calc(1rem * var(--cds-rem-scale, 1))"],
			},
		);
	});

	it("stays 420px wide for a session row with neither a cwd nor a branch", () =>
	{
		const {description: _description, ...bare} = SESSION_OPTION;
		renderMenu(
			{
				options: [bare],
			},
		);

		expect(mentionPopup().style.width).toBe("420px");
	});

	it("draws nothing with no rows, nothing pending and no hint", () =>
	{
		const {container} = renderMenu({});

		expect(container.innerHTML).toBe("");
	});
});

describe("MentionMenu pending skeleton block", () =>
{
	const sessionsPending: MentionPendingBlock =
	{
		providerId: "ccp-sessions",
		before: 0,
		rows: 3,
		category: "Sessions",
	};

	function skeletonRows(block: Element)
	{
		return [...block.querySelectorAll("[data-skeleton-row]")].map((row) => (
		{
			className: row.className,
			ariaHidden: row.getAttribute("aria-hidden"),
			bars: [...row.querySelectorAll<HTMLElement>("[data-cds='Skeleton']")].map((bar) => (
			{
				width: bar.style.width,
				height: bar.style.height,
				role: bar.getAttribute("role"),
			})),
		}));
	}

	it("shows a lone pending block at once: header, decorative group, three skeleton rows, a busy role-less listbox and a Loading status", () =>
	{
		const {container} = renderMenu(
			{
				pending: [sessionsPending],
			},
		);

		const block = container.querySelector("[data-pending-rows]");
		const group = block?.querySelector("[data-cds='SkeletonGroup']");
		const listbox = container.querySelector("[data-cds='MentionDropdown']");
		const status = container.querySelector("[role='status']");
		const header = block?.firstElementChild;
		expect(
			{
				block:
				{
					rows: block?.getAttribute("data-pending-rows"),
					ariaHidden: block?.getAttribute("aria-hidden"),
				},
				header:
				{
					tag: header?.tagName,
					span: header?.querySelector("span[dir='auto']")?.className.split(" ").includes("truncate"),
					text: header?.textContent,
				},
				group:
				{
					hold: group?.getAttribute("data-hold"),
					reason: group?.getAttribute("data-hold-reason"),
					ariaHidden: group?.getAttribute("aria-hidden"),
					role: group?.getAttribute("role"),
				},
				rows: block ? skeletonRows(block) : [],
				listbox:
				{
					role: listbox?.getAttribute("role"),
					label: listbox?.getAttribute("aria-label"),
					busy: listbox?.getAttribute("aria-busy"),
				},
				status:
				{
					label: status?.getAttribute("aria-label"),
					srOnly: status?.className,
					text: status?.textContent,
				},
				width: listbox?.parentElement?.style.width,
			},
		).toStrictEqual(
			{
				block:
				{
					rows: "3",
					ariaHidden: "true",
				},
				header:
				{
					tag: "DIV",
					span: true,
					text: "Sessions",
				},
				group:
				{
					hold: "none",
					reason: "overlay",
					ariaHidden: "true",
					role: null,
				},
				rows: [160, 128, 144].map((width, row) => (
				{
					className: "flex h-6 items-center gap-1.5 px-2",
					ariaHidden: row === 0 ? null : "true",
					bars: [
						{
							width: "20px",
							height: "20px",
							role: null,
						},
						{
							width: `${width}px`,
							height: "16px",
							role: null,
						},
					],
				})),
				listbox:
				{
					role: null,
					label: null,
					busy: "true",
				},
				status:
				{
					label: "Mention suggestions",
					srOnly: "sr-only",
					text: "Loading",
				},
				width: "420px",
			},
		);
	});

	it("splices a block below existing rows with a delayed reveal and no status", () =>
	{
		const {container} = renderMenu(
			{
				options: [README_OPTION, SESSION_OPTION],
				pending: [
					{
						providerId: "ccp-agents",
						before: 2,
						rows: 2,
					},
				],
			},
		);

		const listbox = screen.getByRole(
			"listbox",
			{
				name: "Mention suggestions",
			},
		);
		expect(
			{
				order: [...listbox.children].map((child) =>
					child.hasAttribute("data-pending-rows") ? "pending" : child.textContent,
				),
				hold: container.querySelector("[data-cds='SkeletonGroup']")?.getAttribute("data-hold"),
				busy: listbox.getAttribute("aria-busy"),
				status: container.querySelector("[role='status']"),
			},
		).toStrictEqual(
			{
				order: ["README.md", "Fix bugrepo · main", "pending"],
				hold: "delayed",
				busy: "true",
				status: null,
			},
		);
	});

	it("hides an onlyWhenEmpty block once any row exists", () =>
	{
		const {container} = renderMenu(
			{
				options: [README_OPTION],
				pending: [
					{
						...sessionsPending,
						onlyWhenEmpty: true,
					},
				],
			},
		);

		expect(
			{
				block: container.querySelector("[data-pending-rows]"),
				busy: screen.getByRole("listbox").getAttribute("aria-busy"),
			},
		).toStrictEqual(
			{
				block: null,
				busy: null,
			},
		);
	});

	it("remounts the skeleton group each time the popup empties", () =>
	{
		const {container, rerender} = renderMenu(
			{
				pending: [sessionsPending],
			},
		);
		const first = container.querySelector("[data-cds='SkeletonGroup']");
		const props =
		{
			id: "mentions",
			highlighted: 0,
			onHighlight: () => undefined,
			onAccept: () => undefined,
			pending: [sessionsPending],
		};
		rerender(<MentionMenu {...props} options={[README_OPTION]} />);
		rerender(<MentionMenu {...props} options={[]} />);

		expect(container.querySelector("[data-cds='SkeletonGroup']") === first).toBe(false);
	});
});

describe("MentionMenu empty hint", () =>
{
	it("shows the hint in a gutter block, moves the gutter off a role-less listbox and mirrors it into the status", () =>
	{
		const {container} = renderMenu(
			{
				emptyHint: "No sessions match",
			},
		);

		const listbox = container.querySelector("[data-cds='MentionDropdown']");
		const gutter = listbox?.firstElementChild;
		const row = gutter?.firstElementChild;
		const classes = row?.className.split(" ") ?? [];
		expect(
			{
				listbox:
				{
					role: listbox?.getAttribute("role"),
					label: listbox?.getAttribute("aria-label"),
					className: listbox?.className,
				},
				gutter:
				{
					ariaHidden: gutter?.getAttribute("aria-hidden"),
					className: gutter?.className,
				},
				row:
				{
					has: ["flex", "items-center", "gap-1.5", "select-none", "min-h-6", "font-medium"].filter((c) =>
						classes.includes(c),
					),
					text: row?.textContent,
				},
				status: container.querySelector("[role='status']")?.textContent,
				width: listbox?.parentElement?.style.width,
			},
		).toStrictEqual(
			{
				listbox:
				{
					role: null,
					label: null,
					className: "",
				},
				gutter:
				{
					ariaHidden: "true",
					className: "p-1",
				},
				row:
				{
					has: ["flex", "items-center", "gap-1.5", "select-none", "min-h-6", "font-medium"],
					text: "No sessions match",
				},
				status: "No sessions match",
				width: "420px",
			},
		);
	});
});

describe("Composer mention providers", () =>
{
	function renderWith(providers: readonly MentionProvider[], onSend = vi.fn<(prompt: string) => void>())
	{
		render(
			<PanelsOff>
				<Composer variant="session" draftKey="session-alice" onSend={onSend} mentionProviders={providers} />
			</PanelsOff>,
		);
		return screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
	}

	const hinting: MentionProvider =
	{
		id: "ccp-sessions",
		fetchOptions: async () => Promise.resolve([]),
		emptyHint: () => "No sessions match",
	};

	it("lets arrows and Tab through a hint-only popup, closes it on Escape and reopens once the token grows", async () =>
	{
		const textarea = renderWith([hinting]);
		await type(textarea, "@ab");

		const status = () => document.querySelector("[role='status'][aria-label='Mention suggestions']")?.textContent;
		const shown = status();
		const arrowPassed = fireEvent.keyDown(
			textarea,
			{
				key: "ArrowDown",
			},
		);
		const tabPassed = fireEvent.keyDown(
			textarea,
			{
				key: "Tab",
			},
		);
		const escapePassed = fireEvent.keyDown(
			textarea,
			{
				key: "Escape",
			},
		);
		const afterEscape = status();
		await type(textarea, "@abc");

		expect(
			{
				shown,
				arrowPassed,
				tabPassed,
				escapePassed,
				afterEscape,
				reopened: status(),
			},
		).toStrictEqual(
			{
				shown: "No sessions match",
				arrowPassed: true,
				tabPassed: true,
				escapePassed: false,
				afterEscape: undefined,
				reopened: "No sessions match",
			},
		);
	});

	it("keeps a hint-only popup's hint mounted while the next query loads", async () =>
	{
		let release: (() => void) | undefined;
		const slow: MentionProvider =
		{
			id: "ccp-sessions",
			fetchOptions: async (query) =>
				query === "ab"
					? new Promise<readonly MentionOption[]>((resolve) =>
						{
							release = () =>
							{
								resolve([]);
							};
						})
					: Promise.resolve([]),
			emptyHint: () => "No sessions match",
		};
		const textarea = renderWith([slow]);
		await type(textarea, "@a");
		const before = document.querySelector("[data-cds='MentionDropdown'] > [aria-hidden='true'] > div");

		await type(textarea, "@ab");
		const during = document.querySelector("[data-cds='MentionDropdown'] > [aria-hidden='true'] > div");
		const status = document.querySelector("[role='status']")?.textContent;
		await act(async () =>
		{
			release?.();
			await Promise.resolve();
		});

		expect(
			{
				same: before !== null && before === during,
				status,
			},
		).toStrictEqual(
			{
				same: true,
				status: "No sessions match",
			},
		);
	});

	it("accepts a session row as an @[Title] chip and hands it to the provider on send", async () =>
	{
		const onSent = vi.fn<NonNullable<MentionProvider["onSent"]>>();
		const sessions: MentionProvider =
		{
			id: "ccp-sessions",
			fetchOptions: () => [SESSION_OPTION],
			onSent,
		};
		const onSend = vi.fn<(prompt: string) => void>();
		const textarea = renderWith([sessions], onSend);
		await type(textarea, "see @fix");

		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);
		const text = textarea.value;
		const chip = screen.getByTestId("composer-mention-chip");
		const chipShown =
		{
			session: chip.dataset["sessionId"],
			path: chip.dataset["path"],
			text: chip.textContent,
		};
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				text,
				chipShown,
				sent: onSend.mock.calls.map(([prompt]) => prompt),
				onSent: onSent.mock.calls,
			},
		).toStrictEqual(
			{
				text: "see @[Fix bug] ",
				chipShown:
				{
					session: "session-bob",
					path: undefined,
					text: "@[Fix bug]",
				},
				sent: ["see @[Fix bug]"],
				onSent: [
					[
						"see @[Fix bug]",
						[
							{
								start: 4,
								end: 14,
								kind: "session",
								sessionId: "session-bob",
								title: "Fix bug",
							},
						],
					],
				],
			},
		);
	});

	it("removes an agent row's @query token and leaves no chip", async () =>
	{
		const onSelect = vi.fn<NonNullable<MentionProvider["onSelect"]>>();
		const agent: MentionOption =
		{
			id: "code-reviewer",
			providerId: "ccp-agents",
			label: "code-reviewer",
			renderedText: "code-reviewer",
			category: "Agents",
			kind: "agent",
		};
		const textarea = renderWith([
			{
				id: "ccp-agents",
				fetchOptions: () => [agent],
				onSelect,
			},
		]);
		await type(textarea, "@rev");

		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				text: textarea.value,
				chips: screen.queryAllByTestId("composer-mention-chip").length,
				selected: onSelect.mock.calls.map(([option]) => option.id),
			},
		).toStrictEqual(
			{
				text: "",
				chips: 0,
				selected: ["code-reviewer"],
			},
		);
	});
});

describe("Composer @ outputs", () =>
{
	it("ranks a session output into a search as a /tmp-captioned row whose accept inserts its absolute path", async () =>
	{
		responses.set(searchUrl("rep"), search("rep", ["src/rep.ts"]));
		responses.set(TOP_URL, listing([]));
		render(
			<PanelsOff>
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() => undefined}
					mentionSessionId="session-alice"
					mentionOutputs={[
						{
							path: "/tmp/report.pdf",
							shownPath: "/tmp/report.pdf",
						},
					]}
				/>
			</PanelsOff>,
		);
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);

		await type(textarea, "@rep");
		const shown = screen.getAllByRole("option").map((row) => row.textContent);
		fireEvent.click(screen.getAllByRole("option")[1]!);

		expect(
			{
				shown,
				text: textarea.value,
			},
		).toStrictEqual(
			{
				shown: ["rep.tssrc", "report.pdf/tmp"],
				text: "@/tmp/report.pdf ",
			},
		);
	});
});
