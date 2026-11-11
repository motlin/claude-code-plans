// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {usePaneHost} from "../src/components/panes/pane-host-context";
import {useRegisterTerminalPane} from "../src/components/panes/terminal-pane-entry";
import {TileHost} from "../src/components/panes/tile-host";
import {browserStaleChunkDeps, STALE_CHUNK_RELOAD_KEY} from "../src/lib/stale-chunk-reload";
import {installLocalStorage} from "./fake-storage";

const harness = vi.hoisted(() => ({mode: "stale" as "stale" | "render"}));

vi.mock("../src/components/panes/terminal-pane", () => ({
	get TerminalPane() {
		if (harness.mode === "stale")
			throw new Error("Failed to fetch dynamically imported module: https://example.com/assets/terminal-pane.js");
		return function Crashes(): never {
			throw new Error("Example xterm failure");
		};
	},
}));

const SESSION = "session-alice";

function App() {
	useRegisterTerminalPane(SESSION, {livePane: true, interactive: false, shells: false});
	const host = usePaneHost();
	return (
		<button
			type="button"
			onClick={() => {
				host.openPane("terminal");
			}}
		>
			Open terminal
		</button>
	);
}

async function openTerminal() {
	render(
		<TileHost sessionId={SESSION} onExpandWithoutPane={() => {}}>
			<App />
		</TileHost>,
	);
	fireEvent.click(screen.getByRole("button", {name: "Open terminal"}));
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function terminalBody() {
	const section = document.querySelector('section[data-pane-kind="terminal"]');
	const placeholder = section?.querySelector("[data-pane-placeholder]");
	return {
		frame: placeholder?.parentElement?.parentElement?.className ?? null,
		alert: [...(placeholder?.querySelectorAll("[role=alert] p") ?? [])].map((p) => p.textContent),
		chunkError: section?.querySelector("[data-chunk-error] span")?.textContent ?? null,
		buttons: [...(section?.querySelectorAll("button") ?? [])].map(
			(button) => button.getAttribute("aria-label") ?? button.textContent,
		),
	};
}

beforeEach(() => {
	vi.stubGlobal("sessionStorage", installLocalStorage());
	installLocalStorage();
	harness.mode = "stale";
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("Terminal pane chunk fallbacks", () => {
	it("shows upstream's Couldn’t load the terminal placeholder once the reload guard has fired", async () => {
		const reload = vi.spyOn(browserStaleChunkDeps, "reload").mockImplementation(() => {});
		sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
		await openTerminal();
		const body = terminalBody();
		fireEvent.click(screen.getByRole("button", {name: "Reload"}));
		expect({body, reloads: reload.mock.calls.length}).toStrictEqual({
			body: {
				frame: "absolute inset-0",
				alert: ["Couldn’t load the terminal", "Reload the page to try again."],
				chunkError: null,
				buttons: ["Expand", "Close", "Move", "Reload"],
			},
			reloads: 1,
		});
	});

	it("keeps the inline Couldn’t load this. Retry for a retryable failure", async () => {
		await openTerminal();
		expect(terminalBody()).toStrictEqual({
			frame: null,
			alert: [],
			chunkError: "Couldn’t load this.",
			buttons: ["Expand", "Close", "Move", "Retry"],
		});
	});

	it("sends a terminal render crash to the pane crash boundary", async () => {
		harness.mode = "render";
		await openTerminal();
		expect(terminalBody()).toStrictEqual({
			frame: "contents",
			alert: ["Something went wrong"],
			chunkError: null,
			buttons: ["Expand", "Close", "Move", "Try again"],
		});
	});
});
