import {describe, expect, it} from "vite-plus/test";
import {
	CODE_RESERVES_ACTIONS_GAP,
	RESERVES_ACTIONS_GAP_ATTR,
	USER_TRAILING_AFTER_FRAME_CLASS,
	USER_TRAILING_CLASS,
	USER_TRAILING_SIDE_CLASS,
	reservesAssistantActionsGap,
	reservesUserActionsGap,
	type UserActionsGapInput,
} from "../src/lib/user-trailing";

describe("user trailing strip constants (upstream shared-60/shared-80, verbatim)", () => {
	it("copies the strip class, side classes, after-frame margin, attribute name and Code's presentation value", () => {
		expect({
			USER_TRAILING_CLASS,
			USER_TRAILING_SIDE_CLASS,
			USER_TRAILING_AFTER_FRAME_CLASS,
			RESERVES_ACTIONS_GAP_ATTR,
			CODE_RESERVES_ACTIONS_GAP,
		}).toStrictEqual({
			USER_TRAILING_CLASS:
				"flex w-full flex-col gap-5 compact:gap-4 print:block print:[&>:where(:not(:first-child))]:!mt-5 compact:print:[&>:where(:not(:first-child))]:!mt-4 empty:hidden [&>*]:!my-0",
			USER_TRAILING_SIDE_CLASS: {end: "items-end", start: "items-start"},
			USER_TRAILING_AFTER_FRAME_CLASS: "mt-5 compact:mt-4",
			RESERVES_ACTIONS_GAP_ATTR: "data-reserves-actions-gap",
			CODE_RESERVES_ACTIONS_GAP: "prompts",
		});
	});
});

describe("reservesUserActionsGap (shared-80 p8 `Re`)", () => {
	it("marks only the last/only row of a non-stacked, non-reply turn with trailing items, unless the presentation opts out", () => {
		const base: UserActionsGapInput = {
			reservesActionsGap: "prompts",
			position: "only",
			awaiting: undefined,
			insideReply: false,
			trailingCount: 1,
		};
		const cases: Record<string, UserActionsGapInput> = {
			base,
			last: {...base, position: "last"},
			first: {...base, position: "first"},
			middle: {...base, position: "middle"},
			stacked: {...base, awaiting: "stacked"},
			head: {...base, awaiting: "head"},
			insideReply: {...base, insideReply: true},
			noTrailing: {...base, trailingCount: 0},
			optedOut: {...base, reservesActionsGap: false},
			chatHub: {...base, reservesActionsGap: true},
		};

		expect(
			Object.fromEntries(Object.entries(cases).map(([name, input]) => [name, reservesUserActionsGap(input)])),
		).toStrictEqual({
			base: true,
			last: true,
			first: false,
			middle: false,
			stacked: false,
			head: true,
			insideReply: false,
			noTrailing: false,
			optedOut: false,
			chatHub: true,
		});
	});
});

describe("reservesAssistantActionsGap (shared-80 Hj first term)", () => {
	it("marks assistant messages only for the chat hub's `true`, never for Code's `prompts`", () => {
		expect({
			prompts: reservesAssistantActionsGap("prompts"),
			true: reservesAssistantActionsGap(true),
			false: reservesAssistantActionsGap(false),
		}).toStrictEqual({prompts: false, true: true, false: false});
	});
});
