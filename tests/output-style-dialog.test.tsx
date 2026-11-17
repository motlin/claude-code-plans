// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {OutputStyleDialog} from "../src/components/output-style-dialog";
import type {OutputStyleItem} from "../src/lib/output-style-options";

afterEach(cleanup);

const ITEMS: OutputStyleItem[] = [
	{
		name: "default",
		label: "Default",
		checked: false,
	},
	{
		name: "Learning",
		label: "Learning",
		checked: true,
	},
	{
		name: "Terse",
		label: "Terse",
		checked: false,
	},
];

function setup(items: OutputStyleItem[])
{
	const onApply = vi.fn<(name: string) => void>();
	const onClose = vi.fn<() => void>();
	render(<OutputStyleDialog items={items} onApply={onApply} onClose={onClose} />);
	return {
		onApply,
		onClose,
	};
}

async function view()
{
	const popup = await screen.findByRole("alertdialog");
	const select = screen.getByRole(
		"combobox",
		{
			name: "Output style",
		},
	);
	const apply = screen.getByRole(
		"button",
		{
			name: "Apply",
		},
	);
	return {
		title: popup.querySelector("h2")?.textContent,
		description: popup.querySelector("p")?.textContent,
		value: select.textContent,
		applyDisabled: apply.hasAttribute("disabled"),
		buttons: Array.from(popup.querySelectorAll("button"))
			.filter((button) => button.getAttribute("role") !== "combobox")
			.map((button) => button.textContent),
		selectPad: select.closest("[data-cds='Combobox']")?.parentElement?.parentElement?.className,
	};
}

async function pick(label: string)
{
	await act(async () =>
	{
		fireEvent.click(screen.getByRole("combobox"));
		await Promise.resolve();
	});
	const option = await screen.findByRole(
		"option",
		{
			name: label,
			hidden: true,
		},
	);
	await act(async () =>
	{
		fireEvent.pointerDown(
			option,
			{
				pointerType: "mouse",
			},
		);
		fireEvent.click(option);
		await Promise.resolve();
	});
}

function clickButton(name: string)
{
	fireEvent.click(
		screen.getByRole(
			"button",
			{
				name,
			},
		),
	);
}

describe("OutputStyleDialog", () =>
{
	it("shows upstream's title, description and buttons with the session's style selected", async () =>
	{
		setup(ITEMS);
		expect(await view()).toStrictEqual(
			{
				title: "Output style",
				description: "Applies to this session only.",
				value: "Learning",
				applyDisabled: false,
				buttons: ["Cancel", "Apply"],
				selectPad: "pt-2",
			},
		);
	});

	it("shows the placeholder with Apply disabled when there are no styles", async () =>
	{
		setup([]);
		const {value, applyDisabled} = await view();
		expect(
			{
				value,
				applyDisabled,
			},
		).toStrictEqual(
			{
				value: "Choose a style",
				applyDisabled: true,
			},
		);
	});

	it("applies a picked style once and closes", async () =>
	{
		const {onApply, onClose} = setup(ITEMS);
		await pick("Terse");
		clickButton("Apply");
		expect(
			{
				applied: onApply.mock.calls,
				closed: onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				applied: [["Terse"]],
				closed: 1,
			},
		);
	});

	it("closes without applying for the current style or Cancel", async () =>
	{
		const unchanged = setup(ITEMS);
		await view();
		clickButton("Apply");
		cleanup();
		const cancelled = setup(ITEMS);
		await view();
		clickButton("Cancel");
		expect(
			{
				unchangedApplied: unchanged.onApply.mock.calls,
				unchangedClosed: unchanged.onClose.mock.calls.length,
				cancelApplied: cancelled.onApply.mock.calls,
				cancelClosed: cancelled.onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				unchangedApplied: [],
				unchangedClosed: 1,
				cancelApplied: [],
				cancelClosed: 1,
			},
		);
	});
});
