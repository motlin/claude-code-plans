import {describe, expect, it} from "vite-plus/test";

import type {SessionListItem} from "../src/lib/api/sessions";
import {withAwaitingAck} from "../src/lib/awaiting-ack-overlay";

const T = "2026-11-04T10:00:00.000Z";

function blocked(overrides: Partial<SessionListItem> = {}): SessionListItem
{
	return {
		id: "s1",
		title: "Needs input",
		mtime: T,
		created: "2026-11-04T09:00:00.000Z",
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "waiting",
		awaitingPermission: true,
		bucket: "blocked",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: T,
		...overrides,
	};
}

function idle(overrides: Partial<SessionListItem> = {}): SessionListItem
{
	const {awaitingPermission: _awaiting, ...rest} = blocked(overrides);
	return {
		...rest,
		bucket: "done",
	};
}

describe("withAwaitingAck", () =>
{
	it("draws an acked blocked row idle, keeping its waiting state for the responding overlay", () =>
	{
		expect(withAwaitingAck(blocked(), Date.parse(T), false)).toStrictEqual(idle());
	});

	it("drops the unseen error of an acked errored row", () =>
	{
		expect(
			withAwaitingAck(
				blocked(
					{
						unseenError: true,
						erroredAt: "2026-11-04T09:59:00.000Z",
					},
				),
				Date.parse(T),
				false,
			),
		).toStrictEqual(idle());
	});

	it("puts an acked row with an open or draft PR in review, and a merged one in done", () =>
	{
		const pr = (state: "open" | "draft" | "merged") => (
		{
			number: 7,
			state,
		});
		expect(
			{
				open: withAwaitingAck(
					blocked(
						{
							prStatus: pr("open"),
						},
					),
					Date.parse(T),
					false,
				).bucket,
				draft: withAwaitingAck(
					blocked(
						{
							prStatus: pr("draft"),
						},
					),
					Date.parse(T),
					false,
				).bucket,
				merged: withAwaitingAck(
					blocked(
						{
							prStatus: pr("merged"),
						},
					),
					Date.parse(T),
					false,
				).bucket,
			},
		).toStrictEqual(
			{
				open: "review",
				draft: "review",
				merged: "done",
			},
		);
	});

	it("returns the same object when the ack does not cover the row", () =>
	{
		const session = blocked();
		const working = blocked(
			{
				state: "working",
				bucket: "working",
			},
		);
		expect(
			{
				stale: withAwaitingAck(session, Date.parse(T) - 1, false) === session,
				none: withAwaitingAck(session, undefined, false) === session,
				liveApproval: withAwaitingAck(session, Date.parse(T), true) === session,
				working: withAwaitingAck(working, Date.parse(T), false) === working,
			},
		).toStrictEqual(
			{
				stale: true,
				none: true,
				liveApproval: true,
				working: true,
			},
		);
	});
});
