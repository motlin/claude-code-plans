// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import type {useNavigate} from "@tanstack/react-router";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {DensityScope} from "../src/components/ui/density";
import {customizeMcpServersQueryOptions, type McpServerSummary} from "../src/lib/api/customize";
import {toConnectorSlug} from "../src/lib/customize/mcp-tool-permissions";
import type {ComposerState} from "../src/lib/composer-state";
import type {LiveLaunchControls} from "../src/hooks/use-live-launch-options";
import type {LaunchOptions} from "../src/lib/launch-options";

const navigate = vi.hoisted(() => vi.fn<ReturnType<typeof useNavigate>>());
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));

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
	// The composer sits in the compact main column.
	render(
		<DensityScope density="compact">
			<Composer variant="session" draftKey="session-alice" onSend={onSend} chin={CHIN} {...extra} />
		</DensityScope>,
	);
	return onSend;
}

function press(init: KeyboardEventInit) {
	fireEvent.keyDown(document.activeElement ?? document.body, init);
}

const openModeMenu = () => {
	press({key: "µ", code: "KeyM", metaKey: true, altKey: true});
};
const openModelMenu = () => {
	press({key: "I", code: "KeyI", metaKey: true, shiftKey: true});
};
const openEffort = () => {
	press({key: "E", code: "KeyE", metaKey: true, shiftKey: true});
};

function sendPrompt(text: string) {
	const textarea = screen.getByRole("textbox", {name: "Prompt"});
	fireEvent.change(textarea, {target: {value: text}});
	fireEvent.keyDown(textarea, {key: "Enter"});
}

async function pickEffort(name: RegExp) {
	openEffort();
	await waitFor(() => {
		expect(screen.getAllByRole("menu")).toHaveLength(2);
	});
	const submenu = screen.getAllByRole("menu")[1];
	if (submenu === undefined) throw new Error("no Effort submenu");
	fireEvent.click(within(submenu).getByRole("menuitemradio", {name}));
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

	it("renders upstream's two-line rows: label over a wrapping description, trailing pinned to the first line", async () => {
		renderComposer();

		openModeMenu();
		const menu = await screen.findByRole("menu");
		const popup = menu.closest("[data-cds]");
		const rows = within(menu)
			.getAllByRole("menuitemradio")
			.map((item) => {
				const classes = item.className.split(" ");
				return {
					twoLine: classes.includes("min-h-[41px]") && classes.includes("items-start"),
					singleLine: classes.includes("h-6"),
					paddedBottom: classes.includes("pb-1"),
					description: item.querySelector("[data-menu-item-description]")?.className,
					trailing: item.querySelector("[data-menu-item-trailing]")?.className,
				};
			});

		const row = {
			twoLine: true,
			singleLine: false,
			paddedBottom: true,
			description: "break-words text-[12px]/[15px] text-[var(--menu-muted)]",
			trailing: "flex shrink-0 items-center gap-1 ms-3 h-[1lh] self-start",
		};
		expect({rows, fixedWidth: popup?.classList.contains("w-[280px]")}).toStrictEqual({
			rows: [row, row, row, row],
			fixedWidth: false,
		});
	});

	it("picks an item with its digit, closes the menu, and sends it as a launch option", async () => {
		const onSend = renderComposer();

		openModeMenu();
		fireEvent.keyDown(await screen.findByRole("menu"), {key: "3", code: "Digit3"});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
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
		await waitFor(() => {
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});
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
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const trigger = screen.getByRole("button", {name: /^Model:/}).getAttribute("aria-label");
		sendPrompt("Continue Carol's test");

		expect({rows, more, trigger, calls: onSend.mock.calls}).toStrictEqual({
			rows: [
				{label: "Opus 5.5", key: "1", checked: "true"},
				{label: "Fable 5.1", key: "2", checked: "false"},
				{label: "Sonnet 5.5", key: "3", checked: "false"},
				{label: "Haiku 5.5", key: "4", checked: "false"},
			],
			more: "More models",
			trigger: "Model: Fable 5.1, Effort: High",
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
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Erin's test");

		expect({rows, text, calls: onSend.mock.calls}).toStrictEqual({
			rows: [
				{label: "Opus 5.5", key: "1"},
				{label: "Fable 5.1", key: "2"},
				{label: "Sonnet 5.5", key: "3"},
				{label: "Haiku 5.5", key: "4"},
			],
			text: ["Opus 5.51", "Fable 5.1", "Sonnet 5.53", "Haiku 5.54"],
			calls: [["Continue Erin's test", {model: "sonnet"}]],
		});
	});

	it("keeps the checked row's digit live: pressing 1 on the checked Opus row closes the menu", async () => {
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const opus = within(menu).getByRole("menuitemradio", {name: /^Opus/});
		const attrs = {key: opus.getAttribute("aria-keyshortcuts"), number: opus.getAttribute("data-accelerator")};
		fireEvent.keyDown(menu, {key: "1", code: "Digit1"});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});

		expect(attrs).toStrictEqual({key: "1", number: "1"});
	});

	it("matches the digit by e.code, so a Numpad 3 picks Sonnet", async () => {
		const onSend = renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		fireEvent.keyDown(menu, {key: "3", code: "Numpad3"});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Grace's test");

		expect(onSend.mock.calls).toStrictEqual([["Continue Grace's test", {model: "sonnet"}]]);
	});

	it("ignores a repeating digit key", async () => {
		const onSend = renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		fireEvent.keyDown(menu, {key: "2", code: "Digit2", repeat: true});
		const stillOpen = screen.queryByRole("menu") !== null;
		const checked = radioRows(menu).find((row) => row.checked === "true")?.label;
		fireEvent.keyDown(menu, {key: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Heidi's test");

		expect({stillOpen, checked, calls: onSend.mock.calls}).toStrictEqual({
			stillOpen: true,
			checked: "Opus 5.5",
			calls: [["Continue Heidi's test", {}]],
		});
	});

	it("shows upstream's Fable tooltip on the left when hovering the Fable row", async () => {
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const anchor = within(menu).getByRole("menuitemradio", {name: /^Fable/}).parentElement;
		if (anchor === null) throw new Error("Fable row has no tooltip anchor");
		fireEvent.pointerEnter(anchor);
		const tooltip = await screen.findByRole("tooltip");

		expect({text: tooltip.textContent, side: tooltip.getAttribute("data-side")}).toStrictEqual({
			text: "Fable is the most capable model and draws down usage much faster than Opus",
			side: "left",
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
		await waitFor(() => {
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const submenu = screen.getAllByRole("menu")[1]!;
		const labels = radioRows(submenu).map((row) => row.label);
		fireEvent.click(within(submenu).getByRole("menuitemradio", {name: "Opus 4.6"}));
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Dave's test");

		expect({labels, calls: onSend.mock.calls}).toStrictEqual({
			labels: ["Haiku 4.5", "Sonnet 5", "Opus 5", "Fable 5", "Opus 4.8", "Opus 4.7", "Opus 4.6", "Sonnet 4.6"],
			calls: [["Continue Dave's test", {model: "claude-opus-4-6"}]],
		});
	});
});

describe("Composer effort submenu", () => {
	async function openEffortMenu() {
		openEffort();
		await waitFor(() => {
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const submenu = screen.getAllByRole("menu")[1];
		if (submenu === undefined) throw new Error("no Effort submenu");
		return submenu;
	}

	it("opens the model menu on ⇧⌘E at upstream's Effort submenu: its hint, then Low … Max and Ultracode with the Recommended and Max chips", async () => {
		renderComposer();
		const submenu = await openEffortMenu();
		const main = screen.getAllByRole("menu")[0];

		expect({
			main: within(main!)
				.getAllByRole("menuitem")
				.map((item) => item.textContent),
			hint: submenu.querySelector("[data-menu-label]")?.textContent,
			side: submenu.getAttribute("data-side"),
			align: submenu.getAttribute("data-align"),
			rows: within(submenu)
				.getAllByRole("menuitemradio")
				.map((item) => ({
					id: item.getAttribute("data-effort-id"),
					label: item.querySelector("[data-menu-item-label]")?.textContent,
					labelClass: item.querySelector("[data-menu-item-label]")?.className,
					checked: item.getAttribute("aria-checked"),
				})),
			recommended: submenu.querySelector("[data-effort-recommended]")?.className,
			warning: {
				className: submenu.querySelector("[data-effort-warning]")?.className,
				text: submenu.querySelector("[data-effort-warning]")?.textContent,
				icon: submenu.querySelector("[data-effort-warning] svg")?.getAttribute("class"),
			},
		}).toStrictEqual({
			main: ["EffortHigh", "More models"],
			hint: "Higher effort means more thorough responses, but takes longer and uses your limits faster.",
			side: "inline-start",
			align: "end",
			rows: [
				{id: "low", label: "Low", labelClass: "truncate", checked: "false"},
				{id: "medium", label: "Medium", labelClass: "truncate", checked: "false"},
				{id: "high", label: "High", labelClass: "truncate", checked: "true"},
				{id: "xhigh", label: "Extra", labelClass: "truncate", checked: "false"},
				{id: "max", label: "Max", labelClass: "truncate", checked: "false"},
				{
					id: "ultracode",
					label: "Ultracode",
					labelClass: "truncate font-medium text-[var(--text-pro)]",
					checked: "false",
				},
			],
			recommended:
				"inline-flex items-center gap-1 h-5 whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium bg-alpha-1 text-secondary",
			warning: {
				className:
					"inline-flex items-center gap-1 h-5 whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium min-w-0 shrink bg-[var(--warning-tint)] text-warning-000",
				text: "3.5× or more usage",
				icon: "lucide lucide-triangle-alert size-3 shrink-0",
			},
		});
	});

	it("opens More models to the inline start as well", async () => {
		renderComposer();
		openModelMenu();
		const main = await screen.findByRole("menu");
		fireEvent.click(within(main).getByRole("menuitem", {name: "More models"}));
		await waitFor(() => {
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});

		expect(screen.getAllByRole("menu")[1]?.getAttribute("data-side")).toBe("inline-start");
	});

	it("shows upstream's Max usage tooltip on the right when hovering the Max row", async () => {
		renderComposer();
		const submenu = await openEffortMenu();
		const anchor = within(submenu).getByRole("menuitemradio", {name: /^Max/}).parentElement;
		if (anchor === null) throw new Error("Max row has no tooltip anchor");
		fireEvent.pointerEnter(anchor);
		const tooltip = await screen.findByRole("tooltip");

		expect({text: tooltip.textContent, side: tooltip.getAttribute("data-side")}).toStrictEqual({
			text: "Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.",
			side: "right",
		});
	});

	it("picks Ultracode and sends it as the effort", async () => {
		const onSend = renderComposer();
		const submenu = await openEffortMenu();
		fireEvent.click(within(submenu).getByRole("menuitemradio", {name: "Ultracode"}));
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Erin's test");

		expect({
			name: screen.getByRole("button", {name: /^Model:/}).getAttribute("aria-label"),
			calls: onSend.mock.calls,
		}).toStrictEqual({
			name: "Model: Opus 5.5, Effort: Ultracode",
			calls: [["Continue Erin's test", {effort: "ultracode"}]],
		});
	});

	it("picks an effort, closes, shows it on the shared trigger and sends it", async () => {
		const onSend = renderComposer();
		const submenu = await openEffortMenu();
		fireEvent.click(within(submenu).getByRole("menuitemradio", {name: /^Extra/}));
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const trigger = screen.getByRole("button", {name: /^Model:/});
		sendPrompt("Continue Erin's test");

		expect({
			name: trigger.getAttribute("aria-label"),
			text: trigger.textContent,
			calls: onSend.mock.calls,
		}).toStrictEqual({
			name: "Model: Opus 5.5, Effort: Extra",
			text: "Opus 5.5 Extra",
			calls: [["Continue Erin's test", {effort: "xhigh"}]],
		});
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

		expect(screen.queryAllByRole("menu").length).toBe(0);
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
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
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
			trigger: "Model: Fable 5.1, Effort: High",
			rows: [
				{label: "Opus 5.5", checked: "false"},
				{label: "Fable 5.1", checked: "true"},
				{label: "Sonnet 5.5", checked: "false"},
				{label: "Haiku 5.5", checked: "false"},
			],
		});
	});

	it("shows the live picks in the chin", () => {
		const {live} = liveControls({model: "fable", effort: "max", permissionMode: "plan"});
		renderComposer({live});

		expect({
			mode: document.querySelector("[data-chin-mode]")?.textContent,
			model: screen.getByRole("button", {name: /^Model:/}).getAttribute("aria-label"),
		}).toStrictEqual({mode: "Plan", model: "Model: Fable 5.1, Effort: Max"});
	});

	it("asks Change effort? before sending an effort change", async () => {
		const {live, apply} = liveControls();
		renderComposer({live});

		await pickEffort(/^Low/);
		const confirm = await screen.findByRole("alertdialog");
		const confirmText = confirm.textContent;
		const appliedBeforeConfirm = apply.mock.calls.length;
		fireEvent.click(within(confirm).getByRole("button", {name: "Change effort"}));
		await waitFor(() => {
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});

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

		await pickEffort(/^Max/);
		const confirm = await screen.findByRole("alertdialog");
		fireEvent.click(within(confirm).getByRole("button", {name: "Cancel"}));
		await waitFor(() => {
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});

		expect({
			applied: apply.mock.calls,
			trigger: screen.getByRole("button", {name: /^Model:/}).getAttribute("aria-label"),
		}).toStrictEqual({applied: [], trigger: "Model: Opus 5.5, Effort: High"});
	});
});

describe("Composer chin tooltips and contrast", () => {
	function hoverTooltip(trigger: Element): string | null {
		const anchor = trigger.parentElement;
		if (anchor === null) throw new Error("trigger has no parent");
		fireEvent.pointerEnter(anchor);
		act(() => {
			vi.advanceTimersByTime(400);
		});
		const text = screen.queryByRole("tooltip")?.textContent ?? null;
		fireEvent.pointerLeave(anchor);
		return text;
	}

	it("shows upstream's Add and Mode ⌥⌘M tooltips, and none on the model + effort trigger", () => {
		vi.useFakeTimers();
		try {
			renderComposer();
			const tooltips = {
				add: hoverTooltip(screen.getByRole("button", {name: "Add"})),
				mode: hoverTooltip(document.querySelector("[data-chin-mode]") ?? document.body),
				model: hoverTooltip(screen.getByRole("button", {name: "Model: Opus 5.5, Effort: High"})),
			};

			expect(tooltips).toStrictEqual({add: "Add", mode: "Mode⌥Option⌘CommandM", model: null});
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([
		{name: "Add", trigger: () => screen.getByRole("button", {name: "Add"}), tooltip: "Add"},
		{
			name: "Mode",
			trigger: () => document.querySelector<HTMLElement>("[data-chin-mode]") ?? document.body,
			tooltip: "Mode⌥Option⌘CommandM",
		},
	])("keeps the $name tooltip closed when focus returns from its closed menu", async ({trigger, tooltip}) => {
		renderComposer();
		const button = trigger();
		const anchor = button.parentElement;
		if (anchor === null) throw new Error("trigger has no parent");
		fireEvent.pointerEnter(anchor);
		fireEvent.click(button);
		const menu = await screen.findByRole("menu");
		fireEvent.keyDown(menu, {key: "Escape"});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});

		vi.useFakeTimers();
		try {
			fireEvent.pointerEnter(anchor);
			fireEvent.focus(button);
			act(() => {
				vi.advanceTimersByTime(400);
			});
			const afterClose = screen.queryByRole("tooltip")?.textContent ?? null;
			fireEvent.pointerLeave(anchor);
			fireEvent.pointerEnter(anchor);
			act(() => {
				vi.advanceTimersByTime(400);
			});
			const afterReentry = screen.queryByRole("tooltip")?.textContent ?? null;

			expect({afterClose, afterReentry}).toStrictEqual({afterClose: null, afterReentry: tooltip});
		} finally {
			vi.useRealTimers();
		}
	});

	it("reads the model in primary ink, the rest in secondary, with r4 corners and an 18px +", () => {
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
			model: pick(screen.getByRole("button", {name: "Model: Opus 5.5, Effort: High"})),
		}).toStrictEqual({
			add: {ink: ["text-secondary"], radius: ["rounded-r4"], lineHeight: ["leading-[20px]"]},
			plusIcon: ["size-[18px]"],
			mode: {ink: ["text-secondary"], radius: ["rounded-r4"], lineHeight: ["leading-[20px]"]},
			model: {ink: ["text-primary"], radius: ["rounded-r4"], lineHeight: ["leading-[20px]"]},
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

describe("Composer + menu Connectors submenu", () => {
	const server = (id: string, name: string, enabled: boolean, needsAuth: boolean): McpServerSummary => ({
		id,
		name,
		scope: "user",
		transport: "http",
		urlOrCommand: `https://${name.toLowerCase()}.example.com/mcp`,
		enabled,
		envKeys: [],
		headerKeys: [],
		needsAuth,
	});
	const SERVERS = [
		server("user:Gmail", "Gmail", true, false),
		server("user:Calendar", "Calendar", true, false),
		server("plugin:docs@market:Docs", "Docs", false, false),
		server("user:Sentry", "Sentry", true, true),
	];

	function renderWithServers() {
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, SERVERS);
		render(
			<QueryClientProvider client={queryClient}>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />
			</QueryClientProvider>,
		);
	}

	async function openConnectors() {
		fireEvent.click(screen.getByRole("button", {name: "Add"}));
		const menu = await screen.findByRole("menu");
		const trigger = await within(menu).findByRole("menuitem", {name: /^Connectors/});
		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowRight"});
		await waitFor(() => {
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const submenu = screen.getAllByRole("menu").find((candidate) => candidate !== menu);
		if (submenu === undefined) throw new Error("no Connectors submenu");
		return {menu, trigger, submenu};
	}

	function entries(menu: HTMLElement) {
		return Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]')).map((element) =>
			element.getAttribute("role") === "separator"
				? "---"
				: {
						title: element.querySelector("[data-menu-item-title]")?.textContent,
						description: element.querySelector("[data-menu-item-description]")?.textContent ?? null,
						switch: element.querySelector('[role="switch"]')?.getAttribute("aria-checked") ?? null,
					},
		);
	}

	it("lists Browse, Manage and one row per server, with read-only switches and a Reconnect row", async () => {
		renderWithServers();
		const {menu, trigger, submenu} = await openConnectors();

		expect({
			addMenu: within(menu)
				.getAllByRole("menuitem")
				.map((item) => item.querySelector("[data-menu-item-title]")?.textContent ?? item.textContent),
			note: trigger.querySelector("[data-menu-value]")?.textContent,
			submenu: entries(submenu),
			readOnly: Array.from(submenu.querySelectorAll('[role="switch"]')).map((element) =>
				element.getAttribute("aria-readonly"),
			),
		}).toStrictEqual({
			addMenu: ["Add files or photos", "Slash commands", "Connectors1 needs reconnection"],
			note: "1 needs reconnection",
			submenu: [
				{title: "Browse connectors", description: null, switch: null},
				{title: "Manage connectors", description: null, switch: null},
				"---",
				{title: "Gmail", description: null, switch: "true"},
				{title: "Calendar", description: null, switch: "true"},
				{title: "Docs", description: null, switch: "false"},
				{title: "Sentry", description: "Reconnect", switch: null},
			],
			readOnly: ["true", "true", "true"],
		});
	});

	it("navigates to Customize > Connectors and to each server's page", async () => {
		renderWithServers();
		const targets: unknown[] = [];
		for (const name of ["Browse connectors", "Manage connectors", "Docs", /^Sentry/]) {
			navigate.mockClear();
			const {submenu} = await openConnectors();
			fireEvent.click(within(submenu).getByRole("menuitem", {name}));
			await waitFor(() => {
				expect(screen.queryByRole("menu")).toBeNull();
			});
			targets.push(...navigate.mock.calls.map(([options]) => options));
		}

		expect(targets).toStrictEqual([
			{to: "/customize/connectors"},
			{to: "/customize/connectors"},
			{
				to: "/customize/connectors/id/$serverId",
				params: {serverId: toConnectorSlug("plugin:docs@market:Docs")},
			},
			{to: "/customize/connectors/id/$serverId", params: {serverId: toConnectorSlug("user:Sentry")}},
		]);
	});

	it("shows no reconnection note while every server is healthy", async () => {
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, SERVERS.slice(0, 2));
		render(
			<QueryClientProvider client={queryClient}>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />
			</QueryClientProvider>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Add"}));
		const trigger = await within(await screen.findByRole("menu")).findByRole("menuitem", {name: /^Connectors/});

		expect(trigger.querySelector("[data-menu-value]")).toBeNull();
	});
});
