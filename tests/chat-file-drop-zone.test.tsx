// @vitest-environment jsdom
import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ChatDropOverlayBadge, ChatFileDropZone} from "../src/components/chat-file-drop-zone";

const png = new File([new Uint8Array([1])], "dropped.png", {type: "image/png"});
const files = () => ({dataTransfer: {types: ["Files"], files: [png], items: [], dropEffect: "none"}});
const text = () => ({dataTransfer: {types: ["text/plain"], files: [], items: [], dropEffect: "none"}});

const onDrop = vi.fn<(files: readonly File[]) => void>();

afterEach(() => {
	cleanup();
	onDrop.mockReset();
});

function Harness({disabled = false}: {disabled?: boolean}) {
	return (
		<>
			<ChatFileDropZone onDrop={onDrop} disabled={disabled} className="x">
				<p data-testid="child" />
			</ChatFileDropZone>
			<aside data-testid="side" />
		</>
	);
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const badge = () => document.querySelector(".dframe-drop-overlay-badge");
const zone = () => byTestId("child").parentElement!;

describe("ChatDropOverlayBadge", () => {
	it("renders upstream's badge (shared-41 dZ) with the Drop files here pill at z 40", () => {
		const {container} = render(<ChatDropOverlayBadge />);
		const root = container.firstElementChild as HTMLElement;
		const label = root.firstElementChild as HTMLElement;
		expect({
			tag: root.tagName,
			ariaHidden: root.getAttribute("aria-hidden"),
			className: root.className,
			zIndex: root.style.zIndex,
			children: root.children.length,
			label: {tag: label.tagName, className: label.className, text: label.textContent},
		}).toStrictEqual({
			tag: "DIV",
			ariaHidden: "true",
			className:
				"dframe-drop-overlay-badge inset-0 motion-safe:animate-[cds-fade-in_0.2s_cubic-bezier(0.165,0.84,0.44,1)] start-[calc(8px-var(--tiles-padding,0px))] [[data-chat-gutter-start=shave]_&]:start-2 end-[calc(8px-var(--tiles-padding,0px))] [[data-chat-gutter-end]:not([data-pane-overlay])_&]:end-2 [[data-pane-overlay]_&]:end-[calc(8px-var(--epitaxy-overlay-rail-titlebar-shift,0px))] -bottom-[var(--tiles-padding,0px)] my-2 rounded-[var(--df-radius-card,8px)] [[data-tile-overflow-anchor=left]_&]:mr-[max(0px,var(--tile-overflow-min,0px)_-_100cqw)] [[data-tile-overflow-anchor=right]_&]:ml-[max(0px,var(--tile-overflow-min,0px)_-_100cqw)]",
			zIndex: "40",
			children: 1,
			label: {tag: "SPAN", className: "dframe-drop-overlay-label", text: "Drop files here"},
		});
	});
});

describe("ChatFileDropZone", () => {
	it("wraps its children in a relative div and claims a Files drag, appending the badge last", () => {
		render(<Harness />);
		const notPrevented = fireEvent.dragEnter(byTestId("child"), files());
		expect({
			notPrevented,
			className: zone().className,
			children: Array.from(
				zone().children,
				(node) => node.getAttribute("data-testid") ?? node.className.split(" ")[0],
			),
		}).toStrictEqual({
			notPrevented: false,
			className: "relative x",
			children: ["child", "dframe-drop-overlay-badge"],
		});
	});

	it("sets a copy dropEffect on dragover", () => {
		render(<Harness />);
		const init = files();
		fireEvent.dragEnter(byTestId("child"), init);
		const notPrevented = fireEvent.dragOver(byTestId("child"), init);
		expect({notPrevented, dropEffect: init.dataTransfer.dropEffect}).toStrictEqual({
			notPrevented: false,
			dropEffect: "copy",
		});
	});

	it("leaves drags outside the zone alone", () => {
		render(<Harness />);
		const notPrevented = fireEvent.dragOver(byTestId("side"), files());
		expect({notPrevented, badge: badge()}).toStrictEqual({notPrevented: true, badge: null});
	});

	it("keeps the badge until every entered node has been left", () => {
		render(<Harness />);
		fireEvent.dragEnter(zone(), files());
		fireEvent.dragEnter(byTestId("child"), files());
		fireEvent.dragLeave(zone(), files());
		const afterParentLeave = badge() !== null;
		fireEvent.dragLeave(byTestId("child"), files());
		expect({afterParentLeave, afterChildLeave: badge() !== null}).toStrictEqual({
			afterParentLeave: true,
			afterChildLeave: false,
		});
	});

	it.each([
		{name: "pointerdown", fire: () => fireEvent.pointerDown(document)},
		{name: "dragend", fire: () => fireEvent.dragEnd(document)},
	])("resets on a document $name", ({fire}) => {
		render(<Harness />);
		fireEvent.dragEnter(byTestId("child"), files());
		const shown = badge() !== null;
		fire();
		expect({shown, after: badge()}).toStrictEqual({shown: true, after: null});
	});

	it("drops the files, swallowing the event and clearing the badge", () => {
		render(<Harness />);
		fireEvent.dragEnter(byTestId("child"), files());
		const notPrevented = fireEvent.drop(byTestId("child"), files());
		expect({notPrevented, calls: onDrop.mock.calls, badge: badge()}).toStrictEqual({
			notPrevented: false,
			calls: [[[png]]],
			badge: null,
		});
	});

	it("still claims and swallows a drop while disabled, but shows nothing and attaches nothing", () => {
		render(<Harness disabled />);
		const init = files();
		const enterNotPrevented = fireEvent.dragEnter(byTestId("child"), init);
		fireEvent.dragOver(byTestId("child"), init);
		const shown = badge();
		const dropNotPrevented = fireEvent.drop(byTestId("child"), files());
		expect({
			enterNotPrevented,
			dropEffect: init.dataTransfer.dropEffect,
			shown,
			dropNotPrevented,
			calls: onDrop.mock.calls,
		}).toStrictEqual({
			enterNotPrevented: false,
			dropEffect: "none",
			shown: null,
			dropNotPrevented: false,
			calls: [],
		});
	});

	it("ignores drags without files", () => {
		render(<Harness />);
		const enter = fireEvent.dragEnter(byTestId("child"), text());
		const over = fireEvent.dragOver(byTestId("child"), text());
		const drop = fireEvent.drop(byTestId("child"), text());
		expect({enter, over, drop, badge: badge(), calls: onDrop.mock.calls}).toStrictEqual({
			enter: true,
			over: true,
			drop: true,
			badge: null,
			calls: [],
		});
	});
});
