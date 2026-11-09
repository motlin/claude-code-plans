// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {EnvironmentBarLineHost} from "../src/components/home/environment-bar-line";

afterEach(() => {
	cleanup();
});

const SLOT_BG = "rounded bg-[var(--epitaxy-transcript-surface,var(--color-surface-1))]";

function chipsOf(container: HTMLElement) {
	const chips = container.querySelector("[data-testid=environment-bar-row] > div:first-child");
	return {
		chips: chips?.className,
		children: Array.from(chips?.children ?? [], (child) => ({
			testid: child.getAttribute("data-testid"),
			className: child.className,
			text: child.textContent,
		})),
	};
}

describe("environment bar slots", () => {
	it("puts the place and the worktree toggle in upstream's chips group, each in its surface slot", () => {
		const {container} = render(
			<Composer
				variant="home"
				draftKey="home-slots"
				onSend={() => {}}
				environment={<span>place</span>}
				worktreeToggle={<span>wt</span>}
			/>,
		);

		expect(chipsOf(container)).toStrictEqual({
			chips: "flex items-center gap-1 @max-[28.75rem]:basis-full",
			children: [
				{testid: "environment-bar-place", className: `flex shrink ${SLOT_BG}`, text: "place"},
				{testid: null, className: `flex shrink-0 ${SLOT_BG}`, text: "wt"},
			],
		});
	});

	it("leaves the worktree slot out without a toggle", () => {
		const {container} = render(
			<Composer variant="home" draftKey="home-slots" onSend={() => {}} environment={<span>place</span>} />,
		);

		expect(chipsOf(container).children).toStrictEqual([
			{testid: "environment-bar-place", className: `flex shrink ${SLOT_BG}`, text: "place"},
		]);
	});
});

function lineOf(container: HTMLElement) {
	const host = container.querySelector("[data-environment-bar-line-host]");
	const line = host?.querySelector("[data-testid=environment-bar-line]");
	const inner = line?.firstElementChild;
	return {
		host: host?.className,
		line: line?.className ?? null,
		inner: inner === undefined || inner === null ? null : (inner.getAttribute("class") ?? "(none)"),
		innerChild: inner?.firstElementChild?.className ?? null,
		text: line?.textContent ?? null,
	};
}

describe("environment bar line", () => {
	it("paints a blocking line in danger ink inside the zero-height host", () => {
		const {container} = render(<EnvironmentBarLineHost line={{kind: "blocking", content: "x"}} note={null} />);

		expect(lineOf(container)).toStrictEqual({
			host: "relative h-0",
			line: "pointer-events-none absolute inset-x-0 bottom-1.5 px-4 text-footnote text-danger",
			inner: "pointer-events-auto",
			innerChild: null,
			text: "x",
		});
	});

	it("paints a note line in the muted ink", () => {
		const {container} = render(<EnvironmentBarLineHost line={{kind: "note", content: "n"}} note={null} />);

		expect(lineOf(container).line).toBe(
			"pointer-events-none absolute inset-x-0 bottom-1.5 px-4 text-footnote text-muted-as-secondary",
		);
	});

	it("wraps a lone note in upstream's nowrap span under a classless div", () => {
		const {container} = render(<EnvironmentBarLineHost line={null} note={<span>group</span>} />);

		expect(lineOf(container)).toStrictEqual({
			host: "relative h-0",
			line: "pointer-events-none absolute inset-x-0 bottom-1.5 px-4 text-footnote text-muted-as-secondary",
			inner: "(none)",
			innerChild: "flex min-w-0 items-baseline gap-1.5 whitespace-nowrap",
			text: "group",
		});
	});

	it("keeps the empty host without a line or note", () => {
		const {container} = render(<EnvironmentBarLineHost line={null} note={null} />);

		expect(lineOf(container)).toStrictEqual({
			host: "relative h-0",
			line: null,
			inner: null,
			innerChild: null,
			text: null,
		});
	});
});
