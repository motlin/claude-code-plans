// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DeferredCommandPalette, loadCommandPalette} from "../src/components/command-palette-entry";
import {deferredPane} from "../src/components/panes/deferred-pane";
import {prefetchWhenIdle, warmOnIntent, type IdleHost} from "../src/lib/idle-prefetch";

const harness = vi.hoisted(() => ({imports: 0}));

vi.mock("../src/components/command-palette", () => {
	harness.imports++;
	return {
		CommandPalette: ({open}: {open: boolean}) => (open ? <div role="dialog" aria-label="Command palette" /> : null),
	};
});

afterEach(() => {
	cleanup();
});

/** A host whose idle callbacks, timers and visibility changes run only when the test drives them. */
function fakeHost({idle, hidden}: {idle: boolean; hidden: boolean}) {
	const pending: Array<() => void> = [];
	const listeners = new Set<() => void>();
	const doc: IdleHost["document"] = {
		visibilityState: hidden ? "hidden" : "visible",
		addEventListener: (_type, listener) => {
			listeners.add(listener);
		},
		removeEventListener: (_type, listener) => {
			listeners.delete(listener);
		},
	};
	const host: IdleHost = {
		document: doc,
		setTimeout: (callback: () => void) => pending.push(callback),
		clearTimeout: () => {},
		...(idle ? {requestIdleCallback: (callback: () => void) => pending.push(callback)} : {}),
	};
	return {
		host,
		runPending: () => {
			for (const callback of pending.splice(0)) callback();
		},
		show: () => {
			doc.visibilityState = "visible";
			for (const listener of [...listeners]) listener();
		},
	};
}

describe("prefetchWhenIdle", () => {
	it("calls each loader once when the page goes idle, and swallows a failed download", async () => {
		const fake = fakeHost({idle: true, hidden: false});
		const calls: string[] = [];
		prefetchWhenIdle(
			[
				async () => {
					calls.push("palette");
					return Promise.reject(new Error("Example chunk unavailable"));
				},
				async () => {
					calls.push("settings");
					return Promise.resolve();
				},
			],
			fake.host,
		);
		const beforeIdle = [...calls];
		fake.runPending();
		fake.runPending();
		await Promise.resolve();
		expect({beforeIdle, calls}).toStrictEqual({beforeIdle: [], calls: ["palette", "settings"]});
	});

	it("falls back to a timer without requestIdleCallback and waits for a hidden tab to show", () => {
		const fake = fakeHost({idle: false, hidden: true});
		const calls: string[] = [];
		prefetchWhenIdle(
			[
				async () => {
					calls.push("palette");
					return Promise.resolve();
				},
			],
			fake.host,
		);
		fake.runPending();
		const whileHidden = [...calls];
		fake.show();
		fake.runPending();
		expect({whileHidden, calls}).toStrictEqual({whileHidden: [], calls: ["palette"]});
	});

	it("does nothing once cancelled", () => {
		const fake = fakeHost({idle: true, hidden: false});
		const calls: string[] = [];
		const cancel = prefetchWhenIdle(
			[
				async () => {
					calls.push("palette");
					return Promise.resolve();
				},
			],
			fake.host,
		);
		cancel();
		fake.runPending();
		expect(calls).toStrictEqual([]);
	});
});

describe("warmOnIntent", () => {
	it("warms a control's chunks on hover or focus, and the modifier chunks on a ⌘ or Ctrl press", () => {
		const calls: string[] = [];
		const loader = (name: string) => async () => {
			calls.push(name);
			return Promise.resolve();
		};
		const stop = warmOnIntent(document, {
			targets: {palette: [loader("palette")], settings: [loader("settings")]},
			modifier: [loader("palette"), loader("settings")],
		});
		document.body.innerHTML =
			'<button data-prefetch="palette"><span>Search</span></button><button data-prefetch="settings">Alice</button><button>Other</button>';
		const [search, account, other] = [...document.querySelectorAll("button")];
		search?.firstElementChild?.dispatchEvent(new Event("pointerover", {bubbles: true}));
		account?.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
		other?.dispatchEvent(new Event("pointerover", {bubbles: true}));
		document.dispatchEvent(new KeyboardEvent("keydown", {key: "a"}));
		document.dispatchEvent(new KeyboardEvent("keydown", {key: "Meta"}));
		stop();
		document.dispatchEvent(new KeyboardEvent("keydown", {key: "Control"}));
		document.body.innerHTML = "";
		expect(calls).toStrictEqual(["palette", "settings", "palette", "settings"]);
	});
});

describe("warmed lazy boundaries", () => {
	it("opens the palette in the first render once its shared loader has settled", async () => {
		await Promise.all([loadCommandPalette(), loadCommandPalette()]);
		render(<DeferredCommandPalette open onOpenChange={() => {}} />);
		expect({
			dialog: screen.queryByRole("dialog")?.getAttribute("aria-label"),
			imports: harness.imports,
		}).toStrictEqual({dialog: "Command palette", imports: 1});
	});

	it("renders a preloaded pane without its loading fallback", async () => {
		let loads = 0;
		const Pane = deferredPane("Example", async () => {
			loads++;
			return Promise.resolve(({name}: {name: string}) => <p>Pane of {name}</p>);
		});
		await Promise.all([Pane.preload(), Pane.preload()]);
		render(<Pane resetKey="alice" props={{name: "alice"}} />);
		expect({
			pane: screen.queryByText("Pane of alice")?.textContent,
			status: screen.queryByRole("status"),
			loads,
		}).toStrictEqual({pane: "Pane of alice", status: null, loads: 1});
	});
});
