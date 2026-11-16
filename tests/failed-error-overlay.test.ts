import {describe, expect, it} from "vite-plus/test";

import type {SessionListItem} from "../src/lib/api/sessions";
import {withFailedError} from "../src/lib/failed-error-overlay";

const F = "2026-11-06T10:00:00.000Z";
const M = "2026-11-06T10:05:00.000Z";

function failed(overrides: Partial<SessionListItem> = {}): SessionListItem
{
	return {
		id: "s1",
		title: "Failed",
		mtime: M,
		created: "2026-11-06T09:00:00.000Z",
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "ended",
		bucket: "done",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		failedAt: F,
		...overrides,
	};
}

describe("withFailedError", () =>
{
	it("draws a read failed row whose CLI exited as an error in Needs input", () =>
	{
		expect(withFailedError(failed(), undefined)).toStrictEqual(
			failed(
				{
					bucket: "blocked",
					unseenError: true,
					erroredAt: F,
				},
			),
		);
	});

	it("returns a row the server already draws failed as the same object", () =>
	{
		const row = failed(
			{
				state: "idle",
				unseen: true,
				bucket: "blocked",
				unseenError: true,
				erroredAt: F,
			},
		);
		expect(withFailedError(row, undefined)).toBe(row);
	});

	it("leaves a row acked at its mtime, or at its failure after a later mtime bump", () =>
	{
		const row = failed();
		const bumped = failed(
			{
				mtime: "2026-11-06T10:09:00.000Z",
			},
		);
		expect([
			withFailedError(row, Date.parse(M)) === row,
			withFailedError(bumped, Date.parse(F)) === bumped,
		]).toStrictEqual([true, true]);
	});

	it("clears the server's unseen error once acked, Ready for review with an open PR", () =>
	{
		const row = failed(
			{
				state: "idle",
				unseen: true,
				bucket: "blocked",
				unseenError: true,
				erroredAt: F,
			},
		);
		const {unseenError: _e, erroredAt: _t, ...cleared} = row;
		expect([
			withFailedError(row, Date.parse(F)),
			withFailedError(
				{
					...row,
					prStatus:
					{
						number: 7,
						state: "open",
					},
				},
				Date.parse(F),
			),
		]).toStrictEqual([
			{
				...cleared,
				bucket: "done",
			},
			{
				...cleared,
				prStatus:
				{
					number: 7,
					state: "open",
				},
				bucket: "review",
			},
		]);
	});

	it("re-arms when the failure is newer than the ack", () =>
	{
		expect(withFailedError(failed(), Date.parse(F) - 1)).toStrictEqual(
			failed(
				{
					bucket: "blocked",
					unseenError: true,
					erroredAt: F,
				},
			),
		);
	});

	it("leaves archived, working, gated and never-failed rows alone, the unacked server error included", () =>
	{
		const {failedAt: _f, ...neverFailed} = failed();
		const rows: SessionListItem[] = [
			failed(
				{
					archived: true,
				},
			),
			failed(
				{
					bucket: "working",
					state: "working",
				},
			),
			failed(
				{
					bucket: "blocked",
					state: "waiting",
				},
			),
			failed(
				{
					bucket: "blocked",
					awaitingPermission: true,
				},
			),
			neverFailed,
			{
				...neverFailed,
				bucket: "blocked",
				state: "working",
				unseen: true,
				unseenError: true,
				erroredAt: F,
			},
		];
		expect(rows.map((row) => withFailedError(row, undefined) === row)).toStrictEqual([
			true,
			true,
			true,
			true,
			true,
			true,
		]);
	});
});
