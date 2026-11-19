// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {QueuedMessageBar} from "../src/components/queued-message-bar";
import {queuedDragEnd, queuedRowMask} from "../src/lib/queued-reorder";
import {clearComposerQueues, type QueuedPrompt, queuedPreview} from "../src/lib/composer-queue";

afterEach(() =>
{
	cleanup();
	clearComposerQueues();
	document.documentElement.removeAttribute("data-reduce-motion");
});

const ALICE: QueuedPrompt =
{
	id: "q1",
	text: "Alice's first\n\n  follow-up",
};
const BOB: QueuedPrompt =
{
	id: "q2",
	text: "Bob's second follow-up",
};

function renderBar(items: readonly QueuedPrompt[], sessionId = "session-alice", acceptedIds?: ReadonlySet<string>)
{
	const handlers =
	{
		onEdit: vi.fn<(item: QueuedPrompt) => void>(),
		onSendNow: vi.fn<(id: string) => Promise<void>>(async () => {}),
		onRemove: vi.fn<(id: string) => void>(),
		onClearAll: vi.fn<() => void>(),
	};
	const view = render(
		<QueuedMessageBar
			sessionId={sessionId}
			items={items}
			{...(acceptedIds === undefined
				? {}
				:
					{
						acceptedIds,
					})}
			{...handlers}
		/>,
	);
	return {
		...handlers,
		...view,
	};
}

function buttonNames(element: HTMLElement): string[]
{
	return within(element)
		.getAllByRole("button")
		.map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

describe("queuedPreview", () =>
{
	it("collapses whitespace and shows an ellipsis when empty", () =>
	{
		expect([queuedPreview(ALICE.text), queuedPreview("  \n ")]).toStrictEqual(["Alice's first follow-up", "…"]);
	});
});

describe("QueuedMessageBar", () =>
{
	it("replaces an accepted entry's Send now with upstream's ✓ Sent chip", () =>
	{
		renderBar([ALICE], "session-alice", new Set([ALICE.id]));
		const sent = screen.getByTestId("queued-row-sent");
		const chip = sent.firstElementChild;
		const draw = chip?.firstElementChild;
		expect(
			{
				sendNow: screen.queryByRole(
					"button",
					{
						name: "Send now",
					},
				),
				className: sent.className,
				chip: chip?.className,
				draw: draw?.className,
				icon: draw?.firstElementChild?.getAttribute("aria-hidden"),
				text: sent.textContent,
			},
		).toStrictEqual(
			{
				sendNow: null,
				className:
					"flex shrink-0 items-center px-xs text-body text-muted-as-secondary epitaxy-hint-fade-in h-control",
				chip: "inline-flex items-center gap-0.75",
				draw: "epitaxy-check-draw inline-flex",
				icon: "true",
				text: "Sent",
			},
		);
	});

	it("shows the ✓ Sent chip at the small size on an accepted list row", () =>
	{
		renderBar([ALICE, BOB], "session-alice-sent-rows", new Set([BOB.id]));
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /messages queued/,
				},
			),
		);
		const rows = screen.getAllByRole("listitem");
		expect(
			rows.map((row) =>
			{
				const sent = within(row).queryByTestId("queued-row-sent");
				return sent === null
					? null
					:
						{
							className: sent.className,
							text: sent.textContent,
						};
			}),
		).toStrictEqual([
			null,
			{
				className:
					"flex shrink-0 items-center px-xs text-body text-muted-as-secondary epitaxy-hint-fade-in h-5",
				text: "Sent",
			},
		]);
	});

	it("renders nothing without queued prompts", () =>
	{
		const {container} = renderBar([]);
		expect(container.innerHTML).toBe("");
	});

	it("shows one entry as a band with the count, preview and three inline buttons", () =>
	{
		renderBar([ALICE]);
		const entry = document.querySelector<HTMLElement>("[data-take-back-entry]");
		if (entry === null) throw new Error("Expected the single-entry band");

		expect(
			{
				className: entry.className,
				text: Array.from(entry.querySelectorAll("span")).map((span) => span.textContent),
				buttons: buttonNames(entry),
			},
		).toStrictEqual(
			{
				className:
					"flex items-center gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 px-3 select-none",
				text: ["1 message queued", "Alice's first follow-up", "Stops Claude’s current response."],
				buttons: ["Send now", "Edit in composer", "Remove from queue"],
			},
		);
	});

	it("describes Send now as stopping Claude's current response", () =>
	{
		renderBar([ALICE]);
		const sendNow = screen.getByRole(
			"button",
			{
				name: "Send now",
			},
		);
		const describedBy = sendNow.getAttribute("aria-describedby");
		expect(describedBy === null ? null : document.getElementById(describedBy)?.textContent).toBe(
			"Stops Claude’s current response.",
		);
	});

	it("wires the single entry's buttons to the entry", () =>
	{
		const {onEdit, onSendNow, onRemove} = renderBar([ALICE]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Send now",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Edit in composer",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Remove from queue",
				},
			),
		);
		expect(
			{
				sendNow: onSendNow.mock.calls,
				edit: onEdit.mock.calls,
				remove: onRemove.mock.calls,
			},
		).toStrictEqual(
			{
				sendNow: [["q1"]],
				edit: [[ALICE]],
				remove: [["q1"]],
			},
		);
	});

	it("shows Send now as busy with a 12px spinner and sr-only Sending… until the interrupt settles", async () =>
	{
		let settle = () =>
		{
		};
		const pending = new Promise<void>((resolve) =>
		{
			settle = resolve;
		});
		const {onSendNow} = renderBar([ALICE]);
		onSendNow.mockReturnValueOnce(pending);
		const sendNow = screen.getByRole(
			"button",
			{
				name: "Send now",
			},
		);
		fireEvent.click(sendNow);
		fireEvent.click(sendNow);
		const status = await screen.findByText("Sending…");
		const busy =
		{
			ariaBusy: sendNow.getAttribute("aria-busy"),
			ariaDisabled: sendNow.getAttribute("aria-disabled"),
			iconClass: sendNow.querySelector("svg")?.getAttribute("class"),
			overlayClass: sendNow.querySelector("[role=status]")?.parentElement?.className,
			spinnerBox: sendNow.querySelector<HTMLElement>("[data-spinner]")?.style.width,
			statusClass: status.className,
			calls: onSendNow.mock.calls,
		};
		await act(async () =>
		{
			settle();
			await pending;
		});

		expect(
			{
				busy,
				after:
				{
					ariaBusy: sendNow.getAttribute("aria-busy"),
					ariaDisabled: sendNow.getAttribute("aria-disabled"),
					spinner: sendNow.querySelector("[data-spinner]"),
				},
			},
		).toStrictEqual(
			{
				busy:
				{
					ariaBusy: "true",
					ariaDisabled: "true",
					iconClass: "lucide lucide-corner-down-left size-4 opacity-0",
					overlayClass: "absolute inset-0 grid place-items-center leading-[0]",
					spinnerBox: "0.75rem",
					statusClass: "sr-only",
					calls: [["q1"]],
				},
				after:
				{
					ariaBusy: null,
					ariaDisabled: null,
					spinner: null,
				},
			},
		);
	});

	it("collapses two entries into a bar with the count and the next preview", () =>
	{
		renderBar([ALICE, BOB]);
		const bar = screen.getByRole(
			"button",
			{
				name: /2 messages queued/,
			},
		);
		expect(
			{
				expanded: bar.getAttribute("aria-expanded"),
				text: Array.from(bar.querySelectorAll(":scope > span")).map((span) => span.textContent),
				list: screen.queryByRole(
					"list",
					{
						name: "Queued messages",
					},
				),
			},
		).toStrictEqual(
			{
				expanded: "false",
				text: ["2 messages queued", "Next: Alice's first follow-up", ""],
				list: null,
			},
		);
	});

	it("sizes the collapsed bar and expanded header to the control height plus 16px (48px at comfortable)", () =>
	{
		renderBar([ALICE, BOB]);
		const bar = screen.getByRole(
			"button",
			{
				name: /2 messages queued/,
			},
		);
		const barClasses = bar.className.split(" ");
		fireEvent.click(bar);
		const header = screen.getByRole(
			"button",
			{
				name: "Collapse queued messages",
			},
		).parentElement;

		expect(
			{
				bar: barClasses.filter((c) => c.includes("min-h-")),
				header: header?.className.split(" ").filter((c) => c.includes("min-h-")),
			},
		).toStrictEqual(
			{
				bar: ["min-h-10", "comfortable:min-h-12"],
				header: ["min-h-10", "comfortable:min-h-12"],
			},
		);
	});

	it("expands to a list of rows with Clear all, and collapsing returns focus to the bar", () =>
	{
		const {onClearAll} = renderBar([ALICE, BOB]);
		const bar = screen.getByRole(
			"button",
			{
				name: /2 messages queued/,
			},
		);
		bar.focus();
		fireEvent.click(bar);

		const list = screen.getByRole(
			"list",
			{
				name: "Queued messages",
			},
		);
		const collapse = screen.getByRole(
			"button",
			{
				name: "Collapse queued messages",
			},
		);
		const focusAfterExpand = document.activeElement;
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Clear all",
				},
			),
		);
		collapse.focus();
		fireEvent.click(collapse);

		expect(
			{
				rows: within(list)
					.getAllByRole("listitem")
					.map((row) => row.querySelector(".line-clamp-2")?.textContent),
				collapseExpanded: collapse.getAttribute("aria-expanded"),
				focusAfterExpand: focusAfterExpand === collapse,
				clearAll: onClearAll.mock.calls,
				focusAfterCollapse: document.activeElement?.getAttribute("aria-expanded"),
				list: screen.queryByRole(
					"list",
					{
						name: "Queued messages",
					},
				),
			},
		).toStrictEqual(
			{
				rows: [ALICE.text, BOB.text],
				collapseExpanded: "true",
				focusAfterExpand: true,
				clearAll: [[]],
				focusAfterCollapse: "false",
				list: null,
			},
		);
	});

	it("offers Edit in composer / Send now / Remove from queue in each row's menu", async () =>
	{
		const {onSendNow} = renderBar([ALICE, BOB]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /2 messages queued/,
				},
			),
		);
		const triggers = screen.getAllByRole(
			"button",
			{
				name: "Queued message actions",
			},
		);
		const second = triggers[1];
		if (second === undefined) throw new Error("Expected two row menus");
		fireEvent.click(second);
		const menu = await screen.findByRole("menu");
		const items = within(menu)
			.getAllByRole("menuitem")
			.map((item) => item.textContent);
		fireEvent.click(
			within(menu).getByRole(
				"menuitem",
				{
					name: "Send now",
				},
			),
		);

		expect(
			{
				items,
				separators: within(menu).getAllByRole("separator").length,
				sent: onSendNow.mock.calls,
			},
		).toStrictEqual(
			{
				items: ["Edit in composer", "Send now", "Remove from queue"],
				separators: 1,
				sent: [["q2"]],
			},
		);
	});

	it("opens the same row actions on right-click, keeping the row's DotsVertical shown while open", async () =>
	{
		const {onRemove} = renderBar([ALICE, BOB]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /2 messages queued/,
				},
			),
		);
		const rows = within(
			screen.getByRole(
				"list",
				{
					name: "Queued messages",
				},
			),
		).getAllByRole("listitem");
		const second = rows[1];
		if (second === undefined) throw new Error("Expected two rows");
		fireEvent.contextMenu(
			second,
			{
				clientX: 20,
				clientY: 20,
			},
		);
		const menu = await screen.findByRole("menu");
		const items = within(menu)
			.getAllByRole("menuitem")
			.map((item) => item.textContent);
		const dots = within(second).getByRole(
			"button",
			{
				name: "Queued message actions",
				hidden: true,
			},
		);
		const dotsShown = !dots.className.split(" ").includes("opacity-0");
		fireEvent.click(
			within(menu).getByRole(
				"menuitem",
				{
					name: "Remove from queue",
				},
			),
		);

		expect(
			{
				takeBack: second.hasAttribute("data-take-back-entry"),
				items,
				separators: within(menu).getAllByRole("separator").length,
				dotsShown,
				removed: onRemove.mock.calls,
			},
		).toStrictEqual(
			{
				takeBack: true,
				items: ["Edit in composer", "Send now", "Remove from queue"],
				separators: 1,
				dotsShown: true,
				removed: [["q2"]],
			},
		);
	});

	it("remembers expansion per session across remounts", () =>
	{
		const first = renderBar([ALICE, BOB]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /2 messages queued/,
				},
			),
		);
		first.unmount();
		renderBar([ALICE, BOB]);
		expect(
			screen.getByRole(
				"list",
				{
					name: "Queued messages",
				},
			),
		).toBeTruthy();
	});

	it("plays the exit animation when the last entry leaves, then unmounts", () =>
	{
		const view = renderBar([ALICE]);
		view.rerender(
			<QueuedMessageBar
				sessionId="session-alice"
				items={[]}
				onEdit={view.onEdit}
				onSendNow={view.onSendNow}
				onRemove={view.onRemove}
				onClearAll={view.onClearAll}
			/>,
		);
		const leaving = view.container.firstElementChild;
		const exiting =
		{
			className: leaving?.className,
			inert: leaving?.hasAttribute("inert"),
			text: leaving?.querySelector("[data-take-back-entry] span")?.textContent,
		};
		// jsdom has no AnimationEvent, so React listens for the prefixed name instead of `animationend`.
		if (leaving)
			fireEvent(
				leaving,
				new Event(
					"webkitAnimationEnd",
					{
						bubbles: true,
					},
				),
			);

		expect(
			{
				exiting,
				after: view.container.innerHTML,
			},
		).toStrictEqual(
			{
				exiting:
				{
					className: "band-enter band-exit",
					inert: true,
					text: "1 message queued",
				},
				after: "",
			},
		);
	});

	it("joins its top edge to a band above with joinTop in all three shapes", () =>
	{
		const shapeClasses = (items: readonly QueuedPrompt[], expand: boolean) =>
		{
			const view = render(
				<QueuedMessageBar
					sessionId={`join-${items.length}-${String(expand)}`}
					items={items}
					joinTop
					onEdit={() =>
					{
					}}
					onRemove={() =>
					{
					}}
				/>,
			);
			if (expand)
			{
				fireEvent.click(
					within(view.container).getByRole(
						"button",
						{
							name: /2 messages queued/,
						},
					),
				);
			}
			const band = view.container.firstElementChild?.firstElementChild;
			const classes = band?.className.split(" ") ?? [];
			view.unmount();
			return classes.includes("rounded-t-none") && classes.includes("border-t");
		};
		expect(
			{
				single: shapeClasses([ALICE], false),
				collapsed: shapeClasses([ALICE, BOB], false),
				expanded: shapeClasses([ALICE, BOB], true),
			},
		).toStrictEqual(
			{
				single: true,
				collapsed: true,
				expanded: true,
			},
		);
	});

	it("leaves out Send now and Clear all without their handlers", async () =>
	{
		const single = render(
			<QueuedMessageBar
				sessionId="no-actions-1"
				items={[ALICE]}
				onEdit={() =>
				{
				}}
				onRemove={() =>
				{
				}}
			/>,
		);
		const singleButtons = buttonNames(single.container);
		single.unmount();
		const list = render(
			<QueuedMessageBar
				sessionId="no-actions-2"
				items={[ALICE, BOB]}
				onEdit={() =>
				{
				}}
				onRemove={() =>
				{
				}}
			/>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /2 messages queued/,
				},
			),
		);
		const clearAll = screen.queryByText("Clear all");
		const first = screen.getAllByRole(
			"button",
			{
				name: "Queued message actions",
			},
		)[0];
		if (first === undefined) throw new Error("Expected a row menu");
		fireEvent.click(first);
		const menu = await screen.findByRole("menu");
		expect(
			{
				singleButtons,
				clearAll,
				rowItems: within(menu)
					.getAllByRole("menuitem")
					.map((item) => item.textContent),
				listClassName:
					list.container.firstElementChild?.firstElementChild?.className.includes("rounded-t-none"),
			},
		).toStrictEqual(
			{
				singleButtons: ["Edit in composer", "Remove from queue"],
				clearAll: null,
				rowItems: ["Edit in composer", "Remove from queue"],
				listClassName: false,
			},
		);
	});
});

const CAROL: QueuedPrompt =
{
	id: "q3",
	text: "Carol's third follow-up",
};

const MASK_120 = "[mask-image:linear-gradient(to_right,black_calc(100%_-_120px),transparent_calc(100%_-_48px))]";
const MASK_76 = "[mask-image:linear-gradient(to_right,black_calc(100%_-_76px),transparent_calc(100%_-_28px))]";

/**
 * Unmount the band mid-drag, let a task pass (dnd-kit's KeyboardSensor attaches its document keydown listener on a
 * zero-delay timeout after pick-up), then press ⌥⌘↑ as prompt-jump would. Returns whether anything swallowed it.
 */
async function unmountMidDrag(unmount: () => void): Promise<boolean>
{
	unmount();
	await act(
		async () =>
			new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			}),
	);
	return !fireEvent.keyDown(
		document.body,
		{
			code: "ArrowUp",
			key: "ArrowUp",
			metaKey: true,
			altKey: true,
		},
	);
}

function renderList(
	items: readonly QueuedPrompt[],
	onReorder?: (id: string, overId: string) => void,
	sessionId = "session-reorder",
)
{
	const view = render(
		<QueuedMessageBar
			sessionId={sessionId}
			items={items}
			onEdit={() =>
			{
			}}
			onRemove={() =>
			{
			}}
			{...(onReorder === undefined
				? {}
				:
					{
						onReorder,
					})}
		/>,
	);
	fireEvent.click(
		screen.getByRole(
			"button",
			{
				name: /messages queued/,
			},
		),
	);
	const rows = within(
		screen.getByRole(
			"list",
			{
				name: "Queued messages",
			},
		),
	).getAllByRole("listitem");
	return {
		...view,
		rows,
	};
}

function maskTokens(row: HTMLElement): string[]
{
	return (row.querySelector(".line-clamp-2")?.className ?? "")
		.split(" ")
		.filter((token) => token.includes("mask-image"));
}

function handles(): HTMLElement[]
{
	return screen.queryAllByRole(
		"button",
		{
			name: "Reorder queued message",
		},
	);
}

describe("QueuedMessageBar reorder", () =>
{
	it("gives each expanded row upstream's sortable ≡ handle before its ⋯, with the wider 120/48 hover mask", () =>
	{
		const {rows} = renderList([ALICE, BOB], vi.fn<(id: string, overId: string) => void>());
		const [first] = handles();
		if (first === undefined) throw new Error("Expected a reorder handle");
		const describedBy = document.getElementById(first.getAttribute("aria-describedby") ?? "");
		const actions = within(first.parentElement ?? first)
			.getAllByRole("button")
			.map((button) => button.getAttribute("aria-label"));
		expect(
			{
				count: handles().length,
				type: first.getAttribute("type"),
				roleDescription: first.getAttribute("aria-roledescription"),
				instructions: describedBy?.textContent.trim().split("\n")[0],
				className: first.className,
				glyph: first.querySelector("svg")?.getAttribute("data-cds"),
				bars: first.querySelector("path")?.getAttribute("d"),
				actions,
				takeBack: rows.map((row) => row.getAttribute("data-take-back-entry")),
				masks: maskTokens(rows[0] ?? first),
			},
		).toStrictEqual(
			{
				count: 2,
				type: "button",
				roleDescription: "sortable",
				instructions: "To pick up a draggable item, press the space bar.",
				className:
					"shrink-0 grid h-5 w-5 place-items-center cursor-grab active:cursor-grabbing text-muted-as-secondary hover:text-primary opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100",
				glyph: "Icon",
				bars: "M3 4.8h18M3 12h18M3 19.2h18",
				actions: ["Reorder queued message", "Queued message actions"],
				takeBack: ["q1", "q2"],
				masks: [`group-hover/row:${MASK_120}`, `pointer-coarse:${MASK_120}`],
			},
		);
	});

	it("has no handle and keeps the 76/28 mask without onReorder", () =>
	{
		const {rows} = renderList([ALICE, BOB]);
		expect(
			{
				handles: handles().length,
				masks: maskTokens(rows[0] ?? document.body),
			},
		).toStrictEqual(
			{
				handles: 0,
				masks: [`group-hover/row:${MASK_76}`, `pointer-coarse:${MASK_76}`],
			},
		);
	});

	it("holds the 76/28 mask static while a non-sortable row's ⋯ menu is open", async () =>
	{
		const {rows} = renderList([ALICE, BOB]);
		const first = rows[0];
		if (first === undefined) throw new Error("Expected a row");
		fireEvent.click(
			within(first).getByRole(
				"button",
				{
					name: "Queued message actions",
				},
			),
		);
		await screen.findByRole("menu");
		expect(maskTokens(first)).toStrictEqual([MASK_76]);
	});

	it("reorders only on a drop over a different row", () =>
	{
		const onReorder = vi.fn<(id: string, overId: string) => void>();
		queuedDragEnd(
			{
				active:
				{
					id: "q1",
				},
				over:
				{
					id: "q2",
				},
			},
			onReorder,
		);
		queuedDragEnd(
			{
				active:
				{
					id: "q1",
				},
				over: null,
			},
			onReorder,
		);
		queuedDragEnd(
			{
				active:
				{
					id: "q1",
				},
				over:
				{
					id: "q1",
				},
			},
			onReorder,
		);
		expect(onReorder.mock.calls).toStrictEqual([["q1", "q2"]]);
	});

	it("picks up with Space: the dragged row dims, other rows' actions hide, the body grabs; Escape restores", async () =>
	{
		const onReorder = vi.fn<(id: string, overId: string) => void>();
		const {rows} = renderList([ALICE, BOB, CAROL], onReorder);
		const [first] = handles();
		if (first === undefined) throw new Error("Expected a reorder handle");
		const [alice, bob] = rows;
		if (alice === undefined || bob === undefined) throw new Error("Expected rows");
		fireEvent.keyDown(
			first,
			{
				code: "Space",
				key: " ",
			},
		);
		const bobDots = within(bob).getByRole(
			"button",
			{
				name: "Queued message actions",
			},
		);
		const dragging =
		{
			aliceDragged: ["bg-alpha-2", "opacity-80"].every((token) => alice.className.split(" ").includes(token)),
			aliceHandle: first.className,
			aliceMasks: maskTokens(alice),
			bobDots: ["opacity-0", "pointer-events-none"].map((token) => bobDots.className.split(" ").includes(token)),
			bobMasks: maskTokens(bob),
			bodyCursor: document.body.style.cursor,
			bodySelect: document.body.style.userSelect,
		};
		// dnd-kit's KeyboardSensor listens for the drop/cancel keys from the next task.
		await act(
			async () =>
				new Promise((resolve) =>
				{
					setTimeout(resolve, 0);
				}),
		);
		fireEvent.keyDown(
			first,
			{
				code: "Escape",
				key: "Escape",
			},
		);
		expect(
			{
				dragging,
				after:
				{
					bodyCursor: document.body.style.cursor,
					bodySelect: document.body.style.userSelect,
					reordered: onReorder.mock.calls,
				},
			},
		).toStrictEqual(
			{
				dragging:
				{
					aliceDragged: true,
					aliceHandle: "shrink-0 grid h-5 w-5 place-items-center cursor-grabbing text-primary ",
					aliceMasks: [MASK_120],
					bobDots: [true, true],
					bobMasks: [],
					bodyCursor: "grabbing",
					bodySelect: "none",
				},
				after:
				{
					bodyCursor: "",
					bodySelect: "",
					reordered: [],
				},
			},
		);
	});

	it("restores the body when the band unmounts mid-drag", async () =>
	{
		const {unmount} = renderList([ALICE, BOB], vi.fn<(id: string, overId: string) => void>());
		const [first] = handles();
		if (first === undefined) throw new Error("Expected a reorder handle");
		fireEvent.keyDown(
			first,
			{
				code: "Space",
				key: " ",
			},
		);
		const during = document.body.style.cursor;
		// Let the sensor's deferred keydown listener attach first, so unmounting has a live listener to detach.
		await act(
			async () =>
				new Promise((resolve) =>
				{
					setTimeout(resolve, 0);
				}),
		);
		const arrowSwallowed = await unmountMidDrag(unmount);
		expect([during, document.body.style.cursor, document.body.style.userSelect, arrowSwallowed]).toStrictEqual([
			"grabbing",
			"",
			"",
			false,
		]);
	});

	it("drops the sliding transition under reduced motion", async () =>
	{
		const transitions = async (sessionId: string) =>
		{
			const {rows, unmount} = renderList([ALICE, BOB], vi.fn<(id: string, overId: string) => void>(), sessionId);
			const [first] = handles();
			if (first === undefined) throw new Error("Expected a reorder handle");
			fireEvent.keyDown(
				first,
				{
					code: "Space",
					key: " ",
				},
			);
			const result = rows.map((row) => row.style.transition);
			// Unmounted before the sensor's deferred keydown listener attaches: it must never attach.
			const arrowSwallowed = await unmountMidDrag(unmount);
			return {
				result,
				arrowSwallowed,
			};
		};
		const animated = await transitions("session-animated");
		document.documentElement.setAttribute("data-reduce-motion", "true");
		const reduced = await transitions("session-reduced");
		expect(
			{
				animated: animated.result.some((transition) => transition !== ""),
				animatedArrowSwallowed: animated.arrowSwallowed,
				reduced,
			},
		).toStrictEqual(
			{
				animated: true,
				animatedArrowSwallowed: false,
				reduced:
				{
					result: ["", ""],
					arrowSwallowed: false,
				},
			},
		);
	});
});

describe("queuedRowMask", () =>
{
	it("matches upstream's mask table", () =>
	{
		const hover = (mask: string) => `group-hover/row:${mask} pointer-coarse:${mask}`;
		expect([
			queuedRowMask(
				{
					sortable: true,
					held: true,
					otherDragging: false,
				},
			),
			queuedRowMask(
				{
					sortable: false,
					held: true,
					otherDragging: false,
				},
			),
			queuedRowMask(
				{
					sortable: true,
					held: false,
					otherDragging: true,
				},
			),
			queuedRowMask(
				{
					sortable: true,
					held: false,
					otherDragging: false,
				},
			),
			queuedRowMask(
				{
					sortable: false,
					held: false,
					otherDragging: false,
				},
			),
		]).toStrictEqual([MASK_120, MASK_76, "", hover(MASK_120), hover(MASK_76)]);
	});
});
