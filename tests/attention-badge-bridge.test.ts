import {describe, expect, it} from "vite-plus/test";

import {DEFAULTS, type Settings} from "../src/components/settings-provider";
import {countSessionsNeedingAttention} from "../src/lib/attention";

const enabled: Settings = {...DEFAULTS, notifyCompletions: true, notifyPermissionRequests: true};
const disabled: Settings = {
	...DEFAULTS,
	notifyCompletions: false,
	notifyPermissionRequests: false,
};

const sessions = [
	{sessionId: "session-test-waiting", displayState: "waiting", archived: false},
	{sessionId: "session-test-review", displayState: "review", archived: false},
	{sessionId: "session-test-working", displayState: "working", archived: false},
	{sessionId: "session-test-idle", displayState: "idle", archived: false},
	{sessionId: "session-test-unknown", displayState: "unknown", archived: false},
] as const;

describe("countSessionsNeedingAttention", () => {
	it("counts waiting and review sessions", () => {
		expect(countSessionsNeedingAttention([...sessions], enabled, true, null)).toBe(2);
	});

	it("counts each attention state only when its notification kind is on", () => {
		expect({
			completions: countSessionsNeedingAttention(
				[...sessions],
				{...disabled, notifyCompletions: true},
				true,
				null,
			),
			permissionRequests: countSessionsNeedingAttention(
				[...sessions],
				{...disabled, notifyPermissionRequests: true},
				true,
				null,
			),
		}).toStrictEqual({completions: 1, permissionRequests: 1});
	});

	it("applies the global alert opt-out", () => {
		expect(countSessionsNeedingAttention([...sessions], disabled, true, null)).toBe(0);
	});

	it("applies the visible session alert gate", () => {
		expect(countSessionsNeedingAttention([...sessions], enabled, false, "session-test-waiting")).toBe(1);
	});
});
