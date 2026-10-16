// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {PermissionCard} from "../src/components/permission-card";

afterEach(cleanup);

function permissionChrome() {
	const container = render(
		<PermissionCard title="Allow Claude to run ls?" command="ls" canAnswer onDecision={async () => {}} />,
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
	it("makes the permission card its own container and stacks its actions full width at upstream's 420px", () => {
		const {root, actions} = permissionChrome();

		expect({
			container: root?.className.split(/\s+/).includes("@container"),
			queries: (actions ?? "").split(/\s+/).filter((name) => name.startsWith("@max-[")),
		}).toStrictEqual({
			container: true,
			queries: [
				"@max-[420px]:flex-col",
				"@max-[420px]:items-stretch",
				"@max-[420px]:[&>span]:ms-0",
				"@max-[420px]:[&>span]:flex-col",
				"@max-[420px]:[&>span]:items-stretch",
			],
		});
	});

	it("uses the outline secondary and black primary variants with 11px keycaps", () => {
		const chrome = permissionChrome();
		const classes = (value: string | null) => new Set(value?.split(/\s+/));
		const missing = (value: string | null, expected: string[]) =>
			expected.filter((name) => !classes(value).has(name));
		expect({
			card: missing(chrome.card, ["rounded-r7", "p-3", "card-ring"]),
			secondary: missing(chrome.secondary, [
				"h-6",
				"rounded-r5",
				"px-2",
				"border",
				"border-strong",
				"[&_kbd]:text-[11px]",
			]),
			primary: missing(chrome.primary, [
				"h-6",
				"rounded-r5",
				"px-2",
				"bg-primary",
				"text-surface-1",
				"[&_kbd]:text-[11px]",
			]),
		}).toStrictEqual({card: [], secondary: [], primary: []});
	});
});
