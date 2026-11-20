// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {createRef} from "react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {type UsageRingHandle, UsageRing} from "../src/components/composer-chin";
import type {UsageRingContext} from "../src/components/usage-popover-context";
import {preloadUsagePopoverContext} from "../src/components/usage-popover-context-loader";
import type {CompactActionState} from "../src/lib/compact-action";
import type {ComposerUsage} from "../src/lib/composer-state";
import type {ContextBreakdown} from "../src/lib/context-breakdown";

const UPDATED_AT = "2026-11-04T12:00:00.000Z";

const CONTEXT_ONLY: ComposerUsage =
{
	contextTokens: 656_200,
	contextWindowSize: 1_000_000,
	contextPercent: 66,
	fiveHour: null,
	weekly: null,
	updatedAt: UPDATED_AT,
};

const BREAKDOWN: ContextBreakdown =
{
	categories: [
		{
			name: "System prompt",
			tokens: 3_100,
			kind: "used",
		},
		{
			name: "Messages",
			tokens: 600_000,
			kind: "used",
		},
		{
			name: "Free space",
			tokens: 396_900,
			kind: "free",
		},
	],
	totalTokens: 603_100,
	rawMaxTokens: 1_000_000,
	percentage: 60,
	mcpTools: [],
	memoryFiles: [],
	agents: [],
	fetchedAt: UPDATED_AT,
	source: "mod",
	autoCompactThreshold: 967_000,
};

const NO_CONTEXT: UsageRingContext =
{
	breakdown: null,
	breakdownFetching: false,
	working: false,
	homeRoot: "/Users/test",
	mcpServers: [],
};

class FakeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
}

/* The section is a lazy chunk; load it once so the popover renders it synchronously on open. */
beforeAll(async () =>
{
	await preloadUsagePopoverContext();
});

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("fetch", async () => new Promise(() => {}));
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

function renderRing(usage: ComposerUsage | null, context?: UsageRingContext, ref?: React.Ref<UsageRingHandle>)
{
	const client = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	return render(
		<QueryClientProvider client={client}>
			<UsageRing usage={usage} context={context} ref={ref} />
		</QueryClientProvider>,
	);
}

function openPopover(): HTMLElement
{
	fireEvent.click(
		screen.getByRole(
			"button",
			{
				name: /^Usage/,
			},
		),
	);
	return screen.getByRole("dialog");
}

function toggle(dialog: HTMLElement): HTMLButtonElement
{
	return within(dialog).getByRole<HTMLButtonElement>(
		"button",
		{
			name: /^Context window/,
		},
	);
}

describe("usage popover context section", () =>
{
	it("shows a disabled Context window toggle and a 4px bar without a breakdown, in place of the plan limits", () =>
	{
		renderRing(CONTEXT_ONLY, NO_CONTEXT);
		const dialog = openPopover();
		const button = toggle(dialog);
		const bar = within(dialog).getByRole(
			"progressbar",
			{
				name: "Context window",
			},
		);
		const fill = bar.firstElementChild as HTMLElement | null;
		expect(
			{
				disabled: button.disabled,
				expanded: button.getAttribute("aria-expanded"),
				text: button.textContent,
				caret: button.querySelector("svg"),
				toggleClass: button.className,
				body: bar.parentElement?.className,
				bar: bar.className,
				track: bar.style.backgroundColor,
				now: bar.getAttribute("aria-valuenow"),
				fill: fill?.className,
				width: fill?.style.width,
				plan: dialog.querySelector("[data-usage-popover-header]"),
				footer: dialog.querySelector("[data-usage-context-updated]"),
			},
		).toStrictEqual(
			{
				disabled: true,
				expanded: null,
				text: "Context window656.2k / 1M (66%)",
				caret: null,
				toggleClass:
					"group flex items-center gap-2 px-lg py-xs min-h-[20px] text-start outline-none focus-visible:shadow-focus rounded",
				body: "mt-pad-xs px-lg pb-xs",
				bar: "h-[4px] rounded-full overflow-hidden",
				track: "var(--chart-reference-tint)",
				now: "66",
				fill: "h-full bg-fill-accent transition-[width]",
				width: "66%",
				plan: null,
				footer: null,
			},
		);
	});

	it("keeps the plan-only body when the usage has a plan window", () =>
	{
		renderRing(
			{
				...CONTEXT_ONLY,
				weekly:
				{
					usedPercentage: 12,
					resetsAt: Date.parse(UPDATED_AT) / 1000 + 86_400,
				},
			},
			{
				...NO_CONTEXT,
				breakdown: BREAKDOWN,
			},
		);
		const dialog = openPopover();
		expect(
			{
				section: dialog.querySelector("[data-usage-context-section]"),
				plan: dialog.querySelector("[data-usage-popover-header]") !== null,
			},
		).toStrictEqual(
			{
				section: null,
				plan: true,
			},
		);
	});

	it("expands the breakdown from the toggle, rotating the caret, and collapses again when the popover reopens", () =>
	{
		renderRing(
			CONTEXT_ONLY,
			{
				...NO_CONTEXT,
				breakdown: BREAKDOWN,
			},
		);
		const dialog = openPopover();
		const before = toggle(dialog).getAttribute("aria-expanded");
		fireEvent.click(toggle(dialog));
		const caret = toggle(dialog).querySelector("svg");
		const opened =
		{
			expanded: toggle(dialog).getAttribute("aria-expanded"),
			rotate: caret?.getAttribute("data-cds-rotate"),
			rows: Array.from(dialog.querySelectorAll("[data-context-card-row] > .flex-1"), (name) => name.textContent),
		};
		fireEvent.keyDown(
			dialog,
			{
				key: "Escape",
			},
		);
		const reopened = openPopover();
		expect(
			{
				before,
				opened,
				reopened: toggle(reopened).getAttribute("aria-expanded"),
			},
		).toStrictEqual(
			{
				before: "false",
				opened:
				{
					expanded: "true",
					rotate: "",
					rows: ["Messages", "System prompt", "Since last update", "Free space"],
				},
				reopened: "false",
			},
		);
	});

	it("shows upstream's loading row while the breakdown loads, expanded", () =>
	{
		renderRing(
			CONTEXT_ONLY,
			{
				...NO_CONTEXT,
				breakdownFetching: true,
			},
		);
		const dialog = openPopover();
		fireEvent.click(toggle(dialog));
		const loading = within(dialog).getByText("Loading context breakdown…");
		expect(
			{
				expanded: toggle(dialog).getAttribute("aria-expanded"),
				row: loading.closest("[data-usage-context-loading]")?.className,
			},
		).toStrictEqual(
			{
				expanded: "true",
				row: "mt-pad-xs px-lg pb-xs flex min-h-6 items-center text-footnote text-secondary",
			},
		);
	});

	it("footnotes a breakdown older than the usage with when it was taken and how it refreshes", () =>
	{
		const footer = (context: UsageRingContext) =>
		{
			renderRing(CONTEXT_ONLY, context);
			const node = openPopover().querySelector("[data-usage-context-updated]");
			const found =
				node === null
					? null
					:
						{
							text: node.textContent.replace(/Last updated .*?\./, "Last updated …."),
							className: node.className,
						};
			cleanup();
			return found;
		};
		const older =
		{
			...BREAKDOWN,
			fetchedAt: "2026-11-04T11:00:00.000Z",
		};
		expect(
			{
				idle: footer(
					{
						...NO_CONTEXT,
						breakdown: older,
					},
				),
				working: footer(
					{
						...NO_CONTEXT,
						breakdown: older,
						working: true,
					},
				)?.text,
				fresh: footer(
					{
						...NO_CONTEXT,
						breakdown: BREAKDOWN,
					},
				),
			},
		).toStrictEqual(
			{
				idle:
				{
					text: "Last updated …. Send a message to refresh.",
					className: "mt-pad-xs px-lg pb-xs text-footnote text-secondary",
				},
				working: "Last updated …. Refreshes when this turn ends.",
				fresh: null,
			},
		);
	});

	it("shows the stale-engine notice in the px-lg inset before the stale footer (upstream c2d611398 X)", () =>
	{
		const notice = (breakdown: ContextBreakdown, engineVersion: string | null) =>
		{
			renderRing(
				CONTEXT_ONLY,
				{
					...NO_CONTEXT,
					breakdown,
					engineVersion,
				},
			);
			const node = openPopover().querySelector("[data-rail-context-stale]");
			const found =
				node === null
					? null
					:
						{
							text: node.textContent,
							className: node.className,
							beforeFooter: node.nextElementSibling?.matches("[data-usage-context-updated]") ?? false,
						};
			cleanup();
			return found;
		};
		const limited: ContextBreakdown =
		{
			...BREAKDOWN,
			categories: [
				{
					name: "Messages",
					tokens: 100_000,
					kind: "used",
				},
				{
					name: "Free space",
					tokens: 100_000,
					kind: "free",
				},
			],
			totalTokens: 100_000,
			rawMaxTokens: 200_000,
			fetchedAt: "2026-11-04T11:00:00.000Z",
			autocompactSource: "unknown-model",
			model: "claude-opus-5-5",
		};
		expect(
			{
				limited: notice(limited, "2.1.400"),
				fresh: notice(BREAKDOWN, "2.1.400"),
			},
		).toStrictEqual(
			{
				limited:
				{
					text: "Limited until Claude Code updates",
					className: "px-lg py-xs text-footnote text-secondary",
					beforeFooter: true,
				},
				fresh: null,
			},
		);
	});

	describe("compact row", () =>
	{
		const withCompact = (state: CompactActionState, onCompact = vi.fn<() => void>()): UsageRingContext => (
		{
			...NO_CONTEXT,
			breakdown: BREAKDOWN,
			compact:
			{
				state,
				onCompact,
			},
		});

		it("insets the compact row px-lg with the auto-compact hint, closing the popover before compacting", async () =>
		{
			const onCompact = vi.fn<() => void>();
			renderRing(
				CONTEXT_ONLY,
				withCompact(
					{
						kind: "enabled",
					},
					onCompact,
				),
			);
			const dialog = openPopover();
			const row = dialog.querySelector("[data-rail-compact-action]");
			const shape =
			{
				className: row?.className,
				hint: row?.querySelector("span[id]")?.textContent,
			};
			fireEvent.click(
				within(dialog).getByRole(
					"button",
					{
						name: "Compact session",
					},
				),
			);
			const calls = [...onCompact.mock.calls];
			await waitFor(() =>
			{
				expect(screen.queryByRole("dialog")).toBeNull();
			});
			expect(
				{
					...shape,
					open: screen.queryByRole("dialog"),
					calls,
				},
			).toStrictEqual(
				{
					className: "flex min-h-[20px] items-center gap-sm px-lg py-xs text-footnote",
					hint: "310k until auto-compact",
					open: null,
					calls: [[]],
				},
			);
		});

		it("disables Compact session behind its reason while replying", () =>
		{
			renderRing(
				CONTEXT_ONLY,
				withCompact(
					{
						kind: "disabled",
						reason: "replying",
					},
				),
			);
			const button = within(openPopover()).getByRole<HTMLButtonElement>(
				"button",
				{
					name: "Compact session",
				},
			);
			expect(
				{
					disabled: button.disabled,
					tabIndex: button.closest("[data-cds-disabled-reason-wrapper]")?.getAttribute("tabindex"),
				},
			).toStrictEqual(
				{
					disabled: true,
					tabIndex: "0",
				},
			);
		});
	});

	it("opens the popover with the section expanded on request (upstream's openRequest context)", () =>
	{
		const ref = createRef<UsageRingHandle>();
		renderRing(
			CONTEXT_ONLY,
			{
				...NO_CONTEXT,
				breakdown: BREAKDOWN,
			},
			ref,
		);
		act(() =>
		{
			ref.current?.openContext();
		});
		expect(toggle(screen.getByRole("dialog")).getAttribute("aria-expanded")).toBe("true");
	});
});
