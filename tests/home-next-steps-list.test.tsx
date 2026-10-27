// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useEffect, useRef, useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {NextStepsList} from "../src/components/home/start-card";
import {onHomeComposerFocusRequest} from "../src/lib/home-composer-focus";
import {selectNextSteps, type NextStepCandidate} from "../src/lib/home-next-steps";

function blocked(n: number): NextStepCandidate[] {
	return Array.from({length: n}, (_, index) => ({
		id: "waiting-session",
		subject: `s${index + 1}`,
		stamp: 100,
		title: `Task ${index + 1}`,
		detail: index % 2 === 0 ? "Asked a question" : "Needs permission",
	}));
}

function rowsOf(n: number) {
	return selectNextSteps({candidates: blocked(n), dismissed: {}});
}

function FakeComposer() {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => onHomeComposerFocusRequest(() => ref.current?.focus()), []);
	return <textarea ref={ref} aria-label="Prompt" />;
}

/** A list whose dismiss removes the rows a little later, like React Query's batched observer update. */
function DismissingList({n, onEmptyFocus}: Readonly<{n: number; onEmptyFocus?: () => void}>) {
	const [candidates, setCandidates] = useState(() => blocked(n));
	return (
		<NextStepsList
			rows={selectNextSteps({candidates, dismissed: {}})}
			onOpen={() => {}}
			onDismiss={(dismissed) => {
				setTimeout(() => {
					setCandidates((previous) => previous.filter((c) => !dismissed.includes(c)));
				}, 50);
			}}
			{...(onEmptyFocus === undefined ? {} : {onEmptyFocus})}
		/>
	);
}

/** Makes the element report `:focus-visible`, as a keyboard-focused button does. */
function asFocusVisible(element: HTMLElement): HTMLElement {
	const matches = element.matches.bind(element);
	Object.defineProperty(element, "matches", {
		value: (selector: string) => selector === ":focus-visible" || matches(selector),
	});
	return element;
}

/** Waits out DismissingList's deferred removal. */
async function settle() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	});
}

function rowTexts() {
	return [...document.querySelectorAll("[aria-label='Next steps'] > li [data-next-step-open]")].map(
		(button) => button.textContent,
	);
}

afterEach(() => {
	cleanup();
});

describe("NextStepsList", () => {
	it("renders Blocked rows with their detail and a touch-revealed dismiss", () => {
		render(<NextStepsList rows={rowsOf(2)} onOpen={() => {}} onDismiss={() => {}} />);

		const list = screen.getByRole("list", {name: "Next steps"});
		const items = within(list).getAllByRole("listitem");
		expect(
			items.map((item) => ({
				text: item.querySelector("[data-next-step-open]")?.textContent,
				status: item.querySelector(".text-upstream-warning")?.textContent,
				dismiss: item.querySelector("[data-next-step-dismiss]")?.getAttribute("aria-label"),
			})),
		).toStrictEqual([
			{
				text: "Blocked Task 1Asked a question",
				status: "Blocked",
				dismiss: "Dismiss “Task 1”",
			},
			{
				text: "Blocked Task 2Needs permission",
				status: "Blocked",
				dismiss: "Dismiss “Task 2”",
			},
		]);
		const dismissClass = screen
			.getByRole("button", {name: "Dismiss “Task 1”"})
			.parentElement!.parentElement!.className.split(" ");
		expect(
			["opacity-0", "pointer-coarse:opacity-100", "[@media(hover:none)]:opacity-100"].map((token) =>
				dismissClass.includes(token),
			),
		).toStrictEqual([true, true, true]);
	});

	it("uses upstream's row recipe: keyed li, group/row wrapper, reveal-only spacer and dismiss slot", () => {
		const {container} = render(<NextStepsList rows={rowsOf(1)} onOpen={() => {}} onDismiss={() => {}} />);

		const item = container.querySelector("li")!;
		const wrapper = item.firstElementChild!;
		const button = item.querySelector("[data-next-step-open]")!;
		const line = button.querySelector("[data-next-step-line]")!;
		const [title, detail] = [...line.children];
		const dismiss = item.querySelector("[data-next-step-dismiss]")!;
		expect({
			key: item.dataset["rowKey"],
			list: container.querySelector("ul")!.className,
			wrapper: wrapper.className,
			button: button.className,
			inner: line.parentElement!.className,
			line: line.className,
			title: title?.className,
			detail: detail?.className,
			spacer: button.querySelector("[data-next-step-spacer]")?.outerHTML,
			slot: dismiss.parentElement!.parentElement!.className,
			dismiss: dismiss.className,
		}).toStrictEqual({
			key: "waiting-session:s1",
			list: "card-ring flex w-80 max-w-full shrink-0 flex-col rounded-card bg-surface-1 gap-0.5 p-1 [[data-start-card-setup-hidden]_&]:hidden",
			wrapper: "group/row relative",
			button: "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-[13px]/5 outline-none group-hover/row:bg-fill-ghost-hover group-has-[:focus-visible]/row:bg-fill-ghost-hover group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden",
			inner: "flex min-w-0 flex-1 items-center gap-1",
			line: "flex h-5 min-w-0 items-baseline gap-x-2 overflow-hidden whitespace-nowrap flex-wrap",
			title: "min-w-0 max-w-full truncate text-secondary",
			detail: "min-w-0 max-w-max grow basis-24 truncate text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary",
			spacer: '<span aria-hidden="true" data-next-step-spacer="true" class="hidden shrink-0 items-center group-hover/row:flex group-has-[:focus-visible]/row:flex group-has-[[aria-expanded=true]]/row:flex touch:flex -ms-2"><span class="w-6"></span></span>',
			slot: "pointer-events-none absolute inset-y-0 end-1 flex items-center opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 group-has-[[aria-expanded=true]]/row:opacity-100 pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
			dismiss:
				"pointer-events-auto flex size-6 items-center justify-center rounded-r5 text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
		});
	});

	it("keys the rest row blocked-sessions", () => {
		const {container} = render(<NextStepsList rows={rowsOf(5)} onOpen={() => {}} onDismiss={() => {}} />);

		expect([...container.querySelectorAll("li")].map((li) => li.dataset["rowKey"])).toStrictEqual([
			"waiting-session:s1",
			"waiting-session:s2",
			"blocked-sessions",
		]);
	});

	it("shows a failing PR row without the Blocked status", () => {
		const rows = selectNextSteps({
			candidates: [
				...blocked(1),
				{
					id: "pr-ci-failed",
					subject: "p1",
					stamp: 100,
					title: "Fix the failing checks",
					detail: "2 failing checks",
				},
			],
			dismissed: {},
		});
		render(<NextStepsList rows={rows} onOpen={() => {}} onDismiss={() => {}} />);

		expect(
			screen.getAllByRole("listitem").map((item) => item.querySelector("[data-next-step-open]")?.textContent),
		).toStrictEqual(["Blocked Task 1Asked a question", "Fix the failing checks2 failing checks"]);
	});

	it("opens the session on press", () => {
		const onOpen = vi.fn<(sessionId: string) => void>();
		render(<NextStepsList rows={rowsOf(2)} onOpen={onOpen} onDismiss={() => {}} />);

		fireEvent.click(screen.getByRole("button", {name: /^Blocked Task 2/}));

		expect(onOpen.mock.calls).toStrictEqual([["s2"]]);
	});

	it("lists the remaining sessions in the rest row's popup and dismisses them together", async () => {
		const onOpen = vi.fn<(sessionId: string) => void>();
		const onDismiss = vi.fn<(candidates: NextStepCandidate[]) => void>();
		render(<NextStepsList rows={rowsOf(5)} onOpen={onOpen} onDismiss={onDismiss} />);

		fireEvent.click(screen.getByRole("button", {name: "Dismiss 3 blocked sessions"}));
		fireEvent.click(
			screen.getByRole("button", {
				name: "Claude is blocked in 3 more sessions",
			}),
		);
		const popup = await screen.findByRole("dialog");
		const names = within(popup)
			.getAllByRole("button")
			.map((button) => button.textContent);
		const dismissButtons = popup.querySelectorAll("[aria-label^=Dismiss]").length;
		fireEvent.click(within(popup).getByRole("button", {name: /Task 4/}));
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});

		expect({
			dismissed: onDismiss.mock.calls.map(([candidates]) => candidates.map((c) => c.subject)),
			dismissButtons,
			names,
			opened: onOpen.mock.calls,
			trigger: screen
				.getByRole("button", {name: "Claude is blocked in 3 more sessions"})
				.getAttribute("aria-expanded"),
		}).toStrictEqual({
			dismissed: [["s3", "s4", "s5"]],
			dismissButtons: 0,
			names: ["Task 3Asked a question", "Task 4Needs permission", "Task 5Asked a question"],
			opened: [["s4"]],
			trigger: "false",
		});
	});

	it("anchors the rest popup bottom/start at least as wide as its trigger, a list of keyed rows", async () => {
		render(<NextStepsList rows={rowsOf(5)} onOpen={() => {}} onDismiss={() => {}} />);
		const trigger = screen.getByRole("button", {name: "Claude is blocked in 3 more sessions"});

		fireEvent.click(trigger);
		const popup = await screen.findByRole("dialog");
		const list = within(popup).getByRole("list");

		expect({
			align: popup.getAttribute("data-align"),
			side: popup.getAttribute("data-side"),
			popupClass: popup.className,
			listClass: list.className,
			keys: [...list.children].map((li) => li.getAttribute("data-row-key")),
			expanded: trigger.getAttribute("aria-expanded"),
			caret: trigger.querySelector("svg")?.getAttribute("class"),
			triggerClass: trigger.className,
		}).toStrictEqual({
			align: "start",
			side: "bottom",
			popupClass:
				"max-h-[var(--available-height)] min-w-[var(--anchor-width)] max-w-[min(26rem,90vw)] overflow-y-auto rounded-r7 bg-surface-3 shadow-[var(--menu-shadow)] break-words outline-none",
			listClass: "flex flex-col gap-0.5 p-1",
			keys: ["waiting-session:s3", "waiting-session:s4", "waiting-session:s5"],
			expanded: "true",
			caret: "lucide lucide-chevron-down size-3 shrink-0 text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary",
			triggerClass: expect.stringContaining("group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover"),
		});
	});

	it("moves focus into the first listed row on open and back to the trigger on Escape", async () => {
		render(<NextStepsList rows={rowsOf(5)} onOpen={() => {}} onDismiss={() => {}} />);
		const trigger = screen.getByRole("button", {name: "Claude is blocked in 3 more sessions"});

		fireEvent.click(trigger);
		const popup = await screen.findByRole("dialog");
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 50);
			});
		});
		const onOpenFocus = document.activeElement?.textContent;
		fireEvent.keyDown(popup, {key: "Escape"});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 50);
			});
		});

		expect({onOpenFocus, afterEscape: document.activeElement === trigger}).toStrictEqual({
			onOpenFocus: "Task 3Asked a question",
			afterEscape: true,
		});
	});

	it("moves focus to the composer after a pointer dismiss", async () => {
		render(
			<>
				<DismissingList n={3} />
				<FakeComposer />
			</>,
		);

		fireEvent.click(screen.getByRole("button", {name: "Dismiss “Task 2”"}));
		await settle();

		expect({
			focused: document.activeElement?.getAttribute("aria-label"),
			rows: rowTexts(),
		}).toStrictEqual({
			focused: "Prompt",
			rows: ["Blocked Task 1Asked a question", "Blocked Task 3Asked a question"],
		});
	});

	it("moves focus to the last remaining row after a keyboard dismiss", async () => {
		render(
			<>
				<DismissingList n={3} />
				<FakeComposer />
			</>,
		);

		fireEvent.click(asFocusVisible(screen.getByRole("button", {name: "Dismiss “Task 2”"})));
		await settle();

		expect({
			focused: document.activeElement?.textContent,
			rows: rowTexts(),
		}).toStrictEqual({
			focused: "Blocked Task 3Asked a question",
			rows: ["Blocked Task 1Asked a question", "Blocked Task 3Asked a question"],
		});
	});

	it("dismisses the rest row by keyboard and focuses the last remaining row", async () => {
		render(
			<>
				<DismissingList n={5} />
				<FakeComposer />
			</>,
		);

		fireEvent.click(asFocusVisible(screen.getByRole("button", {name: "Dismiss 3 blocked sessions"})));
		await settle();

		expect({
			focused: document.activeElement?.textContent,
			rows: rowTexts(),
		}).toStrictEqual({
			focused: "Blocked Task 2Needs permission",
			rows: ["Blocked Task 1Asked a question", "Blocked Task 2Needs permission"],
		});
	});

	it("hands focus to onEmptyFocus when a keyboard dismiss empties the list", async () => {
		const onEmptyFocus = vi.fn<() => void>();
		render(<DismissingList n={1} onEmptyFocus={onEmptyFocus} />);

		fireEvent.click(asFocusVisible(screen.getByRole("button", {name: "Dismiss “Task 1”"})));
		await settle();

		expect({calls: onEmptyFocus.mock.calls, rows: rowTexts()}).toStrictEqual({calls: [[]], rows: []});
	});

	it("opens a start-aligned stacked title + detail tooltip above a row, described by a hidden title span", () => {
		vi.useFakeTimers();
		try {
			const {container} = render(<NextStepsList rows={rowsOf(1)} onOpen={() => {}} onDismiss={() => {}} />);
			const button = container.querySelector<HTMLButtonElement>("[data-next-step-open]")!;
			const describedBy = button.getAttribute("aria-describedby");
			const target = describedBy === null ? null : document.getElementById(describedBy);

			fireEvent.pointerEnter(button.parentElement!);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const tooltip = screen.getByRole("tooltip");

			expect({
				target: target?.outerHTML.replace(/id="[^"]+"/, 'id=""'),
				side: tooltip.dataset["side"],
				align: tooltip.dataset["align"],
				parts: [...tooltip.children].map((child) => child.textContent),
				stacked: tooltip.className.includes("max-w-[min(480px,calc(100vw-16px))]"),
				startEdge: tooltip.className.split(" ").includes("left-0"),
			}).toStrictEqual({
				target: '<span id="" hidden="">Task 1</span>',
				side: "top",
				align: "start",
				parts: ["Task 1", "Asked a question"],
				stacked: true,
				startEdge: true,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows a centred Dismiss tooltip over the X and no tooltip on the rest row", () => {
		vi.useFakeTimers();
		try {
			const {container} = render(<NextStepsList rows={rowsOf(5)} onOpen={() => {}} onDismiss={() => {}} />);
			const rest = screen.getByRole("button", {name: "Claude is blocked in 3 more sessions"});

			fireEvent.pointerEnter(rest);
			fireEvent.focus(rest);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const restTooltips = screen.queryAllByRole("tooltip").length;
			fireEvent.blur(rest);
			fireEvent.pointerLeave(rest);

			const dismiss = container.querySelector("li [data-next-step-dismiss]")!;
			fireEvent.pointerEnter(dismiss.parentElement!);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const tooltip = screen.getByRole("tooltip");

			expect({
				restTooltips,
				text: tooltip.textContent,
				side: tooltip.dataset["side"],
				align: tooltip.dataset["align"],
			}).toStrictEqual({restTooltips: 0, text: "Dismiss", side: "top", align: "center"});
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders nothing without rows", () => {
		const {container} = render(<NextStepsList rows={[]} onOpen={() => {}} onDismiss={() => {}} />);

		expect(container.innerHTML).toBe("");
	});
});

function listOf(candidates: NextStepCandidate[], onDismiss: (candidates: NextStepCandidate[]) => void = () => {}) {
	return (
		<NextStepsList rows={selectNextSteps({candidates, dismissed: {}})} onOpen={() => {}} onDismiss={onDismiss} />
	);
}

function subjects(...ids: number[]): NextStepCandidate[] {
	const all = blocked(Math.max(...ids));
	return ids.map((id) => all[id - 1]!);
}

describe("NextStepsList hold", () => {
	it("freezes the rows while the pointer is over the list and lets a new one in on leave", () => {
		const {rerender} = render(listOf(blocked(3)));
		const list = screen.getByRole("list", {name: "Next steps"});

		fireEvent.pointerEnter(list);
		rerender(listOf(blocked(4)));
		const held = rowTexts();
		fireEvent.pointerLeave(list);

		expect({held, released: rowTexts()}).toStrictEqual({
			held: [
				"Blocked Task 1Asked a question",
				"Blocked Task 2Needs permission",
				"Blocked Task 3Asked a question",
			],
			released: [
				"Blocked Task 1Asked a question",
				"Blocked Task 2Needs permission",
				"Claude is blocked in 2 more sessions",
			],
		});
	});

	it("holds while focus is inside the list, still applies removals, and releases on blur out", () => {
		const {rerender} = render(listOf(blocked(3)));
		const first = screen.getByRole("button", {name: /^Blocked Task 1/});

		fireEvent.focus(first);
		rerender(listOf(subjects(1, 3, 4)));
		const held = rowTexts();
		fireEvent.blur(first, {relatedTarget: null});

		expect({held, released: rowTexts()}).toStrictEqual({
			held: ["Blocked Task 1Asked a question", "Blocked Task 3Asked a question"],
			released: [
				"Blocked Task 1Asked a question",
				"Blocked Task 3Asked a question",
				"Blocked Task 4Needs permission",
			],
		});
	});

	it("releases the hold when the focused row disappears", () => {
		const {rerender} = render(listOf(blocked(3)));

		fireEvent.focus(screen.getByRole("button", {name: /^Blocked Task 2/}));
		rerender(listOf(subjects(1, 3, 4)));

		expect(rowTexts()).toStrictEqual([
			"Blocked Task 1Asked a question",
			"Blocked Task 3Asked a question",
			"Blocked Task 4Needs permission",
		]);
	});
});

describe("NextStepsList double-click guard", () => {
	function RemovingList({onDismiss}: Readonly<{onDismiss: (candidates: NextStepCandidate[]) => void}>) {
		const [candidates, setCandidates] = useState(() => blocked(3));
		return listOf(candidates, (dismissed) => {
			onDismiss(dismissed);
			setCandidates((previous) => previous.filter((c) => !dismissed.includes(c)));
		});
	}

	it("swallows a click within 500ms of one on a row that has since gone", () => {
		let now = 1000;
		const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
		try {
			const onDismiss = vi.fn<(candidates: NextStepCandidate[]) => void>();
			render(<RemovingList onDismiss={onDismiss} />);

			fireEvent.click(screen.getByRole("button", {name: "Dismiss “Task 1”"}), {detail: 1});
			now += 200;
			fireEvent.click(screen.getByRole("button", {name: "Dismiss “Task 2”"}), {detail: 2});
			const afterDoubleClick = rowTexts();
			now += 600;
			fireEvent.click(screen.getByRole("button", {name: "Dismiss “Task 2”"}), {detail: 1});

			expect({
				dismissed: onDismiss.mock.calls.map(([candidates]) => candidates.map((c) => c.subject)),
				afterDoubleClick,
			}).toStrictEqual({
				dismissed: [["s1"], ["s2"]],
				afterDoubleClick: ["Blocked Task 2Needs permission", "Blocked Task 3Asked a question"],
			});
		} finally {
			clock.mockRestore();
		}
	});

	it("lets a quick second click through when the first click's row is still there", () => {
		let now = 1000;
		const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
		try {
			const onOpen = vi.fn<(sessionId: string) => void>();
			render(<NextStepsList rows={rowsOf(2)} onOpen={onOpen} onDismiss={() => {}} />);

			fireEvent.click(screen.getByRole("button", {name: /^Blocked Task 1/}), {detail: 1});
			now += 100;
			fireEvent.click(screen.getByRole("button", {name: /^Blocked Task 2/}), {detail: 1});

			expect(onOpen.mock.calls).toStrictEqual([["s1"], ["s2"]]);
		} finally {
			clock.mockRestore();
		}
	});
});
