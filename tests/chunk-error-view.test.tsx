// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ChunkErrorView} from "../src/components/panes/chunk-error-view";
import {deferredPane} from "../src/components/panes/deferred-pane";
import {usePaneHost} from "../src/components/panes/pane-host-context";
import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {CHUNK_ERROR_COPY, chunkErrorState, type ChunkErrorState} from "../src/lib/chunk-error-state";
import {browserStaleChunkDeps, STALE_CHUNK_RELOAD_KEY} from "../src/lib/stale-chunk-reload";
import {installLocalStorage} from "./fake-storage";

const STALE = "Failed to fetch dynamically imported module: https://example.com/assets/links.js";

const loader = {error: new Error(STALE) as Error | null, loads: 0};

function LoadedBody() {
	return <p>Loaded body</p>;
}

function Crashes(): never {
	throw new Error("Example render failure");
}

const DeferredExample = deferredPane("Links", async () => {
	loader.loads++;
	await Promise.resolve();
	if (loader.error !== null) throw loader.error;
	return LoadedBody;
});

const DeferredCrash = deferredPane("Links", async () => Promise.resolve(Crashes));

function Opener() {
	const host = usePaneHost();
	return (
		<button
			type="button"
			onClick={() => {
				host.openPane("links");
			}}
		>
			Open links
		</button>
	);
}

let unregister: () => void = () => {};

async function openPane(render_: () => React.ReactNode) {
	unregister = registerPane("links", {title: "Links", render: render_});
	render(
		<TileHost sessionId="session-alice" onExpandWithoutPane={() => {}}>
			<Opener />
		</TileHost>,
	);
	fireEvent.click(screen.getByRole("button", {name: "Open links"}));
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function chunkError() {
	const root = document.querySelector<HTMLElement>("[data-chunk-error]");
	if (root === null) return null;
	const copy = root.querySelector("span");
	return {
		state: root.dataset["chunkError"],
		copy: copy?.textContent,
		role: copy?.getAttribute("role"),
		button: root.querySelector("button")?.textContent,
		disabled: root.querySelector("button")?.disabled,
	};
}

beforeEach(() => {
	vi.stubGlobal("sessionStorage", installLocalStorage());
	installLocalStorage();
	loader.error = new Error(STALE);
	loader.loads = 0;
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
	);
});

afterEach(() => {
	unregister();
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("chunkErrorState", () => {
	it("picks upstream's ErrorView state from connectivity, the reload guard and earlier retries", () => {
		expect({
			first: chunkErrorState({online: true, reloadUsed: false, retried: false}),
			retried: chunkErrorState({online: true, reloadUsed: false, retried: true}),
			reloaded: chunkErrorState({online: true, reloadUsed: true, retried: true}),
			offline: chunkErrorState({online: false, reloadUsed: false, retried: true}),
			offlineReloaded: chunkErrorState({online: false, reloadUsed: true, retried: false}),
		}).toStrictEqual({
			first: "retry",
			retried: "updated",
			reloaded: "reload",
			offline: "waiting",
			offlineReloaded: "waiting-reload",
		});
	});
});

describe("ChunkErrorView", () => {
	it("copies upstream's copy and control per state", () => {
		const states: ChunkErrorState[] = ["retry", "waiting", "waiting-reload", "updated", "reload"];
		const onRetry = vi.fn<() => void>();
		const onReload = vi.fn<() => void>();
		const rendered = states.map((state) => {
			const {unmount} = render(<ChunkErrorView state={state} onRetry={onRetry} onReload={onReload} />);
			const result = chunkError();
			fireEvent.click(screen.getByRole("button"));
			unmount();
			return result;
		});
		expect({
			copy: CHUNK_ERROR_COPY,
			rendered,
			retries: onRetry.mock.calls.length,
			reloads: onReload.mock.calls.length,
		}).toStrictEqual({
			copy: {
				retry: "Couldn’t load this.",
				waiting: "You’re offline.",
				"waiting-reload": "You’re offline.",
				updated: "Claude was updated. Reload to continue.",
				reload: "Couldn’t load this. Reload the page to continue.",
			},
			rendered: [
				{state: "retry", copy: "Couldn’t load this.", role: "status", button: "Retry", disabled: false},
				{state: "waiting", copy: "You’re offline.", role: "status", button: "Retry", disabled: false},
				{state: "waiting-reload", copy: "You’re offline.", role: "status", button: "Reload", disabled: false},
				{
					state: "updated",
					copy: "Claude was updated. Reload to continue.",
					role: "status",
					button: "Reload",
					disabled: false,
				},
				{
					state: "reload",
					copy: "Couldn’t load this. Reload the page to continue.",
					role: "status",
					button: "Reload",
					disabled: false,
				},
			],
			retries: 2,
			reloads: 3,
		});
	});

	it("uses upstream's inline row markup, or its placeholder grid, and disables the button while busy", () => {
		const {unmount} = render(<ChunkErrorView state="retry" busy onRetry={() => {}} onReload={() => {}} />);
		const row = document.querySelector("[data-chunk-error]");
		const inline = {
			row: row?.className,
			copy: row?.querySelector("span")?.className,
			describedById: row?.querySelector("span")?.id !== "",
			disabled: row?.querySelector("button")?.disabled,
		};
		unmount();
		render(
			<ChunkErrorView
				state="retry"
				placeholder={<p role="status">Loading links…</p>}
				onRetry={() => {}}
				onReload={() => {}}
			/>,
		);
		const grid = document.querySelector("[data-chunk-error]");
		expect({
			inline,
			grid: {
				root: grid?.className,
				state: grid?.getAttribute("data-chunk-error"),
				hidden: grid?.children[0]?.className,
				ariaHidden: grid?.children[0]?.getAttribute("aria-hidden"),
				hiddenText: grid?.children[0]?.textContent,
				overlay: grid?.children[1]?.className,
				status: screen.getByRole("status").textContent,
			},
		}).toStrictEqual({
			inline: {
				row: "flex min-w-0 flex-wrap items-center justify-center gap-xs px-md py-xs text-center",
				copy: "min-w-0 text-body text-muted-as-secondary",
				describedById: true,
				disabled: true,
			},
			grid: {
				root: "grid min-w-0",
				state: "retry",
				hidden: "invisible col-start-1 row-start-1",
				ariaHidden: "true",
				hiddenText: "Loading links…",
				overlay:
					"col-start-1 row-start-1 flex w-0 min-w-full flex-col items-center justify-center gap-xs px-md py-xs text-center",
				status: "Couldn’t load this.",
			},
		});
	});
});

describe("deferred pane chunk failures", () => {
	it("shows Retry first, Claude was updated after a failed retry, and reloads on Reload", async () => {
		const reload = vi.spyOn(browserStaleChunkDeps, "reload").mockImplementation(() => {});
		await openPane(() => <DeferredExample resetKey="session-alice" props={{}} />);
		const first = chunkError();
		fireEvent.click(screen.getByRole("button", {name: "Retry"}));
		await screen.findByText("Claude was updated. Reload to continue.");
		const second = chunkError();
		fireEvent.click(screen.getByRole("button", {name: "Reload"}));
		expect({
			first,
			second,
			busy: chunkError()?.disabled,
			reloads: reload.mock.calls.length,
			loads: loader.loads,
		}).toStrictEqual({
			first: {state: "retry", copy: "Couldn’t load this.", role: "status", button: "Retry", disabled: false},
			second: {
				state: "updated",
				copy: "Claude was updated. Reload to continue.",
				role: "status",
				button: "Reload",
				disabled: false,
			},
			busy: true,
			reloads: 1,
			loads: 2,
		});
	});

	it("shows You’re offline when the browser is offline and Reload the page once the reload guard fired", async () => {
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		await openPane(() => <DeferredExample resetKey="session-alice" props={{}} />);
		const offline = chunkError();
		cleanup();
		unregister();
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
		sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
		await openPane(() => <DeferredExample resetKey="session-alice" props={{}} />);
		expect({offline, reload: chunkError()}).toStrictEqual({
			offline: {state: "waiting", copy: "You’re offline.", role: "status", button: "Retry", disabled: false},
			reload: {
				state: "reload",
				copy: "Couldn’t load this. Reload the page to continue.",
				role: "status",
				button: "Reload",
				disabled: false,
			},
		});
	});

	it("leaves non-chunk failures to the pane crash boundary", async () => {
		await openPane(() => <DeferredCrash resetKey="session-alice" props={{}} />);
		expect({
			chunk: chunkError(),
			crash: document.querySelector("[data-side-pane-crash] [role=alert] p")?.textContent,
		}).toStrictEqual({chunk: null, crash: "Something went wrong"});
	});
});
