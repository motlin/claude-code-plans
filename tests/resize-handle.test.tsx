// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ResizeHandle} from "../src/components/ui/resize-handle";
import {RESIZE_GRIP_PILL, RESIZE_LINE_PILL} from "../src/components/ui/resize-pill";
import {PanelsOff} from "./fizzy-lake-off";

function sortedClasses(element: Element | null | undefined): string[] {
	return [...(element?.classList ?? [])].toSorted();
}

function split(...parts: string[]): string[] {
	return parts.join(" ").split(" ").toSorted();
}

function renderHandle(props: Partial<Parameters<typeof ResizeHandle>[0]> = {}) {
	const calls: unknown[][] = [];
	render(
		<ResizeHandle
			aria-label="Resize file tree"
			side="inline-end"
			onBorder
			onResizeStart={() => calls.push(["start"])}
			onResize={(delta) => calls.push(["resize", delta])}
			onResizeEnd={(moved) => calls.push(["end", moved])}
			{...props}
		/>,
	);
	const handle = screen.getByRole("separator", {name: "Resize file tree"});
	const [ring, pill] = [...handle.children];
	return {calls, handle, ring, pill};
}

describe("ResizeHandle", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	});

	it("renders upstream's cds root for side=inline-end onBorder", () => {
		const {handle} = renderHandle();
		expect({
			cds: handle.dataset["cds"],
			orientation: handle.getAttribute("aria-orientation"),
			tabIndex: handle.tabIndex,
			dragging: handle.dataset["dragging"],
			classes: sortedClasses(handle),
			ringOuter: handle.style.getPropertyValue("--cds-ring-outer"),
			ringInner: handle.style.getPropertyValue("--cds-ring-inner"),
		}).toStrictEqual({
			cds: "ResizeHandle",
			orientation: "vertical",
			tabIndex: 0,
			dragging: undefined,
			classes: split(
				"cds-reset group/resize outline-none focus-visible:outline-hidden w-3 cursor-col-resize absolute inset-y-0 end-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)]",
			),
			ringOuter: "1px",
			ringInner: "0px",
		});
	});

	it("renders relative h-full with no side and no ring overrides without onBorder", () => {
		const {handle} = renderHandle({side: undefined, onBorder: false});
		expect({classes: sortedClasses(handle), style: handle.getAttribute("style")}).toStrictEqual({
			classes: split(
				"cds-reset group/resize outline-none focus-visible:outline-hidden w-3 cursor-col-resize relative h-full",
			),
			style: null,
		});
	});

	it("draws the focus-ring sibling first", () => {
		const {ring} = renderHandle();
		expect({hidden: ring?.getAttribute("aria-hidden"), classes: sortedClasses(ring)}).toStrictEqual({
			hidden: "true",
			classes: split(
				"absolute rounded-full transition-shadow duration-[60ms] group-focus-visible/resize:shadow-focus inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize",
			),
		});
	});

	it("swaps the line pill to its dragging state while a drag runs, locking the body cursor", () => {
		const {handle, pill, calls} = renderHandle();
		const resting = sortedClasses(pill);

		fireEvent.pointerDown(handle, {button: 0, clientX: 100, pointerId: 1});
		const during = {
			dragging: handle.dataset["dragging"],
			pill: sortedClasses(pill),
			cursor: document.body.style.cursor,
			userSelect: document.body.style.userSelect,
		};
		fireEvent.pointerMove(document, {clientX: 102, pointerId: 1});
		fireEvent.pointerMove(document, {clientX: 140, pointerId: 1});
		fireEvent.pointerUp(document, {clientX: 140, pointerId: 1});

		expect({
			part: pill?.getAttribute("data-cds-part"),
			resting,
			during,
			after: {
				dragging: handle.dataset["dragging"],
				pill: sortedClasses(pill),
				cursor: document.body.style.cursor,
				userSelect: document.body.style.userSelect,
			},
			calls,
		}).toStrictEqual({
			part: "resize-pill",
			resting: split(
				RESIZE_LINE_PILL.base,
				RESIZE_LINE_PILL.vertical,
				RESIZE_LINE_PILL.resting,
				RESIZE_LINE_PILL.focus,
			),
			during: {
				dragging: "",
				pill: split(
					RESIZE_LINE_PILL.base,
					RESIZE_LINE_PILL.vertical,
					RESIZE_LINE_PILL.dragging,
					RESIZE_LINE_PILL.focus,
				),
				cursor: "col-resize",
				userSelect: "none",
			},
			after: {dragging: undefined, pill: resting, cursor: "", userSelect: ""},
			calls: [["start"], ["resize", 2], ["resize", 40], ["end", true]],
		});
	});

	it("reports a press that never travels past 3px as unmoved", () => {
		const {handle, calls} = renderHandle();
		fireEvent.pointerDown(handle, {button: 0, clientX: 100, pointerId: 1});
		fireEvent.pointerMove(document, {clientX: 103, pointerId: 1});
		fireEvent.pointerUp(document, {clientX: 103, pointerId: 1});
		expect(calls).toStrictEqual([["start"], ["resize", 3], ["end", false]]);
	});

	it("steps 8px with the arrows and 32px with Shift, each a full start/resize/end cycle", () => {
		const {handle, calls} = renderHandle();
		fireEvent.keyDown(handle, {key: "ArrowRight"});
		fireEvent.keyDown(handle, {key: "ArrowRight", shiftKey: true});
		fireEvent.keyDown(handle, {key: "ArrowLeft"});
		fireEvent.keyDown(handle, {key: "ArrowLeft", metaKey: true});
		fireEvent.keyDown(handle, {key: "ArrowUp"});
		expect(calls).toStrictEqual([
			["start"],
			["resize", 8],
			["end", true],
			["start"],
			["resize", 32],
			["end", true],
			["start"],
			["resize", -8],
			["end", true],
		]);
	});

	it("treats Enter and Space as a click, ignoring repeats", () => {
		const {handle, calls} = renderHandle();
		fireEvent.keyDown(handle, {key: "Enter"});
		fireEvent.keyDown(handle, {key: " "});
		fireEvent.keyDown(handle, {key: "Enter", repeat: true});
		fireEvent.keyDown(handle, {key: "Enter", shiftKey: true});
		expect(calls).toStrictEqual([["start"], ["end", false], ["start"], ["end", false]]);
	});

	it("runs the host's onKeyDown after its own keys", () => {
		const keys: string[] = [];
		const {handle, calls} = renderHandle({onKeyDown: (event) => keys.push(event.key)});
		fireEvent.keyDown(handle, {key: "Home"});
		fireEvent.keyDown(handle, {key: "ArrowRight"});
		expect({keys, calls}).toStrictEqual({
			keys: ["Home", "ArrowRight"],
			calls: [["start"], ["resize", 8], ["end", true]],
		});
	});

	it("uses the grip pill when panels is off", () => {
		render(
			<PanelsOff>
				<ResizeHandle aria-label="Resize file tree" onResize={() => undefined} />
			</PanelsOff>,
		);
		const pill = screen.getByRole("separator").lastElementChild;
		expect(sortedClasses(pill)).toStrictEqual(
			split(RESIZE_GRIP_PILL.base, RESIZE_GRIP_PILL.vertical, RESIZE_GRIP_PILL.resting, RESIZE_GRIP_PILL.focus),
		);
	});
});
