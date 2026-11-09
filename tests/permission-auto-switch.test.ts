import {describe, expect, it} from "vite-plus/test";
import {
	allowMenuItems,
	AUTO_SWITCH_DESCRIPTION,
	AUTO_SWITCH_LABEL,
	autoSwitchOffered,
	type AutoSwitchOfferInput,
} from "../src/lib/permission-auto-switch";

const CYCLE = ["default", "acceptEdits", "plan", "auto"] as const;

const BASE: AutoSwitchOfferInput = {
	mode: "default",
	availableModes: CYCLE,
	canAnswer: true,
	readGated: false,
	elicitation: false,
	dialog: {denyFirst: false, persistent: true, auto: true},
};

describe("autoSwitchOffered", () => {
	it("copies upstream's row copy", () => {
		expect([AUTO_SWITCH_LABEL, AUTO_SWITCH_DESCRIPTION]).toStrictEqual([
			"Allow and switch to Auto",
			"Auto reviews the rest of this session.",
		]);
	});

	it("offers the row only from Manual and Accept edits", () => {
		const modes = ["default", "acceptEdits", "auto", "plan", "bypassPermissions", "dontAsk"];
		expect(modes.map((mode) => autoSwitchOffered({...BASE, mode}))).toStrictEqual([
			true,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it.each([
		{name: "auto missing from the cycle", input: {availableModes: ["default", "acceptEdits", "plan"] as const}},
		{name: "no writable pane", input: {canAnswer: false}},
		{name: "read gate unmet", input: {readGated: true}},
		{name: "a verdict elicitation", input: {elicitation: true}},
		{name: "no dialog to read", input: {dialog: undefined}},
		{name: "the dialog not read yet (askFlagsUnknown)", input: {dialog: "unknown" as const}},
		{name: "a deny-first dialog", input: {dialog: {denyFirst: true, persistent: false, auto: false}}},
	])("withholds the row for $name", ({input}) => {
		expect(autoSwitchOffered({...BASE, ...input})).toStrictEqual(false);
	});

	it("offers the row when the CLI's own auto row is on screen, or else through the shift+tab path", () => {
		expect([
			autoSwitchOffered({...BASE, dialog: {denyFirst: false, persistent: false, auto: true}}),
			autoSwitchOffered({...BASE, dialog: {denyFirst: false, persistent: false, auto: false}}),
			autoSwitchOffered({
				...BASE,
				mode: "acceptEdits",
				availableModes: ["default", "plan", "auto"],
				dialog: {denyFirst: false, persistent: false, auto: true},
			}),
			autoSwitchOffered({
				...BASE,
				mode: "acceptEdits",
				availableModes: ["default", "plan", "auto"],
				dialog: {denyFirst: false, persistent: false, auto: false},
			}),
		]).toStrictEqual([true, true, true, false]);
	});
});

describe("allowMenuItems", () => {
	it.each([
		{persistent: true, lead: "always", autoOffered: true, items: ["once", "auto"]},
		{persistent: true, lead: "always", autoOffered: false, items: ["once"]},
		{persistent: true, lead: "once", autoOffered: true, items: ["persistent", "auto"]},
		{persistent: true, lead: "once", autoOffered: false, items: ["persistent"]},
		{persistent: false, lead: "always", autoOffered: true, items: ["auto"]},
		{persistent: false, lead: "once", autoOffered: true, items: ["auto"]},
		{persistent: false, lead: "always", autoOffered: false, items: []},
		{persistent: false, lead: "once", autoOffered: false, items: []},
	] as const)(
		"persistent $persistent, lead $lead, auto offered $autoOffered → $items",
		({persistent, lead, autoOffered, items}) => {
			expect(allowMenuItems({persistent, lead, autoOffered})).toStrictEqual(items);
		},
	);
});
