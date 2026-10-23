// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {PermissionCard} from "../src/components/permission-card";

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
			],
		});
	});

	it("uses upstream's filled secondary and black primary variants with 11px keycaps and a focus shadow", () => {
		const chrome = permissionChrome();
		const classes = (value: string | null) => new Set(value?.split(/\s+/));
		const missing = (value: string | null, expected: string[]) =>
			expected.filter((name) => !classes(value).has(name));
		expect({
			card: missing(chrome.card, [
				"rounded-r7",
				"p-3",
				"card-ring",
				"focus-visible:outline-1",
				"focus-visible:outline-fill-accent",
				"focus-visible:outline-offset-2",
			]),
			secondary: missing(chrome.secondary, [
				"h-6",
				"rounded-r5",
				"px-2",
				"bg-fill-secondary",
				"shadow-field-drop",
				"text-primary",
				"hover:bg-fill-secondary-hover",
				"focus-visible:shadow-focus",
				"[&_kbd]:text-[11px]",
			]),
			secondaryBorder: [...classes(chrome.secondary)].filter((name) => name.startsWith("border")),
			primary: missing(chrome.primary, [
				"h-6",
				"rounded-r5",
				"px-2",
				"bg-primary",
				"text-surface-1",
				"focus-visible:shadow-focus",
				"[&_kbd]:text-[11px]",
			]),
		}).toStrictEqual({card: [], secondary: [], secondaryBorder: [], primary: []});
	});
});
