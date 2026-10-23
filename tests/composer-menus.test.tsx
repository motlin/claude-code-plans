// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import type {useNavigate} from "@tanstack/react-router";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {DensityScope} from "../src/components/ui/density";
import {FileMentionMenu} from "../src/components/file-mention-menu";
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

function renderHomeComposer() {
	render(
		<DensityScope density="compact">
			<Composer
				variant="home"
				draftKey="home-dana"
				onSend={vi.fn<OnSend>()}
				chin={CHIN}
				environment={<span>Dana's project</span>}
			/>
		</DensityScope>,
	);
}

describe("Composer home bar permissions menu", () => {
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

	it("labels the home bar menu Permissions · this session with no digit keycaps", async () => {
		renderHomeComposer();

		openModeMenu();
		const menu = await screen.findByRole("menu");

		expect({
			labelText: within(menu).queryByText("Permissions · this session")?.textContent ?? null,
			accelerators: menu.querySelectorAll("[data-accelerator]").length,
			rows: radioRows(menu),
		}).toStrictEqual({
			labelText: "Permissions · this session",
			accelerators: 0,
			rows: [
				{label: "Auto", description: "Claude handles permission decisions", key: null, checked: "false"},
				{label: "Manual", description: "Always ask before making changes", key: null, checked: "true"},
				{
					label: "Accept edits",
					description: "Automatically accept all file edits",
					key: null,
					checked: "false",
				},
				{label: "Plan", description: "Create a plan before making changes", key: null, checked: "false"},
			],
		});
	});

	it("names the home bar trigger Permissions: {mode} with the Permissions ⌥⌘M tooltip", () => {
		vi.useFakeTimers();
		try {
			renderHomeComposer();
			const trigger = screen.getByRole("button", {name: "Permissions: Manual"});

			expect({
				text: trigger.textContent,
				tooltip: hoverTooltip(trigger),
			}).toStrictEqual({text: "Manual", tooltip: "Permissions⌥Option⌘CommandM"});
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps the session chin menu labelled Mode with digits and no aria-label", async () => {
		renderComposer();

		openModeMenu();
		const menu = await screen.findByRole("menu");

		expect({
			mode: within(menu).queryByText("Mode")?.textContent ?? null,
			permissions: within(menu).queryByText("Permissions · this session"),
			accelerators: menu.querySelectorAll("[data-accelerator]").length,
			ariaLabel: document.querySelector("[data-chin-mode]")?.getAttribute("aria-label") ?? null,
		}).toStrictEqual({mode: "Mode", permissions: null, accelerators: 4, ariaLabel: null});
	});
});

describe("Composer home bar model menu", () => {
	function modelHeader(menu: HTMLElement) {
		const label = within(menu).queryByText("Model · this session");
		const wrapper = label?.parentElement;
		return label === null || wrapper === null || wrapper === undefined
			? null
			: {
					role: label.getAttribute("role"),
					labelClass: label.className,
					wrapperClass: wrapper.className,
					insideScroller: wrapper.closest("[data-menu-scroller]") !== null,
				};
	}

	it("pins upstream's Model · this session header above the scroller", async () => {
		renderHomeComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");

		expect(modelHeader(menu)).toStrictEqual({
			role: "presentation",
			labelClass: "px-2 py-1 text-[12px]/[15px] font-medium text-[var(--menu-muted)]",
			wrapperClass: "shrink-0 px-1 pt-1",
			insideScroller: false,
		});
	});

	it("has no header in a session chin", async () => {
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");

		expect(modelHeader(menu)).toBeNull();
	});

	it("opens the model menu on ⇧⌘E with the Effort submenu closed", async () => {
		renderHomeComposer();

		openEffort();
		const menu = await screen.findByRole("menu");

		expect({
			menus: screen.getAllByRole("menu").length,
			firstRow: radioRows(menu)[0]?.label,
			effortExpanded:
				within(menu)
					.getByRole("menuitem", {name: /Effort/})
					.getAttribute("aria-expanded") ?? "false",
		}).toStrictEqual({menus: 1, firstRow: "Opus 5.5", effortExpanded: "false"});
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
			trigger: "Model: Fable 5.1 High",
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
			name: "Model: Opus 5.5 Ultracode",
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
			name: "Model: Opus 5.5 Extra",
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
			trigger: "Model: Fable 5.1 High",
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
		}).toStrictEqual({mode: "Plan", model: "Model: Fable 5.1 Max"});
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
		}).toStrictEqual({applied: [], trigger: "Model: Opus 5.5 High"});
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
				model: hoverTooltip(screen.getByRole("button", {name: "Model: Opus 5.5 High"})),
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

	it("reads every chin control in secondary ink, with r4 corners and an 18px +", () => {
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
			model: pick(screen.getByRole("button", {name: "Model: Opus 5.5 High"})),
		}).toStrictEqual({
			add: {ink: ["text-secondary"], radius: ["rounded-r5"], lineHeight: ["leading-[20px]"]},
			plusIcon: ["size-[18px]"],
			mode: {ink: ["text-secondary"], radius: ["rounded-r4"], lineHeight: ["leading-[20px]"]},
			model: {ink: ["text-secondary"], radius: ["rounded-r4"], lineHeight: ["leading-[20px]"]},
		});
	});

	it("paints upstream's focus ring and keeps the open trigger's ghost fill", () => {
		renderComposer();
		const classes =
			screen.getByRole("button", {name: "Model: Opus 5.5 High"}).getAttribute("class")?.split(" ") ?? [];

		expect({
			focus: classes.filter((name) => name.includes("shadow")),
			expanded: classes.filter((name) => name.startsWith("aria-expanded:")),
			effort: screen.getByText("High").getAttribute("class"),
		}).toStrictEqual({
			focus: ["focus-visible:shadow-focus"],
			expanded: ["aria-expanded:bg-fill-ghost-hover"],
			effort: "shrink-0 whitespace-pre text-ink-muted @max-[280px]:hidden",
		});
	});

	it("ends the model trigger in a 12px warning icon at Max effort", () => {
		renderComposer({chin: {...CHIN, effort: {id: "max", label: "Max"}}});
		const trigger = screen.getByRole("button", {name: "Model: Opus 5.5 Max"});
		const last = trigger.lastElementChild;

		expect({
			tag: last?.tagName.toLowerCase(),
			hidden: last?.getAttribute("aria-hidden"),
			warning: last?.hasAttribute("data-effort-warning-icon"),
			sized: last
				?.getAttribute("class")
				?.split(" ")
				.filter((name) => name.startsWith("size-") || name.startsWith("text-")),
		}).toStrictEqual({tag: "svg", hidden: "true", warning: true, sized: ["size-3", "text-warning-100"]});
	});

	it("has no warning icon below Max", () => {
		renderComposer();

		expect(document.querySelector("[data-effort-warning-icon]")).toBeNull();
	});

	it("shows the Model ⇧⌘I tooltip on the home bar's model trigger", () => {
		vi.useFakeTimers();
		try {
			renderHomeComposer();

			expect(hoverTooltip(screen.getByRole("button", {name: "Model: Opus 5.5 High"}))).toBe(
				"Model⇧Shift⌘CommandI",
			);
		} finally {
			vi.useRealTimers();
		}
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

	function renderWithServers(servers: McpServerSummary[] = SERVERS) {
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, servers);
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
		return Array.from(
			menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="separator"]'),
		).map((element) =>
			element.getAttribute("role") === "separator"
				? "---"
				: {
						role: element.getAttribute("role"),
						checked: element.getAttribute("aria-checked"),
						title: element.querySelector("[data-menu-item-title]")?.textContent,
						icon: element.querySelector("svg")?.classList[1] ?? null,
						description: element.querySelector("[data-menu-item-description]")?.textContent ?? null,
						switch:
							element.querySelector('span[inert] > [role="switch"]')?.getAttribute("aria-checked") ??
							null,
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
			switches: Array.from(submenu.querySelectorAll('[role="switch"]')).map((element) => [
				element.getAttribute("aria-label"),
				element.getAttribute("aria-readonly"),
				element.getAttribute("data-size"),
			]),
		}).toStrictEqual({
			addMenu: ["Add files or photos", "Slash commands", "Connectors1 needs reconnection"],
			note: "1 needs reconnection",
			submenu: [
				{
					role: "menuitem",
					checked: null,
					title: "Browse connectors",
					icon: "lucide-library-big",
					description: null,
					switch: null,
				},
				{
					role: "menuitem",
					checked: null,
					title: "Manage connectors",
					icon: "lucide-wrench",
					description: null,
					switch: null,
				},
				"---",
				{
					role: "menuitemcheckbox",
					checked: "true",
					title: "Gmail",
					icon: "lucide-blocks",
					description: null,
					switch: "true",
				},
				{
					role: "menuitemcheckbox",
					checked: "true",
					title: "Calendar",
					icon: "lucide-blocks",
					description: null,
					switch: "true",
				},
				{
					role: "menuitemcheckbox",
					checked: "false",
					title: "Docs",
					icon: "lucide-blocks",
					description: null,
					switch: "false",
				},
				{
					role: "menuitem",
					checked: null,
					title: "Sentry",
					icon: "lucide-cloud-off",
					description: "Reconnect",
					switch: null,
				},
			],
			switches: [
				["Gmail enabled", "true", "xs"],
				["Calendar enabled", "true", "xs"],
				["Docs enabled", "true", "xs"],
			],
		});
	});

	it("lists connected servers first, then every server that needs reconnection, each in API order", async () => {
		renderWithServers([
			server("user:A", "A", true, true),
			server("user:B", "B", true, false),
			server("user:C", "C", false, true),
			server("user:D", "D", false, false),
		]);
		const {submenu} = await openConnectors();

		expect(
			entries(submenu)
				.slice(3)
				.map((entry) => (typeof entry === "string" ? entry : [entry.title, entry.role, entry.description])),
		).toStrictEqual([
			["B", "menuitemcheckbox", null],
			["D", "menuitemcheckbox", null],
			["A", "menuitem", "Reconnect"],
			["C", "menuitem", "Reconnect"],
		]);
	});

	it("navigates to Customize > Connectors and to each server's page", async () => {
		renderWithServers();
		const targets: unknown[] = [];
		for (const name of ["Browse connectors", "Manage connectors", "Docs", /^Sentry/]) {
			navigate.mockClear();
			const {submenu} = await openConnectors();
			fireEvent.click(within(submenu).getByRole(name === "Docs" ? "menuitemcheckbox" : "menuitem", {name}));
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

	it("opens the Add menu 6px above a 28px button with upstream's 6px radius", async () => {
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, SERVERS.slice(0, 2));
		render(
			<QueryClientProvider client={queryClient}>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />
			</QueryClientProvider>,
		);
		const add = screen.getByRole("button", {name: "Add"});
		fireEvent.click(add);
		const menu = await screen.findByRole("menu");
		const classes = add.className.split(" ");

		expect({
			sideOffset: menu.parentElement?.getAttribute("data-side-offset"),
			radius: classes.filter((name) => name.startsWith("rounded-")),
			size: classes.filter((name) => name.startsWith("size-") || name.startsWith("h-")),
		}).toStrictEqual({sideOffset: "6", radius: ["rounded-r5"], size: ["size-7"]});
	});

	it("shows a disabled Connectors row with a 16px spinner while the MCP config loads", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		render(
			<QueryClientProvider client={queryClient}>
				<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />
			</QueryClientProvider>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Add"}));
		const menu = await screen.findByRole("menu");
		const row = await within(menu).findByRole("menuitem", {name: /^Connectors/});
		const spinner = row.querySelector("[data-spinner]");

		expect({
			rows: within(menu)
				.getAllByRole("menuitem")
				.map((item) => item.querySelector("[data-menu-item-title]")?.textContent),
			disabled: row.hasAttribute("data-disabled"),
			popup: row.getAttribute("aria-haspopup"),
			icon: row.querySelector("svg")?.classList[1],
			status: row.querySelector('[role="status"]') !== null,
			spinnerSize: [spinner?.getAttribute("style")],
		}).toStrictEqual({
			rows: ["Add files or photos", "Slash commands", "Connectors"],
			disabled: true,
			popup: null,
			icon: "lucide-blocks",
			status: true,
			spinnerSize: ["width: 1rem; height: 1rem;"],
		});
		vi.unstubAllGlobals();
	});

	it("shows a plain Add connectors item that opens Customize > Connectors when no servers are configured", async () => {
		renderWithServers([]);
		fireEvent.click(screen.getByRole("button", {name: "Add"}));
		const menu = await screen.findByRole("menu");
		const row = await within(menu).findByRole("menuitem", {name: "Add connectors"});

		expect({
			rows: within(menu)
				.getAllByRole("menuitem")
				.map((item) => item.querySelector("[data-menu-item-title]")?.textContent),
			popup: row.getAttribute("aria-haspopup"),
			disabled: row.hasAttribute("data-disabled"),
			icon: row.querySelector("svg")?.classList[1],
		}).toStrictEqual({
			rows: ["Add files or photos", "Slash commands", "Add connectors"],
			popup: null,
			disabled: false,
			icon: "lucide-blocks",
		});

		navigate.mockClear();
		fireEvent.click(row);
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(navigate.mock.calls.map(([options]) => options)).toStrictEqual([{to: "/customize/connectors"}]);
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

describe("Composer text-entry menus at a coarse pointer below 640px", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
				media: query,
				onchange: null,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			})),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function presentation(popup: HTMLElement) {
		return {
			presentation: popup.getAttribute("data-presentation"),
			scrim: document.querySelector("[data-sheet-scrim]"),
		};
	}

	it("keeps the slash command menu anchored above the composer", () => {
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={vi.fn<OnSend>()}
				slashCommands={[{name: "plan", description: "Switch to plan mode", source: "builtin"}]}
			/>,
		);
		fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {target: {value: "/"}});

		expect(presentation(screen.getByRole("menu", {name: "Slash commands"}))).toStrictEqual({
			presentation: null,
			scrim: null,
		});
	});

	it("keeps the @-mention list anchored above the composer", () => {
		render(
			<FileMentionMenu
				id="mentions"
				entries={[{name: "src", relPath: "src", isDirectory: true}]}
				highlighted={0}
				onHighlight={() => undefined}
				onAccept={() => undefined}
			/>,
		);

		expect(presentation(screen.getByRole("listbox", {name: "Mention suggestions"}))).toStrictEqual({
			presentation: null,
			scrim: null,
		});
	});
});

describe("Composer model menu on a coarse pointer under 640px", () => {
	function stubCoarsePhone() {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
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

	it("presents a ModelSelector sheet without data-size, keeping upstream's 32px 14/20 rows and 12px top radius", async () => {
		stubCoarsePhone();
		renderComposer();
		fireEvent.click(screen.getByRole("button", {name: /^Model:/}));
		// The sheet presentation is its own lazily loaded chunk.
		const menu = await screen.findByRole("menu");
		const radioClasses = within(menu)
			.getAllByRole("menuitemradio")
			.map((item) => item.className.split(" "));
		const popupClasses = menu.className.split(" ");

		expect({
			presentation: menu.getAttribute("data-presentation"),
			size: menu.hasAttribute("data-size"),
			handle: menu.firstElementChild?.hasAttribute("data-cds-sheet-handle"),
			radius: popupClasses.filter((name) => name.startsWith("rounded-t-")),
			popupText: popupClasses.filter((name) => name.startsWith("text-[")),
			rows: radioClasses.map((names) => ({
				text: names.filter((name) => name.startsWith("text-[")),
				height: names.includes("h-8"),
			})),
		}).toStrictEqual({
			presentation: "sheet",
			size: false,
			handle: true,
			radius: ["rounded-t-card"],
			popupText: ["text-[14px]/[20px]"],
			rows: Array.from({length: radioClasses.length}, () => ({text: ["text-[14px]/[20px]"], height: true})),
		});
	});
});
