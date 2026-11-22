// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ChangesFindingsBar} from "../src/components/changes/changes-findings-bar";
import {clearDiffScrollTarget, diffScrollTarget} from "../src/lib/diff-scroll-target";
import type {ReviewFinding} from "../src/lib/review-diff";
import {clearReviewFindingCursor, currentReviewFinding} from "../src/lib/review-finding-cursor";

const SESSION = "findings-bar-session";

const finding = (id: string, extra: Partial<ReviewFinding> = {}): ReviewFinding => (
{
	id,
	file: `src/${id}.ts`,
	side: "new",
	line: 3,
	severity: "medium",
	title: `Fake finding ${id}`,
	body: "Fake body.",
	resolved: false,
	...extra,
});

const THREE = [
	finding("a"),
	finding(
		"b",
		{
			endLine: 7,
		},
	),
	finding(
		"c",
		{
			side: "old",
			line: 2,
		},
	),
];

function renderBar(findings: readonly ReviewFinding[], onClose = vi.fn<() => void>(), onApplyFixes?: () => void)
{
	return render(
		<ChangesFindingsBar
			sessionId={SESSION}
			findings={findings}
			onClose={onClose}
			{...(onApplyFixes === undefined
				? {}
				:
					{
						onApplyFixes,
					})}
		/>,
	);
}

function button(name: string): HTMLButtonElement
{
	const element = screen.getByRole(
		"button",
		{
			name,
		},
	);
	if (!(element instanceof HTMLButtonElement)) throw new Error(`${name} is not a button`);
	return element;
}

async function flushTimers()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

afterEach(() =>
{
	cleanup();
	clearReviewFindingCursor(SESSION);
	clearDiffScrollTarget(SESSION);
});

describe("ChangesFindingsBar (upstream c9bd7af9c zw)", () =>
{
	it("renders nothing without findings", () =>
	{
		const {container} = renderBar([]);

		expect(container.firstChild).toBeNull();
	});

	it("shows a lone finding's count and Close, with no arrows, in upstream's subheader classes", () =>
	{
		const {container} = renderBar([finding("a")], vi.fn<() => void>(), vi.fn<() => void>());
		const root = container.firstElementChild;
		const toolbar = screen.getByRole(
			"toolbar",
			{
				name: "Code review controls",
			},
		);
		const wrap = toolbar.firstElementChild?.firstElementChild;

		expect(
			{
				root: root?.className,
				toolbarParent: toolbar.parentElement === root,
				wrap: wrap?.className,
				leading: wrap?.firstElementChild?.className,
				trailing: wrap?.lastElementChild?.className,
				status: screen.getByRole("status").className,
				text: screen.getByRole("status").textContent,
				spark: root?.querySelector('svg[data-cds="Spark"]')?.getAttribute("width"),
				buttons: [...(root?.querySelectorAll("button") ?? [])].map(
					(element) => element.getAttribute("aria-label") ?? element.textContent,
				),
			},
		).toStrictEqual(
			{
				root: "epitaxy-panel-subheader shrink-0 bg-alpha-1",
				toolbarParent: true,
				wrap: "flex min-w-0 flex-1 items-center gap-[4px] min-h-control flex-wrap ps-[calc(0.25rem*var(--cds-rem-scale,1))]",
				leading: "flex h-control items-center gap-1 self-start",
				trailing: "flex min-w-min flex-1 flex-wrap-reverse items-center justify-end gap-1",
				status: "text-body text-muted-as-secondary whitespace-nowrap tabular-nums",
				text: "Finding 1 of 1",
				spark: "16",
				buttons: ["Apply fixes", "Close findings bar"],
			},
		);
	});

	it("steps through findings without wrapping, scrolling fuzzily to each one's end line on its side", () =>
	{
		renderBar(THREE);
		const start =
		{
			text: screen.getByRole("status").textContent,
			previous: button("Previous finding").disabled,
			next: button("Next finding").disabled,
		};
		fireEvent.click(button("Next finding"));
		const second =
		{
			text: screen.getByRole("status").textContent,
			current: currentReviewFinding(SESSION),
			target: diffScrollTarget(SESSION),
		};
		fireEvent.click(button("Next finding"));
		fireEvent.click(button("Next finding"));

		expect(
			{
				start,
				second,
				end:
				{
					text: screen.getByRole("status").textContent,
					previous: button("Previous finding").disabled,
					next: button("Next finding").disabled,
					target: diffScrollTarget(SESSION),
				},
			},
		).toStrictEqual(
			{
				start:
				{
					text: "Finding 1 of 3",
					previous: true,
					next: false,
				},
				second:
				{
					text: "Finding 2 of 3",
					current: "b",
					target:
					{
						filePath: "src/b.ts",
						nonce: 1,
						fuzzy: true,
						anchor:
						{
							side: "additions",
							line: 7,
						},
					},
				},
				end:
				{
					text: "Finding 3 of 3",
					previous: false,
					next: true,
					target:
					{
						filePath: "src/c.ts",
						nonce: 2,
						fuzzy: true,
						anchor:
						{
							side: "deletions",
							line: 2,
						},
					},
				},
			},
		);
	});

	it("is one roving tab stop: Apply fixes holds it and ArrowRight walks the Previous reason wrapper to Next", () =>
	{
		renderBar(THREE, vi.fn<() => void>(), vi.fn<() => void>());
		const apply = button("Apply fixes");
		const previousWrapper = button("Previous finding").parentElement;
		const tabIndexes = [apply, previousWrapper, button("Next finding"), button("Close findings bar")].map(
			(element) => element?.getAttribute("tabindex"),
		);
		const arrowRight = () =>
		{
			const from = document.activeElement;
			if (from !== null)
				fireEvent.keyDown(
					from,
					{
						key: "ArrowRight",
					},
				);
			return document.activeElement;
		};
		apply.focus();

		expect(
			{
				tabIndexes,
				first: arrowRight() === previousWrapper,
				second: arrowRight()?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				tabIndexes: ["0", "-1", "-1", "-1"],
				first: true,
				second: "Next finding",
			},
		);
	});

	it("hands keyboard focus to the other arrow when stepping disables the focused one", async () =>
	{
		renderBar([finding("a"), finding("b")]);
		const next = button("Next finding");
		next.focus();
		fireEvent.click(next);
		await flushTimers();

		expect(document.activeElement?.getAttribute("aria-label")).toBe("Previous finding");
	});

	it("closes through onClose and applies through onApplyFixes", () =>
	{
		const onClose = vi.fn<() => void>();
		const onApplyFixes = vi.fn<() => void>();
		renderBar(THREE, onClose, onApplyFixes);
		fireEvent.click(button("Close findings bar"));
		fireEvent.click(button("Apply fixes"));

		expect(
			{
				closed: onClose.mock.calls.length,
				applied: onApplyFixes.mock.calls.length,
			},
		).toStrictEqual(
			{
				closed: 1,
				applied: 1,
			},
		);
	});
});
