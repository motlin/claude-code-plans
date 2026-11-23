// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {InlinePlanApproval} from "../src/components/inline-plan-approval";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import type {PlanApprovalContextValue} from "../src/components/plan-approval-context";
import {dockedHookPlan, inlinePlanToolUseId} from "../src/lib/docked-plan";
import {landOnWaitingCard} from "../src/lib/question-landing";
import {approvalEnterSeen, markApprovalEnterSeen} from "../src/lib/approval-enter-seen";
import type {PlanDecision} from "../src/lib/plan-approval";
import {defaultPaneLayout} from "../src/lib/pane-layout";

afterEach(cleanup);

const PLAN: PlanApprovalContextValue =
{
	sessionId: "sess_1",
	answerRoute: "live-pane",
	loadDialog: async () =>
		Promise.resolve(
			{
				forwardMode: "auto",
				manual: true,
			},
		),
	decide: async () => Promise.resolve(),
};

function paneHost(openPane: PaneHostApi["openPane"]): PaneHostApi
{
	return {
		layout: defaultPaneLayout(),
		openKinds: [],
		isOpen: () => false,
		openPane,
		closePane: () =>
		{
		},
		togglePane: () =>
		{
		},
	};
}

describe("inlinePlanToolUseId", () =>
{
	it("is the pending ExitPlanMode's id only while the session waits on it", () =>
	{
		const plan =
		{
			id: "toolu_plan_1",
			name: "ExitPlanMode",
			input: {},
		};
		expect([
			inlinePlanToolUseId("waiting", plan),
			inlinePlanToolUseId("working", plan),
			inlinePlanToolUseId(null, plan),
			inlinePlanToolUseId(
				"waiting",
				{
					id: "toolu_q",
					name: "AskUserQuestion",
					input: {},
				},
			),
			inlinePlanToolUseId("waiting", null),
		]).toStrictEqual(["toolu_plan_1", null, null, null, null]);
	});
});

const HOOK_PLAN =
{
	toolUseId: "",
	plan: "# Say hello\n\n1. Print hello",
	planFilePath: "/tmp/plans/say-hello.md",
};

function assistantToolUse(id: string, name: string, input: Record<string, unknown>)
{
	return {
		type: "assistant",
		message:
		{
			content: [
				{
					type: "tool_use",
					id,
					name,
					input,
				},
			],
		},
	};
}

function toolResult(id: string)
{
	return {
		type: "user",
		message:
		{
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content: "ok",
				},
			],
		},
	};
}

describe("dockedHookPlan", () =>
{
	it("is a hook-only pending plan while the session waits", () =>
	{
		expect(
			dockedHookPlan(
				{
					hookPlan: HOOK_PLAN,
					state: "waiting",
					records: [],
				},
			),
		).toStrictEqual(HOOK_PLAN);
	});

	it("is null once the ExitPlanMode record is on disk and awaiting, so the record's own card draws it", () =>
	{
		const records = [
			assistantToolUse(
				"toolu_plan_1",
				"ExitPlanMode",
				{
					plan: HOOK_PLAN.plan,
				},
			),
		];
		expect(
			dockedHookPlan(
				{
					hookPlan: HOOK_PLAN,
					state: "waiting",
					records,
				},
			),
		).toStrictEqual(null);
	});

	it("is still the hook plan when the last on-disk ExitPlanMode is an older, answered one", () =>
	{
		const records = [
			assistantToolUse(
				"toolu_plan_0",
				"ExitPlanMode",
				{
					plan: "old",
				},
			),
			toolResult("toolu_plan_0"),
		];
		expect(
			dockedHookPlan(
				{
					hookPlan: HOOK_PLAN,
					state: "waiting",
					records,
				},
			),
		).toStrictEqual(HOOK_PLAN);
	});

	it("stays null once its own ExitPlanMode is answered on disk while the hook state still says waiting", () =>
	{
		const hookPlan =
		{
			...HOOK_PLAN,
			toolUseId: "toolu_plan_1",
		};
		const asked = [
			assistantToolUse(
				"toolu_plan_1",
				"ExitPlanMode",
				{
					plan: HOOK_PLAN.plan,
				},
			),
		];
		expect([
			dockedHookPlan(
				{
					hookPlan,
					state: "waiting",
					records: [],
				},
			),
			dockedHookPlan(
				{
					hookPlan,
					state: "waiting",
					records: asked,
				},
			),
			dockedHookPlan(
				{
					hookPlan,
					state: "waiting",
					records: [...asked, toolResult("toolu_plan_1")],
				},
			),
		]).toStrictEqual([hookPlan, null, null]);
	});

	it("is null when the hook state clears or the session is no longer waiting", () =>
	{
		expect([
			dockedHookPlan(
				{
					hookPlan: null,
					state: "waiting",
					records: [],
				},
			),
			dockedHookPlan(
				{
					hookPlan: undefined,
					state: "waiting",
					records: [],
				},
			),
			dockedHookPlan(
				{
					hookPlan: HOOK_PLAN,
					state: "working",
					records: [],
				},
			),
			dockedHookPlan(
				{
					hookPlan: HOOK_PLAN,
					state: null,
					records: [],
				},
			),
		]).toStrictEqual([null, null, null, null]);
	});
});

describe("InlinePlanApproval", () =>
{
	it("passes its presentation to the actions: docked, Revise… shows esc and Accept ⇧⌘⏎, and the wrapper leaves the sticky place to the trailing slot", async () =>
	{
		const names = async (presentation: "card" | "dock") =>
		{
			const view = render(
				<InlinePlanApproval
					toolUseId="toolu_plan_1"
					planText={"# Plan: X\n\nbody"}
					plan={PLAN}
					presentation={presentation}
				/>,
			);
			await act(async () => Promise.resolve());
			const shown =
			{
				buttons: screen.getAllByRole("button").map((button) => button.textContent),
				wrapper: view.container.querySelector("[data-inline-plan]")?.getAttribute("class") ?? null,
			};
			view.unmount();
			return shown;
		};
		const card = await names("card");
		const dock = await names("dock");
		expect(
			{
				card: card.buttons.filter((name) => name.startsWith("Revise") || name.startsWith("Accept")),
				cardWrapper: card.wrapper,
				dock: dock.buttons.filter((name) => name.startsWith("Revise") || name.startsWith("Accept")),
				dockWrapper: dock.wrapper,
			},
		).toStrictEqual(
			{
				card: ["Revise…", "Accept", "Accept and use auto modeCtrl⏎Enter"],
				cardWrapper: null,
				dock: ["Revise…Esc", "AcceptCtrlShift⏎Enter", "Accept and use auto modeCtrl⏎Enter"],
				dockWrapper: null,
			},
		);
	});

	it("draws upstream's card for the transcript's sticky trailing slot: the tinted title band with the first plan line, Open plan, then the inline actions; mounting auto-opens the Plan pane", async () =>
	{
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
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open plan",
				},
			),
		);

		expect(
			{
				wrapper: wrapper?.className,
				rootHas: ["!pt-0", "overflow-clip", "gap-3", "max-h-[60vh]"].filter((c) => card?.classList.contains(c)),
				rootLacks: ["gap-[24px]", "epitaxy-tool-card-in-flow"].filter((c) => card?.classList.contains(c)),
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
			},
		).toStrictEqual(
			{
				wrapper: "",
				rootHas: ["!pt-0", "overflow-clip", "gap-3", "max-h-[60vh]"],
				rootLacks: [],
				band: "-mx-pad-lg flex flex-col gap-xs px-lg bg-alpha-1 py-md",
				titleRow: "flex min-h-6 shrink-0 items-center gap-1 text-primary",
				titleColumn: "flex min-w-0 flex-1 flex-col gap-[2px]",
				stopName: ["min-w-0 break-words text-body", "Claude proposed a plan"],
				subtitle: ["text-body text-ink-muted", "line-clamp-2 break-words [unicode-bidi:plaintext]", "Plan: X"],
				trailing: ["shrink-0 self-center", "Open plan"],
				actions: ["Reject", "Revise…", "Accept", "Accept and use auto modeCtrl⏎Enter"],
				opened: [
					[
						"plan",
						{
							unprompted: true,
						},
					],
					["plan"],
				],
			},
		);
	});

	it("asks to leave plan mode when the ExitPlanMode has no plan: upstream's planless title and subtitle, no Open plan, no auto-open", async () =>
	{
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const host = paneHost(openPane);
		render(
			<PaneHostContext.Provider value={host}>
				<InlinePlanApproval toolUseId="toolu_plan_1" planText="  " plan={PLAN} />
			</PaneHostContext.Provider>,
		);
		await act(async () => Promise.resolve());
		expect(
			{
				title: document.querySelector("[data-question-stop-name]")?.textContent,
				subtitle: document.querySelector("[data-testid=approval-title-region] .text-ink-muted")?.textContent,
				openPlan: screen.queryByRole(
					"button",
					{
						name: "Open plan",
					},
				),
				opened: openPane.mock.calls,
			},
		).toStrictEqual(
			{
				title: "Claude wants to leave plan mode",
				subtitle: "Claude hasn\u2019t written a plan, so there\u2019s nothing to review.",
				openPlan: null,
				opened: [],
			},
		);
	});

	it("is named by its 'Claude proposed a plan' title while the Jump to question landing is on it", async () =>
	{
		render(<InlinePlanApproval toolUseId="toolu_plan_1" planText="# P" plan={PLAN} />);
		await act(async () => Promise.resolve());
		landOnWaitingCard(document.querySelector<HTMLElement>("[data-approval-card-root]")!);
		expect(
			screen
				.getByRole(
					"group",
					{
						name: "Claude proposed a plan",
					},
				)
				.hasAttribute("data-approval-card-root"),
		).toBe(true);
	});

	it("leaves out Open plan and the subtitle without a pane host", async () =>
	{
		render(<InlinePlanApproval toolUseId="toolu_plan_1" planText="# P" plan={PLAN} />);
		await act(async () => Promise.resolve());
		expect(
			{
				openPlan: screen.queryByRole(
					"button",
					{
						name: "Open plan",
					},
				),
				subtitle: document.querySelector("[data-testid=approval-title-region] .text-ink-muted"),
			},
		).toStrictEqual(
			{
				openPlan: null,
				subtitle: null,
			},
		);
	});

	it("plays upstream's enter animation for a live arrival, and skips it for a plan this tab already drew", async () =>
	{
		const live = render(<InlinePlanApproval toolUseId="toolu_plan_live" planText="# P" plan={PLAN} />);
		const liveRoot = live.container.querySelector("[data-approval-card-root]");
		const liveState =
		{
			animated: liveRoot?.classList.contains("animate-approval-inline-enter"),
			skip: liveRoot?.hasAttribute("data-skip-approval-enter"),
		};
		live.unmount();
		const seen = approvalEnterSeen("plan:sess_1:toolu_plan_live");
		markApprovalEnterSeen("plan:sess_1:toolu_plan_seen");
		const again = render(<InlinePlanApproval toolUseId="toolu_plan_seen" planText="# P" plan={PLAN} />);
		const againRoot = again.container.querySelector("[data-approval-card-root]");
		await act(async () => Promise.resolve());
		expect(
			{
				live: liveState,
				seen,
				again:
				{
					animated: againRoot?.classList.contains("animate-approval-inline-enter"),
					skip: againRoot?.hasAttribute("data-skip-approval-enter"),
				},
			},
		).toStrictEqual(
			{
				live:
				{
					animated: true,
					skip: false,
				},
				seen: true,
				again:
				{
					animated: false,
					skip: true,
				},
			},
		);
	});

	it("leaves the plan text to the Plan pane and is read-only with the terminal hint when no live pane can answer", () =>
	{
		const readOnly: PlanApprovalContextValue =
		{
			...PLAN,
			answerRoute: "read-only",
			loadDialog: async () => Promise.reject(new Error("no pane")),
		};
		const host = paneHost(vi.fn<PaneHostApi["openPane"]>());
		render(
			<PaneHostContext.Provider value={host}>
				<InlinePlanApproval toolUseId="" planText={HOOK_PLAN.plan} plan={readOnly} />
			</PaneHostContext.Provider>,
		);
		expect(
			{
				buttons: screen.queryAllByRole("button").map((button) => button.textContent),
				planText: document.querySelector("[data-inline-plan]")?.textContent.includes("Print hello"),
			},
		).toStrictEqual(
			{
				buttons: ["Open plan"],
				planText: false,
			},
		);
	});

	describe("without a pane host, as upstream's plan read gate", () =>
	{
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;

		afterEach(() =>
		{
			frames.clear();
			vi.restoreAllMocks();
		});

		/** Lays the card body out as `scrollHeight` of plan in 300px, scrolled to `scrollTop`. */
		function layBody(body: HTMLElement, scrollHeight: number, scrollTop = 0)
		{
			body.style.lineHeight = "19px";
			for (const [key, value] of [
				["clientHeight", 300],
				["scrollHeight", scrollHeight],
				["scrollTop", scrollTop],
				["clientWidth", 400],
			] as const)
			{
				Object.defineProperty(
					body,
					key,
					{
						configurable: true,
						value,
					},
				);
			}
			vi.spyOn(body, "getBoundingClientRect").mockReturnValue(
				DOMRect.fromRect(
					{
						x: 0,
						y: 100,
						width: 400,
						height: 300,
					},
				),
			);
			act(() =>
			{
				fireEvent.scroll(body);
			});
		}

		async function flushFrames()
		{
			for (let index = 0; index < 2; index++)
			{
				const due = [...frames.values()];
				frames.clear();
				await act(async () =>
				{
					for (const callback of due) callback(0);
					await Promise.resolve();
				});
			}
		}

		it("draws the plan in the body and holds both accepts until the body is scrolled to its end", async () =>
		{
			vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
			{
				nextFrame += 1;
				frames.set(nextFrame, callback);
				return nextFrame;
			});
			vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) =>
			{
				frames.delete(id);
			});
			const view = render(<InlinePlanApproval toolUseId="toolu_plan_1" planText={HOOK_PLAN.plan} plan={PLAN} />);
			await act(async () => Promise.resolve());
			const body = view.container.querySelector<HTMLElement>("[data-approval-card-body]")!;
			layBody(body, 900);
			const accepts = () =>
				screen
					.getAllByRole("button")
					.filter((button) => button.textContent.startsWith("Accept"))
					.map((button) => button.hasAttribute("disabled"));
			const plan = body.firstElementChild;
			const held =
			{
				plan:
				{
					testId: plan?.getAttribute("data-testid"),
					className: plan?.className,
					text: plan?.textContent,
				},
				body:
				{
					tabIndex: body.getAttribute("tabindex"),
					role: body.getAttribute("role"),
					label: body.getAttribute("aria-label"),
				},
				accepts: accepts(),
				hint: view.container.querySelector("[data-testid=approval-read-hint]")?.textContent,
			};
			layBody(body, 900, 600);
			await flushFrames();
			expect(
				{
					held,
					read:
					{
						accepts: accepts(),
						hint: view.container.querySelector("[data-testid=approval-read-hint]"),
					},
				},
			).toStrictEqual(
				{
					held:
					{
						plan:
						{
							testId: "approval-plan-text",
							className:
								"whitespace-pre-wrap break-words text-body text-secondary select-text [unicode-bidi:plaintext]",
							text: HOOK_PLAN.plan,
						},
						body:
						{
							tabIndex: "0",
							role: "group",
							label: "Request details",
						},
						accepts: [true, true],
						hint: "Scroll to the end to allow this.",
					},
					read:
					{
						accepts: [false, false],
						hint: null,
					},
				},
			);
		});

		it("lets a plan that fits through at once", async () =>
		{
			const view = render(<InlinePlanApproval toolUseId="toolu_plan_1" planText={HOOK_PLAN.plan} plan={PLAN} />);
			await act(async () => Promise.resolve());
			const body = view.container.querySelector<HTMLElement>("[data-approval-card-body]")!;
			layBody(body, 300);
			expect(
				{
					accepts: screen
						.getAllByRole("button")
						.filter((button) => button.textContent.startsWith("Accept"))
						.map((button) => button.hasAttribute("disabled")),
					role: body.getAttribute("role"),
				},
			).toStrictEqual(
				{
					accepts: [false, false],
					role: null,
				},
			);
		});
	});

	it("answers a hook-only plan (no tool_use id yet) through the plan approval context", async () =>
	{
		const decide = vi.fn<(decision: PlanDecision) => Promise<void>>(async () => Promise.resolve());
		render(
			<InlinePlanApproval
				toolUseId=""
				planText={HOOK_PLAN.plan}
				plan={
				{
					...PLAN,
					loadDialog: async () =>
						Promise.resolve(
							{
								forwardMode: null,
								manual: true,
							},
						),
					decide,
				}}
			/>,
		);
		await act(async () => Promise.resolve());
		const accept = screen.getAllByRole("button").find((button) => button.textContent === "AcceptCtrl⏎Enter");
		if (accept === undefined) throw new Error("No Accept button");
		await act(async () =>
		{
			fireEvent.click(accept);
			return Promise.resolve();
		});
		expect(decide.mock.calls).toStrictEqual([
			[
				{
					kind: "accept",
					mode: "default",
				},
			],
		]);
	});
});

describe("InlinePlanApproval keys (upstream's keyless plan root)", () =>
{
	async function renderPlan()
	{
		const view = render(<InlinePlanApproval toolUseId="toolu_plan_keys" planText="# P" plan={PLAN} />);
		await act(async () => Promise.resolve());
		const root = view.container.querySelector<HTMLElement>("[data-approval-card-root]");
		if (root === null) throw new Error("No card root");
		const buttons = screen.getAllByRole("button");
		const byText = (prefix: string) =>
		{
			const button = buttons.find((b) => b.textContent.startsWith(prefix));
			if (button === undefined) throw new Error(`No ${prefix} button`);
			return button;
		};
		return {
			root,
			byText,
		};
	}

	it("gives the plan card root no tab stop and no role, like upstream's `Fs` shell", async () =>
	{
		const {root} = await renderPlan();
		expect(
			{
				tabindex: root.getAttribute("tabindex"),
				role: root.getAttribute("role"),
			},
		).toStrictEqual(
			{
				tabindex: null,
				role: null,
			},
		);
	});

	it("leaves arrows on a focused action alone: not prevented, and focus stays put", async () =>
	{
		const {byText} = await renderPlan();
		const reject = byText("Reject");
		reject.focus();
		const results = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].map((key) => (
		{
			key,
			notPrevented: fireEvent.keyDown(
				reject,
				{
					key,
				},
			),
			focusedReject: document.activeElement === reject,
		}));
		expect(results).toStrictEqual([
			{
				key: "ArrowRight",
				notPrevented: true,
				focusedReject: true,
			},
			{
				key: "ArrowDown",
				notPrevented: true,
				focusedReject: true,
			},
			{
				key: "ArrowLeft",
				notPrevented: true,
				focusedReject: true,
			},
			{
				key: "ArrowUp",
				notPrevented: true,
				focusedReject: true,
			},
		]);
	});

	it("does not move focus to Accept on an Enter at the root", async () =>
	{
		const {root} = await renderPlan();
		root.focus();
		const before = document.activeElement;
		const notPrevented = fireEvent.keyDown(
			root,
			{
				key: "Enter",
			},
		);
		expect(
			{
				notPrevented,
				unmoved: document.activeElement === before,
			},
		).toStrictEqual(
			{
				notPrevented: true,
				unmoved: true,
			},
		);
	});

	it("swallows only a held Enter/Space on a plan button, as upstream's cds Button, and lets a modified Enter through outside a menu, as upstream's `Aq`", async () =>
	{
		const {byText} = await renderPlan();
		const prevented = (target: Element, init: KeyboardEventInit) => !fireEvent.keyDown(target, init);
		const keys = (target: Element) => (
		{
			repeatEnter: prevented(
				target,
				{
					key: "Enter",
					repeat: true,
				},
			),
			repeatSpace: prevented(
				target,
				{
					key: " ",
					repeat: true,
				},
			),
			altEnter: prevented(
				target,
				{
					key: "Enter",
					altKey: true,
				},
			),
			shiftEnter: prevented(
				target,
				{
					key: "Enter",
					shiftKey: true,
				},
			),
			plainEnter: prevented(
				target,
				{
					key: "Enter",
				},
			),
			plainSpace: prevented(
				target,
				{
					key: " ",
				},
			),
		});
		const expected =
		{
			repeatEnter: true,
			repeatSpace: true,
			altEnter: false,
			shiftEnter: false,
			plainEnter: false,
			plainSpace: false,
		};
		expect(
			{
				accept: keys(byText("Accept and")),
				reject: keys(byText("Reject")),
			},
		).toStrictEqual(
			{
				accept: expected,
				reject: expected,
			},
		);
	});

	it("swallows a held Enter inside a menu within the accept group, as upstream's `Aq`", async () =>
	{
		const {byText} = await renderPlan();
		const group = byText("Accept and").closest("[data-plan-accept-group]");
		if (group === null) throw new Error("No accept group");
		const menu = document.createElement("div");
		menu.setAttribute("role", "menu");
		const item = document.createElement("button");
		menu.append(item);
		group.append(menu);
		expect(
			fireEvent.keyDown(
				item,
				{
					key: "Enter",
					repeat: true,
				},
			),
		).toBe(false);
		menu.remove();
	});
});
