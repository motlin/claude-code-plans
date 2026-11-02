// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {WorktreeToggleChip} from "../src/components/home/worktree-toggle-chip";

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

function renderChip(
	props:
	{
		on?: boolean;
		pending?: boolean;
	} = {},
)
{
	const onChange = vi.fn<(on: boolean) => void>();
	const onPressed = vi.fn<() => void>();
	const {container} = render(
		<WorktreeToggleChip
			on={props.on ?? false}
			pending={props.pending ?? false}
			onChange={onChange}
			onPressed={onPressed}
		/>,
	);
	return {
		container,
		onChange,
		onPressed,
		toggle: screen.getByTestId("environment-bar-worktree-toggle"),
	};
}

describe("WorktreeToggleChip", () =>
{
	it("renders upstream's hit-row chip: an xxs switch labelled Worktree and described by its hidden detail", () =>
	{
		const {container, toggle} = renderChip();
		const row = container.firstElementChild!;
		const label = document.getElementById(toggle.getAttribute("aria-labelledby") ?? "");
		const description = document.getElementById(toggle.getAttribute("aria-describedby") ?? "");

		expect(
			{
				row:
				{
					tag: row.tagName,
					role: row.getAttribute("role"),
					className: row.className,
				},
				toggle:
				{
					role: toggle.getAttribute("role"),
					checked: toggle.getAttribute("aria-checked"),
					size: toggle.getAttribute("data-size"),
					focusable: toggle.tabIndex,
					hitRow: toggle.classList.contains("hit-row-main"),
				},
				label:
				{
					className: label?.className,
					text: label?.textContent,
				},
				description:
				{
					hidden: description?.hidden,
					text: description?.textContent,
				},
			},
		).toStrictEqual(
			{
				row:
				{
					tag: "SPAN",
					role: "presentation",
					className: "hit-row flex h-control items-center gap-xs px-md text-body font-control-regular",
				},
				toggle:
				{
					role: "switch",
					checked: "false",
					size: "xxs",
					focusable: 0,
					hitRow: true,
				},
				label:
				{
					className: "pointer-events-none text-muted-as-secondary",
					text: "Worktree",
				},
				description:
				{
					hidden: true,
					text: "Work in an isolated copy of the repository",
				},
			},
		);
	});

	it("toggles on a pointer click, then hands focus back to the composer", () =>
	{
		const {onChange, onPressed, toggle} = renderChip();
		fireEvent.click(
			toggle,
			{
				detail: 1,
			},
		);

		expect(
			{
				change: onChange.mock.calls,
				pressed: onPressed.mock.calls.length,
			},
		).toStrictEqual(
			{
				change: [[true]],
				pressed: 1,
			},
		);
	});

	it("toggles on a keyboard (virtual) click but keeps focus on the switch", () =>
	{
		const {onChange, onPressed, toggle} = renderChip(
			{
				on: true,
			},
		);
		fireEvent.click(
			toggle,
			{
				detail: 0,
			},
		);

		expect(
			{
				change: onChange.mock.calls,
				pressed: onPressed.mock.calls.length,
			},
		).toStrictEqual(
			{
				change: [[false]],
				pressed: 0,
			},
		);
	});

	it("ignores clicks while pending, marking the switch busy", () =>
	{
		const {onChange, onPressed, toggle} = renderChip(
			{
				pending: true,
			},
		);
		fireEvent.click(
			toggle,
			{
				detail: 1,
			},
		);

		expect(
			{
				change: onChange.mock.calls,
				pressed: onPressed.mock.calls.length,
				busy: toggle.getAttribute("aria-busy"),
				disabled: toggle.getAttribute("aria-disabled"),
			},
		).toStrictEqual(
			{
				change: [],
				pressed: 0,
				busy: "true",
				disabled: "true",
			},
		);
	});

	it("shows the description as its hover tooltip", () =>
	{
		vi.useFakeTimers();
		const {toggle} = renderChip();
		fireEvent.pointerEnter(
			toggle.parentElement!,
			{
				pointerType: "mouse",
			},
		);
		act(() =>
		{
			vi.advanceTimersByTime(1000);
		});

		expect(screen.getByRole("tooltip").textContent).toBe("Work in an isolated copy of the repository");
	});
});
