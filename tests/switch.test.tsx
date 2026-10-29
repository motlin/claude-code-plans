// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Switch} from "../src/components/ui/switch";

afterEach(() => {
	cleanup();
});

const TRACK_CLASS =
	"relative inline-flex h-[14px] w-[25.2px] shrink-0 cursor-pointer rounded-full border-0 p-[2px] bg-[var(--settings-switch-track)] hover:bg-[var(--settings-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";
const KNOB_CLASS =
	"block size-[10px] rounded-full bg-white shadow-sm transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none data-[checked]:translate-x-[11.2px] rtl:data-[checked]:-translate-x-[11.2px]";

function attributes(element: Element) {
	return Object.fromEntries(
		Array.from(element.attributes)
			.filter((attribute) => attribute.name !== "class")
			.map((attribute) => [attribute.name, attribute.value]),
	);
}

describe("Switch", () => {
	it("renders upstream's xs switch checked, with its track and knob classes", () => {
		render(<Switch id="rc" checked aria-label="Remote Control" onCheckedChange={() => {}} />);
		const track = screen.getByRole("switch", {name: "Remote Control"});

		expect({
			track: attributes(track),
			trackClass: track.className,
			knobClass: track.firstElementChild?.className,
		}).toStrictEqual({
			track: {
				id: "rc",
				type: "button",
				role: "switch",
				"aria-checked": "true",
				"aria-label": "Remote Control",
				"data-size": "xs",
				"data-checked": "",
			},
			trackClass: TRACK_CLASS,
			knobClass: KNOB_CLASS,
		});
	});

	it("toggles on click and swallows Enter auto-repeat", () => {
		const onCheckedChange = vi.fn<(checked: boolean) => void>();
		render(<Switch id="rc" checked={false} onCheckedChange={onCheckedChange} />);
		const track = screen.getByRole("switch");
		fireEvent.click(track);
		const repeat = fireEvent.keyDown(track, {key: "Enter", repeat: true});
		const first = fireEvent.keyDown(track, {key: "Enter"});

		expect({calls: onCheckedChange.mock.calls, repeatAllowed: repeat, firstAllowed: first}).toStrictEqual({
			calls: [[true]],
			repeatAllowed: false,
			firstAllowed: true,
		});
	});

	it("marks a disabled switch data-disabled and ignores clicks", () => {
		const onCheckedChange = vi.fn<(checked: boolean) => void>();
		render(<Switch id="rc" checked={false} disabled onCheckedChange={onCheckedChange} />);
		const track = screen.getByRole("switch");
		fireEvent.click(track);

		expect({attributes: attributes(track), calls: onCheckedChange.mock.calls}).toStrictEqual({
			attributes: {
				id: "rc",
				type: "button",
				role: "switch",
				"aria-checked": "false",
				"data-size": "xs",
				"data-unchecked": "",
				disabled: "",
				"data-disabled": "",
			},
			calls: [],
		});
	});

	it("renders aria-readonly without a change handler", () => {
		render(<Switch id="rc" checked />);

		expect(screen.getByRole("switch").getAttribute("aria-readonly")).toBe("true");
	});
});
