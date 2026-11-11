// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {PrTailGlyph, SessionStateIcon} from "../src/components/status-dot";
import {sessionStateKind} from "../src/lib/session-state";

afterEach(cleanup);

const DOT_WRAPPER = "flex min-h-3.5 min-w-3.5 shrink-0 items-center justify-center";
const PULSE_CLASS =
	"block size-[calc(0.375rem*var(--cds-rem-scale,1))] rounded-full forced-colors:!bg-[color:CanvasText]";
const RUNNING_PULSE = (label: string) =>
	`<span role="status" aria-label="${label}" class="${DOT_WRAPPER}"><span class="status-dot contents [--cds-page-bg:transparent]" data-kind="running"><span data-cds="Pulse" class="${PULSE_CLASS} stacks:[--cds-text-muted:var(--cds-fizzy-lake-color-solid-muted)] df-tab-dot-running" style="background: var(--cds-text-muted); box-shadow: 0 0 0 0.5px var(--cds-page-bg);"></span></span></span>`;

function markup(element: React.ReactElement): string {
	return render(element).container.innerHTML;
}

describe("SessionStateIcon", () => {
	it("renders awaiting as a static --cds-fill-warning Pulse in a ring-off contents wrapper", () => {
		expect(markup(<SessionStateIcon kind="awaiting" />)).toBe(
			`<span role="status" aria-label="Awaiting input" class="${DOT_WRAPPER}"><span class="status-dot contents [--cds-page-bg:transparent]" data-kind="awaiting"><span data-cds="Pulse" class="${PULSE_CLASS}" style="background: var(--cds-fill-warning); box-shadow: 0 0 0 0.5px var(--cds-page-bg);"></span></span></span>`,
		);
	});

	it("renders running as upstream's blinking df-tab-dot-running Pulse in --cds-text-muted, remapped to the solid muted ink under fizzy colour", () => {
		expect(markup(<SessionStateIcon kind="running" />)).toBe(RUNNING_PULSE("Running"));
	});

	it("renders ready as a static --cds-fill-accent Pulse", () => {
		expect(markup(<SessionStateIcon kind="ready" />)).toBe(
			`<span role="status" aria-label="Ready" class="${DOT_WRAPPER}"><span class="status-dot contents [--cds-page-bg:transparent]" data-kind="ready"><span data-cds="Pulse" class="${PULSE_CLASS}" style="background: var(--cds-fill-accent); box-shadow: 0 0 0 0.5px var(--cds-page-bg);"></span></span></span>`,
		);
	});

	it("renders error as upstream's 16px warning-coloured TriangleAlert, not a dot", () => {
		const {container} = render(<SessionStateIcon kind="error" live={false} />);
		const wrapper = container.firstElementChild;
		const icon = wrapper?.querySelector("svg");
		expect({
			role: wrapper?.getAttribute("role"),
			label: wrapper?.getAttribute("aria-label"),
			wrapperClass: wrapper?.getAttribute("class"),
			iconClass: icon?.getAttribute("class"),
			iconHidden: icon?.getAttribute("aria-hidden"),
			size: [icon?.getAttribute("width"), icon?.getAttribute("height")],
			dot: container.querySelector(".status-dot") !== null,
		}).toStrictEqual({
			role: "img",
			label: "Error",
			wrapperClass: DOT_WRAPPER,
			iconClass: "lucide lucide-triangle-alert shrink-0 text-upstream-warning",
			iconHidden: "true",
			size: ["16", "16"],
			dot: false,
		});
	});

	it("renders idle as a hollow muted ring", () => {
		expect(markup(<SessionStateIcon kind="idle" />)).toBe(
			`<span role="img" aria-label="Idle" class="${DOT_WRAPPER}"><span aria-hidden="true" class="block size-[6px] rounded-full border border-current text-ink-muted opacity-50"></span></span>`,
		);
	});

	it("lets the caller override the accessible label", () => {
		expect(markup(<SessionStateIcon kind="running" label="Working" />)).toBe(RUNNING_PULSE("Working"));
	});
});

describe("sessionStateKind", () => {
	it("maps each local display state to an upstream icon kind", () => {
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

describe("PrTailGlyph", () => {
	it("renders upstream's aria-hidden title tail: a 16px git-coloured glyph per PR state", () => {
		const glyphs = (["opened", "draft", "merged", "closed", "conflicting", "queued"] as const).map((state) => {
			const {container} = render(<PrTailGlyph state={state} />);
			const tail = container.querySelector("[data-pr-glyph]");
			const icon = tail?.firstElementChild;
			const result = {
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
		const expected = (state: string, icon: string) => ({
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

	it("shows upstream's Pull request · {state} tooltip on hover", () => {
		vi.useFakeTimers();
		try {
			const {container} = render(<PrTailGlyph state="draft" />);
			const tail = container.querySelector("[data-pr-glyph]");
			if (tail === null) throw new Error("no tail");
			fireEvent.pointerEnter(tail);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			expect(screen.getByRole("tooltip").textContent).toBe("Pull request · Draft");
		} finally {
			vi.useRealTimers();
		}
	});
});
