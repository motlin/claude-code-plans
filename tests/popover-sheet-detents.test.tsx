// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {Popover, PopoverContent, preloadPopoverSheet} from "../src/components/ui/popover";

/* jsdom serializes upstream's `min(50dvh, calc((100dvh - safe-top) * .9))` and `calc((100dvh - safe-top) * .9)`. */
const HALF = "min(50dvh, 0.9 * (100dvh - env(safe-area-inset-top, 0px)))";
const TALL = "calc(0.9 * (100dvh - env(safe-area-inset-top, 0px)))";

/* The sheet presentation is a lazy chunk; load it once so sheets render synchronously on open. */
beforeAll(async () => {
	await preloadPopoverSheet();
});

beforeEach(() => {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	/* jsdom has no pointer capture; the drag test installs it on the prototype. */
	for (const api of ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"] as const) {
		Reflect.deleteProperty(HTMLElement.prototype, api);
	}
});

function renderSheet(body = <input aria-label="Name" />) {
	render(
		<Popover.Root>
			<Popover.Trigger>Open</Popover.Trigger>
			<PopoverContent>{body}</PopoverContent>
		</Popover.Root>,
	);
	fireEvent.click(screen.getByRole("button", {name: "Open"}));
	return screen.getByRole("dialog");
}

/** A pointer event at `clientY` with a fixed timeStamp, so velocity is deterministic. */
function pointer(target: Element, type: string, clientY: number, timeStamp: number) {
	const event = new MouseEvent(type, {bubbles: true, cancelable: true, button: 0, clientY});
	Object.defineProperty(event, "pointerId", {value: 1});
	Object.defineProperty(event, "timeStamp", {value: timeStamp});
	fireEvent(target, event);
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

describe("popover sheet detents", () => {
	it("floors a sheet holding a text field at half height, as upstream's RH half floor", () => {
		const popup = renderSheet();
		expect({
			detent: popup.getAttribute("data-cds-sheet-detent"),
			minHeight: popup.style.minHeight,
			maxHeight: popup.style.maxHeight,
		}).toStrictEqual({detent: "default", minHeight: HALF, maxHeight: HALF});
	});

	it("leaves a sheet without a text field at its content height", () => {
		const popup = renderSheet(<p>Body</p>);
		expect({minHeight: popup.style.minHeight, height: popup.style.height}).toStrictEqual({
			minHeight: "",
			height: "",
		});
	});

	it("opens the tall detent when a pressed text field takes focus within a second", () => {
		const popup = renderSheet();
		const input = screen.getByRole("textbox", {name: "Name"});
		fireEvent.pointerDown(input);
		fireEvent.focusIn(input);
		expect({detent: popup.getAttribute("data-cds-sheet-detent"), height: popup.style.height}).toStrictEqual({
			detent: "tall",
			height: TALL,
		});
	});

	it("stays at the default detent when a text field takes focus without a press", () => {
		const popup = renderSheet();
		fireEvent.focusIn(screen.getByRole("textbox", {name: "Name"}));
		expect(popup.getAttribute("data-cds-sheet-detent")).toBe("default");
	});

	it("dismisses on a handle drag down past a quarter of the rest height", async () => {
		const captured = new Set<number>();
		HTMLElement.prototype.setPointerCapture = (id) => {
			captured.add(id);
		};
		HTMLElement.prototype.hasPointerCapture = (id) => captured.has(id);
		HTMLElement.prototype.releasePointerCapture = (id) => {
			captured.delete(id);
		};
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
			DOMRect.fromRect({x: 0, y: 400, width: 420, height: 400}),
		);
		const popup = renderSheet(<p>Body</p>);
		const handle = popup.querySelector("[data-cds-sheet-handle]");
		if (handle === null) throw new Error("no handle");
		pointer(handle, "pointerdown", 400, 0);
		pointer(handle, "pointermove", 600, 1000);
		const during = popup.style.translate;
		pointer(handle, "pointerup", 600, 1000);
		await flush();
		expect({during, open: screen.queryByRole("dialog") !== null}).toStrictEqual({
			during: "0 200px",
			open: false,
		});
	});
});

describe("popover sheet keyboard inset", () => {
	function stubVisualViewport(height: number) {
		const viewport = Object.assign(new EventTarget(), {height, offsetTop: 0});
		vi.stubGlobal("visualViewport", viewport);
		vi.stubGlobal("innerHeight", 860);
		return viewport;
	}

	it("lifts the positioner above the on-screen keyboard while a text field holds focus", () => {
		const viewport = stubVisualViewport(860);
		const popup = renderSheet();
		const positioner = popup.parentElement;
		const input = screen.getByRole("textbox", {name: "Name"});
		fireEvent.focusIn(input);
		act(() => {
			viewport.height = 400;
			viewport.dispatchEvent(new Event("resize"));
		});
		const raised = {
			bottom: positioner?.style.bottom,
			paddingBottom: popup.style.paddingBottom,
			maxHeight: popup.style.maxHeight,
		};
		fireEvent.focusOut(input);
		expect({
			raised,
			released: {bottom: positioner?.style.bottom, paddingBottom: popup.style.paddingBottom},
		}).toStrictEqual({
			raised: {
				bottom: "460px",
				paddingBottom: "0.5rem",
				/* jsdom folds upstream's `calc(400px - safe-top - 8px)`. */
				maxHeight: "calc(392px - env(safe-area-inset-top, 0px))",
			},
			released: {bottom: "0px", paddingBottom: ""},
		});
	});
});
