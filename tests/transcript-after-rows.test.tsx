// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {TranscriptAfterRows} from "../src/components/transcript-after-rows";
import {createTailActionsOutlet} from "../src/lib/tail-actions-outlet";

afterEach(() =>
{
	cleanup();
});

const STICKY_TOP =
	"top-[calc(max(var(--epitaxy-top-fade-height,0px),var(--fade-top,0px),var(--epitaxy-suggested-task-end,0px),var(--epitaxy-sticky-prompt-end,0px))+5px)]";

const CONTINUES =
{
	"data-find-omitted": "",
	"data-transcript-continues-turn": "",
	role: "presentation",
};

function attributes(element: Element | null | undefined): Record<string, string> | null
{
	if (element === null || element === undefined) return null;
	return Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value]));
}

describe("TranscriptAfterRows", () =>
{
	it("renders nothing when every part is absent", () =>
	{
		const {container} = render(<TranscriptAfterRows />);
		expect(container.innerHTML).toBe("");
	});

	it("draws upstream's w8 parts in order with the sticky cards slot", () =>
	{
		const {container} = render(<TranscriptAfterRows cards={<p>card</p>} />);
		const block = container.firstElementChild;
		expect(
			{
				block: attributes(block),
				children: [...(block?.children ?? [])].map((child) => attributes(child)),
				column: [...(block?.children[1]?.children ?? [])].map((child) => [attributes(child), child.innerHTML]),
			},
		).toStrictEqual(
			{
				block:
				{
					"data-testid": "transcript-after-rows",
				},
				children: [
					{
						"data-testid": "transcript-before-cards",
						"data-transcript-before-cards": "",
						...CONTINUES,
						class: "chat-column w-full empty:hidden",
					},
					{
						"data-transcript-tail": "",
						class: "flex flex-col [reading-flow:flex-visual] [[data-transcript-before-cards]:empty+&[data-row-left-empty]_[data-turn-box]]:!mt-xs",
					},
				],
				column: [
					[
						{
							"data-testid": "transcript-trailing-slot",
							"data-find-omitted": "",
							"data-transcript-cards": "",
							"data-transcript-continues-turn": "",
							role: "presentation",
							class: `chat-column w-full sticky has-[.epitaxy-tool-card-in-flow]:order-last ${STICKY_TOP} bg-[var(--epitaxy-transcript-surface,var(--color-surface-1))]`,
							style: "z-index: 1;",
						},
						"<p>card</p>",
					],
					[{}, ""],
				],
			},
		);
	});

	it("draws the tail turn's slot and last-row actions outlet only with a turn box", () =>
	{
		const outlet = createTailActionsOutlet();
		const {container, rerender} = render(
			<TranscriptAfterRows turnBox={<p>box</p>} actionsOutletRef={outlet.set} />,
		);
		const turn = container.querySelector("[data-transcript-tail-turn]");
		expect(
			{
				turn: attributes(turn),
				parts: [...(turn?.children ?? [])].map((child) => [attributes(child), child.innerHTML]),
				outlet: outlet.get() === turn?.children[1],
			},
		).toStrictEqual(
			{
				turn:
				{
					"data-transcript-tail-turn": "",
					class: "group/msg flex w-full flex-col gap-xs",
				},
				parts: [
					[
						{
							"data-testid": "transcript-tail-slot",
							"data-find-omitted": "",
							class: "chat-column w-full empty:hidden",
						},
						"<p>box</p>",
					],
					[
						{
							"data-testid": "transcript-tail-actions",
							"data-find-omitted": "",
							"data-transcript-last-row-controls": "",
							class: "chat-column w-full empty:hidden",
						},
						"",
					],
				],
				outlet: true,
			},
		);
		rerender(<TranscriptAfterRows cards={<p>card</p>} actionsOutletRef={outlet.set} />);
		expect([container.querySelector("[data-transcript-tail-turn]"), outlet.get()]).toStrictEqual([null, null]);
	});

	it("draws the tail chrome whenever chrome is defined, with the pt-0 mt-xs rule under shown actions", () =>
	{
		const {container, rerender} = render(<TranscriptAfterRows turnBox={<p>box</p>} />);
		expect(container.querySelector("[data-testid=transcript-tail-chrome]")).toBeNull();
		rerender(<TranscriptAfterRows turnBox={<p>box</p>} chrome={null} />);
		const chrome = container.querySelector("[data-testid=transcript-tail-chrome]");
		const rule = "[[data-transcript-tail-turn]:has(>[data-transcript-last-row-controls]:not(:empty))+&]";
		expect(
			{
				chrome: attributes(chrome),
				previous: chrome?.previousElementSibling?.hasAttribute("data-transcript-tail-turn"),
			},
		).toStrictEqual(
			{
				chrome:
				{
					"data-testid": "transcript-tail-chrome",
					...CONTINUES,
					class: `chat-column flex w-full flex-col gap-[var(--chat-turn-gap)] pt-[var(--chat-turn-gap)] ${rule}:pt-0 ${rule}:mt-xs empty:hidden`,
				},
				previous: true,
			},
		);
	});

	it("keeps Home and End inside the after-rows parts from reaching the feed", () =>
	{
		const onKeyDown = vi.fn<(key: string) => void>();
		const {getByText} = render(
			<div
				role="presentation"
				onKeyDown={(event) =>
				{
					onKeyDown(event.key);
				}}
			>
				<TranscriptAfterRows
					beforeCards={<button type="button">before</button>}
					cards={<button type="button">card</button>}
					chrome={<button type="button">chrome</button>}
				/>
			</div>,
		);
		for (const name of ["before", "card", "chrome"])
		{
			for (const key of ["Home", "End", "ArrowDown"])
				fireEvent.keyDown(
					getByText(name),
					{
						key,
					},
				);
		}
		expect(onKeyDown.mock.calls).toStrictEqual([["ArrowDown"], ["ArrowDown"], ["ArrowDown"]]);
	});
});

describe("createTailActionsOutlet", () =>
{
	it("notifies subscribers when the outlet element changes", () =>
	{
		const outlet = createTailActionsOutlet();
		const seen: Array<HTMLElement | null> = [];
		const unsubscribe = outlet.subscribe(() =>
		{
			seen.push(outlet.get());
		});
		const element = document.createElement("div");
		outlet.set(element);
		outlet.set(element);
		outlet.set(null);
		unsubscribe();
		outlet.set(element);
		expect(seen).toStrictEqual([element, null]);
	});
});
