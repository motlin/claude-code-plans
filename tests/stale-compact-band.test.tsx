// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {StaleCompactBand, type StaleCompactBandProps} from "../src/components/stale-compact-band";

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

const TOKENS_LINE =
	"Your next message re-reads all 412k tokens. Compact first so later messages start from a short summary.";

function renderBand(overrides: Partial<StaleCompactBandProps> = {})
{
	const calls: string[] = [];
	const props: StaleCompactBandProps =
	{
		ageMinutes: 1379,
		contextTokens: 412_000,
		tokensInLine: true,
		compacting: false,
		onCompact: vi.fn<() => void>(() =>
		{
			calls.push("compact");
		}),
		focusComposer: vi.fn<() => void>(() =>
		{
			calls.push("focus");
		}),
		...overrides,
	};
	const view = render(
		<div>
			<StaleCompactBand {...props} />
			<button type="button">outside</button>
		</div>,
	);
	const root = view.container.firstElementChild!.firstElementChild as HTMLElement;
	return {
		root,
		props,
		calls,
	};
}

describe("StaleCompactBand (upstream bTe)", () =>
{
	it("renders upstream's line, trigger and Compact session link", () =>
	{
		const {root} = renderBand();
		const status = root.children[0]!;
		const trigger = status.firstElementChild!;
		const link = root.children[1]!;
		expect(
			{
				tag: root.tagName,
				keepsPin: root.getAttribute("data-transcript-keeps-pin"),
				findOmitted: root.getAttribute("data-find-omitted"),
				className: root.className,
				childCount: root.children.length,
				status:
				{
					tag: status.tagName,
					role: status.getAttribute("role"),
					live: status.getAttribute("aria-live"),
					atomic: status.getAttribute("aria-atomic"),
					className: status.className,
				},
				trigger:
				{
					tag: trigger.tagName,
					type: trigger.getAttribute("type"),
					className: trigger.className,
					text: trigger.textContent,
				},
				link:
				{
					tag: link.tagName,
					cds: link.getAttribute("data-cds"),
					type: link.getAttribute("type"),
					className: link.className,
					text: link.textContent,
					disabled: (link as HTMLButtonElement).disabled,
					busy: link.getAttribute("aria-busy"),
				},
			},
		).toStrictEqual(
			{
				tag: "DIV",
				keepsPin: "",
				findOmitted: "",
				className: "epitaxy-hint-fade-in flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-footnote",
				childCount: 2,
				status:
				{
					tag: "SPAN",
					role: "status",
					live: "polite",
					atomic: "true",
					className: "min-w-0 text-secondary",
				},
				// Upstream `cds-reset rounded text-start outline-none focus-visible:outline-hidden focus-visible:shadow-focus`;
				// `rounded` is the cds radius `rounded-r5`.
				trigger:
				{
					tag: "BUTTON",
					type: "button",
					className:
						"cds-reset rounded-r5 text-start outline-none focus-visible:outline-hidden focus-visible:shadow-focus",
					text: TOKENS_LINE,
				},
				link:
				{
					tag: "BUTTON",
					cds: "TextLink",
					type: "button",
					className: "cds-reset text-link inline cursor-pointer shrink-0",
					text: "Compact session",
					disabled: false,
					busy: null,
				},
			},
		);
	});

	it("opens the Why compact now popover after a 300ms hover", async () =>
	{
		vi.useFakeTimers();
		renderBand();
		const trigger = screen.getByRole(
			"button",
			{
				name: TOKENS_LINE,
			},
		);
		act(() =>
		{
			fireEvent.pointerEnter(
				trigger,
				{
					pointerType: "mouse",
				},
			);
			fireEvent.mouseEnter(trigger);
			fireEvent.mouseMove(trigger);
		});
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(100);
		});
		expect(screen.queryByRole("dialog")).toBeNull();
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(250);
		});
		const popup = screen.getByRole(
			"dialog",
			{
				name: "Why compact now",
			},
		);
		const body = popup.querySelector("p")!;
		expect(
			{
				text: popup.textContent,
				maxWidth: popup.className.split(" ").includes("max-w-60"),
				bodyClass: body.className,
			},
		).toStrictEqual(
			{
				text: "After 22h idle, the cache has expired, so your next message re-reads all 412k tokens. Compact first so later replies run on a short summary instead.",
				maxWidth: true,
				bodyClass: "text-footnote",
			},
		);
	});

	it("moves focus to the composer before compacting when focus is inside the band", () =>
	{
		const {calls} = renderBand();
		screen
			.getByRole(
				"button",
				{
					name: TOKENS_LINE,
				},
			)
			.focus();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Compact session",
				},
			),
		);
		expect(calls).toStrictEqual(["focus", "compact"]);
	});

	it("leaves focus alone when it is outside the band", () =>
	{
		const {calls} = renderBand();
		screen
			.getByRole(
				"button",
				{
					name: "outside",
				},
			)
			.focus();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Compact session",
				},
			),
		);
		expect(calls).toStrictEqual(["compact"]);
	});

	it("shows Compacting… disabled and busy while compacting", () =>
	{
		const {root, calls} = renderBand(
			{
				compacting: true,
			},
		);
		const link = root.children[1] as HTMLButtonElement;
		fireEvent.click(link);
		expect(
			{
				text: link.textContent,
				disabled: link.disabled,
				busy: link.getAttribute("aria-busy"),
				className: link.className,
				calls,
			},
		).toStrictEqual(
			{
				text: "Compacting…",
				disabled: true,
				busy: "true",
				className: "cds-reset text-link inline cursor-default opacity-disabled shrink-0",
				calls: [],
			},
		);
	});

	it("uses the generic line on the control arm", () =>
	{
		renderBand(
			{
				tokensInLine: false,
			},
		);
		expect(screen.getByRole("status").textContent).toBe(
			"Compacting before your next message keeps later replies fast and lighter on your usage.",
		);
	});
});
