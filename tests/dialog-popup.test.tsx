// @vitest-environment jsdom

import {Dialog} from "@base-ui/react/dialog";
import {render, screen} from "@testing-library/react";
import {createRef} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {DialogPopup} from "../src/components/ui/dialog-popup";
import {PanelsOff} from "./fizzy-lake-off";
import {mockTallWindow} from "./tall-window";

let restore: (() => void) | undefined;
afterEach(() =>
{
	restore?.();
	restore = undefined;
});

function popupFor(ref?: React.Ref<HTMLDivElement>, panelsOff = false)
{
	const node = (
		<Dialog.Root open>
			<Dialog.Portal>
				<DialogPopup aria-label="p" className="c" ref={ref}>
					x
				</DialogPopup>
			</Dialog.Portal>
		</Dialog.Root>
	);
	render(panelsOff ? <PanelsOff>{node}</PanelsOff> : node);
}

describe("DialogPopup (upstream styled cds Dialog.Popup js + lZ)", () =>
{
	it("marks the popup data-cds and data-cds-fizzy under panels, tracks the tall window and forwards its ref", async () =>
	{
		restore = mockTallWindow(true).restore;
		const ref = createRef<HTMLDivElement>();
		popupFor(ref);
		const popup = await screen.findByRole(
			"dialog",
			{
				name: "p",
			},
		);
		expect(
			{
				cds: popup.getAttribute("data-cds"),
				fizzy: popup.getAttribute("data-cds-fizzy"),
				tall: popup.getAttribute("data-cds-tall-window"),
				className: popup.className,
				ref: ref.current === popup,
			},
		).toStrictEqual(
			{
				cds: "Dialog",
				fizzy: "",
				tall: "",
				className: "c",
				ref: true,
			},
		);
	});

	it("drops data-cds-fizzy with panels off and the tall-window mark in a short window", async () =>
	{
		restore = mockTallWindow(false).restore;
		popupFor(undefined, true);
		const popup = await screen.findByRole(
			"dialog",
			{
				name: "p",
			},
		);
		expect(
			{
				cds: popup.getAttribute("data-cds"),
				fizzy: popup.getAttribute("data-cds-fizzy"),
				tall: popup.getAttribute("data-cds-tall-window"),
			},
		).toStrictEqual(
			{
				cds: "Dialog",
				fizzy: null,
				tall: null,
			},
		);
	});
});
