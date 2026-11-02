// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {Select} from "../src/components/ui/select";

afterEach(cleanup);

const ITEMS = [
	{
		value: "a",
		label: "Alpha",
	},
	{
		value: "b",
		label: "Beta",
	},
] as const;

describe("Select", () =>
{
	it("sizes the trigger and rows at upstream's 28px panels control height on a fine pointer, 32px otherwise", async () =>
	{
		render(
			<Select
				label="Letter"
				items={ITEMS}
				value="a"
				onChange={() =>
				{
				}}
			/>,
		);
		const trigger = screen.getByRole("combobox");
		const control = trigger.closest("[data-cds='Combobox']");
		await act(async () =>
		{
			fireEvent.click(trigger);
			await Promise.resolve();
		});
		const option = (
			await screen.findAllByRole(
				"option",
				{
					hidden: true,
				},
			)
		)[0];
		const heights = (className: string | undefined) =>
			(className ?? "").split(" ").filter((name) => /^(min-)?h-|^panels-fine:(min-)?h-/.test(name));
		expect(
			{
				control: heights(control?.className),
				item: heights(option?.className),
			},
		).toStrictEqual(
			{
				control: ["h-8", "panels-fine:h-7"],
				item: ["min-h-8", "panels-fine:min-h-7"],
			},
		);
	});

	it("nests the listbox in upstream's FC gutter and wI scroller, which owns scroll-fade-y", async () =>
	{
		render(
			<Select
				label="Letter"
				items={ITEMS}
				value="a"
				onChange={() =>
				{
				}}
			/>,
		);
		await act(async () =>
		{
			fireEvent.click(screen.getByRole("combobox"));
			await Promise.resolve();
		});
		const listbox = await screen.findByRole(
			"listbox",
			{
				hidden: true,
			},
		);
		const scroller = listbox.parentElement;
		expect(
			{
				listbox: listbox.className,
				scroller:
				{
					marker: scroller?.getAttribute("data-cds-sheet-scroll"),
					className: scroller?.className,
				},
				gutter: scroller?.parentElement?.className,
			},
		).toStrictEqual(
			{
				listbox: "outline-none focus-visible:outline-hidden",
				scroller:
				{
					marker: "",
					className:
						"min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-fade-y outline-none focus-visible:outline-hidden max-h-[var(--cds-popup-list-max-h,none)]",
				},
				gutter: "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit] p-1",
			},
		);
	});
});
