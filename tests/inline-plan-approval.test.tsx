// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {InlinePlanApproval} from "../src/components/inline-plan-approval";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import type {PlanApprovalContextValue} from "../src/components/plan-approval-context";
import {inlinePlanToolUseId} from "../src/lib/docked-plan";
import {defaultPaneLayout} from "../src/lib/pane-layout";
import {CHAT_COLUMN_CLASS} from "../src/lib/transcript-width";

afterEach(cleanup);

const PLAN: PlanApprovalContextValue = {
	answerRoute: "live-pane",
	loadDialog: async () => Promise.resolve({forwardMode: "auto", manual: true}),
	decide: async () => Promise.resolve(),
};

function paneHost(openPane: PaneHostApi["openPane"]): PaneHostApi {
	return {
		layout: defaultPaneLayout(),
		openKinds: [],
		isOpen: () => false,
		openPane,
		closePane: () => {},
		togglePane: () => {},
	};
}

describe("inlinePlanToolUseId", () => {
	it("is the pending ExitPlanMode's id only while the session waits on it", () => {
		const plan = {id: "toolu_plan_1", name: "ExitPlanMode", input: {}};
		expect([
			inlinePlanToolUseId("waiting", plan),
			inlinePlanToolUseId("working", plan),
			inlinePlanToolUseId(null, plan),
			inlinePlanToolUseId("waiting", {id: "toolu_q", name: "AskUserQuestion", input: {}}),
			inlinePlanToolUseId("waiting", null),
		]).toStrictEqual(["toolu_plan_1", null, null, null, null]);
	});
});

describe("InlinePlanApproval", () => {
	it("draws upstream's own sticky approval card after the transcript: title, Open plan, then the actions", async () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane);
		const view = render(
			<PaneHostContext.Provider value={host}>
				<InlinePlanApproval toolUseId="toolu_plan_1" plan={PLAN} />
			</PaneHostContext.Provider>,
		);
		await act(async () => Promise.resolve());
		const wrapper = view.container.querySelector("[data-inline-plan]");
		const card = wrapper?.querySelector("[data-approval-presentation=card]");
		const titleRow = card?.querySelector("[data-approval-card-body]")?.firstElementChild;
		fireEvent.click(screen.getByRole("button", {name: "Open plan"}));

		expect({
			wrapper: wrapper?.className,
			titleRow: titleRow?.className,
			title: [...(titleRow?.children ?? [])].map((child) => [child.className, child.textContent]),
			actions: [
				...(card?.querySelectorAll("[data-approval-card-actions] [data-plan-approval] button") ?? []),
			].map((button) => button.textContent),
			opened: openPane.mock.calls,
		}).toStrictEqual({
			wrapper: `${CHAT_COLUMN_CLASS} sticky top-[5px] z-[1] bg-surface-1 pb-4`,
			titleRow: "flex min-h-6 items-center gap-1 text-primary",
			title: [
				["font-[580]", "Claude proposed a plan"],
				["shrink-0 self-center", "Open plan"],
			],
			actions: ["Reject", "Revise…Esc", "AcceptCtrlShift⏎Enter", "Accept and auto modeCtrl⏎Enter"],
			opened: [["plan"]],
		});
	});

	it("leaves out Open plan without a pane host", async () => {
		render(<InlinePlanApproval toolUseId="toolu_plan_1" plan={PLAN} />);
		await act(async () => Promise.resolve());
		expect(screen.queryByRole("button", {name: "Open plan"})).toStrictEqual(null);
	});
});
