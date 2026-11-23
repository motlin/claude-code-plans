// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {SessionRailSkeleton} from "../src/components/session-rail/session-rail-skeleton";

afterEach(() =>
{
	cleanup();
});

function skeletonShape(container: HTMLElement)
{
	const wrapper = container.firstElementChild;
	const groups = [...container.querySelectorAll("[data-skeleton-group]")];
	return {
		wrapper: wrapper?.className,
		cards: [...(wrapper?.children ?? [])].map((card) => card.className),
		groups: groups.map((group) => (
		{
			className: group.className,
			hold: group.getAttribute("data-hold"),
			role: group.getAttribute("role"),
			hidden: group.getAttribute("aria-hidden"),
		})),
		status: screen.getByRole("status").textContent,
		bars: [...container.querySelectorAll<HTMLElement>("[data-skeleton]")].map((bar) => [
			bar.className,
			bar.style.cssText,
		]),
		rows: container.querySelector("[data-skeleton-group] > .contents > div:not([data-skeleton])")?.className,
	};
}

const CARD_RING =
	"rounded-r7 shadow-[0_0_0_1px_var(--color-border)] dark:shadow-[inset_0_0_0_1px_var(--color-border)] [[data-session-rail-flat]_&]:rounded-none [[data-session-rail-flat]_&]:shadow-none";
const GROUP = "flex flex-col gap-2 py-2 px-3";
const BAR = "max-w-full rounded bg-[var(--skeleton-base)]";

/**
 * jsdom has no AnimationEvent, so React listens for the prefixed `webkitAnimationEnd` and fireEvent drops
 * `animationName`; build the event by hand.
 */
function animationEnd(target: Element, animationName: string)
{
	const event = new Event(
		"webkitAnimationEnd",
		{
			bubbles: true,
		},
	);
	Object.defineProperty(
		event,
		"animationName",
		{
			value: animationName,
		},
	);
	fireEvent(target, event);
}

describe("session rail skeleton", () =>
{
	it("renders upstream's two-card rail skeleton with one status announcement", () =>
	{
		const {container} = render(<SessionRailSkeleton />);

		expect(skeletonShape(container)).toStrictEqual(
			{
				wrapper:
					"flex w-[var(--session-rail-w,17.5rem)] flex-col gap-2.5 p-px [[data-session-rail-flat]_&]:gap-0 [[data-session-rail-flat]_&]:p-0",
				cards: [
					`h-[var(--session-rail-first-card-h,170px)] overflow-hidden ${CARD_RING}`,
					`relative h-10 overflow-hidden ${CARD_RING} before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-alpha-1`,
				],
				groups: [
					{
						className: GROUP,
						hold: "none",
						role: "status",
						hidden: null,
					},
					{
						className: GROUP,
						hold: "none",
						role: null,
						hidden: "true",
					},
				],
				status: "Loading session details",
				bars: [
					[`h-[1em] w-20 ${BAR}`, "height: 14px; --skel-i: 0;"],
					[`h-5 w-full ${BAR}`, "--skel-i: 1;"],
					[`h-5 w-full ${BAR}`, "--skel-i: 2;"],
					[`h-[1em] w-20 ${BAR}`, "height: 14px; --skel-i: 0;"],
				],
				rows: "[display:var(--session-rail-first-card-rows,contents)]",
			},
		);
	});

	it("holds both groups back for upstream's delayed reveal, marking and labelling them as its fade-in ends", () =>
	{
		const holds = (container: HTMLElement) =>
			[...container.querySelectorAll("[data-skeleton-group]")].map((group) => (
			{
				hold: group.getAttribute("data-hold"),
				reason: group.getAttribute("data-hold-reason"),
				shown: group.getAttribute("data-shown"),
				label: group.querySelector("[data-skeleton-label]")?.textContent ?? null,
			}));
		const {container} = render(<SessionRailSkeleton hold="delayed" />);
		const delayed = holds(container);
		const groups = [...container.querySelectorAll("[data-skeleton-group]")];
		// A bar's own animation ending, or another animation on the group, is not the reveal.
		animationEnd(groups[0]!.querySelector("[data-skeleton]")!, "placeholder-reveal");
		animationEnd(groups[0]!, "skeleton-breathe");
		const unrelated = holds(container);
		for (const group of groups) animationEnd(group, "placeholder-reveal");
		const revealed = holds(container);
		cleanup();
		const handoff = holds(render(<SessionRailSkeleton hold="none" holdReason="handoff" />).container);
		const hidden =
		{
			hold: "delayed",
			reason: null,
			shown: null,
		};

		expect(
			{
				delayed,
				unrelated,
				revealed,
				handoff,
			},
		).toStrictEqual(
			{
				delayed: [
					{
						...hidden,
						label: "",
					},
					{
						...hidden,
						label: null,
					},
				],
				unrelated: [
					{
						...hidden,
						label: "",
					},
					{
						...hidden,
						label: null,
					},
				],
				revealed: [
					{
						hold: "delayed",
						reason: null,
						shown: "",
						label: "Loading session details",
					},
					{
						hold: "delayed",
						reason: null,
						shown: "",
						label: null,
					},
				],
				handoff: [
					{
						hold: "none",
						reason: "handoff",
						shown: "",
						label: "Loading session details",
					},
					{
						hold: "none",
						reason: "handoff",
						shown: "",
						label: null,
					},
				],
			},
		);
	});
});
