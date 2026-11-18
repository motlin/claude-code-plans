// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SelectionCommentCard, type SelectionCommentCardProps} from "../src/components/selection-comment-card";

interface Rect
{
	left: number;
	top: number;
	width: number;
	height: number;
}

function domRect({left, top, width, height}: Rect): DOMRect
{
	return {
		left,
		top,
		width,
		height,
		x: left,
		y: top,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	};
}

const CARD_HEIGHT = 60;
let lineRects: Rect[] = [];
let registry = new Map<string, Set<AbstractRange>>();

beforeEach(() =>
{
	registry = new Map();
	vi.stubGlobal(
		"Highlight",
		class extends Set<AbstractRange>
		{
			constructor(...ranges: AbstractRange[])
			{
				super(ranges);
			}
		},
	);
	Object.defineProperty(
		CSS,
		"highlights",
		{
			configurable: true,
			value: registry,
		},
	);
	vi.stubGlobal("innerWidth", 1200);
	vi.stubGlobal("innerHeight", 800);
	lineRects = [
		{
			left: 300,
			top: 400,
			width: 200,
			height: 20,
		},
		{
			left: 300,
			top: 420,
			width: 100,
			height: 20,
		},
	];
	Object.defineProperty(
		Range.prototype,
		"getClientRects",
		{
			configurable: true,
			value: () => lineRects.map(domRect),
		},
	);
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement)
	{
		return this.getAttribute("role") === "dialog" ? CARD_HEIGHT : 0;
	});
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(CSS, "highlights");
	Reflect.deleteProperty(Range.prototype, "getClientRects");
	document.body.replaceChildren();
});

function boundary(): HTMLElement
{
	const element = document.createElement("div");
	element.getBoundingClientRect = () =>
		domRect(
			{
				left: 0,
				top: 0,
				width: 1200,
				height: 800,
			},
		);
	document.body.append(element);
	return element;
}

function replyRange(): Range
{
	const paragraph = document.createElement("p");
	paragraph.textContent = "Hermit crabs live in tide pools.";
	document.body.append(paragraph);
	const range = document.createRange();
	range.selectNodeContents(paragraph);
	return range;
}

function ReplyCard(props: Partial<SelectionCommentCardProps>)
{
	const [value, setValue] = useState("");
	return (
		<SelectionCommentCard
			range={replyRange()}
			selectedText="Hermit crabs live in tide pools."
			boundary={boundary()}
			value={value}
			onChange={setValue}
			onSave={() =>
			{
			}}
			onClose={() =>
			{
			}}
			side="above"
			highlightName="reply-selection"
			quote="Hermit crabs live in tide pools."
			inputLabel="Reply"
			placeholder="Reply to Claude"
			saveLabel="Add to prompt"
			submitWhenEmpty
			{...props}
		/>
	);
}

function dialog(): HTMLElement
{
	const found = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Comment on selection"]');
	if (found === null) throw new Error("no card");
	return found;
}

function textarea(): HTMLTextAreaElement
{
	return screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Reply",
		},
	);
}

describe("selection comment card, reply mode", () =>
{
	it("renders upstream's reply card: draggable-none 320px shell, line-clamped quote, Reply textarea, enabled Add to prompt", () =>
	{
		render(<ReplyCard />);
		const quote = dialog().querySelector("blockquote");
		const save = screen.getByRole<HTMLButtonElement>(
			"button",
			{
				name: "Add to prompt",
			},
		);

		expect(
			{
				draggableNone: dialog().classList.contains("draggable-none"),
				width: dialog().classList.contains("w-[320px]"),
				quoteClass: quote?.className,
				quoteText: quote?.textContent,
				placeholder: textarea().placeholder,
				focused: document.activeElement === textarea(),
				saveDisabled: save.disabled,
				shortcut: save.getAttribute("aria-keyshortcuts"),
				highlighted: registry.has("reply-selection"),
				planHighlighted: registry.has("plan-selection"),
			},
		).toStrictEqual(
			{
				draggableNone: true,
				width: true,
				quoteClass:
					"line-clamp-2 border-s-2 border-strong ps-sm font-normal text-muted-as-secondary [overflow-wrap:anywhere]",
				quoteText: "Hermit crabs live in tide pools.",
				placeholder: "Reply to Claude",
				focused: true,
				saveDisabled: false,
				shortcut: "Enter",
				highlighted: true,
				planHighlighted: false,
			},
		);
	});

	it("clears its highlight on close", () =>
	{
		const {unmount} = render(<ReplyCard />);
		unmount();

		expect(registry.has("reply-selection")).toBe(false);
	});

	it("sits 8px above the first line when there is room", () =>
	{
		render(<ReplyCard />);

		expect(dialog().style.transform).toBe(`translate(400px, ${400 - 8 - CARD_HEIGHT}px) translateX(-50%)`);
	});

	it("drops 8px below the last line without room above, centred on it, and holds that side", () =>
	{
		lineRects = [
			{
				left: 300,
				top: 30,
				width: 200,
				height: 20,
			},
			{
				left: 300,
				top: 50,
				width: 100,
				height: 20,
			},
		];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
		{
			callback(0);
			return 0;
		});
		render(<ReplyCard />);
		const below = dialog().style.transform;
		lineRects = lineRects.map((rect) => (
		{
			...rect,
			top: rect.top + 300,
		}));
		fireEvent.scroll(window);

		expect(
			{
				below,
				held: dialog().style.transform,
			},
		).toStrictEqual(
			{
				below: "translate(350px, 78px) translateX(-50%)",
				held: "translate(350px, 378px) translateX(-50%)",
			},
		);
	});

	it("makes the textarea read-only and Save inert while busy", () =>
	{
		const onSave = vi.fn<SelectionCommentCardProps["onSave"]>();
		render(<ReplyCard busy onSave={onSave} />);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add to prompt",
				},
			),
		);

		expect(
			{
				readOnly: textarea().readOnly,
				saves: onSave.mock.calls.length,
			},
		).toStrictEqual(
			{
				readOnly: true,
				saves: 0,
			},
		);
	});

	it("submits on Enter even when blank, and sends the chord to onChordSubmit", () =>
	{
		const onSave = vi.fn<SelectionCommentCardProps["onSave"]>();
		const onChordSubmit = vi.fn<(text: string) => void>();
		render(<ReplyCard onSave={onSave} onChordSubmit={onChordSubmit} />);
		fireEvent.keyDown(
			textarea(),
			{
				key: "Enter",
			},
		);
		fireEvent.change(
			textarea(),
			{
				target:
				{
					value: " hi ",
				},
			},
		);
		fireEvent.keyDown(
			textarea(),
			{
				key: "Enter",
				metaKey: true,
			},
		);

		expect(
			{
				saves: onSave.mock.calls,
				chords: onChordSubmit.mock.calls,
			},
		).toStrictEqual(
			{
				saves: [[""]],
				chords: [["hi"]],
			},
		);
	});

	it("restores focus to the previously focused element on close, unless a submit hands focus on", () =>
	{
		const before = document.createElement("button");
		document.body.append(before);
		before.focus();
		const {unmount} = render(<ReplyCard restoreFocus />);
		const moved = document.activeElement === textarea();
		unmount();
		const restored = document.activeElement === before;

		const composer = document.createElement("textarea");
		document.body.append(composer);
		before.focus();
		const focusAfterSubmit = vi.fn<() => void>(() =>
		{
			composer.focus();
		});
		const second = render(<ReplyCard restoreFocus focusAfterSubmit={focusAfterSubmit} />);
		fireEvent.keyDown(
			textarea(),
			{
				key: "Enter",
			},
		);
		second.unmount();

		expect(
			{
				moved,
				restored,
				afterSubmit: document.activeElement === composer,
				calls: focusAfterSubmit.mock.calls.length,
			},
		).toStrictEqual(
			{
				moved: true,
				restored: true,
				afterSubmit: true,
				calls: 1,
			},
		);
	});
});
