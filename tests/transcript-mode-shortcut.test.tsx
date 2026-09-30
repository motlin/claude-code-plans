// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {useTranscriptModeShortcut} from "../src/hooks/use-session-transcript-mode";
import {bindingsFor} from "../src/lib/shortcuts/match";
import {SHORTCUTS} from "../src/lib/shortcuts/registry";

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	get length(): number {
		return this.values.size;
	}
	clear(): void {
		this.values.clear();
	}
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

function Probe({sessionId, hasThinking}: {sessionId: string; hasThinking: boolean}) {
	const {mode} = useTranscriptModeShortcut(sessionId, {hasThinking});
	return <output aria-label="transcript mode">{mode}</output>;
}

function renderProbe(sessionId: string, hasThinking = true) {
	return render(
		<SettingsProvider>
			<Probe sessionId={sessionId} hasThinking={hasThinking} />
		</SettingsProvider>,
	);
}

function currentMode(): string | null {
	return screen.getByLabelText("transcript mode").textContent;
}

function pressCtrlO(init: KeyboardEventInit = {}): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		key: "o",
		code: "KeyO",
		ctrlKey: true,
		bubbles: true,
		cancelable: true,
		...init,
	});
	act(() => {
		document.body.dispatchEvent(event);
	});
	return event;
}

beforeEach(() => {
	vi.stubGlobal("localStorage", new MemoryStorage());
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("⌃O transcript mode shortcut", () => {
	it("is enabled and bound to ctrl+o on mac and non-mac", () => {
		expect({
			enabled: SHORTCUTS.transcript_view.enabled,
			mac: bindingsFor("transcript_view", true),
			nonMac: bindingsFor("transcript_view", false),
		}).toStrictEqual({
			enabled: true,
			mac: [{key: "o", code: "KeyO", modifiers: ["ctrl"], platform: "mac"}],
			nonMac: [{key: "o", code: "KeyO", modifiers: ["ctrl"], platform: "non-mac"}],
		});
	});

	it("cycles Normal → Thinking → Verbose → Normal and prevents the browser default", () => {
		renderProbe("session-cycle-a");
		const modes = [currentMode()];
		const prevented: boolean[] = [];
		for (let i = 0; i < 3; i++) {
			prevented.push(pressCtrlO().defaultPrevented);
			modes.push(currentMode());
		}
		expect({modes, prevented}).toStrictEqual({
			modes: ["normal", "thinking", "verbose", "normal"],
			prevented: [true, true, true],
		});
	});

	it("changes only the current session, so a second session keeps its own mode", () => {
		const first = renderProbe("session-own-a");
		pressCtrlO();
		const firstAfter = currentMode();
		first.unmount();

		const second = renderProbe("session-own-b");
		const secondInitial = currentMode();
		pressCtrlO();
		pressCtrlO();
		const secondAfter = currentMode();
		second.unmount();

		renderProbe("session-own-a");
		const firstRevisited = currentMode();

		expect({firstAfter, secondInitial, secondAfter, firstRevisited}).toStrictEqual({
			firstAfter: "thinking",
			secondInitial: "normal",
			secondAfter: "verbose",
			firstRevisited: "thinking",
		});
	});

	it("skips Thinking when the session has none", () => {
		renderProbe("session-no-thinking", false);
		const modes = [currentMode()];
		pressCtrlO();
		modes.push(currentMode());
		pressCtrlO();
		modes.push(currentMode());
		expect(modes).toStrictEqual(["normal", "verbose", "normal"]);
	});

	it("ignores the key during IME composition", () => {
		renderProbe("session-ime");
		const event = pressCtrlO({isComposing: true});
		expect({mode: currentMode(), prevented: event.defaultPrevented}).toStrictEqual({
			mode: "normal",
			prevented: false,
		});
	});

	it("fires while focus is in the composer", () => {
		render(
			<SettingsProvider>
				<Probe sessionId="session-composer" hasThinking />
				<textarea aria-label="composer" />
			</SettingsProvider>,
		);
		const composer = screen.getByLabelText("composer");
		composer.focus();
		const event = new KeyboardEvent("keydown", {
			key: "o",
			code: "KeyO",
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			composer.dispatchEvent(event);
		});
		expect({mode: currentMode(), prevented: event.defaultPrevented}).toStrictEqual({
			mode: "thinking",
			prevented: true,
		});
	});
});
