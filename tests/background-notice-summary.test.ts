import {describe, expect, it} from "vite-plus/test";

import {backgroundNoticeSummary, type NoticeEntry} from "../src/lib/background-notice-summary";

const shell = (status: NoticeEntry["status"]): NoticeEntry => ({status, kind: "shell"});

function text(entries: NoticeEntry[]): string {
	return backgroundNoticeSummary(entries)
		.map((part) => part.text)
		.join(", ");
}

describe("backgroundNoticeSummary", () => {
	it.each<{name: string; entries: NoticeEntry[]; expected: string}>([
		{
			name: "upstream's Klass row",
			entries: [...Array.from({length: 23}, () => shell("completed")), shell("stopped")],
			expected: "23 background commands completed, 1 stopped",
		},
		{
			name: "a singular first part",
			entries: [shell("completed"), shell("stopped")],
			expected: "1 background command completed, 1 stopped",
		},
		{
			name: "only stopped",
			entries: [shell("stopped"), shell("stopped")],
			expected: "2 background commands stopped",
		},
		{
			name: "every status in upstream's order",
			entries: [
				shell("running"),
				shell("stopped"),
				shell("failed"),
				shell("completed"),
				shell("stopped"),
				shell("completed"),
				shell("completed"),
			],
			expected: "3 background commands completed, 1 failed, 2 stopped, 1 running",
		},
		{
			name: "running first",
			entries: [shell("running"), shell("running")],
			expected: "2 background commands running",
		},
		{
			name: "agents",
			entries: [
				{status: "completed", kind: "agent"},
				{status: "completed", kind: "agent"},
			],
			expected: "2 background agents completed",
		},
		{
			name: "mixed kinds",
			entries: [shell("completed"), {status: "completed", kind: "agent"}],
			expected: "2 background tasks completed",
		},
	])("words $name as upstream does", ({entries, expected}) => {
		expect(text(entries)).toBe(expected);
	});

	it("marks only the failed part as danger", () => {
		expect(
			backgroundNoticeSummary([shell("failed"), shell("completed"), shell("completed")]).map((part) => [
				part.key,
				part.danger,
			]),
		).toStrictEqual([
			["completed", false],
			["failed", true],
		]);
	});
});
