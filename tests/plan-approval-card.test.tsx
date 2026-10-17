// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {PlanApprovalCard} from "../src/components/plan-approval-card";
import type {PlanApprovalContextValue} from "../src/components/plan-approval-context";
import type {PlanDecision, PlanDialog} from "../src/lib/plan-approval";
import {planKeyAction} from "../src/lib/plan-approval";

afterEach(cleanup);

const AUTO_DIALOG: PlanDialog = {forwardMode: "auto", manual: true};

function context(overrides: Partial<PlanApprovalContextValue> = {}) {
	const decide = vi.fn<(decision: PlanDecision) => Promise<void>>(async () => Promise.resolve());
	const value: PlanApprovalContextValue = {
		answerRoute: "live-pane",
		loadDialog: async () => Promise.resolve(AUTO_DIALOG),
		decide,
		...overrides,
	};
	return {value, decide};
}

async function renderCard(value: PlanApprovalContextValue) {
	const view = render(<PlanApprovalCard toolUseId="toolu_plan_1" plan={value} />);
	await act(async () => Promise.resolve());
	return view;
}

/** A button by its full text, keycaps included (jsdom renders the non-Mac Ctrl caps). */
function button(text: string): HTMLElement {
	const match = screen.getAllByRole("button").find((candidate) => candidate.textContent === text);
	if (match === undefined) throw new Error(`No button reads ${text}`);
	return match;
}

function buttonNames(): string[] {
	return screen.getAllByRole("button").map((button) => button.textContent);
}

describe("PlanApprovalCard", () => {
	it("offers upstream's Reject, Revise…, Accept and the dialog's forward-mode accept, in order", async () => {
		const {value} = context();
		await renderCard(value);
		expect(buttonNames()).toStrictEqual([
			"Reject",
			"Revise…Esc",
			"AcceptCtrlShift⏎Enter",
			"Accept and auto modeCtrl⏎Enter",
		]);
	});

	it.each([
		{name: "Accept and auto modeCtrl⏎Enter", decision: {kind: "accept", mode: "auto"}},
		{name: "AcceptCtrlShift⏎Enter", decision: {kind: "accept", mode: "default"}},
		{name: "Reject", decision: {kind: "reject", feedback: ""}},
	])("sends $decision.kind for '$name'", async ({name, decision}) => {
		const {value, decide} = context();
		await renderCard(value);
		await act(async () => {
			fireEvent.click(button(name));
			return Promise.resolve();
		});
		expect(decide.mock.calls).toStrictEqual([[decision]]);
	});

	it("labels the primary 'Accept' alone when the dialog has no forward mode", async () => {
		const {value} = context({loadDialog: async () => Promise.resolve({forwardMode: null, manual: true})});
		await renderCard(value);
		expect(buttonNames()).toStrictEqual(["Reject", "Revise…Esc", "AcceptCtrl⏎Enter"]);
	});

	it("opens upstream's feedback box on Revise…, and Enter sends its text as a revision", async () => {
		const {value, decide} = context();
		await renderCard(value);
		fireEvent.click(button("Revise…Esc"));
		const box = screen.getByRole("textbox", {name: "Plan feedback"});
		fireEvent.change(box, {target: {value: "use bye instead"}});
		const shape = {
			placeholder: box.getAttribute("placeholder"),
			rows: box.getAttribute("rows"),
			buttons: buttonNames(),
		};
		await act(async () => {
			fireEvent.keyDown(box, {key: "Enter"});
			return Promise.resolve();
		});
		expect({shape, calls: decide.mock.calls}).toStrictEqual({
			shape: {placeholder: "What should change? (optional)", rows: "3", buttons: ["Back", "Revise"]},
			calls: [[{kind: "reject", feedback: "use bye instead"}]],
		});
	});

	it("closes the feedback box with Back, sending nothing", async () => {
		const {value, decide} = context();
		await renderCard(value);
		fireEvent.click(button("Revise…Esc"));
		fireEvent.click(button("Back"));
		expect({textbox: screen.queryByRole("textbox"), calls: decide.mock.calls}).toStrictEqual({
			textbox: null,
			calls: [],
		});
	});

	it("is read-only with 'Answer in the terminal' when the session has no writable live pane", async () => {
		const loadDialog = vi.fn<() => Promise<PlanDialog>>();
		const {value} = context({answerRoute: "read-only", loadDialog});
		const view = await renderCard(value);
		expect({
			text: view.container.textContent,
			buttons: screen.queryAllByRole("button").length,
			loads: loadDialog.mock.calls.length,
		}).toStrictEqual({text: "Answer in the terminal", buttons: 0, loads: 0});
	});

	it("falls back to 'Answer in the terminal' when the pane is not showing the plan dialog", async () => {
		const {value} = context({
			loadDialog: async () => Promise.reject(new Error("The terminal is not showing the plan approval dialog")),
		});
		const view = await renderCard(value);
		expect({text: view.container.textContent, buttons: screen.queryAllByRole("button").length}).toStrictEqual({
			text: "Answer in the terminal",
			buttons: 0,
		});
	});

	it("shows a refused answer's error under the actions", async () => {
		const {value} = context({decide: async () => Promise.reject(new Error("No plan approval is pending"))});
		const view = await renderCard(value);
		await act(async () => {
			fireEvent.click(button("Reject"));
			return Promise.resolve();
		});
		expect(view.container.querySelector("[data-plan-error]")?.textContent).toStrictEqual(
			"No plan approval is pending",
		);
	});
});

describe("planKeyAction", () => {
	const keys = {metaKey: false, ctrlKey: false, shiftKey: false, altKey: false};
	it.each([
		{name: "⌘⏎", event: {...keys, key: "Enter", metaKey: true}, action: {kind: "accept", mode: "auto"}},
		{name: "ctrl+⏎", event: {...keys, key: "Enter", ctrlKey: true}, action: {kind: "accept", mode: "auto"}},
		{
			name: "⇧⌘⏎",
			event: {...keys, key: "Enter", metaKey: true, shiftKey: true},
			action: {kind: "accept", mode: "default"},
		},
		{name: "Esc", event: {...keys, key: "Escape"}, action: {kind: "revise"}},
		{name: "plain Enter", event: {...keys, key: "Enter"}, action: null},
		{name: "a digit", event: {...keys, key: "1"}, action: null},
	])("maps $name", ({event, action}) => {
		expect(planKeyAction(event, AUTO_DIALOG)).toStrictEqual(action);
	});
});
