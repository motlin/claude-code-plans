// @vitest-environment jsdom

import {Dialog} from "@base-ui/react/dialog";
import {act, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {DIALOG_BAND_BODY_CLASS, GHOST_ICON_BUTTON, useTallWindowRef} from "../src/components/ui/dialog-band";
import {DialogHeader} from "../src/components/ui/dialog-header";
import {PanelsOff} from "./fizzy-lake-off";
import {mockTallWindow} from "./tall-window";

let restore: (() => void) | undefined;
afterEach(() => {
	restore?.();
	restore = undefined;
});

function inDialog(children: ReactNode) {
	return (
		<Dialog.Root open>
			<Dialog.Portal>
				<Dialog.Popup>
					<div>{children}</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function band(): HTMLElement {
	const element = document.querySelector<HTMLElement>("[data-cds-part=band]");
	if (element === null) throw new Error("no band");
	return element;
}

const BAND_CLASSES = [
	"-mx-4",
	"first:-mt-4",
	"mb-1",
	"flex",
	"shrink-0",
	"items-center",
	"gap-1",
	"self-stretch",
	"justify-self-stretch",
	"min-h-12",
	"panels-fine:min-h-11",
	"ps-4",
	"pe-2",
	"py-2",
	"sticky",
	"[:where([data-cds-tall-window])_&]:-top-4",
	"z-[1000]",
	"bg-page",
	"after:pointer-events-none",
	"after:absolute",
	"after:inset-x-0",
	"after:bottom-0",
	"[:where([data-cds-tall-window])_&]:after:border-b",
	"after:border-[color:var(--color-border-line)]",
	"supports-[animation-timeline:scroll()]:after:opacity-0",
	"supports-[animation-timeline:scroll()]:after:[animation-name:sc-sticky-edge]",
	"after:[animation-timing-function:linear]",
	"after:[animation-fill-mode:both]",
	"after:[animation-duration:auto]",
	"after:[animation-timeline:--sc-dialog-scroll]",
	"after:[animation-range:0px_4px]",
];

describe("DialogHeader under panels (upstream JH → aj when qF)", () => {
	it("renders the sticky band with the title and a 28/32px ghost close", async () => {
		render(inDialog(<DialogHeader title="Edit sidebar" />));
		await screen.findByRole("dialog");
		const element = band();
		const close = screen.getByRole("button", {name: "Close"});
		expect({
			classes: element.className.split(" "),
			children: [...element.children].map((child) => child.tagName),
			title: element.querySelector("h2")?.className,
			close: close.className,
			icon: close.querySelector("svg")?.getAttribute("class"),
			sibling: element.nextElementSibling,
		}).toStrictEqual({
			classes: BAND_CLASSES,
			children: ["H2", "BUTTON"],
			title: "pointer-events-auto min-w-0 flex-1 last:me-2 text-[15px]/[20px] font-[520] break-words text-primary",
			close: `${GHOST_ICON_BUTTON} pointer-events-auto self-start aspect-square size-8 panels-fine:size-7 rounded-r6`,
			icon: "lucide lucide-x h-5 w-5",
			sibling: null,
		});
	});

	it("puts the description under the band", async () => {
		render(inDialog(<DialogHeader title="t" description="d" />));
		await screen.findByRole("dialog");
		const sibling = band().nextElementSibling;
		expect({tag: sibling?.tagName, classes: sibling?.className, text: sibling?.textContent}).toStrictEqual({
			tag: "P",
			classes: "text-body font-normal text-secondary break-words mb-4",
			text: "d",
		});
	});

	it("omits the close and renders actions between the title and the close", async () => {
		const {unmount} = render(inDialog(<DialogHeader title="t" showClose={false} />));
		await screen.findByRole("dialog");
		const withoutClose = [...band().children].map((child) => child.tagName);
		unmount();
		render(inDialog(<DialogHeader title="t" actions={<button type="button">A</button>} />));
		await screen.findByRole("dialog");
		const actions = band().children[1];
		expect({
			withoutClose,
			withActions: [...band().children].map((child) => child.tagName),
			actions: actions?.className,
		}).toStrictEqual({
			withoutClose: ["H2"],
			withActions: ["H2", "DIV", "BUTTON"],
			actions: "pointer-events-auto self-start flex items-center",
		});
	});
});

describe("DialogHeader with panels off (upstream JH flag-off)", () => {
	it("renders the flag-off header with a flush 32px close", async () => {
		render(<PanelsOff>{inDialog(<DialogHeader title="t" description="d" />)}</PanelsOff>);
		await screen.findByRole("dialog");
		const title = screen.getByRole("heading", {name: "t"});
		const column = title.parentElement;
		const header = column?.parentElement;
		const close = screen.getByRole("button", {name: "Close"});
		expect({
			band: document.querySelector("[data-cds-part=band]"),
			header: header?.className,
			column: column?.className,
			title: title.className,
			description: column?.querySelector("p")?.className,
			close: close.className,
			closeParent: close.parentElement === header,
		}).toStrictEqual({
			band: null,
			header: "mb-3 flex items-start gap-2",
			column: "-mt-1 flex min-w-0 flex-1 flex-col gap-1",
			title: "text-[22px]/[28px] font-[580] break-words text-primary",
			description: "text-body font-normal text-secondary break-words",
			close: `-me-2 -mt-2 flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus`,
			closeParent: true,
		});
	});

	it("takes the dialog's own flag-off title and header classes and drops the close", async () => {
		render(
			<PanelsOff>
				{inDialog(
					<DialogHeader
						title="t"
						showClose={false}
						offHeaderClassName="mb-4 flex items-start gap-2"
						offTitleClassName="text-[17px] leading-6 font-semibold break-words text-primary"
					/>,
				)}
			</PanelsOff>,
		);
		await screen.findByRole("dialog");
		const title = screen.getByRole("heading", {name: "t"});
		expect({
			header: title.parentElement?.parentElement?.className,
			title: title.className,
			close: screen.queryByRole("button", {name: "Close"}),
		}).toStrictEqual({
			header: "mb-4 flex items-start gap-2",
			title: "text-[17px] leading-6 font-semibold break-words text-primary",
			close: null,
		});
	});
});

describe("DIALOG_BAND_BODY_CLASS (upstream JK)", () => {
	it("hoists the scroll timeline, hides the top fade under a band and pads scrolling in a tall window", () => {
		expect(DIALOG_BAND_BODY_CLASS).toBe(
			"[scroll-timeline:--sc-dialog-scroll_block] [:where([data-cds-tall-window])_&]:has-[[data-cds-part=band]]:scroll-fade-hide-top [:where([data-cds-tall-window])_&]:scroll-pt-[56px] panels-fine:[:where([data-cds-tall-window])_&]:scroll-pt-[52px]",
		);
	});
});

function TallProbe() {
	return <div data-testid="probe" ref={useTallWindowRef()} />;
}

describe("useTallWindowRef (upstream An)", () => {
	it("toggles data-cds-tall-window with (min-height: 30rem)", () => {
		const media = mockTallWindow(true);
		restore = media.restore;
		render(<TallProbe />);
		const probe = screen.getByTestId("probe");
		const states = [probe.hasAttribute("data-cds-tall-window")];
		act(() => {
			media.setMatches(false);
		});
		states.push(probe.hasAttribute("data-cds-tall-window"));
		expect({states, value: (media.setMatches(true), probe.getAttribute("data-cds-tall-window"))}).toStrictEqual({
			states: [true, false],
			value: "",
		});
	});
});
