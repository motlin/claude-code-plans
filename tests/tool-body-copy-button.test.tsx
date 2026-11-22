// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ToolBodyCopyButton} from "../src/components/tool-renderers/shared";

const writeText = vi.fn<Clipboard["writeText"]>(async () => Promise.resolve());

beforeEach(() =>
{
	vi.useFakeTimers();
	writeText.mockReset();
	writeText.mockImplementation(async () => Promise.resolve());
	Object.defineProperty(
		navigator,
		"clipboard",
		{
			value:
			{
				writeText,
			},
			configurable: true,
		},
	);
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

/** Upstream `he` (`ge`'s hover-reveal wrapper); `duration-snap` and `ease-snap` are local @utility ports. */
const REVEAL =
	"opacity-0 group-hover/body:opacity-100 focus-within:opacity-100 transition-opacity duration-fast ease-snap group-hover/body:duration-snap group-hover/body:delay-100 group-has-[:focus-visible]/body:duration-snap focus-within:duration-snap starting:opacity-0 motion-reduce:transition-none pointer-coarse:transition-none [@media(hover:none)]:transition-none";

function shape(container: HTMLElement)
{
	const wrapper = container.firstElementChild!;
	const button = wrapper.querySelector("button")!;
	return {
		wrapper: wrapper.className,
		attrs:
		{
			cds: button.getAttribute("data-cds"),
			iconOnly: button.getAttribute("data-cds-icon-only"),
			ghost: button.getAttribute("data-cds-ghost"),
			size: button.getAttribute("data-size"),
			label: button.getAttribute("aria-label"),
		},
	};
}

async function settle()
{
	await act(async () =>
	{
		await Promise.resolve();
	});
}

describe("ToolBodyCopyButton (upstream `ge`)", () =>
{
	it("is a hover-revealed ghost xs icon-only cds Button", () =>
	{
		const {container} = render(<ToolBodyCopyButton compact text={() => "$ ls"} />);
		expect(shape(container)).toStrictEqual(
			{
				wrapper: REVEAL,
				attrs:
				{
					cds: "Button",
					iconOnly: "",
					ghost: "",
					size: "xs",
					label: "Copy",
				},
			},
		);
	});

	it("is always visible in a shrink-0 wrapper, at the base size without compact", () =>
	{
		const {container} = render(<ToolBodyCopyButton alwaysVisible text="a" />);
		const {wrapper, attrs} = shape(container);
		expect([wrapper, attrs.size]).toStrictEqual(["shrink-0", null]);
	});

	it("copies the lazy text, shows Copied for 1200ms, then Copy again", async () =>
	{
		const {container} = render(<ToolBodyCopyButton compact text={() => "$ ls"} />);
		const button = container.querySelector("button")!;
		fireEvent.click(button);
		await settle();
		const copied = button.getAttribute("aria-label");
		act(() =>
		{
			vi.advanceTimersByTime(1199);
		});
		const held = button.getAttribute("aria-label");
		act(() =>
		{
			vi.advanceTimersByTime(1);
		});
		expect(
			{
				copied,
				held,
				reset: button.getAttribute("aria-label"),
				writes: writeText.mock.calls,
			},
		).toStrictEqual(
			{
				copied: "Copied",
				held: "Copied",
				reset: "Copy",
				writes: [["$ ls"]],
			},
		);
	});

	it("rests on a given label, shows Copied for 1200ms, then the label again", async () =>
	{
		const {container} = render(<ToolBodyCopyButton compact label="Copy command" text="x" />);
		const button = container.querySelector("button")!;
		const rest = button.getAttribute("aria-label");
		fireEvent.click(button);
		await settle();
		const copied = button.getAttribute("aria-label");
		act(() =>
		{
			vi.advanceTimersByTime(1200);
		});
		expect([rest, copied, button.getAttribute("aria-label")]).toStrictEqual([
			"Copy command",
			"Copied",
			"Copy command",
		]);
	});

	it("says Couldn’t copy when the clipboard rejects", async () =>
	{
		writeText.mockImplementation(async () => Promise.reject(new Error("denied")));
		const {container} = render(<ToolBodyCopyButton compact text="x" />);
		const button = container.querySelector("button")!;
		fireEvent.click(button);
		await settle();
		expect(button.getAttribute("aria-label")).toBe("Couldn’t copy");
	});

	it("keeps focus where it was on mouse down", () =>
	{
		const {container} = render(<ToolBodyCopyButton compact text="x" />);
		const event = new MouseEvent(
			"mousedown",
			{
				bubbles: true,
				cancelable: true,
			},
		);
		container.querySelector("button")!.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});
});
