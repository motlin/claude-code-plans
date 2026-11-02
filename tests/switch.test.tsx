// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Switch} from "../src/components/ui/switch";

afterEach(() =>
{
	cleanup();
});

const TRACK_CLASS =
	"relative inline-flex h-[14px] w-[25.2px] shrink-0 cursor-pointer rounded-full border-0 p-[2px] bg-[var(--settings-switch-track)] hover:bg-[var(--settings-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";
const KNOB_CLASS =
	"block size-[10px] rounded-full bg-white shadow-sm transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none data-[checked]:translate-x-[11.2px] rtl:data-[checked]:-translate-x-[11.2px]";

function attributes(element: Element)
{
	return Object.fromEntries(
		Array.from(element.attributes)
			.filter((attribute) => attribute.name !== "class")
			.map((attribute) => [attribute.name, attribute.value]),
	);
}

describe("Switch", () =>
{
	it("renders upstream's xs switch checked, with its track and knob classes", () =>
	{
		render(
			<Switch
				id="rc"
				checked
				aria-label="Remote Control"
				onCheckedChange={() =>
				{
				}}
			/>,
		);
		const track = screen.getByRole(
			"switch",
			{
				name: "Remote Control",
			},
		);

		expect(
			{
				track: attributes(track),
				trackClass: track.className,
				knobClass: track.firstElementChild?.className,
			},
		).toStrictEqual(
			{
				track:
				{
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
			},
		);
	});

	it("toggles on click and swallows Enter auto-repeat", () =>
	{
		const onCheckedChange = vi.fn<(checked: boolean) => void>();
		render(<Switch id="rc" checked={false} onCheckedChange={onCheckedChange} />);
		const track = screen.getByRole("switch");
		fireEvent.click(track);
		const repeat = fireEvent.keyDown(
			track,
			{
				key: "Enter",
				repeat: true,
			},
		);
		const first = fireEvent.keyDown(
			track,
			{
				key: "Enter",
			},
		);

		expect(
			{
				calls: onCheckedChange.mock.calls,
				repeatAllowed: repeat,
				firstAllowed: first,
			},
		).toStrictEqual(
			{
				calls: [[true]],
				repeatAllowed: false,
				firstAllowed: true,
			},
		);
	});

	it("marks a disabled switch data-disabled and ignores clicks", () =>
	{
		const onCheckedChange = vi.fn<(checked: boolean) => void>();
		render(<Switch id="rc" checked={false} disabled onCheckedChange={onCheckedChange} />);
		const track = screen.getByRole("switch");
		fireEvent.click(track);

		expect(
			{
				attributes: attributes(track),
				calls: onCheckedChange.mock.calls,
			},
		).toStrictEqual(
			{
				attributes:
				{
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
			},
		);
	});

	it("renders aria-readonly without a change handler", () =>
	{
		render(<Switch id="rc" checked />);

		expect(screen.getByRole("switch").getAttribute("aria-readonly")).toBe("true");
	});

	describe("size xxs", () =>
	{
		const XXS_TRACK_CLASS =
			"relative inline-flex h-[var(--cds-switch-h)] w-[calc(var(--cds-switch-h)*1.8)] shrink-0 cursor-pointer rounded-full border-0 p-[2px] bg-[var(--settings-switch-track)] hover:bg-[var(--settings-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus hit-row-main";
		const XXS_KNOB_CLASS =
			"block size-[calc(var(--cds-switch-h)-4px)] rounded-full bg-white shadow-sm transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none data-[checked]:translate-x-[calc(var(--cds-switch-h)*0.8)] rtl:data-[checked]:-translate-x-[calc(var(--cds-switch-h)*0.8)]";

		it("sizes the track and knob from --cds-switch-h and passes the chip's props through", () =>
		{
			render(
				<Switch
					size="xxs"
					checked
					className="hit-row-main"
					aria-labelledby="l"
					aria-describedby="d"
					data-testid="t"
					onCheckedChange={() =>
					{
					}}
				/>,
			);
			const track = screen.getByRole("switch");

			expect(
				{
					track: attributes(track),
					trackClass: track.className,
					knobClass: track.firstElementChild?.className,
				},
			).toStrictEqual(
				{
					track:
					{
						type: "button",
						role: "switch",
						"aria-checked": "true",
						"aria-labelledby": "l",
						"aria-describedby": "d",
						"data-testid": "t",
						"data-size": "xxs",
						"data-checked": "",
					},
					trackClass: XXS_TRACK_CLASS,
					knobClass: XXS_KNOB_CLASS,
				},
			);
		});

		it("marks a busy switch aria-busy and aria-disabled, still focusable, and ignores clicks", () =>
		{
			const onCheckedChange = vi.fn<(checked: boolean) => void>();
			render(<Switch size="xxs" checked={false} busy onCheckedChange={onCheckedChange} />);
			const track = screen.getByRole("switch");
			fireEvent.click(track);

			expect(
				{
					busy: track.getAttribute("aria-busy"),
					ariaDisabled: track.getAttribute("aria-disabled"),
					disabled: track.hasAttribute("disabled"),
					calls: onCheckedChange.mock.calls,
				},
			).toStrictEqual(
				{
					busy: "true",
					ariaDisabled: "true",
					disabled: false,
					calls: [],
				},
			);
		});
	});

	describe("disabledReason", () =>
	{
		function wrapperState()
		{
			const track = screen.getByRole("switch");
			const wrapper = track.parentElement!;
			const describedBy = wrapper.getAttribute("aria-describedby");
			return {
				wrapped: wrapper.hasAttribute("data-cds-disabled-reason-wrapper"),
				tabIndex: wrapper.tabIndex,
				description: describedBy === null ? null : (document.getElementById(describedBy)?.textContent ?? null),
				trackDisabled: track.hasAttribute("data-disabled"),
			};
		}

		it("wraps a disabled switch in upstream's reason wrapper, opening the reason on its side", () =>
		{
			render(<Switch id="rc" checked={false} disabled disabledReason="x" disabledReasonSide="left" />);
			const state = wrapperState();
			act(() =>
			{
				screen.getByRole("switch").parentElement!.focus();
			});
			const tooltip = screen.getByRole("tooltip");

			expect(
				{
					...state,
					tooltip: tooltip.textContent,
					side: tooltip.className.split(" ").slice(-4).join(" "),
				},
			).toStrictEqual(
				{
					wrapped: true,
					tabIndex: 0,
					description: "x",
					trackDisabled: true,
					tooltip: "x",
					side: "right-full top-1/2 mr-1 -translate-y-1/2",
				},
			);
		});

		it("keeps a stable, undescribed wrapper while enabled or given a null reason, as upstream", () =>
		{
			const {rerender} = render(
				<Switch
					id="rc"
					checked={false}
					disabledReason="x"
					onCheckedChange={() =>
					{
					}}
				/>,
			);
			const enabled = wrapperState();
			rerender(
				<Switch
					id="rc"
					checked={false}
					disabled
					disabledReason={null}
					onCheckedChange={() =>
					{
					}}
				/>,
			);

			expect(
				{
					enabled,
					nullReason: wrapperState(),
				},
			).toStrictEqual(
				{
					enabled:
					{
						wrapped: true,
						tabIndex: -1,
						description: null,
						trackDisabled: false,
					},
					nullReason:
					{
						wrapped: true,
						tabIndex: -1,
						description: null,
						trackDisabled: true,
					},
				},
			);
		});

		it("renders no wrapper without a disabledReason", () =>
		{
			const {container} = render(<Switch id="rc" checked={false} disabled />);

			expect(container.querySelector("[data-cds-disabled-reason-wrapper]")).toBeNull();
		});
	});
});
