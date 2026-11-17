// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {AdvisorDialog} from "../src/components/advisor-dialog";

afterEach(cleanup);

function setup(current: string | null | undefined)
{
	const onApply = vi.fn<(option: string) => void>();
	const onClose = vi.fn<() => void>();
	render(<AdvisorDialog current={current} onApply={onApply} onClose={onClose} />);
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
			name: "Advisor model",
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

describe("AdvisorDialog", () =>
{
	it("shows upstream's title, description and buttons, and an unknown value as a placeholder with Apply disabled", async () =>
	{
		setup(undefined);
		expect(await view()).toStrictEqual(
			{
				title: "Advisor",
				description: "Let Claude consult a stronger model at key moments.",
				value: "Choose a model",
				applyDisabled: true,
				buttons: ["Cancel", "Apply"],
				selectPad: "pt-2",
			},
		);
	});

	it("selects the session's current advisor: null as Off, a model id by its family", async () =>
	{
		const values: (string | null | undefined)[] = [];
		for (const current of [null, "claude-opus-5-5", "claude-haiku-4-5"])
		{
			const {unmount} = render(
				<AdvisorDialog
					current={current}
					onApply={() =>
					{
					}}
					onClose={() =>
					{
					}}
				/>,
			);
			values.push((await view()).value);
			unmount();
		}
		expect(values).toStrictEqual(["Off", "Opus", "Choose a model"]);
	});

	it("enables Apply after a pick from unknown, and applies the picked option once", async () =>
	{
		const {onApply, onClose} = setup(undefined);
		await pick("Sonnet");
		const enabled = !(await view()).applyDisabled;
		clickButton("Apply");
		expect(
			{
				enabled,
				applied: onApply.mock.calls,
				closed: onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				enabled: true,
				applied: [["sonnet"]],
				closed: 1,
			},
		);
	});

	it("applies an unchanged value, and Cancel closes without applying", async () =>
	{
		const applied = setup("claude-fable-5-1");
		await view();
		clickButton("Apply");
		cleanup();
		const cancelled = setup("claude-fable-5-1");
		await view();
		clickButton("Cancel");
		expect(
			{
				applied: applied.onApply.mock.calls,
				cancelApplied: cancelled.onApply.mock.calls,
				cancelClosed: cancelled.onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				applied: [["fable"]],
				cancelApplied: [],
				cancelClosed: 1,
			},
		);
	});
});
