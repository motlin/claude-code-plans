// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {PermissionCard} from "../src/components/permission-card";
import {QuestionCard} from "../src/components/question-card";
import {compileAll, loadDesignSystem} from "./helpers/tailwind-design-system";

afterEach(cleanup);

function permissionChrome() {
	const container = render(
		<PermissionCard title={{action: "run", meta: null}} detail="ls" canAnswer onDecision={async () => {}} />,
	).container;
	const classOf = (element: Element | null) => element?.getAttribute("class") ?? null;
	return {
		root: container.querySelector("[data-approval-card-root]"),
		card: classOf(container.querySelector("[data-approval-card-root]")),
		actions: classOf(container.querySelector("[data-approval-card-actions]")),
		secondary: classOf(screen.getByRole("button", {name: /^Deny/})),
		primary: classOf(screen.getByRole("button", {name: /^Allow once/})),
	};
}

describe("approval card chrome", () => {
	// Upstream approval cards carry data-fixed-code-size, so their code keeps the default size under
	// Settings ▸ Code font size; the detail opts into the hook class that the exemption rule matches.
	it("fixes the card's code size with upstream's data-fixed-code-size root and epitaxy-code-size detail", () => {
		const {root} = permissionChrome();

		expect({
			fixed: root?.getAttribute("data-fixed-code-size"),
			detail: root?.querySelector("[data-permission-detail]")?.classList.contains("epitaxy-code-size"),
		}).toStrictEqual({fixed: "", detail: true});
	});

	// Upstream's cds host shell `Re` (shared-40, 2026-11-10) marks every un-themed approval card root; the themed
	// AskUserQuestion card (`epitaxy-question-card`) has no mark.
	it("marks the permission card root with upstream's data-approval-prompt, and not the question card", () => {
		const {root} = permissionChrome();
		cleanup();
		const question = render(
			<QuestionCard questions={[{question: "Pick one?", options: [{label: "Yes"}]}]} onSubmit={async () => {}} />,
		).container.querySelector("[data-approval-card-root]");
		expect({
			permission: root?.getAttribute("data-approval-prompt"),
			question: question?.hasAttribute("data-approval-prompt"),
		}).toStrictEqual({permission: "", question: false});
	});

	it("rounds the card with upstream's rounded-card (cds radius + 4px), not the fixed 10px rounded-r7", () => {
		const classes = permissionChrome().card?.split(/\s+/) ?? [];
		expect({card: classes.includes("rounded-card"), r7: classes.includes("rounded-r7")}).toStrictEqual({
			card: true,
			r7: false,
		});
	});

	it("makes the permission card its own container and stacks its actions and any split button full width at upstream's 420px", () => {
		const {root, actions} = permissionChrome();

		expect({
			container: root?.className.split(/\s+/).includes("@container"),
			queries: (actions ?? "").split(/\s+/).filter((name) => name.startsWith("@max-[")),
		}).toStrictEqual({
			container: true,
			queries: [
				"@max-[420px]:flex-col",
				"@max-[420px]:items-stretch",
				"@max-[420px]:[&>div]:flex-col",
				"@max-[420px]:[&>div]:items-stretch",
				"@max-[420px]:[&_[data-cds=SplitDropdownButton]]:w-full",
				"@max-[420px]:[&_[data-cds=SplitDropdownButton]>[data-cds-segment]:first-child_button]:flex-auto",
				"@max-[420px]:[&_[data-cds=SplitDropdownButton]>[data-cds-segment]:first-child>div>:first-child]:flex-auto",
			],
		});
	});

	it("uses upstream's control-token secondary and primary cds Buttons: h-control, text-body, the button pad, --cds-radius, the control weight, no ring or drop shadow under fizzy colour", () => {
		const chrome = permissionChrome();
		const base =
			"relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--upstream-radius)] whitespace-nowrap select-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus [&:disabled:not([aria-busy])]:opacity-disabled disabled:pointer-events-none stacks:[&:disabled:not([aria-busy])]:opacity-100 stacks:[&:disabled:not([aria-busy])]:text-button-disabled stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor] h-control px-[min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md)))] text-body";
		expect({
			card: [
				"rounded-card",
				"p-lg",
				"card-ring",
				"focus-visible:outline-1",
				"focus-visible:outline-fill-accent",
				"focus-visible:outline-offset-2",
			].filter((name) => !chrome.card?.split(/\s+/).includes(name)),
			secondary: chrome.secondary,
			primary: chrome.primary,
			shortcut: chrome.root?.querySelector("[data-approval-primary] [data-cds=Shortcut]")?.getAttribute("class"),
		}).toStrictEqual({
			card: [],
			secondary: `${base} bg-fill-secondary font-control-regular [:root:not([data-cds-fizzy-lake~=color])_&]:shadow-field-drop after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] [:root:not([data-cds-fizzy-lake~=color])_&]:after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)] text-primary hover:bg-fill-secondary-hover stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled`,
			primary: `${base} bg-primary font-control text-surface-1 [--shortcut-cap-ink:currentColor] hover:bg-primary/80 stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled`,
			shortcut:
				"inline-flex shrink-0 items-center gap-[2px] text-caption [&:where(:root[dir=rtl]_:dir(rtl))]:flex-row-reverse pointer-coarse:hidden ms-1 me-[calc((var(--cds-h-control)-1em-6px)/2-min(var(--cds-pad-md),var(--cds-button-pad-max,var(--cds-pad-md))))]",
		});
	});

	it("compiles the pre-fizzy secondary depth only outside fizzy colour, like upstream's stacks:shadow-none", async () => {
		const compiled = await compileAll([
			"[:root:not([data-cds-fizzy-lake~=color])_&]:shadow-field-drop",
			"[:root:not([data-cds-fizzy-lake~=color])_&]:after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)]",
		]);
		expect(Object.values(compiled).map((css) => css?.slice(0, css.indexOf(" {")).split(" .")[0])).toStrictEqual([
			":root:not([data-cds-fizzy-lake~=color])",
			":root:not([data-cds-fizzy-lake~=color])",
		]);
	});
});

describe("approval card disabled actions, as upstream's cds Button", () => {
	it("emits the fizzy disabled rules after the base opacity and the variants' hover paint, so they win at equal specificity", async () => {
		const candidates = [
			"stacks:[&:disabled:not([aria-busy])]:opacity-100",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			"[&:disabled:not([aria-busy])]:opacity-disabled",
			"hover:bg-fill-secondary-hover",
			"hover:bg-primary/80",
		];
		const order = (await loadDesignSystem()).getClassOrder(candidates);
		const sorted = order.toSorted(([, a], [, b]) => (a === null || b === null ? 0 : a < b ? -1 : a > b ? 1 : 0));
		expect(sorted.map(([name]) => name)).toStrictEqual([
			"hover:bg-fill-secondary-hover",
			"hover:bg-primary/80",
			"[&:disabled:not([aria-busy])]:opacity-disabled",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			"stacks:[&:disabled:not([aria-busy])]:opacity-100",
		]);
	});

	it("compiles the disabled look: opacity .4 by default; under fizzy colour (outside forced colours and data-cds-theme) opacity 1 with the disabled ink, fill and cap ink; busy buttons excluded", async () => {
		const disabled = ":disabled:not([aria-busy])";
		const stacks =
			':where([data-cds-fizzy-lake~="color"], [data-cds-fizzy-lake~="color"] *):not(:where([data-cds-theme], [data-cds-theme] *))';
		const compiled = await compileAll([
			"[&:disabled:not([aria-busy])]:opacity-disabled",
			"disabled:pointer-events-none",
			"stacks:[&:disabled:not([aria-busy])]:opacity-100",
			"stacks:[&:disabled:not([aria-busy])]:text-button-disabled",
			"stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor]",
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
		]);
		expect(compiled).toStrictEqual({
			"[&:disabled:not([aria-busy])]:opacity-disabled": `.\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:opacity-disabled${disabled} { opacity: var(--upstream-opacity-disabled, 0.4); }`,
			"disabled:pointer-events-none": ".disabled\\:pointer-events-none:disabled { pointer-events: none; }",
			"stacks:[&:disabled:not([aria-busy])]:opacity-100": `@media (forced-colors: none) { .stacks\\:\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:opacity-100${stacks}${disabled} { opacity: 100%; } }`,
			"stacks:[&:disabled:not([aria-busy])]:text-button-disabled": `@media (forced-colors: none) { .stacks\\:\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:text-button-disabled${stacks}${disabled} { color: var(--upstream-text-button-disabled, var(--upstream-text-disabled, currentColor)); } }`,
			"stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor]": `@media (forced-colors: none) { .stacks\\:\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:\\[--shortcut-cap-ink\\:currentColor\\]${stacks}${disabled} { --shortcut-cap-ink: currentColor; } }`,
			"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled": `@media (forced-colors: none) { .stacks\\:\\[\\&\\:disabled\\:not\\(\\[aria-busy\\]\\)\\]\\:bg-fill-disabled${stacks}${disabled} { background-color: var(--upstream-fill-disabled); } }`,
		});
	});
});

function dragEvent(type: string, types: string[]) {
	const event = new Event(type, {bubbles: true, cancelable: true});
	const dataTransfer = {types, dropEffect: "copy"};
	Object.defineProperty(event, "dataTransfer", {value: dataTransfer});
	return {event, dataTransfer};
}

let listeners = new AbortController();
afterEach(() => {
	listeners.abort();
	listeners = new AbortController();
});

describe("approval card file drops", () => {
	it("swallows file drags on the card so they never reach a parent drop handler, as upstream does", () => {
		const {root} = permissionChrome();
		const reached: string[] = [];
		for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
			document.addEventListener(type, () => reached.push(type), {signal: listeners.signal});
		}
		const results = ["dragenter", "dragover", "dragleave", "drop"].map((type) => {
			const {event, dataTransfer} = dragEvent(type, ["Files"]);
			root?.dispatchEvent(event);
			return {type, prevented: event.defaultPrevented, dropEffect: dataTransfer.dropEffect};
		});
		expect({results, reached}).toStrictEqual({
			results: [
				{type: "dragenter", prevented: true, dropEffect: "none"},
				{type: "dragover", prevented: true, dropEffect: "none"},
				{type: "dragleave", prevented: true, dropEffect: "none"},
				{type: "drop", prevented: true, dropEffect: "none"},
			],
			reached: [],
		});
	});

	it("lets non-file drags through", () => {
		const {root} = permissionChrome();
		const reached: string[] = [];
		document.addEventListener("drop", () => reached.push("drop"), {signal: listeners.signal});
		const {event, dataTransfer} = dragEvent("drop", ["text/plain"]);
		root?.dispatchEvent(event);
		expect({prevented: event.defaultPrevented, dropEffect: dataTransfer.dropEffect, reached}).toStrictEqual({
			prevented: false,
			dropEffect: "copy",
			reached: ["drop"],
		});
	});
});
