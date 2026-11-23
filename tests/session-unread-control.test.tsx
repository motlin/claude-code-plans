// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {SessionRowStatusDot, SidebarRowSrText} from "../src/components/session-unread-control";
import type {SessionListItem} from "../src/lib/api/sessions";
import type {SessionBucket} from "../src/lib/session-state";
import {TOUCH_HIT} from "../src/lib/touch-reveal";
import {__unreadStoreTesting as __testing, syncUnseenFromSummaries, toggleUnseen} from "../src/lib/unread-store";

type PersistCall =
{
	sessionId: string;
	action: "reviewed" | "unreviewed";
};

function listItem(bucket: SessionBucket, overrides: Partial<SessionListItem> = {}): SessionListItem
{
	return {
		id: "session-test-100",
		title: "Fix the flaky test",
		mtime: "2026-09-28T10:00:00.000Z",
		created: "2026-09-28T09:00:00.000Z",
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "idle",
		bucket,
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		...overrides,
	};
}

function shownDot(container: HTMLElement):
{
	toggle: string | null;
	kind: string;
}
{
	return {
		toggle: screen.queryByRole("button")?.getAttribute("aria-label") ?? null,
		kind: container.querySelector("[data-kind]")?.getAttribute("data-kind") ?? "idle",
	};
}

describe("SessionRowStatusDot", () =>
{
	let calls: PersistCall[];

	beforeEach(() =>
	{
		__testing.reset();
		calls = [];
		__testing.setPersist(async (sessionId, action) =>
		{
			calls.push(
				{
					sessionId,
					action,
				},
			);
			return Promise.resolve();
		});
	});

	afterEach(() =>
	{
		cleanup();
	});

	it("shows the idle ring on a read row and marks an unread row read from its ready dot", async () =>
	{
		const {container} = render(<SessionRowStatusDot session={listItem("done")} />);
		const before = shownDot(container);

		act(() =>
		{
			toggleUnseen("session-test-100");
		});
		const afterMarkUnread = shownDot(container);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Click to mark as read",
				},
			),
		);
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});

		expect(
			{
				before,
				afterMarkUnread,
				after: shownDot(container),
				calls,
			},
		).toStrictEqual(
			{
				before:
				{
					toggle: null,
					kind: "idle",
				},
				afterMarkUnread:
				{
					toggle: "Click to mark as read",
					kind: "ready",
				},
				after:
				{
					toggle: null,
					kind: "idle",
				},
				calls: [
					{
						sessionId: "session-test-100",
						action: "unreviewed",
					},
					{
						sessionId: "session-test-100",
						action: "reviewed",
					},
				],
			},
		);
	});

	it("shows the ready dot when the server summary reports the session unseen", () =>
	{
		const {container} = render(<SessionRowStatusDot session={listItem("done")} />);

		act(() =>
		{
			syncUnseenFromSummaries([
				{
					id: "session-test-100",
					unseen: true,
				},
			]);
		});

		expect(shownDot(container)).toStrictEqual(
			{
				toggle: "Click to mark as read",
				kind: "ready",
			},
		);
	});

	it("keeps a review row the server did not flag unseen (an open PR) on the ready dot", () =>
	{
		const {container} = render(<SessionRowStatusDot session={listItem("review")} />);

		expect(shownDot(container)).toStrictEqual(
			{
				toggle: null,
				kind: "ready",
			},
		);
	});

	it.each([
		["working", "running"],
		["blocked", "awaiting"],
	] as const)("offers no toggle on a %s row and persists nothing", (bucket, kind) =>
	{
		const {container} = render(<SessionRowStatusDot session={listItem(bucket)} />);

		expect(
			{
				dot: shownDot(container),
				calls,
			},
		).toStrictEqual(
			{
				dot:
				{
					toggle: null,
					kind,
				},
				calls: [],
			},
		);
	});

	it("gives the 14px mark-as-read toggle a 44px touch hit area", () =>
	{
		render(<SessionRowStatusDot session={listItem("done")} />);
		act(() =>
		{
			toggleUnseen("session-test-100");
		});

		expect(
			screen.getByRole(
				"button",
				{
					name: "Click to mark as read",
				},
			).className,
		).toBe(
			`flex cursor-pointer items-center justify-center rounded-full hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${TOUCH_HIT}`,
		);
	});
});

describe("SidebarRowSrText", () =>
{
	afterEach(() =>
	{
		cleanup();
		document.getElementById("live-announcer")?.remove();
	});

	it("mounts upstream's role-less data-session-status span only while the row has a status, announcing each change (never the first render) politely, after the title unless the row is selected", () =>
	{
		__testing.reset();
		const shown = (container: HTMLElement) =>
		{
			const region = document.getElementById("live-announcer");
			return {
				spans: [...container.querySelectorAll("span")].map((span) => [
					span.getAttribute("role"),
					span.getAttribute("data-session-status"),
					span.textContent,
				]),
				live:
					region === null
						? null
						: [
								region.getAttribute("aria-live"),
								[...region.children].map((child) => [
									child.getAttribute("data-announce-key"),
									child.textContent,
								]),
							],
			};
		};
		const {container, rerender} = render(
			<SidebarRowSrText session={listItem("blocked")} paneSelected={false} title="Fix the bug" />,
		);
		const blocked = shown(container);
		rerender(<SidebarRowSrText session={listItem("working")} paneSelected={false} title="Fix the bug" />);
		const working = shown(container);
		rerender(<SidebarRowSrText session={listItem("working")} paneSelected={false} title="Why?" />);
		const retitled = shown(container);
		rerender(<SidebarRowSrText session={listItem("blocked")} paneSelected={false} title="Why?" />);
		const questionTitle = shown(container);
		rerender(<SidebarRowSrText session={listItem("working")} paneSelected title="Why?" />);
		const selected = shown(container);
		rerender(<SidebarRowSrText session={listItem("done")} paneSelected={false} title="Why?" />);

		expect(
			{
				blocked,
				working,
				retitled: retitled.live,
				questionTitle: questionTitle.live,
				selected: selected.live,
				done: shown(container),
			},
		).toStrictEqual(
			{
				blocked:
				{
					spans: [
						[null, "", " Awaiting input"],
						[null, null, " alpha · Connected"],
					],
					live: null,
				},
				working:
				{
					spans: [
						[null, "", " Running"],
						[null, null, " alpha · Connected"],
					],
					live: ["polite", [["session-status-session-test-100", "Fix the bug. Running"]]],
				},
				retitled: ["polite", [["session-status-session-test-100", "Fix the bug. Running"]]],
				questionTitle: ["polite", [["session-status-session-test-100", "Why? Awaiting input"]]],
				selected: ["polite", [["session-status-session-test-100", "Running"]]],
				done:
				{
					spans: [[null, null, " alpha · Connected"]],
					live: ["polite", []],
				},
			},
		);
	});
});
