// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {PrTailGlyph, SessionStateIcon} from "../src/components/status-dot";
import {sessionStateKind} from "../src/lib/session-state";

afterEach(cleanup);

const DOT_WRAPPER = "flex min-h-3.5 min-w-3.5 shrink-0 items-center justify-center";

function markup(element: React.ReactElement): string {
	return render(element).container.innerHTML;
}

describe("SessionStateIcon", () => {
	it("renders awaiting as an amber status dot", () => {
		expect(markup(<SessionStateIcon kind="awaiting" />)).toBe(
			`<span role="status" aria-label="Awaiting input" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="awaiting"></span></span>`,
		);
	});

	it("renders running as a blinking status dot", () => {
		expect(markup(<SessionStateIcon kind="running" />)).toBe(
			`<span role="status" aria-label="Running" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="running"></span></span>`,
		);
	});

	it("renders ready as an accent status dot", () => {
		expect(markup(<SessionStateIcon kind="ready" />)).toBe(
			`<span role="status" aria-label="Ready" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="ready"></span></span>`,
		);
	});

	it("renders error as a danger status dot", () => {
		expect(markup(<SessionStateIcon kind="error" />)).toBe(
			`<span role="status" aria-label="Error" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="error"></span></span>`,
		);
	});

	it("renders idle as a hollow muted ring", () => {
		expect(markup(<SessionStateIcon kind="idle" />)).toBe(
			`<span role="img" aria-label="Idle" class="${DOT_WRAPPER}"><span aria-hidden="true" class="block size-[6px] rounded-full border border-current text-ink-muted opacity-50"></span></span>`,
		);
	});

	it("lets the caller override the accessible label", () => {
		expect(markup(<SessionStateIcon kind="running" label="Working" />)).toBe(
			`<span role="status" aria-label="Working" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="running"></span></span>`,
		);
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

const PR_TAIL_CLASS =
	"flex h-[var(--sb-row-ctl)] min-w-[var(--sb-row-ctl)] shrink-0 items-center justify-end gap-0.5 ps-[calc((var(--sb-row-ctl)-12px)/2)] pe-[calc((var(--sb-row-ctl)-12px)/2)] text-footnote text-ink-muted";

describe("PrTailGlyph", () => {
	it("renders upstream's aria-hidden title tail: a 12px git-coloured glyph per PR state", () => {
		const glyphs = (["opened", "draft", "merged", "closed", "conflicting", "queued"] as const).map((state) => {
			const {container} = render(<PrTailGlyph state={state} />);
			const tail = container.querySelector("[data-pr-glyph]");
			const icon = tail?.firstElementChild;
			const result = {
				children: container.children.length,
				hidden: tail?.getAttribute("aria-hidden"),
				state: tail?.getAttribute("data-pr-glyph"),
				className: tail?.getAttribute("class"),
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
			icon,
			size: ["12", "12"],
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
