// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	useParams,
	useRouterState,
} from "@tanstack/react-router";
import {readFileSync} from "node:fs";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {CommandPalette, PALETTE_RECENT_LIMIT} from "../src/components/command-palette";
import {motionReduced, rowActionsAnchorRect} from "../src/components/palette-row-actions";
import {ToastProvider} from "../src/components/toast";
import {useCommandPalette} from "../src/hooks/use-command-palette";
import {recentSessionsQueryOptions, sessionQueryKeys} from "../src/lib/api/sessions";
import {pin, readPinState} from "../src/lib/pin-store";
import {useSessionRenameRequest} from "../src/lib/session-rename-request";
import {clearAll, hasUnseenWork} from "../src/lib/unread-store";
import {installLocalStorage} from "./fake-storage";

const renameRequests: string[] = [];

function SessionPage() {
	const {id = ""} = useParams({strict: false});
	useSessionRenameRequest(id, () => renameRequests.push(id));
	return null;
}

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function recentSession(id: string, title: string) {
	return {
		id,
		title,
		summary: undefined,
		mtime: new Date().toISOString(),
		created: new Date().toISOString(),
		project: "/users/dev/project-a",
		projectName: "project-a",
		messageCount: 1,
		gitBranch: undefined,
		archived: false,
		state: "unknown" as const,
		bucket: "done" as const,
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
	};
}

function Location() {
	const pathname = useRouterState({select: (state) => state.location.pathname});
	return <output aria-label="Location">{pathname}</output>;
}

function Harness() {
	const palette = useCommandPalette();
	return (
		<>
			<textarea aria-label="Composer" />
			<Location />
			<CommandPalette {...palette} />
		</>
	);
}

async function openPalette(
	sessions = [recentSession("sess-1", "Refactor auth module"), recentSession("sess-2", "Write release notes")],
) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(recentSessionsQueryOptions(PALETTE_RECENT_LIMIT).queryKey, {
		sessions,
		nextCursor: null,
	});
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<Harness />
					<Outlet />
				</ToastProvider>
			</QueryClientProvider>
		),
	});
	const sessionRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "session/$id",
		component: SessionPage,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([sessionRoute]),
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	const composer = await screen.findByRole("textbox", {name: "Composer"});
	composer.focus();
	fireEvent.keyDown(composer, {key: "k", code: "KeyK", metaKey: true});
	const dialog = await screen.findByRole("dialog", {name: "Search"});
	await within(dialog).findByRole("option", {name: /Refactor auth module/});
	return {dialog, input: within(dialog).getByRole("combobox", {name: "Search"}), queryClient};
}

async function openCard() {
	const opened = await openPalette();
	fireEvent.keyDown(opened.input, {key: "Enter", code: "Enter", altKey: true});
	const card = await screen.findByRole("menu", {name: "Actions"});
	return {...opened, card};
}

/** The cmdk values of the rows whose wrapper currently holds the "…" button. */
function rowsWithActionsButton(dialog: HTMLElement) {
	return [...dialog.querySelectorAll("[cmdk-item]")]
		.filter((row) => row.parentElement?.querySelector("[data-palette-row-actions-button]") !== null)
		.map((row) => row.getAttribute("data-value"));
}

function menuItems(card: HTMLElement) {
	return within(card)
		.getAllByRole("menuitem")
		.map((item) => [item.textContent, item.getAttribute("aria-keyshortcuts")]);
}

describe("palette row actions card", () => {
	const writeText = vi.fn<(text: string) => Promise<void>>(async () => Promise.resolve());
	const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Promise<Response>(() => {}));

	beforeEach(() => {
		installLocalStorage();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		Element.prototype.scrollIntoView = () => {};
		clearAll();
		renameRequests.length = 0;
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		writeText.mockClear();
		fetchMock.mockClear();
	});

	it("⌥⏎ opens the card for the selected session row with focus on Open", async () => {
		const {card, input} = await openCard();

		await waitFor(() => {
			expect(document.activeElement).toBe(within(card).getByRole("menuitem", {name: "Open"}));
		});
		expect({
			heading: card.querySelector("[data-palette-card-title]")?.textContent,
			meta: card.querySelector("[data-palette-card-meta]")?.textContent,
			items: menuItems(card),
			inputFocused: document.activeElement === input,
		}).toStrictEqual({
			heading: "Refactor auth module",
			meta: "Code session · Just now",
			items: [
				["Open1", "1"],
				["Open in new tab2", "2"],
				["Copy link3", "3"],
				["Pin4", "4"],
				["Rename5", "5"],
				["Archive6", "6"],
				["Mark as unread7", "7"],
			],
			inputFocused: false,
		});
	});

	it('reads just "Code session" in the meta when the session is older than a year', async () => {
		const ancient = {
			...recentSession("sess-2", "Write release notes"),
			mtime: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString(),
		};
		const {dialog, input} = await openPalette([recentSession("sess-1", "Refactor auth module"), ancient]);

		fireEvent.keyDown(input, {key: "ArrowDown", code: "ArrowDown"});
		await waitFor(() => {
			expect(rowsWithActionsButton(dialog)).toStrictEqual(["session:sess-2"]);
		});
		fireEvent.click(dialog.querySelector("[data-palette-row-actions-button]")!);

		const card = await screen.findByRole("menu", {name: "Actions"});
		expect({
			heading: card.querySelector("[data-palette-card-title]")?.textContent,
			meta: card.querySelector("[data-palette-card-meta]")?.textContent,
		}).toStrictEqual({heading: "Write release notes", meta: "Code session"});
	});

	it("renders the row … button only on the selected row, in upstream's end-9 own-keys wrapper", async () => {
		const {dialog, input} = await openPalette();
		expect(rowsWithActionsButton(dialog)).toStrictEqual(["session:sess-1"]);
		const wrapper = dialog.querySelector("[data-palette-row-actions-button]")?.closest("span[aria-hidden]");
		expect({
			ariaHidden: wrapper?.getAttribute("aria-hidden"),
			ownKeys: wrapper?.getAttribute("data-palette-own-keys"),
			className: wrapper?.className,
		}).toStrictEqual({
			ariaHidden: "true",
			ownKeys: "",
			className: "pointer-events-none absolute inset-y-0 end-9 flex items-center *:pointer-events-auto",
		});

		fireEvent.keyDown(input, {key: "ArrowDown", code: "ArrowDown"});

		await waitFor(() => {
			expect(rowsWithActionsButton(dialog)).toStrictEqual(["session:sess-2"]);
		});
	});

	it("shows the footer Actions ⌥⏎ hint only while the selected row supports actions", async () => {
		const {dialog, input} = await openPalette();
		const footerLabels = () =>
			[...dialog.querySelectorAll("[data-palette-footer-hint]")].map(
				(hint) => hint.querySelector("span")?.textContent,
			);
		const selected = () => dialog.querySelector("[cmdk-item][data-selected=true]")?.getAttribute("data-value");
		const step = async (key: "ArrowDown" | "ArrowUp", value: string) => {
			fireEvent.keyDown(input, {key, code: key});
			await waitFor(() => {
				expect(selected()).toBe(value);
			});
			return {selected: value, footer: footerLabels()};
		};

		const first = {selected: selected(), footer: footerLabels()};
		const second = await step("ArrowDown", "session:sess-2");
		const newSession = await step("ArrowDown", "action:New session");
		const back = await step("ArrowUp", "session:sess-2");

		expect({first, second, newSession, back}).toStrictEqual({
			first: {selected: "session:sess-1", footer: ["Close", "Change type", "Filters", "Actions"]},
			second: {selected: "session:sess-2", footer: ["Close", "Change type", "Filters", "Actions"]},
			newSession: {selected: "action:New session", footer: ["Close", "Change type", "Filters"]},
			back: {selected: "session:sess-2", footer: ["Close", "Change type", "Filters", "Actions"]},
		});
	});

	it("opens from the selected row's … button", async () => {
		const {dialog, input} = await openPalette();

		fireEvent.keyDown(input, {key: "ArrowDown", code: "ArrowDown"});
		const buttons = await waitFor(() => {
			const found = dialog.querySelectorAll("[data-palette-row-actions-button]");
			expect(found.length).toBe(1);
			return found;
		});
		fireEvent.click(buttons[0]!);

		const card = await screen.findByRole("menu", {name: "Actions"});
		expect(card.querySelector("[data-palette-card-title]")?.textContent).toBe("Write release notes");
	});

	it("copies the current fresh canonical proof from the selected row card", async () => {
		const {card, queryClient} = await openCard();
		queryClient.setQueryData(sessionQueryKeys.detail("sess-1"), {canonicalRouteId: "session_alice_100"});
		fireEvent.keyDown(card, {key: "3", code: "Digit3"});
		await waitFor(() => {
			expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/session_alice_100"]]);
		});
	});

	it("ignores stale or conflicting canonical ownership when copying from a row card", async () => {
		const {card, queryClient} = await openCard();
		queryClient.setQueryData(sessionQueryKeys.detail("sess-1"), {canonicalRouteId: "session_alice_100"});
		queryClient.setQueryData(sessionQueryKeys.identity("session_alice_100"), {sessionId: "sess-2"});
		fireEvent.keyDown(card, {key: "3", code: "Digit3"});
		await waitFor(() => {
			expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/sess-1"]]);
		});
	});

	it("number keys activate items", async () => {
		const {card} = await openCard();

		fireEvent.keyDown(card, {key: "3", code: "Digit3"});

		await waitFor(() => {
			expect(writeText.mock.calls).toStrictEqual([["http://localhost:3000/session/sess-1"]]);
		});
		expect(await screen.findByText("Link copied to clipboard.")).toBeTruthy();
		expect(screen.queryByRole("menu", {name: "Actions"})).toBeNull();
	});

	it("marks the session unread from the card", async () => {
		const {card} = await openCard();

		fireEvent.keyDown(card, {key: "7", code: "Digit7"});

		expect(hasUnseenWork("sess-1")).toBe(true);
	});

	it("archives the session from the card", async () => {
		const {card} = await openCard();

		fireEvent.keyDown(card, {key: "6", code: "Digit6"});

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalled();
		});
		expect(fetchMock.mock.calls.at(-1)).toStrictEqual([
			"/api/sessions/sess-1/archived",
			expect.objectContaining({method: "PUT"}),
		]);
	});

	it("pins the session in this browser from the card", async () => {
		const {card} = await openCard();

		fireEvent.keyDown(card, {key: "4", code: "Digit4"});

		await waitFor(() => {
			expect(readPinState()).toStrictEqual({pinnedIds: ["sess-1"], pinnedOrder: []});
		});
	});

	it("Rename opens upstream's Rename session dialog over the palette", async () => {
		const {dialog: palette, card} = await openCard();

		fireEvent.click(within(card).getByRole("menuitem", {name: /^Rename/}));

		const rename = await screen.findByRole("dialog", {name: "Rename session"});
		const field = within(rename).getByRole("textbox", {name: "Rename session"});
		await waitFor(() => {
			expect(document.activeElement).toBe(field);
		});
		expect({
			card: screen.queryByRole("menu", {name: "Actions"}),
			paletteOpen: palette.isConnected,
			value: (field as HTMLInputElement).value,
			testId: field.getAttribute("data-testid"),
			buttons: within(rename)
				.getAllByRole("button")
				.map((button) => [button.textContent, (button as HTMLButtonElement).disabled]),
			location: document.querySelector('output[aria-label="Location"]')?.textContent,
			inlineRenames: renameRequests,
		}).toStrictEqual({
			card: null,
			paletteOpen: true,
			value: "Refactor auth module",
			testId: "name-session",
			buttons: [
				["Cancel", false],
				["Save", false],
			],
			location: "/",
			inlineRenames: [],
		});
	});

	it("disables Save while the rename field is blank", async () => {
		const {card} = await openCard();
		fireEvent.click(within(card).getByRole("menuitem", {name: /^Rename/}));
		const rename = await screen.findByRole("dialog", {name: "Rename session"});

		fireEvent.change(within(rename).getByRole("textbox", {name: "Rename session"}), {target: {value: "   "}});

		expect(within(rename).getByRole<HTMLButtonElement>("button", {name: "Save"}).disabled).toBe(true);
	});

	it("Save renames the session and keeps the palette open", async () => {
		const {dialog: palette, card} = await openCard();
		fireEvent.click(within(card).getByRole("menuitem", {name: /^Rename/}));
		const rename = await screen.findByRole("dialog", {name: "Rename session"});

		fireEvent.change(within(rename).getByRole("textbox", {name: "Rename session"}), {
			target: {value: "  Auth rewrite  "},
		});
		fireEvent.click(within(rename).getByRole("button", {name: "Save"}));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Rename session"})).toBeNull();
		});
		expect({
			request: fetchMock.mock.calls.at(-1),
			paletteOpen: palette.isConnected,
			location: document.querySelector('output[aria-label="Location"]')?.textContent,
		}).toStrictEqual({
			request: [
				"/api/sessions/sess-1/title",
				{
					method: "PUT",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({title: "Auth rewrite"}),
					credentials: "same-origin",
				},
			],
			paletteOpen: true,
			location: "/",
		});
	});

	it("Save with the name unchanged closes the dialog without renaming", async () => {
		const {card} = await openCard();
		fireEvent.click(within(card).getByRole("menuitem", {name: /^Rename/}));
		const rename = await screen.findByRole("dialog", {name: "Rename session"});

		fireEvent.click(within(rename).getByRole("button", {name: "Save"}));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Rename session"})).toBeNull();
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("Cancel closes only the rename dialog", async () => {
		const {dialog: palette, card} = await openCard();
		fireEvent.click(within(card).getByRole("menuitem", {name: /^Rename/}));
		const rename = await screen.findByRole("dialog", {name: "Rename session"});

		fireEvent.click(within(rename).getByRole("button", {name: "Cancel"}));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Rename session"})).toBeNull();
		});
		expect({paletteOpen: palette.isConnected, fetched: fetchMock.mock.calls.length}).toStrictEqual({
			paletteOpen: true,
			fetched: 0,
		});
	});

	it("Escape closes only the rename dialog and returns focus to the Search input", async () => {
		const {dialog: palette, input, card} = await openCard();
		fireEvent.click(within(card).getByRole("menuitem", {name: /^Rename/}));
		const rename = await screen.findByRole("dialog", {name: "Rename session"});

		fireEvent.keyDown(within(rename).getByRole("textbox", {name: "Rename session"}), {
			key: "Escape",
			code: "Escape",
		});

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Rename session"})).toBeNull();
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		expect(palette.isConnected).toBe(true);
	});

	it("shows the Actions tooltip on the row's hover … button", async () => {
		const {dialog} = await openPalette();

		const button = dialog.querySelector<HTMLElement>("[data-palette-row-actions-button]");
		fireEvent.pointerEnter(button!);

		expect((await screen.findByRole("tooltip", {hidden: true})).textContent).toBe("Actions");
	});

	it("opens in a new tab with 2", async () => {
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const {card} = await openCard();

		fireEvent.keyDown(card, {key: "2", code: "Digit2"});

		expect(open.mock.calls).toStrictEqual([
			["http://localhost:3000/session/sess-1", "_blank", "noopener,noreferrer"],
		]);
	});

	it("opens the session with 1 and closes the palette", async () => {
		const {card} = await openCard();

		fireEvent.keyDown(card, {key: "1", code: "Digit1"});

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(screen.getByRole("status", {name: "Location"}).textContent).toBe("/session/sess-1");
	});

	it("← closes the card and returns focus to the row", async () => {
		const {card, input, dialog} = await openCard();

		fireEvent.keyDown(card, {key: "ArrowLeft", code: "ArrowLeft"});

		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect({
			focused: document.activeElement === input,
			selected: within(dialog)
				.getAllByRole("option", {selected: true})
				.map((option) => option.textContent),
		}).toStrictEqual({focused: true, selected: ["Refactor auth module"]});
	});

	it("Esc closes the card first, then the palette", async () => {
		const {card, input, dialog} = await openCard();

		fireEvent.keyDown(card, {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(screen.getByRole("dialog", {name: "Search"})).toBe(dialog);
		expect(document.activeElement).toBe(input);

		fireEvent.keyDown(input, {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("⌥⏎ inside the card closes it and returns focus to the Search input", async () => {
		const {card, input} = await openCard();

		fireEvent.keyDown(card, {key: "Enter", code: "Enter", altKey: true});

		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(document.activeElement).toBe(input);
	});

	it("AltGraph+Enter opens the card, and Ctrl doesn't block it", async () => {
		const {input} = await openPalette();

		fireEvent.keyDown(input, {key: "Enter", code: "Enter", ctrlKey: true, modifierAltGraph: true});

		expect(await screen.findByRole("menu", {name: "Actions"})).toBeTruthy();
	});

	it("held-Enter repeats on the input after ⌥⏎ don't run the selected row", async () => {
		const {input} = await openPalette();

		fireEvent.keyDown(input, {key: "Enter", code: "Enter", altKey: true});
		fireEvent.keyDown(input, {key: "Enter", code: "Enter", altKey: true, repeat: true});
		fireEvent.keyDown(input, {key: "Enter", code: "Enter", repeat: true});

		expect({
			location: document.querySelector('output[aria-label="Location"]')?.textContent,
			card: screen.queryByRole("menu", {name: "Actions"}) !== null,
		}).toStrictEqual({location: "/", card: true});
	});

	it("a repeated Enter inside the card closes it without running the item", async () => {
		const {card} = await openCard();
		const [open] = within(card).getAllByRole("menuitem");
		open!.focus();

		fireEvent.keyDown(open!, {key: "Enter", code: "Enter", repeat: true});

		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect({
			location: document.querySelector('output[aria-label="Location"]')?.textContent,
			palette: screen.queryByRole("dialog", {name: "Search"}) !== null,
		}).toStrictEqual({location: "/", palette: true});
	});

	it("Tab closes the card", async () => {
		const {card} = await openCard();

		fireEvent.keyDown(card, {key: "Tab", code: "Tab"});

		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(screen.queryByRole("dialog", {name: "Search"})).not.toBeNull();
	});

	it("a repeated digit does nothing", async () => {
		const {card} = await openCard();

		fireEvent.keyDown(card, {key: "3", code: "Digit3", repeat: true});

		expect({
			copied: writeText.mock.calls,
			card: screen.queryByRole("menu", {name: "Actions"}) !== null,
		}).toStrictEqual({copied: [], card: true});
	});

	it("ignores digits for 300ms after the item list changes", async () => {
		let now = 1000;
		vi.spyOn(performance, "now").mockImplementation(() => now);
		const {card} = await openCard();

		now = 2000;
		act(() => {
			pin("sess-1");
		});
		await within(card).findByRole("menuitem", {name: /^Unpin/});
		now = 2299;
		fireEvent.keyDown(card, {key: "4", code: "Digit4"});
		const guarded = readPinState();
		now = 2300;
		fireEvent.keyDown(card, {key: "4", code: "Digit4"});

		await waitFor(() => {
			expect({guarded, after: readPinState()}).toStrictEqual({
				guarded: {pinnedIds: ["sess-1"], pinnedOrder: []},
				after: {pinnedIds: [], pinnedOrder: []},
			});
		});
	});

	it("renders as a 280px cds Menu beside the palette, overlapping it by upstream's 44px", async () => {
		const {card} = await openCard();

		const positioner = card.parentElement!;
		expect({
			width: card.classList.contains("w-[280px]"),
			side: card.getAttribute("data-side"),
			sideOffset: positioner.getAttribute("data-side-offset"),
			density: positioner.getAttribute("data-density"),
			itemClasses: within(card)
				.getAllByRole("menuitem")
				.map((item) => item.classList.contains("h-6") && item.classList.contains("text-[13px]/[19px]")),
		}).toStrictEqual({
			width: true,
			side: "right",
			sideOffset: "-44",
			density: "compact",
			itemClasses: [true, true, true, true, true, true, true],
		});
	});

	it("recedes the palette from its top over 200ms like upstream, and not under reduced motion", async () => {
		const motion = [
			"origin-top",
			"transition-[scale]",
			"duration-200",
			"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
			"motion-reduce:transition-none",
			"scale-[.97]",
			"motion-reduce:scale-100",
		];
		const veilMotion = [
			"bg-surface-0",
			"after:absolute",
			"after:inset-0",
			"after:rounded-[inherit]",
			"after:bg-backdrop",
			"transition-opacity",
			"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
			"opacity-0",
			"duration-[120ms]",
			"opacity-20",
			"duration-200",
		];
		const read = () => {
			const veil = document.querySelector<HTMLElement>("[data-palette-recede-veil]")!;
			return {
				recedeCard: veil.parentElement!.hasAttribute("data-palette-recede-card"),
				dialog: motion.filter((name) => veil.parentElement!.classList.contains(name)),
				veil: veilMotion.filter((name) => veil.classList.contains(name)),
			};
		};

		const {input} = await openPalette();
		const closed = read();
		fireEvent.keyDown(input, {key: "Enter", code: "Enter", altKey: true});
		const card = await screen.findByRole("menu", {name: "Actions"});

		expect({
			closed,
			open: read(),
			card: {
				animation: card.classList.contains("animate-palette-card-in"),
				reduced: card.classList.contains("motion-reduce:animate-none"),
				slide: card.style.getPropertyValue("--cp-card-slide"),
			},
		}).toStrictEqual({
			closed: {
				recedeCard: true,
				dialog: [
					"origin-top",
					"transition-[scale]",
					"duration-200",
					"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
					"motion-reduce:transition-none",
					"motion-reduce:scale-100",
				],
				veil: [
					"bg-surface-0",
					"after:absolute",
					"after:inset-0",
					"after:rounded-[inherit]",
					"after:bg-backdrop",
					"transition-opacity",
					"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
					"opacity-0",
					"duration-[120ms]",
				],
			},
			open: {
				recedeCard: true,
				dialog: motion,
				veil: [
					"bg-surface-0",
					"after:absolute",
					"after:inset-0",
					"after:rounded-[inherit]",
					"after:bg-backdrop",
					"transition-opacity",
					"ease-[cubic-bezier(0.165,0.84,0.44,1)]",
					"opacity-20",
					"duration-200",
				],
			},
			card: {animation: true, reduced: true, slide: "-12px"},
		});
	});

	it("defines upstream's palette-card-in keyframes and 200ms ease-out animation", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		expect({
			animation: /--animate-palette-card-in: [^;]*;/.exec(styles)?.[0],
			keyframes: /@keyframes palette-card-in \{[^}]*\}\n\}/.exec(styles)?.[0],
		}).toStrictEqual({
			animation: "--animate-palette-card-in: palette-card-in 200ms cubic-bezier(0.165, 0.84, 0.44, 1);",
			keyframes:
				"@keyframes palette-card-in {\n\t0% {\n\t\topacity: 0;\n\t\ttransform: translateX(var(--cp-card-slide));\n\t}\n}",
		});
	});

	it("freezes the palette selection while the card is open", async () => {
		const {dialog} = await openCard();

		const other = dialog.querySelector<HTMLElement>('[cmdk-item][data-value="session:sess-2"]')!;
		fireEvent.pointerMove(other);

		expect(
			[...dialog.querySelectorAll<HTMLElement>('[cmdk-item][data-selected="true"]')].map(
				(item) => item.dataset["value"],
			),
		).toStrictEqual(["session:sess-1"]);
	});

	it("a click on the palette while the card is open closes the card without opening the row", async () => {
		const {dialog} = await openCard();

		const other = dialog.querySelector<HTMLElement>('[cmdk-item][data-value="session:sess-2"]')!;
		fireEvent.pointerDown(other);
		fireEvent.mouseDown(other);
		fireEvent.click(other);

		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect({
			// The modal palette hides the rest of the page from AT, so read the output directly.
			location: document.querySelector('output[aria-label="Location"]')?.textContent,
			palette: screen.queryByRole("dialog", {name: "Search"}) === dialog,
		}).toStrictEqual({location: "/", palette: true});
	});

	it("closes the card when its row leaves the list", async () => {
		const {dialog, input} = await openCard();

		fireEvent.change(input, {target: {value: "release"}});

		await waitFor(() => {
			expect(dialog.querySelector('[cmdk-item][data-value="session:sess-1"]')).toBeNull();
		});
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(document.activeElement).toBe(input);
	});
});

describe("rowActionsAnchorRect", () => {
	const list = {x: 100, y: 200, width: 600, height: 400};
	const dialog = {x: 100, y: 150, width: 600, height: 500};

	it("takes the list's x and width at the row's y, scaled .97 about the dialog centre, then lifted 4px", () => {
		const rect = rowActionsAnchorRect({list, row: {y: 300, height: 32}, dialog, reducedMotion: false});

		expect(rect).toStrictEqual({x: 109, y: 299, width: 582, height: 31.04});
	});

	it("clamps the row into the list viewport", () => {
		const above = rowActionsAnchorRect({list, row: {y: 120, height: 32}, dialog, reducedMotion: true});
		const below = rowActionsAnchorRect({list, row: {y: 900, height: 32}, dialog, reducedMotion: true});

		expect([above, below]).toStrictEqual([
			{x: 100, y: 196, width: 600, height: 32},
			{x: 100, y: 564, width: 600, height: 32},
		]);
	});
});

describe("motionReduced", () => {
	afterEach(() => {
		delete document.documentElement.dataset["motion"];
		vi.unstubAllGlobals();
	});

	function stubOsReducedMotion(matches: boolean) {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: matches && query === "(prefers-reduced-motion: reduce)",
		}));
	}

	it("follows the OS reduced-motion setting and Settings ▸ Motion ▸ Reduced", () => {
		stubOsReducedMotion(false);
		const neither = motionReduced();
		document.documentElement.dataset["motion"] = "reduced";
		const inApp = motionReduced();
		delete document.documentElement.dataset["motion"];
		stubOsReducedMotion(true);
		const os = motionReduced();

		expect({neither, inApp, os}).toStrictEqual({neither: false, inApp: true, os: true});
	});
});
