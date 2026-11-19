import {describe, expect, it} from "vite-plus/test";
import {modeMenuItems} from "../src/lib/launch-options";

/** Each row's id with its badge, or none. */
function badges(...args: Parameters<typeof modeMenuItems>)
{
	return modeMenuItems(...args).map((item) => [item.id, item.badge ?? null]);
}

describe("modeMenuItems badges (upstream's ar/or over the permission rows)", () =>
{
	it("badges the settings default, recommends Auto when it isn't current, and lets Recommended win a shared row", () =>
	{
		expect(
			{
				autoDefaultOnAuto: badges(
					true,
					{
						defaultMode: "auto",
						current: "auto",
					},
				),
				autoDefaultOnPlan: badges(
					true,
					{
						defaultMode: "auto",
						current: "plan",
					},
				),
				acceptEditsOnPlan: badges(
					true,
					{
						defaultMode: "acceptEdits",
						current: "plan",
					},
				),
				acceptEditsOnAuto: badges(
					true,
					{
						defaultMode: "acceptEdits",
						current: "auto",
					},
				),
				noDefault: badges(
					true,
					{
						defaultMode: null,
						current: "default",
					},
				),
				unlistedBypass: badges(
					false,
					{
						defaultMode: "bypassPermissions",
						current: "plan",
					},
				),
				unknownMode: badges(
					false,
					{
						defaultMode: "nonsense",
						current: "auto",
					},
				),
				managedNonAuto: badges(
					false,
					{
						defaultMode: "acceptEdits",
						current: "plan",
						recommendAuto: false,
					},
				),
				noOptions: badges(false),
			},
		).toStrictEqual(
			{
				autoDefaultOnAuto: [
					["auto", "default"],
					["default", null],
					["acceptEdits", null],
					["plan", null],
					["bypassPermissions", null],
				],
				autoDefaultOnPlan: [
					["auto", "recommended"],
					["default", null],
					["acceptEdits", null],
					["plan", null],
					["bypassPermissions", null],
				],
				acceptEditsOnPlan: [
					["auto", "recommended"],
					["default", null],
					["acceptEdits", "default"],
					["plan", null],
					["bypassPermissions", null],
				],
				acceptEditsOnAuto: [
					["auto", null],
					["default", null],
					["acceptEdits", "default"],
					["plan", null],
					["bypassPermissions", null],
				],
				noDefault: [
					["auto", "recommended"],
					["default", null],
					["acceptEdits", null],
					["plan", null],
					["bypassPermissions", null],
				],
				unlistedBypass: [
					["auto", "recommended"],
					["default", null],
					["acceptEdits", null],
					["plan", null],
				],
				unknownMode: [
					["auto", null],
					["default", null],
					["acceptEdits", null],
					["plan", null],
				],
				managedNonAuto: [
					["auto", null],
					["default", null],
					["acceptEdits", "default"],
					["plan", null],
				],
				noOptions: [
					["auto", null],
					["default", null],
					["acceptEdits", null],
					["plan", null],
				],
			},
		);
	});

	it("keeps the rows otherwise unchanged, with no badge key on an unbadged row", () =>
	{
		expect(
			modeMenuItems(
				false,
				{
					defaultMode: "plan",
					current: "auto",
				},
			),
		).toStrictEqual([
			{
				id: "auto",
				label: "Auto",
				description: "Claude handles permission decisions",
				warning: false,
			},
			{
				id: "default",
				label: "Manual",
				description: "Always ask before making changes",
				warning: false,
			},
			{
				id: "acceptEdits",
				label: "Accept edits",
				description: "Automatically accept all file edits",
				warning: false,
			},
			{
				id: "plan",
				label: "Plan",
				description: "Create a plan before making changes",
				warning: false,
				badge: "default",
			},
		]);
	});

	it("moves a model-locked Auto to a disabled last row, after Bypass, carrying the lock note, and drops its Recommended badge", () =>
	{
		const note = "Requires Claude 4.6 or newer";
		const rows = modeMenuItems(
			true,
			{
				defaultMode: null,
				current: "acceptEdits",
			},
			note,
		);
		expect(
			{
				rows: rows.map((item) => [item.id, item.disabled ?? false, item.badge ?? null]),
				last: rows.at(-1),
			},
		).toStrictEqual(
			{
				rows: [
					["default", false, null],
					["acceptEdits", false, null],
					["plan", false, null],
					["bypassPermissions", false, null],
					["auto", true, null],
				],
				last:
				{
					id: "auto",
					label: "Auto",
					description: "Claude handles permission decisions",
					warning: false,
					disabled: true,
					disabledReason: note,
				},
			},
		);
	});
});
