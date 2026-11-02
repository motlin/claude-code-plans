// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {useLandedFlash} from "../src/components/landed-flash";
import {UserMessageActions} from "../src/components/message-actions";
import {clearLanded, markLanded} from "../src/lib/landed-store";
import {clearPickups, recordPickup, usePickupSettling} from "../src/lib/pickup-settling";

afterEach(() =>
{
	cleanup();
	clearLanded();
	clearPickups();
	vi.useRealTimers();
});

function Bubble({text}: {text: string})
{
	const {isolate, accent} = useLandedFlash(text);
	return (
		<div data-testid="bubble" className={`relative ${isolate}`}>
			{accent}
			{text}
		</div>
	);
}

describe("landed flash", () =>
{
	it("flashes a user row that mounts after its promoted prompt lands, for 1500ms", () =>
	{
		vi.useFakeTimers();
		render(<Bubble text="earlier fix it" />);
		act(() =>
		{
			markLanded("fix it");
		});
		const {container} = render(<Bubble text="fix it" />);
		const flash = () => container.querySelector(".epitaxy-reply-flash-accent");
		const during = flash();
		const shape =
			during === null
				? null
				:
					{
						ariaHidden: during.getAttribute("aria-hidden"),
						className: during.className,
						bubble: during.parentElement?.className,
					};
		act(() =>
		{
			vi.advanceTimersByTime(1499);
		});
		const before = flash() !== null;
		act(() =>
		{
			vi.advanceTimersByTime(1);
		});
		expect(
			{
				shape,
				before,
				after: flash() !== null,
			},
		).toStrictEqual(
			{
				shape:
				{
					ariaHidden: "true",
					className:
						"epitaxy-reply-flash-accent pointer-events-none absolute inset-0 -z-[1] rounded-[inherit] animate-code-reply-flash-accent motion-reduce:animate-none motion-reduce:bg-upstream-accent-pressed",
					bubble: "relative isolate",
				},
				before: true,
				after: false,
			},
		);
	});

	it("leaves rows that were already on screen, and rows with other text, alone", () =>
	{
		const {container} = render(<Bubble text="fix it" />);
		act(() =>
		{
			markLanded("fix it");
		});
		const other = render(<Bubble text="something else" />);
		expect(
			{
				existing: container.querySelector(".epitaxy-reply-flash-accent") !== null,
				other: other.container.querySelector(".epitaxy-reply-flash-accent") !== null,
			},
		).toStrictEqual(
			{
				existing: false,
				other: false,
			},
		);
	});
});

function SettlingProbe({text}: {text: string})
{
	return <span data-testid="phase">{String(usePickupSettling(text))}</span>;
}

describe("settling time fade", () =>
{
	it("settles a picked-up prompt from 1400ms to 1800ms after pickup", () =>
	{
		vi.useFakeTimers();
		act(() =>
		{
			recordPickup("ship it");
		});
		const {getByTestId} = render(<SettlingProbe text="ship it" />);
		const phase = () => getByTestId("phase").textContent;
		const read = phase();
		act(() =>
		{
			vi.advanceTimersByTime(1400);
		});
		const settling = phase();
		act(() =>
		{
			vi.advanceTimersByTime(400);
		});
		expect(
			{
				read,
				settling,
				rest: phase(),
			},
		).toStrictEqual(
			{
				read: "false",
				settling: "true",
				rest: "false",
			},
		);
	});

	it("fades a settling user row's time in, and leaves a resting one plain", () =>
	{
		const timestamp = new Date().toISOString();
		const props =
		{
			message: undefined,
			text: "hi",
			timestamp,
			details: [],
		};
		const settling = render(<UserMessageActions {...props} settling />);
		const resting = render(<UserMessageActions {...props} />);
		const fades = (container: HTMLElement) =>
			container.querySelector("time")?.classList.contains("epitaxy-hint-fade-in");
		expect(
			{
				settling: fades(settling.container),
				resting: fades(resting.container),
			},
		).toStrictEqual(
			{
				settling: true,
				resting: false,
			},
		);
	});
});
