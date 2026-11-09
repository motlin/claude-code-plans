// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {InlinePlanApproval} from "../src/components/inline-plan-approval";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import type {PlanApprovalContextValue} from "../src/components/plan-approval-context";
import {dockedHookPlan, inlinePlanToolUseId} from "../src/lib/docked-plan";
import {approvalEnterSeen, markApprovalEnterSeen} from "../src/lib/approval-enter-seen";
import type {PlanDecision} from "../src/lib/plan-approval";
import {defaultPaneLayout} from "../src/lib/pane-layout";
import {CHAT_COLUMN_CLASS} from "../src/lib/transcript-width";

afterEach(cleanup);

const PLAN: PlanApprovalContextValue = {
	sessionId: "sess_1",
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

const HOOK_PLAN = {toolUseId: "", plan: "# Say hello\n\n1. Print hello", planFilePath: "/tmp/plans/say-hello.md"};

function assistantToolUse(id: string, name: string, input: Record<string, unknown>) {
	return {type: "assistant", message: {content: [{type: "tool_use", id, name, input}]}};
}

function toolResult(id: string) {
	return {type: "user", message: {content: [{type: "tool_result", tool_use_id: id, content: "ok"}]}};
}

describe("dockedHookPlan", () => {
	it("is a hook-only pending plan while the session waits", () => {
		expect(dockedHookPlan({hookPlan: HOOK_PLAN, state: "waiting", records: []})).toStrictEqual(HOOK_PLAN);
	});

	it("is null once the ExitPlanMode record is on disk and awaiting, so the record's own card draws it", () => {
		const records = [assistantToolUse("toolu_plan_1", "ExitPlanMode", {plan: HOOK_PLAN.plan})];
		expect(dockedHookPlan({hookPlan: HOOK_PLAN, state: "waiting", records})).toStrictEqual(null);
	});

	it("is still the hook plan when the last on-disk ExitPlanMode is an older, answered one", () => {
		const records = [assistantToolUse("toolu_plan_0", "ExitPlanMode", {plan: "old"}), toolResult("toolu_plan_0")];
		expect(dockedHookPlan({hookPlan: HOOK_PLAN, state: "waiting", records})).toStrictEqual(HOOK_PLAN);
	});

	it("stays null once its own ExitPlanMode is answered on disk while the hook state still says waiting", () => {
		const hookPlan = {...HOOK_PLAN, toolUseId: "toolu_plan_1"};
		const asked = [assistantToolUse("toolu_plan_1", "ExitPlanMode", {plan: HOOK_PLAN.plan})];
		expect([
			dockedHookPlan({hookPlan, state: "waiting", records: []}),
			dockedHookPlan({hookPlan, state: "waiting", records: asked}),
			dockedHookPlan({hookPlan, state: "waiting", records: [...asked, toolResult("toolu_plan_1")]}),
		]).toStrictEqual([hookPlan, null, null]);
	});

	it("is null when the hook state clears or the session is no longer waiting", () => {
		expect([
			dockedHookPlan({hookPlan: null, state: "waiting", records: []}),
			dockedHookPlan({hookPlan: undefined, state: "waiting", records: []}),
			dockedHookPlan({hookPlan: HOOK_PLAN, state: "working", records: []}),
			dockedHookPlan({hookPlan: HOOK_PLAN, state: null, records: []}),
		]).toStrictEqual([null, null, null, null]);
	});
});

describe("InlinePlanApproval", () => {
	it("draws upstream's sticky card after the transcript: the tinted title band with the first plan line, Open plan, then the inline actions; mounting auto-opens the Plan pane", async () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane);
		const view = render(
			<PaneHostContext.Provider value={host}>
				<InlinePlanApproval toolUseId="toolu_plan_1" planText={"\n# Plan: X\n\nbody"} plan={PLAN} />
			</PaneHostContext.Provider>,
		);
		await act(async () => Promise.resolve());
		const wrapper = view.container.querySelector("[data-inline-plan]");
		const card = wrapper?.querySelector<HTMLElement>("[data-approval-presentation=card]");
		const band = card?.querySelector("[data-testid=approval-title-region] > div");
		const titleRow = band?.firstElementChild;
		fireEvent.click(screen.getByRole("button", {name: "Open plan"}));

		expect({
			wrapper: wrapper?.className,
			rootHas: ["!pt-0", "overflow-clip", "gap-3", "max-h-[60vh]"].filter((c) => card?.classList.contains(c)),
			rootLacks: ["gap-[24px]"].filter((c) => card?.classList.contains(c)),
			band: band?.className,
			titleRow: titleRow?.className,
			titleColumn: titleRow?.firstElementChild?.className,
			stopName: [
				titleRow?.querySelector("[data-question-stop-name]")?.className,
				titleRow?.querySelector("[data-question-stop-name]")?.textContent,
			],
			subtitle: [
				titleRow?.querySelector(".text-ink-muted")?.className,
				titleRow?.querySelector(".text-ink-muted .line-clamp-2")?.className,
				titleRow?.querySelector(".text-ink-muted")?.textContent,
			],
			trailing: [titleRow?.lastElementChild?.className, titleRow?.lastElementChild?.textContent],
			actions: [
				...(card?.querySelectorAll("[data-approval-card-actions] [data-plan-approval] button") ?? []),
			].map((button) => button.textContent),
			opened: openPane.mock.calls,
		}).toStrictEqual({
			wrapper: `${CHAT_COLUMN_CLASS} sticky top-[calc(max(var(--epitaxy-top-fade-height,0px),var(--fade-top,0px))+5px)] z-[1] bg-[var(--epitaxy-transcript-surface,var(--color-surface-1))] pb-4`,
			rootHas: ["!pt-0", "overflow-clip", "gap-3", "max-h-[60vh]"],
			rootLacks: [],
			band: "-mx-3 flex flex-col gap-1.5 bg-alpha-1 px-3 py-2",
			titleRow: "flex min-h-6 shrink-0 items-center gap-1 text-primary",
			titleColumn: "flex min-w-0 flex-1 flex-col gap-[2px]",
			stopName: ["min-w-0 break-words text-body", "Claude proposed a plan"],
			subtitle: ["text-body text-ink-muted", "line-clamp-2 break-words [unicode-bidi:plaintext]", "Plan: X"],
			trailing: ["shrink-0 self-center", "Open plan"],
			actions: ["Reject", "Revise…", "Accept", "Accept and use auto modeCtrl⏎Enter"],
			opened: [["plan"], ["plan"]],
		});
	});

	it("asks to leave plan mode when the ExitPlanMode has no plan: upstream's planless title and subtitle, no Open plan, no auto-open", async () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane);
		render(
			<PaneHostContext.Provider value={host}>
				<InlinePlanApproval toolUseId="toolu_plan_1" planText="  " plan={PLAN} />
			</PaneHostContext.Provider>,
		);
		await act(async () => Promise.resolve());
		expect({
			title: document.querySelector("[data-question-stop-name]")?.textContent,
			subtitle: document.querySelector("[data-testid=approval-title-region] .text-ink-muted")?.textContent,
			openPlan: screen.queryByRole("button", {name: "Open plan"}),
			opened: openPane.mock.calls,
		}).toStrictEqual({
			title: "Claude wants to leave plan mode",
			subtitle: "Claude hasn\u2019t written a plan, so there\u2019s nothing to review.",
			openPlan: null,
			opened: [],
		});
	});

	it("leaves out Open plan and the subtitle without a pane host", async () => {
		render(<InlinePlanApproval toolUseId="toolu_plan_1" planText="# P" plan={PLAN} />);
		await act(async () => Promise.resolve());
		expect({
			openPlan: screen.queryByRole("button", {name: "Open plan"}),
			subtitle: document.querySelector("[data-testid=approval-title-region] .text-ink-muted"),
		}).toStrictEqual({openPlan: null, subtitle: null});
	});

	it("plays upstream's enter animation for a live arrival, and skips it for a plan this tab already drew", async () => {
		const live = render(<InlinePlanApproval toolUseId="toolu_plan_live" planText="# P" plan={PLAN} />);
		const liveRoot = live.container.querySelector("[data-approval-card-root]");
		const liveState = {
			animated: liveRoot?.classList.contains("animate-approval-inline-enter"),
			skip: liveRoot?.hasAttribute("data-skip-approval-enter"),
		};
		live.unmount();
		const seen = approvalEnterSeen("plan:sess_1:toolu_plan_live");
		markApprovalEnterSeen("plan:sess_1:toolu_plan_seen");
		const again = render(<InlinePlanApproval toolUseId="toolu_plan_seen" planText="# P" plan={PLAN} />);
		const againRoot = again.container.querySelector("[data-approval-card-root]");
		await act(async () => Promise.resolve());
		expect({
			live: liveState,
			seen,
			again: {
				animated: againRoot?.classList.contains("animate-approval-inline-enter"),
				skip: againRoot?.hasAttribute("data-skip-approval-enter"),
			},
		}).toStrictEqual({
			live: {animated: true, skip: false},
			seen: true,
			again: {animated: false, skip: true},
		});
	});

	it("leaves the plan text to the Plan pane and is read-only with the terminal hint when no live pane can answer", () => {
		const readOnly: PlanApprovalContextValue = {
			...PLAN,
			answerRoute: "read-only",
			loadDialog: async () => Promise.reject(new Error("no pane")),
		};
		render(<InlinePlanApproval toolUseId="" planText={HOOK_PLAN.plan} plan={readOnly} />);
		expect({
			buttons: screen.queryAllByRole("button").map((button) => button.textContent),
			planText: document.querySelector("[data-inline-plan]")?.textContent.includes("Print hello"),
		}).toStrictEqual({buttons: [], planText: false});
	});

	it("answers a hook-only plan (no tool_use id yet) through the plan approval context", async () => {
		const decide = vi.fn<(decision: PlanDecision) => Promise<void>>(async () => Promise.resolve());
		render(
			<InlinePlanApproval
				toolUseId=""
				planText={HOOK_PLAN.plan}
				plan={{...PLAN, loadDialog: async () => Promise.resolve({forwardMode: null, manual: true}), decide}}
			/>,
		);
		await act(async () => Promise.resolve());
		const accept = screen.getAllByRole("button").find((button) => button.textContent === "AcceptCtrl⏎Enter");
		if (accept === undefined) throw new Error("No Accept button");
		await act(async () => {
			fireEvent.click(accept);
			return Promise.resolve();
		});
		expect(decide.mock.calls).toStrictEqual([[{kind: "accept", mode: "default"}]]);
	});
});

describe("InlinePlanApproval keys (upstream's keyless plan root)", () => {
	async function renderPlan() {
		const view = render(<InlinePlanApproval toolUseId="toolu_plan_keys" planText="# P" plan={PLAN} />);
		await act(async () => Promise.resolve());
		const root = view.container.querySelector<HTMLElement>("[data-approval-card-root]");
		if (root === null) throw new Error("No card root");
		const buttons = screen.getAllByRole("button");
		const byText = (prefix: string) => {
			const button = buttons.find((b) => b.textContent.startsWith(prefix));
			if (button === undefined) throw new Error(`No ${prefix} button`);
			return button;
		};
		return {root, byText};
	}

	it("gives the plan card root no tab stop and no role, like upstream's `Fs` shell", async () => {
		const {root} = await renderPlan();
		expect({tabindex: root.getAttribute("tabindex"), role: root.getAttribute("role")}).toStrictEqual({
			tabindex: null,
			role: null,
		});
	});

	it("leaves arrows on a focused action alone: not prevented, and focus stays put", async () => {
		const {byText} = await renderPlan();
		const reject = byText("Reject");
		reject.focus();
		const results = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].map((key) => ({
			key,
			notPrevented: fireEvent.keyDown(reject, {key}),
			focusedReject: document.activeElement === reject,
		}));
		expect(results).toStrictEqual([
			{key: "ArrowRight", notPrevented: true, focusedReject: true},
			{key: "ArrowDown", notPrevented: true, focusedReject: true},
			{key: "ArrowLeft", notPrevented: true, focusedReject: true},
			{key: "ArrowUp", notPrevented: true, focusedReject: true},
		]);
	});

	it("does not move focus to Accept on an Enter at the root", async () => {
		const {root} = await renderPlan();
		root.focus();
		const before = document.activeElement;
		const notPrevented = fireEvent.keyDown(root, {key: "Enter"});
		expect({notPrevented, unmoved: document.activeElement === before}).toStrictEqual({
			notPrevented: true,
			unmoved: true,
		});
	});

	it("swallows a held Enter/Space and any modified Enter on an accept button, as upstream's `hh`, even inside the arm grace", async () => {
		const {byText} = await renderPlan();
		const accept = byText("Accept and");
		const prevented = (init: KeyboardEventInit) => !fireEvent.keyDown(accept, init);
		expect({
			repeatEnter: prevented({key: "Enter", repeat: true}),
			repeatSpace: prevented({key: " ", repeat: true}),
			metaEnter: prevented({key: "Enter", metaKey: true}),
			ctrlEnter: prevented({key: "Enter", ctrlKey: true}),
			altEnter: prevented({key: "Enter", altKey: true}),
			shiftEnter: prevented({key: "Enter", shiftKey: true}),
			plainEnter: prevented({key: "Enter"}),
			plainSpace: prevented({key: " "}),
		}).toStrictEqual({
			repeatEnter: true,
			repeatSpace: true,
			metaEnter: true,
			ctrlEnter: true,
			altEnter: true,
			shiftEnter: true,
			plainEnter: false,
			plainSpace: false,
		});
	});

	it("lets a held Enter through inside a menu within the accept group", async () => {
		const {byText} = await renderPlan();
		const group = byText("Accept and").closest("[data-plan-accept-group]");
		if (group === null) throw new Error("No accept group");
		const menu = document.createElement("div");
		menu.setAttribute("role", "menu");
		const item = document.createElement("button");
		menu.append(item);
		group.append(menu);
		expect(fireEvent.keyDown(item, {key: "Enter", repeat: true})).toBe(true);
		menu.remove();
	});
});
