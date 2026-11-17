// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";
import {findWaitingCard, landOnWaitingCard, WAITING_CARD_SELECTOR} from "../src/lib/question-landing";

afterEach(() =>
{
	document.body.innerHTML = "";
});

function mount(html: string): void
{
	document.body.innerHTML = html;
}

function byId(id: string): HTMLElement
{
	const element = document.getElementById(id);
	if (element === null) throw new Error(`No #${id}`);
	return element;
}

const LANDING = "data-focus-region-landing";

describe("findWaitingCard", () =>
{
	it("selects approval card roots", () =>
	{
		expect(WAITING_CARD_SELECTOR).toBe("[data-approval-card-root]");
	});

	it("returns null with no cards", () =>
	{
		mount(`<main><p>Nothing pending</p></main><div><div data-focus-region="composer"></div></div>`);
		expect(findWaitingCard(document)).toBeNull();
	});

	it("orders transcript cards before the card beside the composer, like upstream's codeChat waitingCardRoots", () =>
	{
		mount(`
			<main><div id="transcript-card" data-approval-card-root tabindex="-1"></div></main>
			<footer>
				<div data-docked-plan data-approval-card-root id="dock-card"></div>
				<div data-focus-region="composer"></div>
			</footer>`);
		expect(findWaitingCard(document)?.id).toBe("transcript-card");
	});

	it("falls back to transcript cards in document order", () =>
	{
		mount(`
			<main>
				<div id="first" data-approval-card-root></div>
				<div id="second" data-approval-card-root></div>
			</main>
			<footer><div data-focus-region="composer"></div></footer>`);
		expect(findWaitingCard(document)?.id).toBe("first");
	});

	it("skips cards inside hidden, inert or aria-hidden subtrees", () =>
	{
		mount(`
			<div hidden><div data-approval-card-root id="hidden"></div></div>
			<div inert><div data-approval-card-root id="inert"></div></div>
			<div aria-hidden="true"><div data-approval-card-root id="aria"></div></div>
			<div data-approval-card-root id="visible"></div>`);
		expect(findWaitingCard(document)?.id).toBe("visible");
	});
});

describe("findWaitingCard cycling from the focus origin", () =>
{
	const THREE = `
		<main>
			<div id="a" data-approval-card-root></div>
			<div id="b" data-approval-card-root><button id="in-b">Pick</button></div>
			<div id="c" data-approval-card-root></div>
		</main>
		<button id="outside">Elsewhere</button>
		<footer><div data-focus-region="composer"></div></footer>`;

	it("lands on the card after the one holding focus, wrapping to the first", () =>
	{
		mount(THREE);
		const ids = [byId("a"), byId("b"), byId("c"), null, byId("outside"), byId("in-b")].map(
			(from) => findWaitingCard(document, from)?.id,
		);
		expect(ids).toStrictEqual(["b", "c", "a", "a", "a", "c"]);
	});

	it("cycles from the transcript card to the dock card and wraps back", () =>
	{
		mount(`
			<main><div id="a" data-approval-card-root><button id="in-a">Pick</button></div></main>
			<footer>
				<div id="d" data-docked-plan data-approval-card-root><button id="in-d">Pick</button></div>
				<div data-focus-region="composer"></div>
			</footer>`);
		const ids = [byId("in-a"), byId("in-d")].map((from) => findWaitingCard(document, from)?.id);
		expect(ids).toStrictEqual(["d", "a"]);
	});

	it("skips a hidden card after the one holding focus", () =>
	{
		mount(`
			<div id="a" data-approval-card-root></div>
			<div hidden><div id="h" data-approval-card-root></div></div>
			<div id="c" data-approval-card-root></div>`);
		expect(findWaitingCard(document, byId("a"))?.id).toBe("c");
	});
});

describe("landOnWaitingCard", () =>
{
	it("clears the previous card's landing ring when landing on another", () =>
	{
		mount(`
			<div role="dialog"><div id="a" data-approval-card-root tabindex="-1" style="position: relative"></div>
			<div id="b" data-approval-card-root tabindex="-1" style="position: relative"></div></div>`);
		const a = byId("a");
		const b = byId("b");
		landOnWaitingCard(a);
		landOnWaitingCard(b);
		expect([a.getAttribute(LANDING), b.getAttribute(LANDING)]).toStrictEqual([null, "overlay"]);
	});

	function landed(): HTMLElement
	{
		mount(`
			<div data-approval-card-root role="group" aria-label="Pick one" tabindex="-1" id="card" style="position: relative">
				<button id="inner">Pick</button>
			</div>
			<div data-cds="Toast"><button id="toast-button">Undo</button></div>
			<button id="outside">Elsewhere</button>`);
		const card = byId("card");
		landOnWaitingCard(card);
		return card;
	}

	it("focuses the card and marks the overlay landing", () =>
	{
		const card = landed();
		expect([document.activeElement === card, card.getAttribute(LANDING)]).toStrictEqual([true, "overlay"]);
	});

	it("keeps the ring through keys and beforeinput on the card root, as upstream lands a root without clearOnInput", () =>
	{
		const card = landed();
		const after = ["Shift", "Escape", " ", "a"].map((key) =>
		{
			card.dispatchEvent(
				new KeyboardEvent(
					"keydown",
					{
						key,
						bubbles: true,
					},
				),
			);
			return card.getAttribute(LANDING);
		});
		card.dispatchEvent(
			new Event(
				"beforeinput",
				{
					bubbles: true,
				},
			),
		);
		expect([...after, card.getAttribute(LANDING)]).toStrictEqual([
			"overlay",
			"overlay",
			"overlay",
			"overlay",
			"overlay",
		]);
	});

	it("clears the ring on a pointerdown inside the card", () =>
	{
		const card = landed();
		byId("inner").dispatchEvent(
			new Event(
				"pointerdown",
				{
					bubbles: true,
				},
			),
		);
		expect(card.getAttribute(LANDING)).toBeNull();
	});

	it("clears the ring when focus moves to a button inside the card or outside it", () =>
	{
		const card = landed();
		byId("inner").focus();
		const afterInner = card.getAttribute(LANDING);
		landOnWaitingCard(card);
		byId("outside").focus();
		expect([afterInner, card.getAttribute(LANDING)]).toStrictEqual([null, null]);
	});

	it("keeps the ring on window blur while the card stays the active element, and when focus moves into a toast", () =>
	{
		const card = landed();
		window.dispatchEvent(new Event("blur"));
		const afterBlur = card.getAttribute(LANDING);
		byId("toast-button").focus();
		expect([afterBlur, card.getAttribute(LANDING)]).toStrictEqual(["overlay", "overlay"]);
	});

	it("adds tabindex=-1 to a card without one for the landing and removes it on clear", () =>
	{
		mount(`<div data-approval-card-root id="card" aria-label="Pick"></div><button id="outside">Elsewhere</button>`);
		const card = byId("card");
		landOnWaitingCard(card);
		const during = [card.getAttribute("tabindex"), document.activeElement === card];
		byId("outside").focus();
		expect([...during, card.getAttribute("tabindex")]).toStrictEqual(["-1", true, null]);
	});

	it("stops listening once cleared, so a later landing is not cleared by stale listeners", () =>
	{
		const card = landed();
		byId("inner").focus();
		card.focus();
		card.setAttribute(LANDING, "overlay");
		byId("inner").dispatchEvent(
			new Event(
				"pointerdown",
				{
					bubbles: true,
				},
			),
		);
		expect(card.getAttribute(LANDING)).toBe("overlay");
	});
});

describe("landOnWaitingCard naming an unlabelled card (upstream nO)", () =>
{
	function naming(card: HTMLElement):
	{
		role: string | null;
		labelledBy: string | null;
		label: string | null;
	}
	{
		return {
			role: card.getAttribute("role"),
			labelledBy: card.getAttribute("aria-labelledby"),
			label: card.getAttribute("aria-label"),
		};
	}

	it("labels the card by its stop-name title while landed and restores it on clear", () =>
	{
		mount(`
			<div data-approval-card-root id="card" tabindex="-1">
				<span data-question-stop-name=""><span>Claude proposed a plan</span></span>
				<span data-question-stop-name="">  </span>
				<button id="inner">Approve</button>
			</div>`);
		const card = byId("card");
		const title = card.querySelector("[data-question-stop-name]")!;
		landOnWaitingCard(card);
		const landedName = naming(card);
		const titleId = title.id;
		byId("inner").focus();
		expect([landedName, /^named-by-text-\d+$/.test(titleId), naming(card), title.id]).toStrictEqual([
			{
				role: "group",
				labelledBy: titleId,
				label: null,
			},
			true,
			{
				role: null,
				labelledBy: null,
				label: null,
			},
			"",
		]);
	});

	it("leaves an aria-labelled card alone", () =>
	{
		mount(`<div data-approval-card-root id="card" tabindex="-1" aria-label="Permission request"></div>`);
		const card = byId("card");
		landOnWaitingCard(card);
		expect(naming(card)).toStrictEqual(
			{
				role: null,
				labelledBy: null,
				label: "Permission request",
			},
		);
	});

	it("labels a card with no stop names by its own new id", () =>
	{
		mount(`<div data-approval-card-root id="" tabindex="-1" role="region">Approve the deploy?</div>`);
		const card = document.querySelector<HTMLElement>("[data-approval-card-root]")!;
		landOnWaitingCard(card);
		expect([
			naming(card),
			card.id === card.getAttribute("aria-labelledby"),
			/^named-by-text-\d+$/.test(card.id),
		]).toStrictEqual([
			{
				role: "region",
				labelledBy: card.id,
				label: null,
			},
			true,
			true,
		]);
	});
});
