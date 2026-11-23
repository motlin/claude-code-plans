// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {PrTailGlyph, SessionStateIcon} from "../src/components/status-dot";
import {sessionStateKind} from "../src/lib/session-state";

afterEach(cleanup);

const DOT_WRAPPER = "flex min-h-3.5 min-w-3.5 shrink-0 items-center justify-center";
const PULSE_CLASS =
	"block size-[calc(0.375rem*var(--cds-rem-scale,1))] rounded-full [--cds-text-primary:var(--cds-solid-primary)] [--cds-text-secondary:var(--cds-solid-secondary)] [--cds-text-muted:var(--cds-solid-muted)] forced-colors:!bg-[color:CanvasText]";
const RUNNING_PULSE = (label: string) =>
	`<span role="status" aria-label="${label}" class="${DOT_WRAPPER}"><span class="status-dot contents [--cds-page-bg:transparent]" data-kind="running"><span data-cds="Pulse" class="${PULSE_CLASS} df-tab-dot-running" style="background: var(--cds-text-muted); box-shadow: 0 0 0 0.5px var(--cds-ground, var(--cds-page-bg));"></span></span></span>`;

function markup(element: React.ReactElement): string
{
	return render(element).container.innerHTML;
}

describe("SessionStateIcon", () =>
{
	it("renders awaiting as a static --cds-fill-warning Pulse in a ring-off contents wrapper", () =>
	{
		expect(markup(<SessionStateIcon kind="awaiting" />)).toBe(
			`<span role="status" aria-label="Awaiting input" class="${DOT_WRAPPER}"><span class="status-dot contents [--cds-page-bg:transparent]" data-kind="awaiting"><span data-cds="Pulse" class="${PULSE_CLASS}" style="background: var(--cds-fill-warning); box-shadow: 0 0 0 0.5px var(--cds-ground, var(--cds-page-bg));"></span></span></span>`,
		);
	});

	it("renders running as upstream's blinking df-tab-dot-running Pulse in --cds-text-muted, remapped to the solid muted ink", () =>
	{
		expect(markup(<SessionStateIcon kind="running" />)).toBe(RUNNING_PULSE("Running"));
	});

	it("renders ready as a static --cds-fill-accent Pulse", () =>
	{
		expect(markup(<SessionStateIcon kind="ready" />)).toBe(
			`<span role="status" aria-label="Ready" class="${DOT_WRAPPER}"><span class="status-dot contents [--cds-page-bg:transparent]" data-kind="ready"><span data-cds="Pulse" class="${PULSE_CLASS}" style="background: var(--cds-fill-accent); box-shadow: 0 0 0 0.5px var(--cds-ground, var(--cds-page-bg));"></span></span></span>`,
		);
	});

	it("renders error as upstream's 16px muted Warning triangle, not a dot", () =>
	{
		const {container} = render(<SessionStateIcon kind="error" live={false} />);
		const wrapper = container.firstElementChild;
		const icon = wrapper?.querySelector("svg");
		expect(
			{
				role: wrapper?.getAttribute("role"),
				label: wrapper?.getAttribute("aria-label"),
				wrapperClass: wrapper?.getAttribute("class"),
				iconClass: icon?.getAttribute("class"),
				iconHidden: icon?.getAttribute("aria-hidden"),
				size: [icon?.getAttribute("width"), icon?.getAttribute("height")],
				dot: container.querySelector(".status-dot") !== null,
			},
		).toStrictEqual(
			{
				role: "img",
				label: "Something went wrong",
				wrapperClass: DOT_WRAPPER,
				iconClass:
					"lucide lucide-triangle-exclamation-point lucide-alert-triangle lucide-triangle-alert shrink-0 text-[color:var(--muted-as-secondary,var(--cds-text-muted))]",
				iconHidden: "true",
				size: ["16", "16"],
				dot: false,
			},
		);
	});

	it("renders idle as a hollow muted ring", () =>
	{
		expect(markup(<SessionStateIcon kind="idle" />)).toBe(
			`<span role="img" aria-label="Idle" class="${DOT_WRAPPER}"><span aria-hidden="true" class="block size-[6px] rounded-full border border-current text-ink-muted opacity-50"></span></span>`,
		);
	});

	it("lets the caller override the accessible label", () =>
	{
		expect(markup(<SessionStateIcon kind="running" label="Working" />)).toBe(RUNNING_PULSE("Working"));
	});
});

describe("sessionStateKind", () =>
{
	it("maps each local display state to an upstream icon kind", () =>
	{
		expect(
			(["waiting", "working", "review", "idle", "unknown"] as const).map((state) => [
				state,
				sessionStateKind(state),
			]),
		).toStrictEqual([
			["waiting", "awaiting"],
			["working", "running"],
			["review", "ready"],
			["idle", "idle"],
			["unknown", "idle"],
		]);
	});
});

// Upstream `tT place:"title"`: --df-pr-glyph:16px, with the --df-heading-pitch term on the end padding.
const PR_TAIL_CLASS =
	"flex h-[var(--sb-row-ctl)] min-w-[var(--sb-row-ctl)] shrink-0 items-center justify-end gap-0.5 ps-[calc((var(--sb-row-ctl)-var(--df-pr-glyph))/2)] pe-[calc((var(--sb-row-ctl)-var(--df-pr-glyph))/2+max(0px,var(--df-heading-pitch,0px)-var(--sb-row-ctl)))] text-footnote text-muted-as-secondary";

describe("PrTailGlyph", () =>
{
	it("renders upstream's aria-hidden title tail: a 16px git-coloured glyph per PR state", () =>
	{
		const glyphs = (["opened", "draft", "merged", "closed", "conflicting", "queued"] as const).map((state) =>
		{
			const {container} = render(<PrTailGlyph state={state} entries={[]} />);
			const tail = container.querySelector("[data-pr-glyph]");
			const icon = tail?.firstElementChild;
			const result =
			{
				children: container.children.length,
				hidden: tail?.getAttribute("aria-hidden"),
				state: tail?.getAttribute("data-pr-glyph"),
				className: tail?.getAttribute("class"),
				glyphSize: tail instanceof HTMLElement ? tail.style.getPropertyValue("--df-pr-glyph") : null,
				icon: icon
					?.getAttribute("class")
					?.split(" ")
					.find((name) => name.startsWith("lucide-") && name !== "lucide-icon"),
				size: [icon?.getAttribute("width"), icon?.getAttribute("height")],
				style: icon?.getAttribute("style"),
			};
			cleanup();
			return result;
		});
		const expected = (state: string, icon: string) => (
		{
			children: 1,
			hidden: "true",
			state,
			className: PR_TAIL_CLASS,
			glyphSize: "16px",
			icon,
			size: ["16", "16"],
			style: `color: var(--color-git-${state});`,
		});
		expect(glyphs).toStrictEqual([
			expected("opened", "lucide-git-pull-request"),
			expected("draft", "lucide-git-pull-request-draft"),
			expected("merged", "lucide-git-merge"),
			expected("closed", "lucide-git-pull-request-closed"),
			expected("conflicting", "lucide-git-merge-conflict"),
			expected("queued", "lucide-git-pull-request-arrow"),
		]);
	});

	it("shows upstream's Pull request · {state} tooltip after 500ms when it has no entries, closing at once on leave", () =>
	{
		vi.useFakeTimers();
		try
		{
			const {container} = render(<PrTailGlyph state="draft" entries={[]} />);
			const tail = container.querySelector("[data-pr-glyph]");
			if (tail === null) throw new Error("no tail");
			fireEvent.pointerEnter(tail);
			act(() =>
			{
				vi.advanceTimersByTime(499);
			});
			const at499 = screen.queryByRole("tooltip");
			act(() =>
			{
				vi.advanceTimersByTime(1);
			});
			const at500 = screen.getByRole("tooltip").textContent;
			if (tail.parentElement === null) throw new Error("no anchor");
			fireEvent.pointerLeave(tail.parentElement);
			expect(
				{
					at499,
					at500,
					afterLeave: screen.queryByRole("tooltip"),
				},
			).toStrictEqual(
				{
					at499: null,
					at500: "Pull request · Draft",
					afterLeave: null,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("labels every PR state with upstream's hj words", () =>
	{
		vi.useFakeTimers();
		try
		{
			const texts = (["opened", "draft", "merged", "closed", "conflicting", "queued"] as const).map((state) =>
			{
				const {container} = render(<PrTailGlyph state={state} entries={[]} />);
				const tail = container.querySelector("[data-pr-glyph]");
				if (tail === null) throw new Error("no tail");
				fireEvent.pointerEnter(tail);
				act(() =>
				{
					vi.advanceTimersByTime(500);
				});
				const text = screen.getByRole("tooltip").textContent;
				cleanup();
				return text;
			});
			expect(texts).toStrictEqual([
				"Pull request · Open",
				"Pull request · Draft",
				"Pull request · Merged",
				"Pull request · Closed",
				"Pull request · Merge conflicts",
				"Pull request · Queued",
			]);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("renders the bare glyph with no tooltip on touch devices, as upstream's VA does", () =>
	{
		vi.useFakeTimers();
		vi.stubGlobal("matchMedia", (query: string) => (
		{
			matches: query === "(pointer: coarse), (hover: none)",
			media: query,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		}));
		try
		{
			const {container} = render(<PrTailGlyph state="opened" entries={[]} />);
			const tail = container.querySelector("[data-pr-glyph]");
			if (tail === null) throw new Error("no tail");
			fireEvent.pointerEnter(tail);
			act(() =>
			{
				vi.advanceTimersByTime(1000);
			});
			expect(
				{
					bare: container.firstElementChild === tail,
					tooltip: screen.queryByRole("tooltip"),
				},
			).toStrictEqual(
				{
					bare: true,
					tooltip: null,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});

	it("opens upstream's Pull requests card instead of the tooltip once the PR has an entry", async () =>
	{
		vi.useFakeTimers();
		try
		{
			const url = "https://github.com/o/r/pull/12";
			const {container} = render(
				<PrTailGlyph
					state="opened"
					entries={[
						{
							state: "open",
							repo: "o/r",
							number: 12,
							url,
						},
					]}
				/>,
			);
			const tail = container.querySelector("[data-pr-glyph]");
			if (tail === null) throw new Error("no tail");
			act(() =>
			{
				fireEvent.pointerEnter(
					tail,
					{
						pointerType: "mouse",
					},
				);
				fireEvent.mouseEnter(tail);
				fireEvent.mouseMove(tail);
			});
			await act(async () =>
			{
				await vi.advanceTimersByTimeAsync(300);
			});
			const links = [
				...document.querySelectorAll("[aria-label='Pull requests'] ul[role=list] > li > a[target=_blank]"),
			];
			expect(
				{
					items: links.map((link) => [
						link.parentElement?.getAttribute("title"),
						link.getAttribute("href"),
						link.getAttribute("rel"),
					]),
					tooltip: screen.queryByRole("tooltip"),
					count: tail.querySelector(".tabular-nums"),
				},
			).toStrictEqual(
				{
					items: [[url, url, "noopener noreferrer"]],
					tooltip: null,
					count: null,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("counts two or more entries beside the glyph", () =>
	{
		const entry = (number: number) => (
		{
			state: "open" as const,
			number,
		});
		const {container} = render(<PrTailGlyph state="opened" entries={[entry(1), entry(2)]} />);
		const tail = container.querySelector("[data-pr-glyph]");
		expect(
			[...(tail?.children ?? [])].map((child) => [
				child.tagName.toLowerCase(),
				child.getAttribute("class"),
				child.textContent,
			]),
		).toStrictEqual([
			["svg", "lucide lucide-git-pull-request", ""],
			["span", "tabular-nums", "2"],
		]);
	});
});
