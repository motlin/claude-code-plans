// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {__awaitingAckTesting, ack, ackedAt} from "../src/lib/awaiting-ack-store";
import {markCompletedWithUndo} from "../src/lib/mark-completed";
import
{
	__unreadStoreTesting,
	hasUnseenWork,
	isExplicitUnread,
	markUnseen,
	syncUnseenFromSummaries,
} from "../src/lib/unread-store";

const T = Date.parse("2026-11-04T10:00:00.000Z");
const T0 = Date.parse("2026-11-03T10:00:00.000Z");
const T2 = Date.parse("2026-11-05T10:00:00.000Z");

const persist = vi.fn<(sessionId: string, action: "reviewed" | "unreviewed") => Promise<void>>();

function state()
{
	return {
		acked: ackedAt("s1"),
		unseen: hasUnseenWork("s1"),
		explicit: isExplicitUnread("s1"),
	};
}

async function settle()
{
	await new Promise((resolve) =>
	{
		setTimeout(resolve, 0);
	});
}

beforeEach(() =>
{
	localStorage.clear();
	__awaitingAckTesting.reset();
	__unreadStoreTesting.reset();
	persist.mockReset();
	persist.mockResolvedValue();
	__unreadStoreTesting.setPersist(persist);
});

afterEach(() =>
{
	__unreadStoreTesting.reset();
});

describe("markCompletedWithUndo", () =>
{
	it("acks and reads an unseen row, and its restore clears the ack and marks it unseen again", async () =>
	{
		syncUnseenFromSummaries([
			{
				id: "s1",
				unseen: true,
			},
		]);
		const restore = markCompletedWithUndo("s1", T);
		const completed = state();
		restore();
		await settle();

		expect(
			{
				completed,
				restored: state(),
				persisted: persist.mock.calls,
			},
		).toStrictEqual(
			{
				completed:
				{
					acked: T,
					unseen: false,
					explicit: false,
				},
				restored:
				{
					acked: undefined,
					unseen: true,
					explicit: false,
				},
				persisted: [
					["s1", "reviewed"],
					["s1", "unreviewed"],
				],
			},
		);
	});

	it("puts back an earlier ack", () =>
	{
		ack("s1", T0);
		const restore = markCompletedWithUndo("s1", T);
		restore();

		expect(state()).toStrictEqual(
			{
				acked: T0,
				unseen: false,
				explicit: false,
			},
		);
	});

	it("leaves a row that was already read as read", async () =>
	{
		const restore = markCompletedWithUndo("s1", T);
		restore();
		await settle();

		expect(
			{
				state: state(),
				persisted: persist.mock.calls,
			},
		).toStrictEqual(
			{
				state:
				{
					acked: undefined,
					unseen: false,
					explicit: false,
				},
				persisted: [["s1", "reviewed"]],
			},
		);
	});

	it("keeps an ack written after the completion (upstream ackedAt === r guard)", () =>
	{
		const restore = markCompletedWithUndo("s1", T);
		ack("s1", T2);
		restore();

		expect(state().acked).toBe(T2);
	});

	it("restores a hand Mark as unread as explicit", () =>
	{
		markUnseen(
			"s1",
			{
				explicit: true,
			},
		);
		const restore = markCompletedWithUndo("s1", T);
		restore();

		expect(state()).toStrictEqual(
			{
				acked: undefined,
				unseen: true,
				explicit: true,
			},
		);
	});
});
