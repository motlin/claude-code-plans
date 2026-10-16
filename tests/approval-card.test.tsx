// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ApprovalDock} from "../src/components/approval-dock";
import {PendingQuestionCard} from "../src/components/approval-card";
import {PermissionCard} from "../src/components/permission-card";
import type {QuestionLike} from "../src/lib/ask-user-question";

afterEach(cleanup);

const QUESTIONS: QuestionLike[] = [
	{question: "Which test runner?", header: "Runner", options: [{label: "Vitest"}, {label: "Jest"}]},
];

function chrome() {
	const permission = render(
		<PermissionCard title="Allow Claude to run ls?" command="ls" canAnswer onDecision={async () => {}} />,
	).container;
	const dock = render(<ApprovalDock toolUseId="t1" questions={QUESTIONS} onSubmit={async () => {}} />).container;
	const classOf = (element: Element | null) => element?.getAttribute("class") ?? null;
	return {
		permission: {
			container: classOf(permission.firstElementChild),
			card: classOf(permission.querySelector("[data-approval-card-root]")),
			body: classOf(permission.querySelector("[data-approval-card-body]")),
			title: classOf(permission.querySelector("[data-approval-card-title]")),
			actions: classOf(permission.querySelector("[data-approval-card-actions]")),
			secondary: classOf(screen.getByRole("button", {name: /^Deny/})),
			primary: classOf(screen.getByRole("button", {name: /^Allow once/})),
		},
		dock: {
			container: classOf(dock.firstElementChild),
			card: classOf(dock.querySelector("[data-approval-card-root]")),
			body: classOf(dock.querySelector("[data-approval-card-body]")),
			title: classOf(dock.querySelector("[data-approval-card-title]")),
			actions: classOf(dock.querySelector("[data-approval-card-actions]")),
			secondary: classOf(screen.getByRole("button", {name: /^Skip/})),
			primary: classOf(screen.getByRole("button", {name: /^Submit/})),
		},
	};
}

describe("shared approval card chrome", () => {
	it("gives the AskUserQuestion dock the permission card's shell, title and action buttons", () => {
		const {permission, dock} = chrome();
		expect(permission.card).not.toBeNull();
		expect(permission.secondary).not.toBeNull();
		const sharedChrome = ({actions: _a, secondary: _s, primary: _p, ...rest}: typeof dock) => rest;
		expect(sharedChrome(dock)).toStrictEqual(sharedChrome(permission));
	});

	it("makes each card its own container and stacks every card's actions full width at upstream's 420px, measured on the question card's full width", () => {
		const {permission, dock} = chrome();
		render(
			<PendingQuestionCard
				questions={[{question: "Pick one", header: "Pick", multiSelect: false, options: [{label: "A"}]}]}
			/>,
		);
		const pending = screen.getByRole("group", {name: "Waiting for your input"});
		const queries = (value: string | null | undefined) =>
			(value ?? "").split(/\s+/).filter((name) => name.startsWith("@max-["));
		const roots = [...document.querySelectorAll("[data-approval-card-root]")].map((root) =>
			root.className.split(/\s+/).includes("@container"),
		);
		const stack = (width: number) => [
			`@max-[${width}px]:flex-col`,
			`@max-[${width}px]:items-stretch`,
			`@max-[${width}px]:[&>span]:ms-0`,
			`@max-[${width}px]:[&>span]:flex-col`,
			`@max-[${width}px]:[&>span]:items-stretch`,
		];

		expect({
			roots,
			permission: queries(permission.actions),
			dock: queries(dock.actions),
			pending: queries(pending.querySelector("[data-approval-card-actions]")?.getAttribute("class")),
		}).toStrictEqual({
			roots: [true, true, true],
			permission: stack(420),
			dock: stack(396),
			pending: stack(396),
		});
	});

	it("uses the outline secondary and black primary variants with 11px keycaps", () => {
		const {dock} = chrome();
		const classes = (value: string | null) => new Set(value?.split(/\s+/));
		const missing = (value: string | null, expected: string[]) =>
			expected.filter((name) => !classes(value).has(name));
		expect({
			card: missing(dock.card, ["rounded-r7", "p-3", "shadow-[var(--approval-card-shadow)]"]),
			secondary: missing(dock.secondary, [
				"h-6",
				"rounded-r5",
				"px-2",
				"border",
				"border-strong",
				"[&_kbd]:text-[11px]",
			]),
			primary: missing(dock.primary, [
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
