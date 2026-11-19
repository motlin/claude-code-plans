// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";

import {buttonDigit, cardOwnsDigit, digitLayoutKey, permissionDigitEntries} from "../src/lib/approval-digits";

afterEach(() =>
{
	document.body.replaceChildren();
});

describe("permissionDigitEntries, as upstream's lL(deny, Ya)", () =>
{
	it("maps 1 to deny and the last digit to Allow once, with the persistent option a held entry between them", () =>
	{
		expect([
			permissionDigitEntries(
				{
					persistentOffered: false,
					allowDisabled: false,
					denyDisabled: false,
				},
			),
			permissionDigitEntries(
				{
					persistentOffered: true,
					allowDisabled: false,
					denyDisabled: false,
				},
			),
			permissionDigitEntries(
				{
					persistentOffered: false,
					allowDisabled: true,
					denyDisabled: false,
				},
			),
			permissionDigitEntries(
				{
					persistentOffered: true,
					allowDisabled: true,
					denyDisabled: false,
				},
			),
			permissionDigitEntries(
				{
					persistentOffered: false,
					allowDisabled: true,
					denyDisabled: true,
				},
			),
		]).toStrictEqual([
			["deny", "once"],
			["deny", "held", "once"],
			["deny", "dead"],
			["deny", "held", "dead"],
			["dead", "dead"],
		]);
	});
});

describe("digitLayoutKey, as upstream's Pi", () =>
{
	it("joins the entries with a dash for each dead or held one", () =>
	{
		expect([
			digitLayoutKey(["deny", "held", "once"]),
			digitLayoutKey(["deny", "held", "dead"]),
			digitLayoutKey(["deny", "once"]),
		]).toStrictEqual(["deny,-,once", "deny,-,-", "deny,once"]);
	});
});

function cardWithButton(digits: string): HTMLButtonElement
{
	const card = document.createElement("div");
	card.setAttribute("data-approval-card-digits", digits);
	const button = document.createElement("button");
	const label = document.createElement("span");
	label.setAttribute("data-approval-digit", "2");
	button.append(label);
	card.append(button);
	const outside = document.createElement("button");
	document.body.append(card, outside);
	return button;
}

describe("cardOwnsDigit, as upstream's DP", () =>
{
	it("claims a digit up to the focused card's count, and nothing outside a card", () =>
	{
		const button = cardWithButton("2");
		const outside = document.body.lastElementChild;
		expect(
			{
				one: cardOwnsDigit("1", button),
				two: cardOwnsDigit("2", button),
				three: cardOwnsDigit("3", button),
				zero: cardOwnsDigit("0", button),
				letter: cardOwnsDigit("a", button),
				outside: cardOwnsDigit("2", outside),
				none: cardOwnsDigit("2", null),
			},
		).toStrictEqual(
			{
				one: true,
				two: true,
				three: false,
				zero: false,
				letter: false,
				outside: false,
				none: false,
			},
		);
	});
});

describe("buttonDigit, as upstream's $0", () =>
{
	it("reads a button's label digit, and null for anything else", () =>
	{
		const button = cardWithButton("2");
		const plain = document.createElement("button");
		expect(
			{
				button: buttonDigit(button),
				label: buttonDigit(button.firstElementChild),
				plain: buttonDigit(plain),
				none: buttonDigit(null),
			},
		).toStrictEqual(
			{
				button: 2,
				label: null,
				plain: null,
				none: null,
			},
		);
	});
});
