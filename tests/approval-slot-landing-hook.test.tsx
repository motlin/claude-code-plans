// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {clearLanding, LANDING_AFTER_RING, LANDING_RING, useApprovalSlot} from "../src/lib/approval-slot-landing";

afterEach(() =>
{
	cleanup();
	endEnterSwallows();
	clearLanding(window);
	vi.restoreAllMocks();
});

beforeEach(() =>
{
	vi.spyOn(performance, "now").mockReturnValue(5000);
});

function noDraft(): boolean
{
	return false;
}

interface CardSpec
{
	id: string;
	label?: string;
	stopName?: string;
	position?: "relative" | "static";
}

function Dock({
	cards,
	takesFocus = true,
	hasDraft = noDraft,
	toComposer,
}: {
	cards: CardSpec[];
	takesFocus?: boolean;
	hasDraft?: () => boolean;
	toComposer: (from: Element) => void;
})
{
	const first = cards[0];
	const {setSlot, watch} = useApprovalSlot(
		{
			card: first === undefined ? undefined : `permission:${first.id}`,
			takesFocus,
			hasDraft,
			chordActsAnywhere: false,
			toComposer,
		},
	);
	return (
		<div data-testid="dock">
			<div
				style={
				{
					display: "contents",
				}}
				ref={setSlot}
			>
				{cards.map((card) => (
					<div
						key={card.id}
						style={
						{
							display: "contents",
						}}
					>
						<div
							data-approval-card-root=""
							data-card={card.id}
							{...(card.label === undefined
								? {}
								:
									{
										"aria-label": card.label,
										role: "group",
									})}
							style={
							{
								position: card.position ?? "relative",
							}}
						>
							{card.stopName !== undefined && <span data-question-stop-name="">{card.stopName}</span>}
							<button type="button">Answer {card.id}</button>
						</div>
					</div>
				))}
			</div>
			{watch}
			<textarea aria-label="Prompt" />
		</div>
	);
}

function setup(
	first: CardSpec[],
	props:
	{
		takesFocus?: boolean;
		hasDraft?: () => boolean;
	} = {},
)
{
	const toComposer = vi.fn<(from: Element) => void>(() =>
	{
		document.querySelector<HTMLTextAreaElement>('[aria-label="Prompt"]')?.focus();
	});
	const utils = render(<Dock cards={first} toComposer={toComposer} {...props} />);
	const rerender = async (
		cards: CardSpec[],
		next:
		{
			takesFocus?: boolean;
		} = {},
	) =>
	{
		await act(async () =>
		{
			utils.rerender(<Dock cards={cards} toComposer={toComposer} {...props} {...next} />);
			await Promise.resolve();
		});
	};
	const answer = (id: string) => document.querySelector<HTMLElement>(`[data-card="${id}"] button`)!;
	const root = (id: string) => document.querySelector<HTMLElement>(`[data-card="${id}"]`)!;
	return {
		toComposer,
		rerender,
		answer,
		root,
	};
}

function ringState(element: HTMLElement)
{
	return {
		active: document.activeElement === element,
		tabindex: element.getAttribute("tabindex"),
		className: element.getAttribute("class"),
	};
}

describe("useApprovalSlot", () =>
{
	it("lands on the next card with upstream's after-ring and a temporary tabindex, all gone on blur", async () =>
	{
		const {rerender, answer, root, toComposer} = setup([
			{
				id: "A",
			},
			{
				id: "B",
				label: "Permission request: B",
			},
		]);
		answer("A").focus(
			{
				focusVisible: true,
			},
		);
		await rerender([
			{
				id: "B",
				label: "Permission request: B",
			},
		]);
		const landed = ringState(root("B"));
		document.querySelector<HTMLElement>('[aria-label="Prompt"]')?.focus();
		expect(
			{
				landed,
				left: ringState(root("B")),
				toComposer: toComposer.mock.calls.length,
			},
		).toStrictEqual(
			{
				landed:
				{
					active: true,
					tabindex: "-1",
					className: LANDING_AFTER_RING,
				},
				left:
				{
					active: false,
					tabindex: null,
					className: null,
				},
				toComposer: 0,
			},
		);
	});

	it("draws the plain ring on a static card root", async () =>
	{
		const {rerender, answer, root} = setup([
			{
				id: "A",
			},
			{
				id: "B",
				label: "B",
				position: "static",
			},
		]);
		answer("A").focus(
			{
				focusVisible: true,
			},
		);
		await rerender([
			{
				id: "B",
				label: "B",
				position: "static",
			},
		]);
		expect(ringState(root("B"))).toStrictEqual(
			{
				active: true,
				tabindex: "-1",
				className: LANDING_RING,
			},
		);
	});

	it("hands focus to the composer instead while the composer holds a draft", async () =>
	{
		const {rerender, answer, root, toComposer} = setup(
			[
				{
					id: "A",
				},
				{
					id: "B",
				},
			],
			{
				hasDraft: () => true,
			},
		);
		answer("A").focus(
			{
				focusVisible: true,
			},
		);
		await rerender([
			{
				id: "B",
			},
		]);
		expect(
			{
				calls: toComposer.mock.calls.length,
				onB: document.activeElement === root("B"),
				active: document.activeElement?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				calls: 1,
				onB: false,
				active: "Prompt",
			},
		);
	});

	it("hands focus to the composer when the next card doesn't take focus", async () =>
	{
		const {rerender, answer, toComposer} = setup([
			{
				id: "A",
			},
			{
				id: "B",
			},
		]);
		answer("A").focus(
			{
				focusVisible: true,
			},
		);
		await rerender(
			[
				{
					id: "B",
				},
			],
			{
				takesFocus: false,
			},
		);
		expect(
			{
				calls: toComposer.mock.calls.length,
				active: document.activeElement?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				calls: 1,
				active: "Prompt",
			},
		);
	});

	it("hands focus to the composer when the last card leaves", async () =>
	{
		const {rerender, answer, toComposer} = setup([
			{
				id: "A",
			},
		]);
		answer("A").focus(
			{
				focusVisible: true,
			},
		);
		await rerender([]);
		expect(
			{
				calls: toComposer.mock.calls.length,
				active: document.activeElement?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				calls: 1,
				active: "Prompt",
			},
		);
	});

	it("does nothing when the card was answered with the pointer", async () =>
	{
		const {rerender, answer, toComposer} = setup([
			{
				id: "A",
			},
			{
				id: "B",
			},
		]);
		answer("A").dispatchEvent(
			new MouseEvent(
				"pointerdown",
				{
					bubbles: true,
				},
			),
		);
		answer("A").focus();
		await rerender([
			{
				id: "B",
			},
		]);
		expect(
			{
				calls: toComposer.mock.calls.length,
				active: document.activeElement === document.body,
			},
		).toStrictEqual(
			{
				calls: 0,
				active: true,
			},
		);
	});

	it("names an unlabelled landed root by its stop-name parts, and restores it exactly on blur", async () =>
	{
		const {rerender, answer, root} = setup([
			{
				id: "A",
			},
			{
				id: "B",
				stopName: "Allow Bash?",
			},
		]);
		answer("A").focus(
			{
				focusVisible: true,
			},
		);
		await rerender([
			{
				id: "B",
				stopName: "Allow Bash?",
			},
		]);
		const part = root("B").querySelector("[data-question-stop-name]")!;
		const named =
		{
			role: root("B").getAttribute("role"),
			labelledBy: root("B").getAttribute("aria-labelledby"),
			partId: part.id,
		};
		const labelledByPart = named.labelledBy === part.id && /^named-by-text-\d+$/.test(part.id);
		root("B").blur();
		expect(
			{
				role: named.role,
				labelledByPart,
				restored:
				{
					role: root("B").getAttribute("role"),
					labelledBy: root("B").getAttribute("aria-labelledby"),
					partId: part.getAttribute("id"),
				},
			},
		).toStrictEqual(
			{
				role: "group",
				labelledByPart: true,
				restored:
				{
					role: null,
					labelledBy: null,
					partId: null,
				},
			},
		);
	});

	it("leaves an already labelled root's name alone", async () =>
	{
		const {rerender, answer, root} = setup([
			{
				id: "A",
			},
			{
				id: "B",
				label: "Permission request: B",
			},
		]);
		answer("A").focus(
			{
				focusVisible: true,
			},
		);
		await rerender([
			{
				id: "B",
				label: "Permission request: B",
			},
		]);
		expect(
			{
				label: root("B").getAttribute("aria-label"),
				labelledBy: root("B").getAttribute("aria-labelledby"),
			},
		).toStrictEqual(
			{
				label: "Permission request: B",
				labelledBy: null,
			},
		);
	});

	it("undoes the ring, tabindex and naming at once when focus doesn't land", async () =>
	{
		const {rerender, answer, root} = setup([
			{
				id: "A",
			},
			{
				id: "B",
				stopName: "Allow Bash?",
			},
		]);
		answer("A").focus(
			{
				focusVisible: true,
			},
		);
		const focus = HTMLElement.prototype.focus;
		vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options)
		{
			if (this.dataset["card"] !== "B") focus.call(this, options);
		});
		await rerender([
			{
				id: "B",
				stopName: "Allow Bash?",
			},
		]);
		expect(
			{
				tabindex: root("B").getAttribute("tabindex"),
				className: root("B").getAttribute("class"),
				role: root("B").getAttribute("role"),
				labelledBy: root("B").getAttribute("aria-labelledby"),
			},
		).toStrictEqual(
			{
				tabindex: null,
				className: null,
				role: null,
				labelledBy: null,
			},
		);
	});
});

/** Ends any Enter swallow a landing left on the shared document (it ends on the next plain key). */
function endEnterSwallows()
{
	document.dispatchEvent(
		new KeyboardEvent(
			"keydown",
			{
				key: "Unidentified",
			},
		),
	);
}
