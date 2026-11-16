// @vitest-environment jsdom

import {cleanup, createEvent, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SaveErrorBanner} from "../src/components/files/save-error-banner";
import {cdsButtonClass} from "../src/components/ui/cds-button";
import type {SaveError} from "../src/lib/source-save";

afterEach(cleanup);

const ROOT_CLASS = "shrink-0 ps-md pe-sm py-sm bg-alpha-2 flex flex-wrap items-center gap-1";

function renderBanner(
	error: SaveError,
	extra:
	{
		busy?: boolean;
		inPaneHeaderLine?: boolean;
	} = {},
): HTMLElement
{
	render(
		<SaveErrorBanner
			error={error}
			busy={extra.busy ?? false}
			inPaneHeaderLine={extra.inPaneHeaderLine ?? false}
			onDiscard={vi.fn<() => void>()}
			onRetry={vi.fn<() => void>()}
		/>,
	);
	return screen.getByRole("alert");
}

function describeBanner(alert: HTMLElement)
{
	return {
		text: alert.querySelector("span")?.textContent,
		buttons: [...alert.querySelectorAll("button")].map((button) => [button.textContent, button.className]),
		dataKind: alert.dataset["saveError"],
		className: alert.className,
	};
}

describe("SaveErrorBanner", () =>
{
	it("renders upstream's copy and buttons for each kind", () =>
	{
		const errors: SaveError[] = [
			{
				kind: "writeFailed",
				etag: '"1"',
			},
			{
				kind: "conflict",
				etag: '"2"',
			},
			{
				kind: "missing",
			},
			{
				kind: "denied",
			},
		];
		const ghost = cdsButtonClass("ghost");
		const secondary = cdsButtonClass("secondary");
		expect(
			errors.map((error) =>
			{
				const described = describeBanner(renderBanner(error));
				cleanup();
				return described;
			}),
		).toStrictEqual([
			{
				text: "Couldn’t save this file.",
				buttons: [
					["Discard", ghost],
					["Try again", secondary],
				],
				dataKind: "writeFailed",
				className: ROOT_CLASS,
			},
			{
				text: "This file changed on disk since you started editing.",
				buttons: [
					["Discard", ghost],
					["Override", secondary],
				],
				dataKind: "conflict",
				className: ROOT_CLASS,
			},
			{
				text: "This file was deleted on disk since you started editing.",
				buttons: [
					["Discard", ghost],
					["Save anyway", secondary],
				],
				dataKind: "missing",
				className: ROOT_CLASS,
			},
			{
				text: "This file can’t be saved. Its path is outside the working directory, or this is a remote session.",
				buttons: [["Discard", ghost]],
				dataKind: "denied",
				className: ROOT_CLASS,
			},
		]);
	});

	it("insets the start padding to the pane header text inside a pane header line", () =>
	{
		const alert = renderBanner(
			{
				kind: "missing",
			},
			{
				inPaneHeaderLine: true,
			},
		);
		expect(alert.className).toBe(
			"shrink-0 pe-sm py-sm bg-alpha-2 flex flex-wrap items-center gap-1 ps-[calc(1.25rem*var(--cds-rem-scale,1))]",
		);
	});

	it("disables both buttons while a save is in flight", () =>
	{
		const alert = renderBanner(
			{
				kind: "conflict",
				etag: null,
			},
			{
				busy: true,
			},
		);
		expect(
			{
				disabled: [...alert.querySelectorAll("button")].map((button) => button.disabled),
				span: alert.querySelector("span")?.className,
				group: alert.querySelector("div")?.className,
			},
		).toStrictEqual(
			{
				disabled: [true, true],
				span: "grow basis-40 text-body text-primary",
				group: "ms-auto flex flex-wrap justify-end gap-1",
			},
		);
	});

	it("keeps the editor's focus on button mousedown", () =>
	{
		renderBanner(
			{
				kind: "conflict",
				etag: null,
			},
		);
		const prevented = ["Discard", "Override"].map((name) =>
		{
			const button = screen.getByRole(
				"button",
				{
					name,
				},
			);
			const mouseDown = createEvent.mouseDown(button);
			fireEvent(button, mouseDown);
			return mouseDown.defaultPrevented;
		});
		expect(prevented).toStrictEqual([true, true]);
	});
});
