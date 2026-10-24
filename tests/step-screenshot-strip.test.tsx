// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {StepScreenshotStrip} from "../src/components/step-screenshot-strip";
import type {ToolResultImage} from "../src/lib/session-utils";

afterEach(cleanup);

function shots(count: number): ToolResultImage[] {
	return Array.from({length: count}, (_, i) => ({mimeType: "image/png", data: `IMG${i + 1}`}));
}

function thumbLabels(): (string | null)[] {
	return screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
}

describe("StepScreenshotStrip", () => {
	it("renders one shot as a single 'Screenshot' button with upstream's strip and thumb classes", () => {
		const {container} = render(<StepScreenshotStrip shots={shots(1)} captions={["Read"]} />);

		const strip = container.firstElementChild;
		expect(strip?.className).toBe("flex h-6 shrink-0 items-center gap-2 my-[calc((1lh_-_--spacing(6))_/_2)]");
		expect(container.textContent).toBe("Read");
		expect(thumbLabels()).toStrictEqual(["Screenshot"]);

		const button = screen.getByRole("button", {name: "Screenshot"});
		expect(button.getAttribute("type")).toBe("button");
		expect(button.className).toBe(
			"h-6 max-w-11 shrink-0 cursor-zoom-in overflow-hidden rounded-sm border-[0.5px] border-strong shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-fill-accent",
		);
		expect(button.parentElement?.className).toBe("contents");
		expect(button.parentElement?.parentElement?.className).toBe("flex h-6 items-center gap-1");

		const img = button.querySelector("img");
		expect(img?.outerHTML).toBe(
			'<img alt="" class="h-full w-auto max-w-full object-cover object-left-top" src="data:image/png;base64,IMG1">',
		);

		const descriptionId = button.getAttribute("aria-describedby");
		expect(descriptionId).not.toBeNull();
		const description = document.getElementById(descriptionId ?? "");
		expect(description?.outerHTML).toBe(
			`<span id="${descriptionId}" class="sr-only select-none" data-find-omitted="">Read</span>`,
		);
	});

	it("labels two shots 'Screenshot N of 2'", () => {
		render(<StepScreenshotStrip shots={shots(2)} captions={["Read a.png", "Read b.png"]} />);

		expect(thumbLabels()).toStrictEqual(["Screenshot 1 of 2", "Screenshot 2 of 2"]);
	});

	it("shows only the last three of five shots behind +2 (desktop) and +4 (phone) counters", () => {
		const {container} = render(<StepScreenshotStrip shots={shots(5)} captions={["a", "b", "c", "d", "e"]} />);

		expect(thumbLabels()).toStrictEqual(["Screenshot 3 of 5", "Screenshot 4 of 5", "Screenshot 5 of 5"]);
		const counters = [...container.querySelectorAll("span[aria-hidden]")].map((span) => ({
			className: span.className,
			text: span.textContent,
		}));
		expect(counters).toStrictEqual([
			{className: "tabular-nums text-ink-muted max-sm:hidden", text: "+2"},
			{className: "tabular-nums text-ink-muted sm:hidden", text: "+4"},
		]);
		const wrappers = screen.getAllByRole("button").map((button) => button.parentElement?.className);
		expect(wrappers).toStrictEqual(["contents max-sm:hidden", "contents max-sm:hidden", "contents"]);
		const sources = screen.getAllByRole("button").map((button) => button.querySelector("img")?.getAttribute("src"));
		expect(sources).toStrictEqual([
			"data:image/png;base64,IMG3",
			"data:image/png;base64,IMG4",
			"data:image/png;base64,IMG5",
		]);
	});

	it("shows the +1 phone counter but no desktop counter for two shots", () => {
		const {container} = render(<StepScreenshotStrip shots={shots(2)} captions={[]} />);

		const counters = [...container.querySelectorAll("span[aria-hidden]")].map((span) => ({
			className: span.className,
			text: span.textContent,
		}));
		expect(counters).toStrictEqual([{className: "tabular-nums text-ink-muted sm:hidden", text: "+1"}]);
	});

	it("numbers group-wide with from and total", () => {
		render(<StepScreenshotStrip shots={shots(2)} captions={["Read", "Read"]} from={2} total={4} />);

		expect(thumbLabels()).toStrictEqual(["Screenshot 3 of 4", "Screenshot 4 of 4"]);
	});

	it("marks images lazy and async-decoded when lazy", () => {
		render(<StepScreenshotStrip shots={shots(1)} captions={["Read"]} lazy />);

		const img = screen.getByRole("button", {name: "Screenshot"}).querySelector("img");
		expect(img?.getAttribute("loading")).toBe("lazy");
		expect(img?.getAttribute("decoding")).toBe("async");
	});

	it("opens at the clicked shot's group-wide index without the click reaching the row behind it", () => {
		const onParentClick = vi.fn<(event: Event) => void>();
		const onOpen = vi.fn<(index: number) => void>();
		document.body.addEventListener("click", onParentClick);
		render(<StepScreenshotStrip shots={shots(2)} captions={[]} from={1} total={3} onOpen={onOpen} />);

		fireEvent.click(screen.getByRole("button", {name: "Screenshot 3 of 3"}));
		document.body.removeEventListener("click", onParentClick);

		expect(onParentClick).not.toHaveBeenCalled();
		expect(onOpen.mock.calls).toStrictEqual([[2]]);
	});
});

describe("StepScreenshotStrip preview card", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function advance(ms: number) {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ms);
		});
	}

	function hover(element: HTMLElement) {
		act(() => {
			fireEvent.pointerEnter(element, {pointerType: "mouse"});
			fireEvent.mouseEnter(element);
			fireEvent.mouseMove(element);
		});
	}

	function popup(): HTMLElement | null {
		return document.querySelector("[data-screenshot-preview]");
	}

	it("opens upstream's preview card with the image and caption when a thumbnail takes focus", async () => {
		render(<StepScreenshotStrip shots={shots(1)} captions={["Read input-debug.png"]} />);

		act(() => {
			screen.getByRole("button", {name: "Screenshot"}).focus();
		});
		await advance(150);

		const card = popup();
		expect(card?.className).toBe(
			"flex flex-col gap-1 overflow-hidden rounded-r7 bg-surface-3 p-0 shadow-[var(--menu-shadow)] outline-none w-[min(20rem,100vw-2rem)]",
		);
		expect(card?.parentElement?.className).toBe("pointer-events-none z-[100]");
		expect(card?.parentElement?.getAttribute("data-side")).toBe("top");
		expect(card?.parentElement?.getAttribute("data-align")).toBe("end");
		expect(card?.innerHTML).toBe(
			'<div class="overflow-hidden rounded-[inherit]"><img alt="" class="max-h-60 w-full bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)] object-contain" src="data:image/png;base64,IMG1"></div>' +
				'<div class="flex items-baseline gap-2 px-3 py-2 text-footnote"><bdi class="min-w-0 flex-1 truncate text-primary">Read input-debug.png</bdi></div>',
		);
	});

	it("opens on hover after 150ms and shows 'N of M' when the strip holds several shots", async () => {
		render(<StepScreenshotStrip shots={shots(2)} captions={["Read a.png", undefined]} />);

		hover(screen.getByRole("button", {name: "Screenshot 2 of 2"}));
		await advance(100);
		expect(popup()).toBeNull();
		await advance(50);

		const footer = popup()?.lastElementChild;
		expect(footer?.innerHTML).toBe(
			'<bdi class="min-w-0 flex-1 truncate text-primary">Screenshot</bdi><span class="shrink-0 tabular-nums text-ink-muted">2 of 2</span>',
		);
	});

	it("shows no preview card while the viewer is open", async () => {
		render(<StepScreenshotStrip shots={shots(1)} captions={["Read"]} viewerOpen />);

		const thumb = screen.getByRole("button", {name: "Screenshot"});
		hover(thumb);
		act(() => {
			thumb.focus();
		});
		await advance(500);

		expect(popup()).toBeNull();
	});
});
