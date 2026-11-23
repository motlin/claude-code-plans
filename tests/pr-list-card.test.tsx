// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionHoverCard} from "../src/components/session-hover-card";
import {PrListCard} from "../src/components/sidebar/pr-list-card";
import type {PrEntry} from "../src/lib/pr-entries";

const URL = "https://github.com/o/r/pull/12";

const ENTRY: PrEntry =
{
	state: "open",
	repo: "o/r",
	number: 12,
	url: URL,
	title: "Fix the thing",
	ciState: "failed",
	additions: 10,
	deletions: 2,
};

beforeEach(() =>
{
	vi.useFakeTimers();
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

function hover(element: Element)
{
	act(() =>
	{
		fireEvent.pointerEnter(
			element,
			{
				pointerType: "mouse",
			},
		);
		fireEvent.pointerOver(
			element,
			{
				pointerType: "mouse",
			},
		);
		fireEvent.mouseEnter(element);
		fireEvent.mouseMove(element);
	});
}

async function advance(ms: number)
{
	await act(async () =>
	{
		await vi.advanceTimersByTimeAsync(ms);
	});
}

function prCard(): HTMLElement | null
{
	return document.querySelector("[aria-label='Pull requests']");
}

function sessionCard(): HTMLElement | null
{
	return document.querySelector("[data-session-hover-card]");
}

async function openCard(entries: readonly PrEntry[], onRowClick = vi.fn<() => void>())
{
	render(
		<a href="#row" onClick={onRowClick}>
			<PrListCard entries={entries}>
				<span data-testid="glyph">PR</span>
			</PrListCard>
		</a>,
	);
	hover(screen.getByTestId("glyph"));
	await advance(250);
	const card = prCard();
	if (card === null) throw new Error("no PR card");
	return card;
}

/** Each element under the card's list items (not inside icons) as {tag, className, text} (text only on leaves). */
function shape(root: Element)
{
	return [...root.querySelectorAll("li *:not(svg *)")].map((node) => (
	{
		tag: node.tagName.toLowerCase(),
		className: node.getAttribute("class"),
		text: node.children.length === 0 ? node.textContent : null,
	}));
}

const ANCHOR_CLASS =
	"flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-body text-primary outline-none hover:bg-alpha-1 focus-visible:shadow-focus focus-visible:outline-hidden";
const TITLE_CLASS =
	"min-w-0 truncate text-body-medium [text-align:-webkit-match-parent] supports-[text-align:match-parent]:[text-align:match-parent]";
const META_CLASS = "flex min-w-0 items-center text-footnote text-muted-as-secondary";

describe("PrListCard", () =>
{
	it("opens upstream's Pull requests list after 250ms with one entry row per PR", async () =>
	{
		const card = await openCard([ENTRY]);
		const list = card.querySelector("ul");
		const item = list?.querySelector("li");
		const anchor = item?.querySelector("a");
		expect(
			{
				list: list?.getAttribute("class"),
				role: list?.getAttribute("role"),
				items: list?.children.length,
				title: item?.getAttribute("title"),
				href: anchor?.getAttribute("href"),
				target: anchor?.getAttribute("target"),
				rel: anchor?.getAttribute("rel"),
				shape: shape(card),
			},
		).toStrictEqual(
			{
				list: "scroll-fade-y flex max-h-[24rem] flex-col overflow-y-auto rounded-[inherit] p-xs",
				role: "list",
				items: 1,
				title: URL,
				href: URL,
				target: "_blank",
				rel: "noopener noreferrer",
				shape: [
					{
						tag: "a",
						className: ANCHOR_CLASS,
						text: null,
					},
					{
						tag: "span",
						className: "flex min-w-0 flex-1 flex-col gap-0.5",
						text: null,
					},
					{
						tag: "bdi",
						className: TITLE_CLASS,
						text: "Fix the thing",
					},
					{
						tag: "span",
						className: META_CLASS,
						text: null,
					},
					{
						tag: "span",
						className: "flex min-w-0 items-center gap-1 text-git-opened",
						text: null,
					},
					{
						tag: "svg",
						className: "lucide lucide-git-pull-request shrink-0",
						text: null,
					},
					{
						tag: "span",
						className: "min-w-0 truncate",
						text: "Checks failed",
					},
					{
						tag: "span",
						className: "shrink-0 px-1.5",
						text: "·",
					},
					{
						tag: "span",
						className: "min-w-0 shrink-[9999] truncate",
						text: "o/r",
					},
					{
						tag: "span",
						className: "shrink-0 tabular-nums ps-1",
						text: "#12",
					},
					{
						tag: "span",
						className: "ms-auto shrink-0 whitespace-nowrap ps-2 tabular-nums",
						text: null,
					},
					{
						tag: "span",
						className: "[font-feature-settings:'case']",
						text: null,
					},
					{
						tag: "span",
						className: "text-git-added opacity-70",
						text: "+10",
					},
					{
						tag: "span",
						className: "ms-1 text-git-removed opacity-70",
						text: "−2",
					},
				],
			},
		);
	});

	it("ends the footnote line with upstream's subtle +A −D stat only when both counts are known", async () =>
	{
		const card = await openCard([
			{
				state: "open",
				number: 1,
				title: "Zero",
				additions: 0,
				deletions: 0,
			},
			{
				state: "open",
				number: 2,
				title: "Half",
				additions: 5,
			},
			{
				state: "open",
				repo: "an-owner-with-a-very-long-name/and-an-even-longer-repository-name",
				number: 3,
				title: "Long",
				additions: 12345,
				deletions: 678,
			},
		]);
		expect(
			[...card.querySelectorAll("bdi + span")].map((meta) =>
			{
				const last = meta.lastElementChild;
				return [last?.getAttribute("class"), last?.textContent, last?.firstElementChild?.getAttribute("dir")];
			}),
		).toStrictEqual([
			["ms-auto shrink-0 whitespace-nowrap ps-2 tabular-nums", "+0−0", "ltr"],
			["shrink-0 tabular-nums ps-1", "#2", undefined],
			["ms-auto shrink-0 whitespace-nowrap ps-2 tabular-nums", "+12345−678", "ltr"],
		]);
	});

	it("shows #N as a tabular title and no trailing number when the PR has no title", async () =>
	{
		const card = await openCard([
			{
				state: "merged",
				repo: "o/r",
				number: 12,
				url: URL,
			},
		]);
		const meta = card.querySelector("bdi + span");
		expect(
			{
				title: card.querySelector("bdi")?.getAttribute("class"),
				text: card.querySelector("bdi")?.textContent,
				state: meta?.firstElementChild?.getAttribute("class"),
				meta: [...(meta?.children ?? [])]
					.slice(1)
					.map((node) => [node.getAttribute("class"), node.textContent]),
			},
		).toStrictEqual(
			{
				title: `${TITLE_CLASS} tabular-nums`,
				text: "#12",
				state: "flex min-w-0 items-center gap-1 text-git-merged",
				meta: [
					["shrink-0 px-1.5", "·"],
					["min-w-0 shrink-[9999] truncate", "o/r"],
				],
			},
		);
	});

	it("renders an entry without a url as a plain span, not a link", async () =>
	{
		const card = await openCard([
			{
				state: "draft",
				number: 4,
				title: "WIP",
			},
		]);
		const item = card.querySelector("li");
		expect(
			{
				title: item?.getAttribute("title"),
				child: item?.firstElementChild?.tagName.toLowerCase(),
				childClass: item?.firstElementChild?.getAttribute("class"),
				links: card.querySelectorAll("a").length,
				meta: [...(card.querySelector("bdi + span")?.children ?? [])].map((node) => [
					node.getAttribute("class"),
					node.textContent,
				]),
			},
		).toStrictEqual(
			{
				title: null,
				child: "span",
				childClass: ANCHOR_CLASS,
				links: 0,
				meta: [
					["flex min-w-0 items-center gap-1 text-git-draft", "Draft"],
					["shrink-0 px-1.5", "·"],
					["shrink-0 tabular-nums ps-1", "#4"],
				],
			},
		);
	});

	it("stops clicks inside the popup and on the entry link from reaching the row", async () =>
	{
		const onRowClick = vi.fn<() => void>();
		const card = await openCard([ENTRY], onRowClick);
		const anchor = card.querySelector("a");
		if (anchor === null) throw new Error("no anchor");
		anchor.addEventListener("click", (event) =>
		{
			event.preventDefault();
		});
		fireEvent.click(card);
		fireEvent.pointerDown(card);
		fireEvent.doubleClick(card);
		fireEvent.click(anchor);
		expect(onRowClick).not.toHaveBeenCalled();
	});

	it("returns focus to the trigger's control when Escape closes the card", async () =>
	{
		render(
			<PrListCard entries={[ENTRY]} keyboardOnly>
				<span className="flex items-center" data-arrows-only="">
					<button type="button">More options</button>
				</span>
			</PrListCard>,
		);
		const kebab = screen.getByRole("button");
		act(() =>
		{
			kebab.focus();
		});
		await advance(250);
		const anchor = prCard()?.querySelector("a");
		if (anchor == null) throw new Error("no card");
		act(() =>
		{
			anchor.focus();
		});
		fireEvent.keyDown(
			anchor,
			{
				key: "Escape",
			},
		);
		await advance(0);
		expect(
			{
				card: prCard(),
				focused: document.activeElement === kebab,
			},
		).toStrictEqual(
			{
				card: null,
				focused: true,
			},
		);
	});

	it("never opens the keyboard-only card while the pointer is inside its trigger", async () =>
	{
		render(
			<PrListCard entries={[ENTRY]} keyboardOnly>
				<span className="flex items-center" data-arrows-only="">
					<button type="button">More options</button>
				</span>
			</PrListCard>,
		);
		hover(screen.getByRole("button"));
		await advance(600);
		expect(prCard()).toBeNull();
	});
});

function Row({children}: {children: ReactNode})
{
	return (
		<QueryClientProvider client={new QueryClient()}>
			<SessionHoverCard
				sessionId="s1"
				title="Row title"
				summary="What the session did"
				blocked={false}
				render={<div data-testid="row" />}
			>
				{children}
			</SessionHoverCard>
		</QueryClientProvider>
	);
}

describe("PR card and session hover card exclusion", () =>
{
	it("keeps the session card closed while the PR card is open", async () =>
	{
		render(
			<Row>
				<PrListCard entries={[ENTRY]}>
					<span data-testid="glyph">PR</span>
				</PrListCard>
			</Row>,
		);
		hover(screen.getByTestId("row"));
		hover(screen.getByTestId("glyph"));
		await advance(250);
		expect(prCard()).not.toBeNull();
		await advance(600);
		expect(
			{
				pr: prCard() !== null,
				session: sessionCard(),
			},
		).toStrictEqual(
			{
				pr: true,
				session: null,
			},
		);
	});

	it("keeps the keyboard PR card closed while the session card is open", async () =>
	{
		render(
			<Row>
				<PrListCard entries={[ENTRY]} keyboardOnly>
					<span data-arrows-only="">
						<button type="button">More options</button>
					</span>
				</PrListCard>
			</Row>,
		);
		hover(screen.getByTestId("row"));
		await advance(500);
		expect(sessionCard()).not.toBeNull();
		act(() =>
		{
			screen.getByRole("button").focus();
		});
		await advance(400);
		expect(prCard()).toBeNull();
	});

	it("re-enables the session card once an open PR card unmounts", async () =>
	{
		const view = render(
			<Row>
				<PrListCard entries={[ENTRY]}>
					<span data-testid="glyph">PR</span>
				</PrListCard>
			</Row>,
		);
		hover(screen.getByTestId("glyph"));
		await advance(250);
		expect(prCard()).not.toBeNull();
		view.rerender(
			<Row>
				<span data-testid="glyph">PR</span>
			</Row>,
		);
		hover(screen.getByTestId("row"));
		await advance(600);
		expect(sessionCard()).not.toBeNull();
	});
});
