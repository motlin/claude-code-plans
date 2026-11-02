// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChaptersToc} from "../src/components/session-chapters-toc";
import {addUserChapter, CHAPTER_STORAGE_KEY} from "../src/lib/chapter-store";
import type {SessionChapter} from "../src/lib/session-chapters";
import {installLocalStorage} from "./fake-storage";

const SESSION_ID = "session-alice";

const START: SessionChapter =
{
	id: "session-start",
	title: "Session start",
	source: "session",
	uuid: "u-0",
	recordIndex: 0,
};
const PLAN: SessionChapter =
{
	id: "toolu_plan",
	title: "Plan the work",
	summary: "Read the queue",
	source: "claude",
	uuid: "a-1",
	recordIndex: 10,
};
const PIN: SessionChapter =
{
	id: "uch-fake-uuid-1",
	title: "Kickoff",
	source: "user",
	uuid: "u-2",
	recordIndex: 20,
};
const CHAPTERS = [START, PLAN, PIN];

const ROOT_CLASS =
	"epitaxy-toc absolute top-[20px] bottom-[32px] -start-[var(--session-rail-band-start,0px)] z-[11] pointer-events-none [.epitaxy-chat-panel[data-chat-gutter-end=bleed]:not([data-chat-gutter-start])_&]:[--chat-gutter:var(--chat-gutter-end,clamp(16px,(100cqw_-_var(--chat-column-measure,var(--transcript-measure))_-_16px)_*_0.4_+_16px,32px))]";
const POPOVER_CLASS =
	"absolute start-0 top-0 isolate rounded-card bg-surface-3 shadow-panel forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] rounded-lg w-max min-w-[232px] max-w-[320px] max-h-full flex flex-col py-sm transition-[opacity,transform,visibility] motion-reduce:transition-none duration-150 ease-out";
const POPOVER_CLOSED = "invisible opacity-0 -translate-x-1 [&:where(:root[dir=rtl]_:dir(rtl))]:translate-x-1";
const POPOVER_OPEN = "visible opacity-100 pointer-events-auto";
const ROW_BUTTON_CLASS =
	"group/ch hit-row-main w-full flex items-center gap-sm px-1.25 h-list-row rounded-r4 text-start text-body hover:bg-fill-ghost-hover";
const RAIL_DASH_CLASS =
	"block h-[2px] rounded-full transition-[scale,background-color] motion-reduce:transition-none duration-200 w-[calc(var(--chat-gutter)*3/8+2px)] origin-left [&:where(:root[dir=rtl]_:dir(rtl))]:origin-right";
const ROW_DASH_CLASS = "block h-[2px] rounded-full shrink-0 transition-[background-color] duration-150";

/** A scroller whose reading line sits past the Plan heading only, so Plan is the active chapter. */
function buildScroller(): HTMLDivElement
{
	const scroller = document.createElement("div");
	scroller.getBoundingClientRect = () =>
		(
		{
			top: 100,
			bottom: 700,
		}) as DOMRect;
	Object.defineProperty(
		scroller,
		"scrollHeight",
		{
			get: () => 3000,
		},
	);
	Object.defineProperty(
		scroller,
		"clientHeight",
		{
			get: () => 600,
		},
	);
	const row = document.createElement("div");
	row.setAttribute("data-transcript-entry-index", "0");
	row.setAttribute("data-perf-line", "0");
	row.getBoundingClientRect = () =>
		(
		{
			top: 100,
			bottom: 900,
		}) as DOMRect;
	for (const [id, top] of [
		["toolu_plan", 120],
		["uch-fake-uuid-1", 500],
	] as const)
	{
		const heading = document.createElement("h3");
		heading.id = `epitaxy-ch-${id}`;
		heading.getBoundingClientRect = () =>
			(
			{
				top,
				bottom: top + 20,
			}) as DOMRect;
		row.append(heading);
	}
	scroller.append(row);
	document.body.append(scroller);
	return scroller;
}

function renderToc(chapters: readonly SessionChapter[] = CHAPTERS, onJump = vi.fn<(chapter: SessionChapter) => void>())
{
	const scrollRef =
	{
		current: buildScroller(),
	};
	const view = render(
		<SessionChaptersToc
			sessionId={SESSION_ID}
			chapters={chapters}
			scrollRef={scrollRef}
			scrollKey="visit"
			onJump={onJump}
		/>,
	);
	return {
		...view,
		onJump,
	};
}

// By selector, not role: an open row menu makes everything outside it inert.
const nav = () => document.querySelector<HTMLElement>("nav[aria-label='Session chapters']")!;
const popover = () => nav().querySelector<HTMLElement>("[data-surface='popover']")!;
const rail = () => nav().querySelector<HTMLElement>("ol[data-dash-rail]")!;
const rowButton = (title: string) =>
	[...popover().querySelectorAll("button")].find((button) => button.textContent.startsWith(title))!;
const isOpen = () => popover().className === `${POPOVER_CLASS} ${POPOVER_OPEN}`;
const stored = (): unknown => JSON.parse(localStorage.getItem(CHAPTER_STORAGE_KEY) ?? "null");

function openMenuOn(element: Element): HTMLElement | undefined
{
	fireEvent.contextMenu(
		element,
		{
			clientX: 10,
			clientY: 10,
		},
	);
	return screen.queryAllByRole("menu").at(-1);
}

function clickItem(menu: HTMLElement, title: string): void
{
	const item = [...menu.querySelectorAll('[role="menuitem"]')].find(
		(row) => row.querySelector("[data-menu-item-title]")?.textContent === title,
	);
	if (item === undefined) throw new Error(`no item ${title}`);
	fireEvent.click(item);
}

describe("SessionChaptersToc", () =>
{
	let frames: FrameRequestCallback[] = [];
	const flushFrames = () =>
	{
		const due = frames;
		frames = [];
		act(() =>
		{
			for (const frame of due) frame(0);
		});
	};

	beforeEach(() =>
	{
		installLocalStorage();
		frames = [];
		vi.spyOn(crypto, "randomUUID").mockReturnValue("fake-uuid-1" as ReturnType<typeof crypto.randomUUID>);
	});

	afterEach(() =>
	{
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		document.body.replaceChildren();
	});

	it("renders nothing for a session whose only chapter is its start", () =>
	{
		const {container} = renderToc([START]);
		expect(container.innerHTML).toBe("");
	});

	it("draws upstream's rail and closed popover, the active chapter marked on both", () =>
	{
		renderToc();
		const root = nav().parentElement!;
		const list = popover().querySelector("ol")!;
		const dashes = [...rail().querySelectorAll("li")];
		const rows = [...list.querySelectorAll(":scope > li")];
		const planButton = rowButton("Plan the work");
		const summary = planButton.querySelector("span[hidden]")!;

		expect(
			{
				root: root.className,
				nav:
				{
					className: nav().className,
					tabIndex: nav().tabIndex,
				},
				rail:
				{
					className: rail().className,
					ariaHidden: rail().getAttribute("aria-hidden"),
				},
				dashItems: dashes.map((item) => item.className),
				dashes: dashes.map((item) => item.firstElementChild?.className),
				popover: popover().className,
				list:
				{
					className: list.className,
					role: list.getAttribute("role"),
				},
				rows: rows.map((row) => row.className),
				buttons: [...list.querySelectorAll("button")].map((button) => (
				{
					type: button.type,
					className: button.className,
					current: button.getAttribute("aria-current"),
					dash: button.firstElementChild?.className,
					dashHidden: button.firstElementChild?.getAttribute("aria-hidden"),
					text: button.textContent,
				})),
				summary:
				{
					text: summary.textContent,
					describes: planButton.getAttribute("aria-describedby") === summary.id,
					others: [rowButton("Session start"), rowButton("Kickoff")].map((button) =>
						button.getAttribute("aria-describedby"),
					),
				},
			},
		).toStrictEqual(
			{
				root: `${ROOT_CLASS} epitaxy-toc-fade-in`,
				nav:
				{
					className:
						"relative h-full w-[var(--chat-gutter)] [.epitaxy-chat-panel_&]:[@container_tile-slot_(max-width:560px)]:[--chat-gutter:16px] focus-visible:outline-hidden focus-visible:shadow-focus",
					tabIndex: 0,
				},
				rail:
				{
					className:
						"max-h-full flex flex-col py-1.25 ps-[calc(var(--chat-gutter)*3/16)] overflow-hidden pointer-events-auto",
					ariaHidden: "true",
				},
				dashItems: ["h-[8px] flex items-center", "h-[8px] flex items-center", "h-[8px] flex items-center"],
				dashes: [
					`${RAIL_DASH_CLASS} scale-x-[calc(9/14)] bg-alpha-3`,
					`${RAIL_DASH_CLASS} bg-alpha-8`,
					`${RAIL_DASH_CLASS} scale-x-[calc(9/14)] bg-alpha-3`,
				],
				popover: `${POPOVER_CLASS} ${POPOVER_CLOSED}`,
				list:
				{
					className: "flex-1 min-h-0 flex flex-col hit-gap-y-0.75 overflow-y-auto px-xs",
					role: "list",
				},
				rows: ["hit-row", "hit-row", "hit-row"],
				buttons: [
					{
						type: "button",
						className: `${ROW_BUTTON_CLASS} text-secondary hover:text-primary`,
						current: null,
						dash: `${ROW_DASH_CLASS} w-[9px] bg-alpha-3 group-hover/ch:bg-alpha-5`,
						dashHidden: "true",
						text: "Session start",
					},
					{
						type: "button",
						className: `${ROW_BUTTON_CLASS} text-primary`,
						current: "true",
						dash: `${ROW_DASH_CLASS} w-[14px] bg-alpha-8`,
						dashHidden: "true",
						text: "Plan the workRead the queue",
					},
					{
						type: "button",
						className: `${ROW_BUTTON_CLASS} text-secondary hover:text-primary`,
						current: null,
						dash: `${ROW_DASH_CLASS} w-[9px] bg-alpha-3 group-hover/ch:bg-alpha-5`,
						dashHidden: "true",
						text: "Kickoff",
					},
				],
				summary:
				{
					text: "Read the queue",
					describes: true,
					others: [null, null],
				},
			},
		);
	});

	it("is invisible until the active chapter is first computed", () =>
	{
		const scroller = document.createElement("div");
		const {container} = render(
			<SessionChaptersToc
				sessionId={SESSION_ID}
				chapters={CHAPTERS}
				scrollRef={
				{
					current: scroller,
				}}
				scrollKey="visit"
				onJump={() =>
				{
				}}
			/>,
		);
		expect(container.firstElementChild?.className).toBe(`${ROOT_CLASS} invisible`);
	});

	it("opens on entering the rail or focusing the nav, and closes on leaving it or blurring outside", () =>
	{
		renderToc();
		const atRest = isOpen();
		fireEvent.mouseEnter(rail());
		const afterEnter = isOpen();
		fireEvent.mouseLeave(nav());
		const afterLeave = isOpen();
		fireEvent.focus(nav());
		const afterFocus = isOpen();
		fireEvent.blur(
			nav(),
			{
				relatedTarget: rowButton("Kickoff"),
			},
		);
		const afterBlurInside = isOpen();
		fireEvent.blur(
			rowButton("Kickoff"),
			{
				relatedTarget: document.body,
			},
		);

		expect(
			{
				atRest,
				afterEnter,
				afterLeave,
				afterFocus,
				afterBlurInside,
				afterBlurOutside: isOpen(),
			},
		).toStrictEqual(
			{
				atRest: false,
				afterEnter: true,
				afterLeave: false,
				afterFocus: true,
				afterBlurInside: true,
				afterBlurOutside: false,
			},
		);
	});

	it("jumps to the clicked chapter", () =>
	{
		const {onJump} = renderToc();
		fireEvent.mouseEnter(rail());
		fireEvent.click(rowButton("Session start"));
		fireEvent.click(rowButton("Kickoff"));

		expect(onJump.mock.calls).toStrictEqual([[START], [PIN]]);
	});

	it("offers Rename and Delete on a chapter row but no menu on Session start, and stays open under the menu", () =>
	{
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
		renderToc();
		fireEvent.mouseEnter(rail());
		const startMenu = openMenuOn(rowButton("Session start"));
		const menu = openMenuOn(rowButton("Plan the work"))!;
		const rows = [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "---" : row.querySelector("[data-menu-item-title]")?.textContent,
		);
		fireEvent.mouseLeave(nav());
		const underMenu = isOpen();
		act(() =>
		{
			fireEvent.keyDown(
				menu,
				{
					key: "Escape",
				},
			);
		});
		flushFrames();

		expect(
			{
				startMenu,
				rows,
				underMenu,
				afterMenuClosed: isOpen(),
			},
		).toStrictEqual(
			{
				startMenu: undefined,
				rows: ["Rename", "---", "Delete"],
				underMenu: true,
				afterMenuClosed: false,
			},
		);
	});

	it("starts a rename from the row menu, with the list held open once the menu has closed", () =>
	{
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
		renderToc();
		fireEvent.mouseEnter(rail());
		const menu = openMenuOn(rowButton("Plan the work"))!;
		act(() =>
		{
			clickItem(menu, "Rename");
		});
		flushFrames();
		const input = document.querySelector<HTMLInputElement>("input[aria-label='Chapter title']");

		expect(
			{
				value: input?.value,
				focused: document.activeElement === input,
				open: isOpen(),
			},
		).toStrictEqual(
			{
				value: "Plan the work",
				focused: true,
				open: true,
			},
		);
	});

	it("deletes a Claude chapter by hiding it and a user chapter by removing it", () =>
	{
		addUserChapter(SESSION_ID, "u-2", "Kickoff", 20);
		renderToc();
		fireEvent.mouseEnter(rail());
		const claudeMenu = openMenuOn(rowButton("Plan the work"))!;
		act(() =>
		{
			clickItem(claudeMenu, "Delete");
		});
		const afterClaude = stored();
		const userMenu = openMenuOn(rowButton("Kickoff"))!;
		act(() =>
		{
			clickItem(userMenu, "Delete");
		});

		expect(
			{
				afterClaude,
				afterUser: stored(),
			},
		).toStrictEqual(
			{
				afterClaude:
				{
					[SESSION_ID]:
					{
						renames: {},
						hidden: ["toolu_plan"],
						userChapters: [
							{
								id: "uch-fake-uuid-1",
								afterId: "u-2",
								title: "Kickoff",
								recordIndex: 20,
							},
						],
					},
				},
				afterUser:
				{
					[SESSION_ID]:
					{
						renames: {},
						hidden: ["toolu_plan"],
						userChapters: [],
					},
				},
			},
		);
	});

	it("reveals a row's changed title with upstream's NA and draws a first title plain", () =>
	{
		const {rerender} = renderToc();
		const titleOf = () => rowButton("Plan").querySelector<HTMLElement>("[data-chapter-title]")!;
		const initial = titleOf().innerHTML;
		rerender(
			<SessionChaptersToc
				sessionId={SESSION_ID}
				chapters={[
					START,
					{
						...PLAN,
						title: "Planning",
					},
					PIN,
				]}
				scrollRef={
				{
					current: document.querySelector("div"),
				}}
				scrollKey="visit"
				onJump={vi.fn<(chapter: SessionChapter) => void>()}
			/>,
		);
		const title = titleOf();

		expect(
			{
				initial,
				srOnly: title.querySelector(".sr-only")?.textContent,
				fading: title.querySelector<HTMLElement>("[aria-hidden='true']")?.style.opacity,
			},
		).toStrictEqual(
			{
				initial: "Plan the work",
				srOnly: "Planning",
				fading: "0",
			},
		);
	});

	it("renames a row in place on double-click: Enter and blur commit, Escape cancels, and the list holds open", () =>
	{
		const onDocumentKeyDown = vi.fn<(event: KeyboardEvent) => void>();
		document.addEventListener("keydown", onDocumentKeyDown);
		addUserChapter(SESSION_ID, "u-2", "Kickoff", 20);
		const pinned =
		{
			id: "uch-fake-uuid-1",
			afterId: "u-2",
			title: "Kickoff",
			recordIndex: 20,
		};
		renderToc();
		fireEvent.mouseEnter(rail());

		fireEvent.doubleClick(rowButton("Session start"));
		const startInput = screen.queryByRole(
			"textbox",
			{
				name: "Chapter title",
			},
		);

		fireEvent.doubleClick(rowButton("Plan the work"));
		const input = screen.getByRole<HTMLInputElement>(
			"textbox",
			{
				name: "Chapter title",
			},
		);
		const row = input.parentElement!;
		const editing =
		{
			row: row.className,
			dash: row.firstElementChild?.className,
			input: input.className,
			size: input.size,
			value: input.value,
			selected: input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
			focused: document.activeElement === input,
		};
		fireEvent.mouseLeave(nav());
		const heldOpen = isOpen();
		fireEvent.change(
			input,
			{
				target:
				{
					value: "  Planning  ",
				},
			},
		);
		act(() =>
		{
			fireEvent.keyDown(
				input,
				{
					key: "Enter",
				},
			);
		});
		const afterEnter =
		{
			stored: stored(),
			input: screen.queryByRole(
				"textbox",
				{
					name: "Chapter title",
				},
			),
		};

		fireEvent.doubleClick(rowButton("Plan the work"));
		const second = screen.getByRole(
			"textbox",
			{
				name: "Chapter title",
			},
		);
		fireEvent.change(
			second,
			{
				target:
				{
					value: "Abandoned",
				},
			},
		);
		act(() =>
		{
			fireEvent.keyDown(
				second,
				{
					key: "Escape",
				},
			);
		});
		const afterEscape =
		{
			stored: stored(),
			input: screen.queryByRole(
				"textbox",
				{
					name: "Chapter title",
				},
			),
		};

		fireEvent.doubleClick(rowButton("Kickoff"));
		const third = screen.getByRole(
			"textbox",
			{
				name: "Chapter title",
			},
		);
		fireEvent.change(
			third,
			{
				target:
				{
					value: "Opening moves",
				},
			},
		);
		act(() =>
		{
			fireEvent.blur(
				third,
				{
					relatedTarget: document.body,
				},
			);
		});
		document.removeEventListener("keydown", onDocumentKeyDown);

		expect(
			{
				startInput,
				editing,
				heldOpen,
				afterEnter,
				afterEscape,
				afterBlur: stored(),
				closedAfterBlurOutside: !isOpen(),
				escapeReachedDocument: onDocumentKeyDown.mock.calls.some(([event]) => event.key === "Escape"),
			},
		).toStrictEqual(
			{
				startInput: null,
				editing:
				{
					row: "flex items-center gap-sm px-1.25 h-list-row rounded-r4",
					dash: "block h-[2px] w-[10px] rounded-full bg-alpha-8 shrink-0",
					input: "flex-1 min-w-0 [field-sizing:content] bg-transparent text-body text-primary focus-visible:outline-hidden focus-visible:shadow-focus",
					size: 13,
					value: "Plan the work",
					selected: "Plan the work",
					focused: true,
				},
				heldOpen: true,
				afterEnter:
				{
					stored:
					{
						[SESSION_ID]:
						{
							renames:
							{
								toolu_plan: "Planning",
							},
							hidden: [],
							userChapters: [pinned],
						},
					},
					input: null,
				},
				afterEscape:
				{
					stored:
					{
						[SESSION_ID]:
						{
							renames:
							{
								toolu_plan: "Planning",
							},
							hidden: [],
							userChapters: [pinned],
						},
					},
					input: null,
				},
				afterBlur:
				{
					[SESSION_ID]:
					{
						renames:
						{
							toolu_plan: "Planning",
						},
						hidden: [],
						userChapters: [
							{
								...pinned,
								title: "Opening moves",
							},
						],
					},
				},
				closedAfterBlurOutside: true,
				escapeReachedDocument: false,
			},
		);
	});
});
