// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import type {ComposerState} from "../src/lib/composer-state";
import type {LiveLaunchControls} from "../src/hooks/use-live-launch-options";
import type {LaunchOptions} from "../src/lib/launch-options";

const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CHIN: ComposerState = {
	mode: {id: "default", label: "Manual"},
	model: "Opus 5.5",
	modelId: "claude-opus-5-5",
	effort: {id: "high", label: "High"},
	usage: null,
};

type OnSend = (prompt: string, launchOptions: LaunchOptions) => void;

function renderComposer(
	extra: {bypassPermissionsAllowed?: boolean; live?: LiveLaunchControls; chin?: ComposerState} = {},
) {
	const onSend = vi.fn<OnSend>();
	render(<Composer variant="session" draftKey="session-alice" onSend={onSend} chin={CHIN} {...extra} />);
	return onSend;
}

function press(init: KeyboardEventInit) {
	fireEvent.keyDown(document.activeElement ?? document.body, init);
}

const openModeMenu = () => press({key: "µ", code: "KeyM", metaKey: true, altKey: true});
const openModelMenu = () => press({key: "I", code: "KeyI", metaKey: true, shiftKey: true});
const openEffort = () => press({key: "E", code: "KeyE", metaKey: true, shiftKey: true});

function sendPrompt(text: string) {
	const textarea = screen.getByRole("textbox", {name: "Prompt"});
	fireEvent.change(textarea, {target: {value: text}});
	fireEvent.keyDown(textarea, {key: "Enter"});
}

function radioRows(menu: HTMLElement) {
	return within(menu)
		.getAllByRole("menuitemradio")
		.map((item) => ({
			label: item.querySelector("[data-menu-item-label]")?.textContent,
			description: item.querySelector("[data-menu-item-description]")?.textContent ?? null,
			key: item.getAttribute("aria-keyshortcuts"),
			checked: item.getAttribute("aria-checked"),
		}));
}

beforeEach(() => {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
});

describe("Composer mode menu", () => {
	it("opens on ⌥⌘M with the upstream local-session items and digit keycaps", async () => {
		renderComposer();

		openModeMenu();
		const menu = await screen.findByRole("menu");

		expect(radioRows(menu)).toStrictEqual([
			{
				label: "Auto",
				description: "Claude handles permission decisions",
				key: "1",
				checked: "false",
			},
			{
				label: "Manual",
				description: "Always ask before making changes",
				key: "2",
				checked: "true",
			},
			{
				label: "Accept edits",
				description: "Automatically accept all file edits",
				key: "3",
				checked: "false",
			},
			{
				label: "Plan",
				description: "Create a plan before making changes",
				key: "4",
				checked: "false",
			},
		]);
	});

	it("picks an item with its digit, closes the menu, and sends it as a launch option", async () => {
		const onSend = renderComposer();

		openModeMenu();
		fireEvent.keyDown(await screen.findByRole("menu"), {key: "3", code: "Digit3"});
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		const readout = document.querySelector("[data-chin-mode]")?.textContent;
		sendPrompt("Continue Alice's test");

		expect({readout, calls: onSend.mock.calls}).toStrictEqual({
			readout: "Accept edits",
			calls: [["Continue Alice's test", {permissionMode: "acceptEdits"}]],
		});
	});

	it("offers Bypass permissions only when settings allow it, behind a confirm", async () => {
		renderComposer();
		openModeMenu();
		const withoutBypass = radioRows(await screen.findByRole("menu")).map((row) => row.label);
		cleanup();

		const onSend = renderComposer({bypassPermissionsAllowed: true});
		openModeMenu();
		const menu = await screen.findByRole("menu");
		const bypass = within(menu).getByRole("menuitemradio", {name: /Bypass permissions/});
		const variant = bypass.getAttribute("data-variant");
		fireEvent.click(bypass);
		const confirm = await screen.findByRole("alertdialog");
		const confirmText = confirm.textContent;
		fireEvent.click(within(confirm).getByRole("button", {name: "Enable"}));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		const readout = document.querySelector("[data-chin-mode]")?.textContent;
		sendPrompt("Continue Bob's test");

		expect({
			withoutBypass,
			variant,
			confirmText,
			readout,
			calls: onSend.mock.calls,
		}).toStrictEqual({
			withoutBypass: ["Auto", "Manual", "Accept edits", "Plan"],
			variant: "warning",
			confirmText:
				"Enable bypass permissionsClaude will read, edit, and execute files without asking — including potentially destructive commands. Only use this in isolated or disposable environments.CancelEnable",
			readout: "Bypass",
			calls: [["Continue Bob's test", {permissionMode: "bypassPermissions"}]],
		});
	});
});

describe("Composer model menu", () => {
	it("opens on ⇧⌘I with versioned labels, the checked row's ✓ in place of its digit, and a More models submenu", async () => {
		const onSend = renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const rows = radioRows(menu).map(({label, key, checked}) => ({label, key, checked}));
		const more = within(menu).getByRole("menuitem", {name: /More models/}).textContent;
		fireEvent.keyDown(menu, {key: "2", code: "Digit2"});
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		const trigger = screen.getByRole("button", {name: /^Model:/}).getAttribute("aria-label");
		sendPrompt("Continue Carol's test");

		expect({rows, more, trigger, calls: onSend.mock.calls}).toStrictEqual({
			rows: [
				{label: "Opus 5.5", key: null, checked: "true"},
				{label: "Fable 5.1", key: "2", checked: "false"},
				{label: "Sonnet 5.5", key: "3", checked: "false"},
				{label: "Haiku 4.5", key: "4", checked: "false"},
			],
			more: "More models",
			trigger: "Model: Fable 5.1",
			calls: [["Continue Carol's test", {model: "fable"}]],
		});
	});

	it("numbers the rows around a checked middle row and picks the row a digit names", async () => {
		const onSend = renderComposer({chin: {...CHIN, model: "Fable 5.1", modelId: "claude-fable-5-1"}});

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const rows = radioRows(menu).map(({label, key}) => ({label, key}));
		const text = within(menu)
			.getAllByRole("menuitemradio")
			.map((item) => item.textContent);
		fireEvent.keyDown(menu, {key: "3", code: "Digit3"});
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		sendPrompt("Continue Erin's test");

		expect({rows, text, calls: onSend.mock.calls}).toStrictEqual({
			rows: [
				{label: "Opus 5.5", key: "1"},
				{label: "Fable 5.1", key: null},
				{label: "Sonnet 5.5", key: "3"},
				{label: "Haiku 4.5", key: "4"},
			],
			text: ["Opus 5.51", "Fable 5.1", "Sonnet 5.53", "Haiku 4.54"],
			calls: [["Continue Erin's test", {model: "sonnet"}]],
		});
	});

	it("opens More models on hover with only the models the primary rows lack, in upstream order", async () => {
		const onSend = renderComposer();

		openModelMenu();
		const subTrigger = await screen.findByRole("menuitem", {name: /More models/});
		fireEvent.pointerEnter(subTrigger, {pointerType: "mouse"});
		fireEvent.mouseEnter(subTrigger);
		fireEvent.pointerMove(subTrigger, {pointerType: "mouse"});
		fireEvent.mouseMove(subTrigger);
		await waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(2));
		const submenu = screen.getAllByRole("menu")[1] as HTMLElement;
		const labels = radioRows(submenu).map((row) => row.label);
		fireEvent.click(within(submenu).getByRole("menuitemradio", {name: "Opus 4.6"}));
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		sendPrompt("Continue Dave's test");

		expect({labels, calls: onSend.mock.calls}).toStrictEqual({
			labels: ["Sonnet 5", "Opus 5", "Fable 5", "Opus 4.8", "Opus 4.7", "Opus 4.6", "Sonnet 4.6"],
			calls: [["Continue Dave's test", {model: "claude-opus-4-6"}]],
		});
	});
});

describe("Composer effort selector", () => {
	it("opens a 220px dialog on ⇧⌘E with a five-stop slider", async () => {
		const onSend = renderComposer();

		openEffort();
		const dialog = await screen.findByRole("dialog");
		const slider = within(dialog).getByRole("slider", {name: "Effort"});
		const before = {
			cds: dialog.getAttribute("data-cds"),
			width: dialog.className.includes("w-[220px]"),
			min: slider.getAttribute("min"),
			max: slider.getAttribute("max"),
			value: (slider as HTMLInputElement).value,
			valueText: slider.getAttribute("aria-valuetext"),
			captions: dialog.querySelector("[data-effort-captions]")?.textContent,
		};
		fireEvent.change(slider, {target: {value: "3"}});
		const header = dialog.querySelector("[data-effort-current]")?.textContent;
		const trigger = screen.getByRole("button", {name: /^Effort:/}).getAttribute("aria-label");
		sendPrompt("Continue Erin's test");

		expect({before, header, trigger, calls: onSend.mock.calls}).toStrictEqual({
			before: {
				cds: "ModelSelectorEffort",
				width: true,
				min: "0",
				max: "4",
				value: "2",
				valueText: "High (Recommended)",
				captions: "FasterSmarter",
			},
			header: "Extra-high",
			trigger: "Effort: Extra-high",
			calls: [["Continue Erin's test", {effort: "xhigh"}]],
		});
	});

	it("picks a stop with its digit and closes", async () => {
		const onSend = renderComposer();

		openEffort();
		fireEvent.keyDown(await screen.findByRole("dialog"), {key: "1", code: "Digit1"});
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		sendPrompt("Continue Frank's test");

		expect(onSend.mock.calls).toStrictEqual([["Continue Frank's test", {effort: "low"}]]);
	});
});

describe("Composer effort slider affordances", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function openDialog() {
		openEffort();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		const dialog = screen.getByRole("dialog");
		return dialog;
	}

	function tooltipOf(anchor: Element): string | null {
		fireEvent.pointerEnter(anchor);
		act(() => vi.advanceTimersByTime(400));
		const text = screen.queryByRole("tooltip")?.textContent ?? null;
		fireEvent.pointerLeave(anchor);
		return text;
	}

	it("draws five tick dots whose hover tooltips use upstream's short names", async () => {
		renderComposer();
		const dialog = await openDialog();
		const ticks = [...dialog.querySelectorAll("[data-effort-tick]")];

		expect(
			ticks.map((tick) => {
				const anchor = tick.parentElement;
				if (anchor === null) throw new Error("tick has no anchor");
				return tooltipOf(anchor);
			}),
		).toStrictEqual(["Low", "Medium", "High", "Extra", "Max"]);
	});

	it("captions High as Recommended and drops the suffix elsewhere in aria-valuetext", async () => {
		renderComposer();
		const dialog = await openDialog();
		const slider = within(dialog).getByRole("slider", {name: "Effort"});
		const atHigh = slider.getAttribute("aria-valuetext");
		fireEvent.change(slider, {target: {value: "4"}});

		expect({
			caption: dialog.querySelector("[data-effort-recommended]")?.textContent,
			atHigh,
			atMax: slider.getAttribute("aria-valuetext"),
			radius: dialog.className.includes("rounded-r7"),
		}).toStrictEqual({caption: "Recommended", atHigh: "High (Recommended)", atMax: "Max", radius: true});
	});

	it("shows the About effort help card on hover", async () => {
		renderComposer();
		const dialog = await openDialog();
		const help = within(dialog).getByRole("button", {name: "About effort"});
		await act(async () => {
			fireEvent.pointerEnter(help, {pointerType: "mouse"});
			fireEvent.mouseEnter(help);
			fireEvent.mouseMove(help);
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(document.querySelector("[data-effort-help]")?.textContent).toBe(
			"EffortHigher effort means more thorough responses, but takes longer and uses your limits faster.",
		);
	});
});

describe("Composer menu shortcuts", () => {
	it("are ignored while a dialog is open", () => {
		renderComposer();
		render(
			<div role="dialog" aria-label="Other dialog">
				<button type="button">Inside</button>
			</div>,
		);
		screen.getByRole("button", {name: "Inside"}).focus();

		openModeMenu();
		openModelMenu();
		openEffort();

		expect({
			menus: screen.queryAllByRole("menu").length,
			effort: document.querySelector('[role="dialog"][data-cds="ModelSelectorEffort"]'),
		}).toStrictEqual({menus: 0, effort: null});
	});

	it("sends no launch options until one is picked", () => {
		const onSend = renderComposer();
		sendPrompt("Continue Grace's test");
		expect(onSend.mock.calls).toStrictEqual([["Continue Grace's test", {}]]);
	});
});

describe("Composer on a live pane", () => {
	function liveControls(options: LaunchOptions = {}) {
		const apply = vi.fn<LiveLaunchControls["apply"]>(async () => {});
		return {live: {options, apply}, apply};
	}

	it("applies a mode pick to the pane instead of storing a launch option", async () => {
		const {live, apply} = liveControls();
		const onSend = renderComposer({live});

		openModeMenu();
		fireEvent.keyDown(await screen.findByRole("menu"), {key: "4", code: "Digit4"});
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		sendPrompt("Continue Heidi's test");

		expect({applied: apply.mock.calls, sends: onSend.mock.calls}).toStrictEqual({
			applied: [[{permissionMode: "plan"}]],
			sends: [["Continue Heidi's test", {}]],
		});
	});

	it("checks the session's current model in the Model menu", async () => {
		const {live} = liveControls();
		renderComposer({live, chin: {...CHIN, model: "Fable 5.1", modelId: "claude-fable-5-1"}});

		openModelMenu();
		const menu = await screen.findByRole("menu");

		expect({
			trigger: screen.getByRole("button", {name: /^Model:/}).getAttribute("aria-label"),
			rows: radioRows(menu).map(({label, checked}) => ({label, checked})),
		}).toStrictEqual({
			trigger: "Model: Fable 5.1",
			rows: [
				{label: "Opus 5.5", checked: "false"},
				{label: "Fable 5.1", checked: "true"},
				{label: "Sonnet 5.5", checked: "false"},
				{label: "Haiku 4.5", checked: "false"},
			],
		});
	});

	it("shows the live picks in the chin", () => {
		const {live} = liveControls({model: "fable", effort: "max", permissionMode: "plan"});
		renderComposer({live});

		expect({
			mode: document.querySelector("[data-chin-mode]")?.textContent,
			model: screen.getByRole("button", {name: /^Model:/}).getAttribute("aria-label"),
			effort: screen.getByRole("button", {name: /^Effort:/}).getAttribute("aria-label"),
		}).toStrictEqual({mode: "Plan", model: "Model: Fable 5.1", effort: "Effort: Max"});
	});

	it("asks Change effort? before sending an effort change", async () => {
		const {live, apply} = liveControls();
		renderComposer({live});

		openEffort();
		fireEvent.keyDown(await screen.findByRole("dialog"), {key: "1", code: "Digit1"});
		const confirm = await screen.findByRole("alertdialog");
		const confirmText = confirm.textContent;
		const appliedBeforeConfirm = apply.mock.calls.length;
		fireEvent.click(within(confirm).getByRole("button", {name: "Change effort"}));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

		expect({confirmText, appliedBeforeConfirm, applied: apply.mock.calls}).toStrictEqual({
			confirmText:
				"Change effort?This session is cached with effort set to High. Changing it to Low means Claude re-reads the whole session on your next message, which uses more of your limit.CancelChange effort",
			appliedBeforeConfirm: 0,
			applied: [[{effort: "low"}]],
		});
	});

	it("drops the effort change when the confirm is cancelled", async () => {
		const {live, apply} = liveControls();
		renderComposer({live});

		openEffort();
		fireEvent.keyDown(await screen.findByRole("dialog"), {key: "5", code: "Digit5"});
		const confirm = await screen.findByRole("alertdialog");
		fireEvent.click(within(confirm).getByRole("button", {name: "Cancel"}));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

		expect({
			applied: apply.mock.calls,
			effort: screen.getByRole("button", {name: /^Effort:/}).getAttribute("aria-label"),
		}).toStrictEqual({applied: [], effort: "Effort: High"});
	});
});

describe("Composer chin tooltips and contrast", () => {
	function hoverTooltip(trigger: Element): string | null {
		const anchor = trigger.parentElement;
		if (anchor === null) throw new Error("trigger has no parent");
		fireEvent.pointerEnter(anchor);
		act(() => vi.advanceTimersByTime(400));
		const text = screen.queryByRole("tooltip")?.textContent ?? null;
		fireEvent.pointerLeave(anchor);
		return text;
	}

	it("shows upstream's Add, Mode ⌥⌘M and Effort tooltips, and none on the model trigger", () => {
		vi.useFakeTimers();
		try {
			renderComposer();
			const tooltips = {
				add: hoverTooltip(screen.getByRole("button", {name: "Add"})),
				mode: hoverTooltip(document.querySelector("[data-chin-mode]") ?? document.body),
				model: hoverTooltip(screen.getByRole("button", {name: "Model: Opus 5.5"})),
				effort: hoverTooltip(screen.getByRole("button", {name: "Effort: High"})),
			};

			expect(tooltips).toStrictEqual({add: "Add", mode: "Mode⌥Option⌘CommandM", model: null, effort: "Effort"});
		} finally {
			vi.useRealTimers();
		}
	});

	it("reads the model and effort in primary ink, the rest in secondary, with r4 corners and a 16px +", () => {
		renderComposer();
		const classes = (element: Element | null) => element?.getAttribute("class")?.split(" ") ?? [];
		const add = screen.getByRole("button", {name: "Add"});
		const pick = (element: Element | null) => {
			const list = classes(element);
			return {
				ink: list.filter((name) => name === "text-primary" || name === "text-secondary"),
				radius: list.filter((name) => name.startsWith("rounded")),
				lineHeight: list.filter((name) => name.startsWith("leading")),
			};
		};

		expect({
			add: pick(add),
			plusIcon: classes(add.querySelector("svg")).filter((name) => name.startsWith("size-")),
			mode: pick(document.querySelector("[data-chin-mode]")),
			model: pick(screen.getByRole("button", {name: "Model: Opus 5.5"})),
			effort: pick(screen.getByRole("button", {name: "Effort: High"})),
		}).toStrictEqual({
			add: {ink: ["text-secondary"], radius: ["rounded-r4"], lineHeight: ["leading-[17px]"]},
			plusIcon: ["size-4"],
			mode: {ink: ["text-secondary"], radius: ["rounded-r4"], lineHeight: ["leading-[17px]"]},
			model: {ink: ["text-primary"], radius: ["rounded-r4"], lineHeight: ["leading-[17px]"]},
			effort: {ink: ["text-primary"], radius: ["rounded-r4"], lineHeight: ["leading-[17px]"]},
		});
	});

	it("heads the Mode menu with a 500-weight label padded 4px 8px", async () => {
		renderComposer();
		openModeMenu();
		const menu = await screen.findByRole("menu");
		const label = within(menu).getByText("Mode");

		expect(label.getAttribute("class")).toBe("px-2 py-1 text-[12px]/[15px] font-medium text-[var(--menu-muted)]");
	});
});
