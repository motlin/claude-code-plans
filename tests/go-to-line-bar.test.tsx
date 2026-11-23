// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {GoToLineBar} from "../src/components/files/go-to-line-bar";

afterEach(() =>
{
	cleanup();
});

function renderBar()
{
	const onGo = vi.fn<(line: number, column: number | undefined) => void>();
	const onClose = vi.fn<(refocus: boolean) => void>();
	render(
		<GoToLineBar
			caret={
			{
				line: 4,
				lines: 30,
			}}
			onGo={onGo}
			onClose={onClose}
		/>,
	);
	const input = screen.getByRole<HTMLInputElement>(
		"textbox",
		{
			name: "Go to line",
		},
	);
	const status = () => document.querySelector("[aria-live=polite]")?.textContent;
	return {
		onGo,
		onClose,
		input,
		status,
	};
}

describe("GoToLineBar", () =>
{
	it("focuses the input, shows the caret line, and flags invalid input with the valid range", () =>
	{
		const {input, status} = renderBar();
		const initial =
		{
			focused: document.activeElement === input,
			placeholder: input.placeholder,
			status: status(),
		};
		fireEvent.change(
			input,
			{
				target:
				{
					value: "abc",
				},
			},
		);
		expect(
			{
				initial,
				invalid: status(),
				fieldInvalid: input.closest("[data-cds=Field]")?.hasAttribute("data-invalid"),
				close: attributes(
					screen.getByRole(
						"button",
						{
							name: "Close go to line bar",
						},
					),
				),
				root: document.querySelector("[data-pane-editor]")?.className,
				toolbar: toolbarShape(),
			},
		).toStrictEqual(
			{
				initial:
				{
					focused: true,
					placeholder: "Line, or line:column",
					status: "Line 4 of 30",
				},
				invalid: "Type a line number from 1 to 30",
				fieldInvalid: true,
				close:
				{
					"aria-keyshortcuts": "Escape",
				},
				root: "epitaxy-panel-subheader shrink-0 bg-alpha-1",
				toolbar:
				{
					inPaneEditor: true,
					cds: "Toolbar",
					closeIsDirectChild: true,
					closeCds: ["Button", "", ""],
				},
			},
		);
	});

	it("goes on Enter and closes with refocus on Escape", () =>
	{
		const {input, onGo, onClose} = renderBar();
		fireEvent.change(
			input,
			{
				target:
				{
					value: "5",
				},
			},
		);
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
			},
		);
		fireEvent.change(
			input,
			{
				target:
				{
					value: "6:2",
				},
			},
		);
		fireEvent.keyDown(
			input,
			{
				key: "Enter",
			},
		);
		fireEvent.keyDown(
			input,
			{
				key: "Escape",
			},
		);
		expect([onGo.mock.calls, onClose.mock.calls]).toStrictEqual([
			[
				[5, undefined],
				[6, 2],
			],
			[[true]],
		]);
	});

	it("closes without refocus when focus leaves the bar", () =>
	{
		const {input, onClose} = renderBar();
		fireEvent.blur(
			input,
			{
				relatedTarget: document.body,
			},
		);
		expect(onClose.mock.calls).toStrictEqual([[false]]);
	});
});

function toolbarShape()
{
	const toolbar = screen.getByRole(
		"toolbar",
		{
			name: "Go to line controls",
		},
	);
	const close = screen.getByRole(
		"button",
		{
			name: "Close go to line bar",
		},
	);
	return {
		inPaneEditor: toolbar.parentElement?.hasAttribute("data-pane-editor"),
		cds: toolbar.dataset["cds"],
		closeIsDirectChild: close.parentElement === toolbar,
		closeCds: [
			close.dataset["cds"],
			close.getAttribute("data-cds-ghost"),
			close.getAttribute("data-cds-icon-only"),
		],
	};
}

function attributes(element: Element): Record<string, string | null>
{
	return {
		"aria-keyshortcuts": element.getAttribute("aria-keyshortcuts"),
	};
}
