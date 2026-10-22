// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function stubPointer(coarse: boolean) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: coarse && query === "(pointer: coarse)",
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

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

interface Handlers {
	onSend: (prompt: string) => void;
	onStop: () => void;
	onQueueForLater: ((prompt: string) => void) | undefined;
}

function renderWorking(coarse: boolean, withQueue = true) {
	stubPointer(coarse);
	const handlers = {
		onSend: vi.fn<(prompt: string) => void>(),
		onStop: vi.fn<() => void>(),
		onQueueForLater: withQueue ? vi.fn<(prompt: string) => void>() : undefined,
	};
	const element = (props: Partial<Handlers> = {}) => {
		const merged = {...handlers, ...props};
		return (
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={(prompt) => {
					merged.onSend(prompt);
				}}
				onStop={merged.onStop}
				onQueueForLater={merged.onQueueForLater}
			/>
		);
	};
	const view = render(element());
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	fireEvent.change(textarea, {target: {value: "Alice's note"}});
	return {handlers, textarea, view, element};
}

async function openMenu() {
	fireEvent.click(screen.getByRole("button", {name: "More send options"}));
	await flush();
	return screen.getByRole("menu");
}

function menuEntries(menu: HTMLElement) {
	return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')]
		.filter((node) => node.closest("[data-cds-sheet-control]") === null)
		.map((node) => (node.getAttribute("role") === "separator" ? "---" : node.textContent));
}

describe("Composer touch split Send while working", () => {
	it("shows the Send split group instead of Stop with a draft on a coarse pointer", () => {
		renderWorking(true);
		const group = screen.getByRole("group", {name: "Send"});

		expect({
			cds: group.getAttribute("data-cds"),
			buttons: [...group.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
			keyshortcuts: screen.getByRole("button", {name: "Send"}).getAttribute("aria-keyshortcuts"),
			stop: screen.queryByRole("button", {name: "Stop", hidden: true}),
		}).toStrictEqual({
			cds: "SplitDropdownButton",
			buttons: ["Send", "More send options"],
			keyshortcuts: "Enter",
			stop: null,
		});
	});

	it("sends (steers) from the primary segment", () => {
		const {handlers, textarea} = renderWorking(true);
		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		expect({sent: handlers.onSend.mock.calls, draft: textarea.value}).toStrictEqual({
			sent: [["Alice's note"]],
			draft: "",
		});
	});

	it("lists Queue for later, a separator and Stop in the caret menu", async () => {
		renderWorking(true);
		const menu = await openMenu();

		expect(menuEntries(menu)).toStrictEqual(["Queue for later", "---", "Stop"]);
	});

	it("queues the draft from Queue for later and refocuses the cleared editor", async () => {
		const {handlers, textarea} = renderWorking(true);
		await openMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "Queue for later"}));
		await flush();

		expect({
			queued: handlers.onQueueForLater?.mock.calls,
			sent: handlers.onSend.mock.calls,
			draft: textarea.value,
			focused: document.activeElement === textarea,
		}).toStrictEqual({queued: [["Alice's note"]], sent: [], draft: "", focused: true});
	});

	it("stops from the menu without clearing the draft", async () => {
		const {handlers, textarea} = renderWorking(true);
		await openMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "Stop"}));
		await flush();

		expect({stops: handlers.onStop.mock.calls.length, draft: textarea.value}).toStrictEqual({
			stops: 1,
			draft: "Alice's note",
		});
	});

	it("ignores a primary tap within 500ms of a menu Stop", async () => {
		const {handlers} = renderWorking(true);
		await openMenu();
		fireEvent.click(screen.getByRole("menuitem", {name: "Stop"}));
		await flush();
		fireEvent.click(screen.getByRole("button", {name: "Send"}));

		expect(handlers.onSend.mock.calls).toStrictEqual([]);
	});

	it("offers only Stop when the session has no queue-for-later lane", async () => {
		renderWorking(true, false);
		const menu = await openMenu();

		expect(menuEntries(menu)).toStrictEqual(["Stop"]);
	});

	it("closes the menu with the split when the turn ends", async () => {
		const {view} = renderWorking(true);
		await openMenu();
		view.rerender(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() => {}}
				onStop={undefined}
				onQueueForLater={() => {}}
			/>,
		);
		await flush();

		expect({
			menu: screen.queryByRole("menu"),
			group: screen.queryByRole("group", {name: "Send"}),
			send: screen.getByRole("button", {name: "Send"}).dataset["testid"],
		}).toStrictEqual({menu: null, group: null, send: "code-prompt-send"});
	});

	it("keeps the plain Send / Stop crossfade on a fine pointer", () => {
		renderWorking(false);

		expect({
			group: screen.queryByRole("group", {name: "Send"}),
			send: screen.getByRole("button", {name: "Send"}).dataset["testid"],
			caret: screen.queryByRole("button", {name: "More send options"}),
		}).toStrictEqual({group: null, send: "code-prompt-send", caret: null});
	});
});

describe("Composer touch send-cell spacer", () => {
	function spacerShape(container: HTMLElement) {
		const spacer = container.querySelector("[data-send-spacer]");
		return {
			inert: spacer?.hasAttribute("inert") ?? null,
			hidden: spacer?.getAttribute("aria-hidden") ?? null,
			classes: spacer?.className ?? null,
			cds: spacer?.firstElementChild?.getAttribute("data-cds") ?? null,
			slot: spacer?.parentElement?.className ?? null,
		};
	}
	const coarseSpacer = {
		inert: true,
		hidden: "true",
		classes: "invisible col-start-1 row-start-1 flex",
		cds: "SplitDropdownButton",
		slot: "absolute right-0 bottom-0 grid min-h-7 items-center justify-items-end pl-1.5",
	};

	it("reserves the split width with an inert split on an idle, empty coarse composer", () => {
		stubPointer(true);
		const {container} = render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);

		expect({
			spacer: spacerShape(container),
			send: screen.queryByRole("button", {name: "Send"}),
			group: screen.queryByRole("group", {name: "Send"}),
			textarea: screen
				.getByRole("textbox", {name: "Prompt"})
				.parentElement?.className.includes("pointer-coarse:pr-[51px]"),
		}).toStrictEqual({spacer: coarseSpacer, send: null, group: null, textarea: true});
	});

	it("keeps the split spacer under the visible Send on an idle coarse composer with a draft", () => {
		stubPointer(true);
		const {container} = render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {target: {value: "Bob's note"}});
		const send = screen.getByRole("button", {name: "Send"});

		expect({
			spacer: spacerShape(container),
			sendTestId: send.dataset["testid"],
			face: send.closest("[data-send-face-slot]")?.className ?? null,
		}).toStrictEqual({
			spacer: coarseSpacer,
			sendTestId: "code-prompt-send",
			face: "col-start-1 row-start-1 flex",
		});
	});

	it("keeps the split spacer while working with a draft on a coarse pointer", () => {
		const {view} = renderWorking(true);

		expect(spacerShape(view.container)).toStrictEqual(coarseSpacer);
	});

	it("keeps the 28px spacer on a fine pointer", () => {
		stubPointer(false);
		const {container} = render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		const spacer = container.querySelector("[data-send-spacer]");

		expect({
			children: [...(spacer?.children ?? [])].map((child) => child.outerHTML),
			split: container.querySelector("[data-send-spacer] [data-cds=SplitDropdownButton]"),
		}).toStrictEqual({children: ['<span class="size-7"></span>'], split: null});
	});
});
