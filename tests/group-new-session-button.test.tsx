// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {GroupNewSessionButton, type GroupNewSessionSource} from "../src/components/sidebar/group-new-session-button";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function hoverPlus(): void {
	vi.useFakeTimers();
	fireEvent.pointerEnter(screen.getByRole("button"));
	act(() => {
		vi.advanceTimersByTime(300);
	});
}

describe("<GroupNewSessionButton> labels", () => {
	it("labels a project section's + by the group, with no tooltip", () => {
		render(
			<GroupNewSessionButton
				groupLabel="claude-code-plans"
				onNewSession={vi.fn<(source: GroupNewSessionSource) => void>()}
			/>,
		);

		hoverPlus();

		expect({
			label: screen.getByRole("button").getAttribute("aria-label"),
			tabIndex: screen.getByRole("button").tabIndex,
			rowAction: screen.getByRole("button").hasAttribute("data-row-action"),
			tooltip: screen.queryByRole("tooltip"),
		}).toStrictEqual({label: "New session in claude-code-plans", tabIndex: -1, rowAction: true, tooltip: null});
	});

	it("labels a custom section's + by its folder and group, with the folder tooltip and Added to detail", () => {
		render(
			<GroupNewSessionButton
				groupLabel="Work"
				target="foo"
				onNewSession={vi.fn<(source: GroupNewSessionSource) => void>()}
			/>,
		);

		hoverPlus();

		const tooltip = screen.getByRole("tooltip");
		expect({
			label: screen.getByRole("button").getAttribute("aria-label"),
			text: tooltip.textContent,
			side: tooltip.dataset["side"],
			detail: [...tooltip.querySelectorAll("span")].map((span) => span.textContent).at(-1),
		}).toStrictEqual({
			label: "New session in foo, added to Work",
			text: "New session in fooAdded to Work",
			side: "right",
			detail: "Added to Work",
		});
	});

	it("labels a custom section with no folder as no folder picked", () => {
		render(
			<GroupNewSessionButton
				groupLabel="Work"
				target={null}
				onNewSession={vi.fn<(source: GroupNewSessionSource) => void>()}
			/>,
		);

		hoverPlus();

		expect({
			label: screen.getByRole("button").getAttribute("aria-label"),
			text: screen.getByRole("tooltip").textContent,
		}).toStrictEqual({
			label: "New session with no folder picked, added to Work",
			text: "New session with no folder pickedAdded to Work",
		});
	});
});

describe("<GroupNewSessionButton> click", () => {
	it("starts a new session from the plus button without toggling the section", () => {
		const onNewSession = vi.fn<(source: GroupNewSessionSource) => void>();
		const onToggle = vi.fn<() => void>();
		render(
			// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in for the section's toggle row
			<div data-group-toggle="" onClick={onToggle}>
				<GroupNewSessionButton groupLabel="claude-code-plans" onNewSession={onNewSession} />
			</div>,
		);

		fireEvent.click(screen.getByRole("button"));

		expect({newSession: onNewSession.mock.calls, toggled: onToggle.mock.calls}).toStrictEqual({
			newSession: [["plus_button"]],
			toggled: [],
		});
	});
});
