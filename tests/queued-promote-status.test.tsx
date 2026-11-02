// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {QueuedPromoteStatus} from "../src/components/queued-message-bar";
import {announce, clearAnnouncements} from "../src/lib/landed-store";

afterEach(() =>
{
	cleanup();
	clearAnnouncements();
});

function statusOf(container: HTMLElement)
{
	const status = container.querySelector<HTMLElement>("[data-queued-promote-status]");
	if (status === null) throw new Error("Expected the queued promote status");
	return {
		tag: status.tagName,
		role: status.getAttribute("role"),
		className: status.className,
		text: status.textContent,
	};
}

describe("QueuedPromoteStatus", () =>
{
	it("announces Sent when a promote is accepted, then Read when it lands", () =>
	{
		const {container} = render(<QueuedPromoteStatus sessionId="session-alice" />);
		const atMount = statusOf(container);
		act(() =>
		{
			announce("session-alice", "sent");
		});
		const sent = statusOf(container).text;
		act(() =>
		{
			announce("session-alice", "read");
		});
		expect(
			{
				atMount,
				sent,
				read: statusOf(container).text,
			},
		).toStrictEqual(
			{
				atMount:
				{
					tag: "SPAN",
					role: "status",
					className: "sr-only",
					text: "",
				},
				sent: "Sent",
				read: "Read",
			},
		);
	});

	it("starts empty when mounted after an announcement, and ignores other sessions", () =>
	{
		act(() =>
		{
			announce("session-alice", "sent");
		});
		const {container} = render(<QueuedPromoteStatus sessionId="session-alice" />);
		const atMount = statusOf(container).text;
		act(() =>
		{
			announce("session-bob", "read");
		});
		expect(
			{
				atMount,
				afterOther: statusOf(container).text,
				roles: screen.getAllByRole("status").length,
			},
		).toStrictEqual(
			{
				atMount: "",
				afterOther: "",
				roles: 1,
			},
		);
	});
});
