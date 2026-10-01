// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionRowStatusDot} from "../src/components/session-unread-control";
import type {SessionListItem} from "../src/lib/api/sessions";
import type {SessionBucket} from "../src/lib/session-state";
import {__unreadStoreTesting, syncUnseenFromSummaries} from "../src/lib/unread-store";

function listItem(bucket: SessionBucket): SessionListItem {
	return {
		id: "session-status-dot-1",
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
	};
}

function hoverTooltip(target: Element): {text: string | null; describedBy: boolean} {
	fireEvent.pointerEnter(target);
	act(() => {
		vi.advanceTimersByTime(300);
	});
	const tooltip = screen.queryByRole("tooltip");
	return {
		text: tooltip?.textContent ?? null,
		describedBy: tooltip !== null && target.getAttribute("aria-describedby") === tooltip.id,
	};
}

describe("SessionRowStatusDot glyph", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		__unreadStoreTesting.reset();
		__unreadStoreTesting.setPersist(async () => {});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it.each([
		["blocked", "Awaiting input"],
		["working", "Running"],
	] as const)("shows a top tooltip on a %s row's glyph", (bucket, text) => {
		render(<SessionRowStatusDot session={listItem(bucket)} />);
		const glyph = screen.getByRole("status", {name: text});

		expect({
			button: screen.queryByRole("button"),
			hover: hoverTooltip(glyph),
			side: screen.getByRole("tooltip").className.includes("bottom-full"),
		}).toStrictEqual({button: null, hover: {text, describedBy: true}, side: true});
	});

	it("renders a read finished row's glyph as a plain image with no button, title or tooltip", () => {
		const {container} = render(<SessionRowStatusDot session={listItem("done")} />);
		const glyph = screen.getByRole("img", {name: "Idle"});

		expect({
			button: screen.queryByRole("button"),
			titles: container.querySelectorAll("[title]").length,
			hover: hoverTooltip(glyph),
		}).toStrictEqual({button: null, titles: 0, hover: {text: null, describedBy: false}});
	});

	it("keeps the toggle on an unread row's dot, labelled by the shared tooltip", () => {
		const {container} = render(<SessionRowStatusDot session={listItem("done")} />);
		act(() => syncUnseenFromSummaries([{id: "session-status-dot-1", unseen: true}]));
		const button = screen.getByRole("button", {name: "Click to mark as read"});

		expect({
			titles: container.querySelectorAll("[title]").length,
			hover: hoverTooltip(button),
		}).toStrictEqual({titles: 0, hover: {text: "Click to mark as read", describedBy: true}});
	});
});
