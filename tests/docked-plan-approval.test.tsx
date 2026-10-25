// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DockedPlanApproval} from "../src/components/docked-plan-approval";
import {dockedHookPlan} from "../src/lib/docked-plan";
import type {PlanApprovalContextValue} from "../src/components/plan-approval-context";
import type {PlanDecision} from "../src/lib/plan-approval";

afterEach(cleanup);

const HOOK_PLAN = {toolUseId: "", plan: "# Say hello\n\n1. Print hello", planFilePath: "/tmp/plans/say-hello.md"};

function assistantToolUse(id: string, name: string, input: Record<string, unknown>) {
	return {type: "assistant", message: {content: [{type: "tool_use", id, name, input}]}};
}

function toolResult(id: string) {
	return {type: "user", message: {content: [{type: "tool_result", tool_use_id: id, content: "ok"}]}};
}

describe("dockedHookPlan", () => {
	it("docks a hook-only pending plan while the session waits", () => {
		expect(dockedHookPlan({hookPlan: HOOK_PLAN, state: "waiting", records: []})).toStrictEqual(HOOK_PLAN);
	});

	it("hides once the ExitPlanMode record is on disk and awaiting, so the transcript card draws it", () => {
		const records = [assistantToolUse("toolu_plan_1", "ExitPlanMode", {plan: HOOK_PLAN.plan})];
		expect(dockedHookPlan({hookPlan: HOOK_PLAN, state: "waiting", records})).toStrictEqual(null);
	});

	it("still docks when the last on-disk ExitPlanMode is an older, answered one", () => {
		const records = [assistantToolUse("toolu_plan_0", "ExitPlanMode", {plan: "old"}), toolResult("toolu_plan_0")];
		expect(dockedHookPlan({hookPlan: HOOK_PLAN, state: "waiting", records})).toStrictEqual(HOOK_PLAN);
	});

	it("stays hidden once its own ExitPlanMode is answered on disk while the hook state still says waiting", () => {
		const hookPlan = {...HOOK_PLAN, toolUseId: "toolu_plan_1"};
		const asked = [assistantToolUse("toolu_plan_1", "ExitPlanMode", {plan: HOOK_PLAN.plan})];
		expect([
			dockedHookPlan({hookPlan, state: "waiting", records: []}),
			dockedHookPlan({hookPlan, state: "waiting", records: asked}),
			dockedHookPlan({hookPlan, state: "waiting", records: [...asked, toolResult("toolu_plan_1")]}),
		]).toStrictEqual([hookPlan, null, null]);
	});

	it("hides when the hook state clears or the session is no longer waiting", () => {
		expect([
			dockedHookPlan({hookPlan: null, state: "waiting", records: []}),
			dockedHookPlan({hookPlan: undefined, state: "waiting", records: []}),
			dockedHookPlan({hookPlan: HOOK_PLAN, state: "working", records: []}),
			dockedHookPlan({hookPlan: HOOK_PLAN, state: null, records: []}),
		]).toStrictEqual([null, null, null, null]);
	});
});

describe("DockedPlanApproval", () => {
	it("marks its root as a waiting card for the palette's Jump to question", () => {
		const plan: PlanApprovalContextValue = {
			answerRoute: "live-pane",
			loadDialog: async () => Promise.resolve({forwardMode: null, manual: true}),
			decide: async () => Promise.resolve(),
		};
		const {container} = render(<DockedPlanApproval pendingPlan={HOOK_PLAN} plan={plan} />);
		const root = container.querySelector<HTMLElement>("[data-docked-plan]");
		// Focusable and positioned, so a jump lands on it and its ::after landing ring sits inside it.
		expect({
			waitingCard: root?.hasAttribute("data-approval-card-root"),
			tabIndex: root?.getAttribute("tabindex"),
			positioned: root?.classList.contains("relative"),
		}).toStrictEqual({waitingCard: true, tabIndex: "-1", positioned: true});
	});

	it("leads with 'Claude proposed a plan' and answers through the plan approval context", async () => {
		const decide = vi.fn<(decision: PlanDecision) => Promise<void>>(async () => Promise.resolve());
		const plan: PlanApprovalContextValue = {
			answerRoute: "live-pane",
			loadDialog: async () => Promise.resolve({forwardMode: null, manual: true}),
			decide,
		};
		render(<DockedPlanApproval pendingPlan={HOOK_PLAN} plan={plan} />);
		await act(async () => Promise.resolve());

		const accept = screen.getAllByRole("button").find((button) => button.textContent === "AcceptCtrl⏎Enter");
		if (accept === undefined) throw new Error("No Accept button");
		await act(async () => {
			fireEvent.click(accept);
			return Promise.resolve();
		});

		expect({
			title: screen.getByText("Claude proposed a plan").tagName,
			docked: document.querySelector("[data-docked-plan]") !== null,
			decisions: decide.mock.calls,
		}).toStrictEqual({title: "SPAN", docked: true, decisions: [[{kind: "accept", mode: "default"}]]});
	});

	it("is read-only with the terminal hint when no live pane can answer", () => {
		const plan: PlanApprovalContextValue = {
			answerRoute: "read-only",
			loadDialog: async () => Promise.reject(new Error("no pane")),
			decide: async () => Promise.resolve(),
		};
		render(<DockedPlanApproval pendingPlan={HOOK_PLAN} plan={plan} />);

		expect(screen.queryAllByRole("button").map((button) => button.textContent)).toStrictEqual([]);
	});

	it("leaves the plan text to the Plan pane, as upstream's card shows only the title and Open plan", () => {
		const plan: PlanApprovalContextValue = {
			answerRoute: "read-only",
			loadDialog: async () => Promise.reject(new Error("no pane")),
			decide: async () => Promise.resolve(),
		};
		render(<DockedPlanApproval pendingPlan={HOOK_PLAN} plan={plan} />);

		expect({
			blocks: document.querySelectorAll("[data-docked-plan] [data-plan-block]").length,
			text: document.querySelector("[data-docked-plan]")?.textContent.includes("Print hello"),
		}).toStrictEqual({blocks: 0, text: false});
	});

	it("is a size container, so the actions stack at upstream's ≤420px card width", () => {
		const plan: PlanApprovalContextValue = {
			answerRoute: "read-only",
			loadDialog: async () => Promise.reject(new Error("no pane")),
			decide: async () => Promise.resolve(),
		};
		render(<DockedPlanApproval pendingPlan={HOOK_PLAN} plan={plan} />);

		expect(document.querySelector("[data-docked-plan]")?.className.split(" ").includes("@container")).toStrictEqual(
			true,
		);
	});
});
