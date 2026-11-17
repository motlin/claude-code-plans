// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";
import
{
	PALETTE_OVERLAY_SELECTOR,
	type PaletteCloseHoldInput,
	paletteCloseHold,
	shouldAutoClose,
} from "../src/lib/palette-close-hold";

const IDLE: PaletteCloseHoldInput =
{
	mode: "search",
	entrypoint: "default",
	search: "",
	compose: "",
	attachments: 0,
	filters: {},
	startStep: "idle",
};

function holdOf(overrides: Partial<PaletteCloseHoldInput>)
{
	return paletteCloseHold(
		{
			...IDLE,
			...overrides,
		},
	);
}

describe("paletteCloseHold (upstream body hold + host `F`)", () =>
{
	it("is none for an idle palette", () =>
	{
		expect(holdOf({})).toStrictEqual("none");
	});

	it("is input for short searches, blank compose behind Search, a chip, and long search-only text", () =>
	{
		expect([
			holdOf(
				{
					search: "abc",
				},
			),
			holdOf(
				{
					search: " ",
				},
			),
			holdOf(
				{
					compose: "  ",
				},
			),
			holdOf(
				{
					filters:
					{
						archived: true,
					},
				},
			),
			holdOf(
				{
					entrypoint: "search",
					search: "a".repeat(60),
				},
			),
			holdOf(
				{
					search: "a".repeat(50),
				},
			),
		]).toStrictEqual(["input", "input", "input", "input", "input", "input"]);
	});

	it("is all for drafts, attachments, long default-view text and the launch flow", () =>
	{
		expect([
			holdOf(
				{
					mode: "compose",
					compose: " ",
				},
			),
			holdOf(
				{
					compose: "hi",
				},
			),
			holdOf(
				{
					attachments: 1,
				},
			),
			holdOf(
				{
					search: "a".repeat(51),
				},
			),
			holdOf(
				{
					startStep: "launching",
				},
			),
			holdOf(
				{
					startStep: "picker",
				},
			),
		]).toStrictEqual(["all", "all", "all", "all", "all", "all"]);
	});
});

describe("shouldAutoClose (upstream A7 close gate)", () =>
{
	it("refuses everything under all and only route changes under input", () =>
	{
		expect(
			(["none", "input", "all"] as const).flatMap((hold) =>
				(["route", "dialog"] as const).map((reason) => [hold, reason, shouldAutoClose(hold, reason)]),
			),
		).toStrictEqual([
			["none", "route", true],
			["none", "dialog", true],
			["input", "route", false],
			["input", "dialog", true],
			["all", "route", false],
			["all", "dialog", false],
		]);
	});
});

describe("PALETTE_OVERLAY_SELECTOR (upstream YI plus the palette-owned exemption)", () =>
{
	it("matches open modal dialogs but not toasts, closed popups or palette-owned ones", () =>
	{
		const markup = [
			'<div role="alertdialog"></div>',
			'<div aria-modal="true"></div>',
			'<div data-cds="Dialog"></div>',
			'<div data-cds="ConfirmationDialog"></div>',
			'<div role="alertdialog" aria-modal="false"></div>',
			'<div data-cds="Dialog" data-closed=""></div>',
			'<div data-cds="Dialog" data-palette-owned=""></div>',
			'<div role="dialog"></div>',
		];
		const root = document.createElement("div");
		root.innerHTML = markup.join("");
		expect([...root.children].map((node) => node.matches(PALETTE_OVERLAY_SELECTOR))).toStrictEqual([
			true,
			true,
			true,
			true,
			false,
			false,
			false,
			false,
		]);
	});
});
