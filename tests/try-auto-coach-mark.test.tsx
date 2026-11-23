// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {TryAutoCoachMark} from "../src/components/try-auto-coach-mark";
import {TRY_AUTO_COACH_KEY, readTryAutoCoachSeenAt, tryAutoCoachEligible} from "../src/lib/try-auto-coach";
import {installLocalStorage} from "./fake-storage";

const NOW = 1_800_000_000_000;

function Harness({initiallyEligible = true}: {initiallyEligible?: boolean})
{
	const [eligible, setEligible] = useState(initiallyEligible);
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
	return (
		<>
			<button
				ref={setAnchor}
				type="button"
				onClick={() =>
				{
					setEligible(false);
				}}
			>
				Pick Auto
			</button>
			<TryAutoCoachMark eligible={eligible} anchor={anchor} />
		</>
	);
}

beforeEach(() =>
{
	installLocalStorage();
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

describe("TryAutoCoachMark", () =>
{
	it("opens 500 ms after it becomes eligible and stamps the seen time", () =>
	{
		render(<Harness />);
		act(() =>
		{
			vi.advanceTimersByTime(499);
		});
		expect([
			screen.queryByRole(
				"dialog",
				{
					name: "Try auto mode",
				},
			),
			readTryAutoCoachSeenAt(),
		]).toStrictEqual([null, 0]);
		act(() =>
		{
			vi.advanceTimersByTime(1);
		});
		const dialog = screen.getByRole(
			"dialog",
			{
				name: "Try auto mode",
			},
		);
		expect([
			dialog.textContent,
			dialog.className.split(" ")[0],
			readTryAutoCoachSeenAt(),
			localStorage.getItem(TRY_AUTO_COACH_KEY),
		]).toStrictEqual([
			"Try auto modeClaude checks each tool call and runs ones that pass its safety checks. Choose Auto from this menu anytime.",
			"max-w-xs",
			NOW + 500,
			String(NOW + 500),
		]);
		// Upstream's titled layout: no leading icon, the title row holds the Dismiss, the body is plain white text.
		const heading = within(dialog).getByRole(
			"heading",
			{
				name: "Try auto mode",
			},
		);
		const dismiss = within(dialog).getByRole(
			"button",
			{
				name: "Dismiss",
			},
		);
		expect(
			{
				svgsBeforeHeading: [...dialog.querySelectorAll("svg")].filter(
					(svg) =>
						(svg.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
						svg.closest("[data-cds='CoachMark'] > :first-child") === null,
				).length,
				headingTag: heading.tagName,
				rowHoldsDismiss: heading.parentElement?.contains(dismiss),
				dimmedBody: dialog.querySelector(".text-white\\/85"),
				ariaLabel: dialog.getAttribute("aria-label"),
				labelledBy: dialog.getAttribute("aria-labelledby"),
			},
		).toStrictEqual(
			{
				svgsBeforeHeading: 0,
				headingTag: "H2",
				rowHoldsDismiss: true,
				dimmedBody: null,
				ariaLabel: null,
				labelledBy: heading.id,
			},
		);
	});

	it("closes when Auto is picked", () =>
	{
		render(<Harness />);
		act(() =>
		{
			vi.advanceTimersByTime(500);
		});
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Pick Auto",
				},
			),
		);
		act(() =>
		{
			vi.advanceTimersByTime(1000);
		});
		expect(
			screen.queryByRole(
				"dialog",
				{
					name: "Try auto mode",
				},
			),
		).toBeNull();
	});

	it("closes on Dismiss and never comes back", () =>
	{
		const {unmount} = render(<Harness />);
		act(() =>
		{
			vi.advanceTimersByTime(500);
		});
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Dismiss",
				},
			),
		);
		act(() =>
		{
			vi.advanceTimersByTime(1000);
		});
		expect(
			screen.queryByRole(
				"dialog",
				{
					name: "Try auto mode",
				},
			),
		).toBeNull();
		unmount();
		render(<Harness />);
		act(() =>
		{
			vi.advanceTimersByTime(1000);
		});
		expect(
			screen.queryByRole(
				"dialog",
				{
					name: "Try auto mode",
				},
			),
		).toBeNull();
	});

	it("never shows once the key is set", () =>
	{
		localStorage.setItem(TRY_AUTO_COACH_KEY, "1");
		render(<Harness />);
		act(() =>
		{
			vi.advanceTimersByTime(1000);
		});
		expect(
			screen.queryByRole(
				"dialog",
				{
					name: "Try auto mode",
				},
			),
		).toBeNull();
	});

	it("never shows while ineligible", () =>
	{
		render(<Harness initiallyEligible={false} />);
		act(() =>
		{
			vi.advanceTimersByTime(1000);
		});
		expect([
			screen.queryByRole(
				"dialog",
				{
					name: "Try auto mode",
				},
			),
			readTryAutoCoachSeenAt(),
		]).toStrictEqual([null, 0]);
	});
});

describe("tryAutoCoachEligible", () =>
{
	const offer =
	{
		autoModeIsDefault: true,
		setup:
		{
			offered: true,
			setupComplete: false,
		},
	};

	it("holds only for an explicit Manual pick while setup is offered and not done", () =>
	{
		expect([
			tryAutoCoachEligible("default", offer),
			tryAutoCoachEligible(undefined, offer),
			tryAutoCoachEligible("acceptEdits", offer),
			tryAutoCoachEligible("auto", offer),
			tryAutoCoachEligible(
				"default",
				{
					...offer,
					autoModeIsDefault: false,
				},
			),
			tryAutoCoachEligible(
				"default",
				{
					...offer,
					setup:
					{
						offered: false,
						setupComplete: false,
					},
				},
			),
			tryAutoCoachEligible(
				"default",
				{
					...offer,
					setup:
					{
						offered: true,
						setupComplete: true,
					},
				},
			),
			tryAutoCoachEligible("default", undefined),
		]).toStrictEqual([true, false, false, false, false, false, false, false]);
	});
});
