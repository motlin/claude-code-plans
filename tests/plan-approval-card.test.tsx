// @vitest-environment jsdom

import type {ReactNode} from "react";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {STACK_ACTIONS} from "../src/components/approval-card";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import {PlanApprovalCard} from "../src/components/plan-approval-card";
import type {PlanApprovalContextValue} from "../src/components/plan-approval-context";
import type {PlanDecision, PlanDialog} from "../src/lib/plan-approval";
import {planKeyAction} from "../src/lib/plan-approval";
import {addPlanComment, clearPlanComments, getPlanComments} from "../src/lib/plan-comments";
import {defaultPaneLayout} from "../src/lib/pane-layout";
import {PHONE_SHEET_QUERY} from "../src/lib/use-phone-sheet";

const SESSION = "sess_plan_card";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	clearPlanComments(SESSION);
});

const AUTO_DIALOG: PlanDialog = {forwardMode: "auto", manual: true};

function context(overrides: Partial<PlanApprovalContextValue> = {}) {
	const decide = vi.fn<(decision: PlanDecision) => Promise<void>>(async () => Promise.resolve());
	const value: PlanApprovalContextValue = {
		sessionId: SESSION,
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

	it("styles the feedback box as upstream's field: 6px radius, 5% fill, field ring, accent focus shadow", async () => {
		const {value} = context();
		await renderCard(value);
		fireEvent.click(button("Revise…Esc"));
		const box = screen.getByRole("textbox", {name: "Plan feedback"});
		expect(box.className.split(" ")).toStrictEqual([
			"w-full",
			"resize-none",
			"rounded-r6",
			"bg-alpha-1",
			"px-2",
			"py-1.5",
			"text-body",
			"text-primary",
			"placeholder:text-ink-muted",
			"shadow-[inset_0_0_0_1px_var(--color-border)]",
			"outline-none",
			"focus-visible:shadow-[var(--focus-shadow)]",
			"hover:not-focus:shadow-[inset_0_0_0_1px_var(--color-strong)]",
		]);
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

	it("stacks the actions full width in upstream's ≤420px container, both groups growing", async () => {
		const {value} = context();
		const view = await renderCard(value);
		expect(view.container.querySelector("[data-plan-actions]")?.className).toStrictEqual(
			`flex flex-wrap justify-between gap-x-1 gap-y-2 [&>span]:grow ${STACK_ACTIONS} @max-[420px]:[&>span]:flex-col @max-[420px]:[&>span]:items-stretch @max-[420px]:[&_button]:w-full`,
		);
	});
});

function hostOpening(openPane: PaneHostApi["openPane"]): PaneHostApi {
	return {
		layout: defaultPaneLayout(),
		openKinds: [],
		isOpen: () => false,
		openPane,
		closePane: () => {},
		togglePane: () => {},
	};
}

function withPaneHost(host: PaneHostApi, node: ReactNode) {
	return <PaneHostContext.Provider value={host}>{node}</PaneHostContext.Provider>;
}

describe("PlanApprovalCard with plan comments", () => {
	function seedComments() {
		addPlanComment(SESSION, {selectedText: "about 95°C.", startOffset: 40, endOffset: 51, comment: "Hotter"});
		addPlanComment(SESSION, {selectedText: "Green", startOffset: 5, endOffset: 10, comment: "Add oolong"});
	}

	function rowShape(view: ReturnType<typeof render>) {
		const list = view.container.querySelector("ul");
		return {
			listClass: list?.className,
			rows: [...(list?.querySelectorAll("li") ?? [])].map((li) => ({
				className: li.className,
				text: li.textContent,
			})),
		};
	}

	it("forces Revise open without moving focus: upstream's comment list, sr count, placeholder, and no Back", async () => {
		seedComments();
		const {value} = context();
		const view = await renderCard(value);
		const box = screen.getByRole("textbox", {name: "Plan feedback"});
		expect({
			...rowShape(view),
			placeholder: box.getAttribute("placeholder"),
			focused: document.activeElement === box,
			buttons: buttonNames(),
			spacer: view.container.querySelector("[data-plan-actions] > span")?.className,
		}).toStrictEqual({
			listClass: "-m-2 flex max-h-[176px] scroll-p-2 flex-col gap-1 overflow-y-auto p-2",
			rows: [
				{
					className: "flex items-center gap-0.5 rounded-r4 bg-alpha-1 pe-1.25 hover:bg-alpha-2",
					text: "about 95°C.Hotter",
				},
				{
					className: "flex items-center gap-0.5 rounded-r4 bg-alpha-1 pe-1.25 hover:bg-alpha-2",
					text: "GreenAdd oolong",
				},
				{className: "sr-only", text: "2 inline comments will be sent"},
			],
			placeholder: "Anything else to add?",
			focused: false,
			buttons: ["about 95°C.Hotter", "", "GreenAdd oolong", "", "Revise"],
			spacer: "@max-[420px]:hidden",
		});
	});

	it("words the sr count for one comment", async () => {
		addPlanComment(SESSION, {selectedText: "Green", startOffset: 5, endOffset: 10, comment: "Add oolong"});
		const {value} = context();
		const view = await renderCard(value);
		expect(view.container.querySelector("li.sr-only")?.textContent).toStrictEqual("1 inline comment will be sent");
	});

	it("returns to the idle actions once every comment is deleted", async () => {
		seedComments();
		const {value} = context();
		await renderCard(value);
		for (const del of screen.getAllByRole("button", {name: "Delete comment"})) fireEvent.click(del);
		expect({buttons: buttonNames(), store: getPlanComments(SESSION)}).toStrictEqual({
			buttons: ["Reject", "Revise…Esc", "AcceptCtrlShift⏎Enter", "Accept and auto modeCtrl⏎Enter"],
			store: [],
		});
	});

	it("keeps Revise open after deleting the last comment when the user opened it", async () => {
		addPlanComment(SESSION, {selectedText: "Green", startOffset: 5, endOffset: 10, comment: "Add oolong"});
		const {value} = context();
		await renderCard(value);
		fireEvent.click(screen.getByRole("button", {name: "Delete comment"}));
		fireEvent.click(button("Revise…Esc"));
		addPlanComment(SESSION, {selectedText: "Green", startOffset: 5, endOffset: 10, comment: "Again"});
		await act(async () => Promise.resolve());
		fireEvent.click(screen.getByRole("button", {name: "Delete comment"}));
		expect(buttonNames()).toStrictEqual(["Back", "Revise"]);
	});

	it("opens the Plan pane from a comment row", async () => {
		seedComments();
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const {value} = context();
		render(withPaneHost(hostOpening(openPane), <PlanApprovalCard toolUseId="toolu_plan_1" plan={value} />));
		await act(async () => Promise.resolve());
		openPane.mockClear();
		fireEvent.click(button("GreenAdd oolong"));
		expect(openPane.mock.calls).toStrictEqual([["plan"]]);
	});

	it("keeps Revise open on Esc while comments exist", async () => {
		seedComments();
		const {value} = context();
		await renderCard(value);
		const box = screen.getByRole("textbox", {name: "Plan feedback"});
		fireEvent.keyDown(box, {key: "Escape"});
		fireEvent.keyDown(document.body, {key: "Escape"});
		expect(screen.queryByRole("textbox", {name: "Plan feedback"})).not.toBeNull();
	});

	it("sends upstream's formatted feedback on Revise and clears the session's comments", async () => {
		seedComments();
		const {value, decide} = context();
		await renderCard(value);
		fireEvent.change(screen.getByRole("textbox", {name: "Plan feedback"}), {target: {value: "Also iced."}});
		await act(async () => {
			fireEvent.click(button("Revise"));
			return Promise.resolve();
		});
		expect({calls: decide.mock.calls, store: getPlanComments(SESSION)}).toStrictEqual({
			calls: [
				[
					{
						kind: "reject",
						feedback:
							"On selected text:\n> Green\nAdd oolong\n\nOn selected text:\n> about 95°C.\nHotter\n\n\nAlso iced.",
					},
				],
			],
			store: [],
		});
	});

	it("restores the comments and keeps the typed text when the send fails", async () => {
		seedComments();
		const before = getPlanComments(SESSION);
		const {value} = context({decide: async () => Promise.reject(new Error("No plan approval is pending"))});
		const view = await renderCard(value);
		fireEvent.change(screen.getByRole("textbox", {name: "Plan feedback"}), {target: {value: "Also iced."}});
		await act(async () => {
			fireEvent.click(button("Revise"));
			return Promise.resolve();
		});
		expect({
			store: getPlanComments(SESSION),
			typed: screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Plan feedback"}).value,
			error: view.container.querySelector("[data-plan-error]")?.textContent,
		}).toStrictEqual({store: before, typed: "Also iced.", error: "No plan approval is pending"});
	});
});

describe("PlanApprovalCard keys", () => {
	beforeEach(() => {
		vi.useFakeTimers({toFake: ["performance"]});
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("withholds ⌘⏎ within upstream's 400ms of the card arriving, then accepts", async () => {
		const {value, decide} = context();
		await renderCard(value);
		vi.advanceTimersByTime(100);
		fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
		const callsInGrace = [...decide.mock.calls];
		vi.advanceTimersByTime(400);
		await act(async () => {
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
			return Promise.resolve();
		});
		expect({callsInGrace, calls: decide.mock.calls}).toStrictEqual({
			callsInGrace: [],
			calls: [[{kind: "accept", mode: "auto"}]],
		});
	});

	it("listens on window in the capture phase and stops the chord there", async () => {
		const {value, decide} = context();
		await renderCard(value);
		vi.advanceTimersByTime(500);
		const bubbled = vi.fn<(event: Event) => void>();
		document.addEventListener("keydown", bubbled);
		await act(async () => {
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
			return Promise.resolve();
		});
		document.removeEventListener("keydown", bubbled);
		expect({calls: decide.mock.calls, bubbled: bubbled.mock.calls.length}).toStrictEqual({
			calls: [[{kind: "accept", mode: "auto"}]],
			bubbled: 0,
		});
	});

	it("accepts manually with ⇧⌘⏎ from a composer holding a draft, while ⌘⏎ stays the composer's", async () => {
		const {value, decide} = context();
		await renderCard(value);
		const composer = document.createElement("div");
		composer.dataset["focusRegion"] = "composer";
		const draft = document.createElement("textarea");
		draft.value = "a draft";
		composer.append(draft);
		document.body.append(composer);
		vi.advanceTimersByTime(500);
		fireEvent.keyDown(draft, {key: "Enter", metaKey: true});
		const afterPlain = [...decide.mock.calls];
		await act(async () => {
			fireEvent.keyDown(draft, {key: "Enter", metaKey: true, shiftKey: true});
			return Promise.resolve();
		});
		composer.remove();
		expect({afterPlain, calls: decide.mock.calls}).toStrictEqual({
			afterPlain: [],
			calls: [[{kind: "accept", mode: "default"}]],
		});
	});
});

describe("PlanApprovalCard auto-opens the Plan pane", () => {
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

	function card(host: PaneHostApi | null, key: string) {
		const {value} = context();
		const node = <PlanApprovalCard key={key} toolUseId="toolu_plan_1" plan={value} />;
		return host === null ? node : <PaneHostContext.Provider value={host}>{node}</PaneHostContext.Provider>;
	}

	function mockPhone(phone: boolean) {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === PHONE_SHEET_QUERY ? phone : false,
				media: query,
				onchange: null,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			})),
		);
	}

	it("opens it once per mount, and again on a remount, as upstream's card effect does", async () => {
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		const view = render(card(paneHost(openPane), "a"));
		await act(async () => Promise.resolve());
		const afterMount = [...openPane.mock.calls];
		view.rerender(card(paneHost(openPane), "a"));
		await act(async () => Promise.resolve());
		const afterRerender = [...openPane.mock.calls];
		view.rerender(card(paneHost(openPane), "b"));
		await act(async () => Promise.resolve());
		expect({afterMount, afterRerender, afterRemount: openPane.mock.calls}).toStrictEqual({
			afterMount: [["plan"]],
			afterRerender: [["plan"]],
			afterRemount: [["plan"], ["plan"]],
		});
	});

	it("does nothing without a pane host", async () => {
		render(card(null, "a"));
		await act(async () => Promise.resolve());
		expect(buttonNames()).toStrictEqual([
			"Reject",
			"Revise…Esc",
			"AcceptCtrlShift⏎Enter",
			"Accept and auto modeCtrl⏎Enter",
		]);
	});

	it("skips it on a phone, where upstream has no side panes", async () => {
		mockPhone(true);
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		render(card(paneHost(openPane), "a"));
		await act(async () => Promise.resolve());
		expect(openPane.mock.calls).toStrictEqual([]);
	});

	it("skips it while the tab is hidden", async () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		const openPane = vi.fn<PaneHostApi["openPane"]>();
		render(card(paneHost(openPane), "a"));
		await act(async () => Promise.resolve());
		vi.restoreAllMocks();
		expect(openPane.mock.calls).toStrictEqual([]);
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
		{name: "a held ⌘⏎ repeat", event: {...keys, key: "Enter", metaKey: true, repeat: true}, action: null},
		{name: "a held Esc repeat", event: {...keys, key: "Escape", repeat: true}, action: null},
		{
			name: "⌘⏎ while an IME composes",
			event: {...keys, key: "Enter", metaKey: true, isComposing: true},
			action: null,
		},
	])("maps $name", ({event, action}) => {
		expect(planKeyAction(event, AUTO_DIALOG)).toStrictEqual(action);
	});
});
