// @vitest-environment jsdom

import {act, renderHook, waitFor} from "@testing-library/react";
import {createElement, type ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {useTerminalTheme} from "../src/hooks/use-terminal-theme";
import {loadCodeTheme} from "../src/lib/code-themes";
import {terminalThemeFromCodeTheme} from "../src/lib/terminal-theme";

function stubStorage(entries: Record<string, string>): void {
	const storage = new Map(Object.entries(entries));
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	});
}

function wrapper({children}: {children: ReactNode}) {
	return createElement(SettingsProvider, null, children);
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.documentElement.classList.remove("dark");
});

describe("useTerminalTheme", () => {
	it("follows the light code theme by default", async () => {
		stubStorage({"ccp-code-theme-light": "min-light"});
		const expected = terminalThemeFromCodeTheme(await loadCodeTheme("min-light"));

		const {result} = renderHook(() => useTerminalTheme(), {wrapper});

		await waitFor(() => {
			expect(result.current).toStrictEqual({ready: true, theme: expected, fontSize: null});
		});
	});

	it("switches to the dark code theme when the page goes dark", async () => {
		stubStorage({"ccp-code-theme-light": "min-light", "ccp-code-theme-dark": "nord"});
		const light = terminalThemeFromCodeTheme(await loadCodeTheme("min-light"));
		const dark = terminalThemeFromCodeTheme(await loadCodeTheme("nord"));

		const {result} = renderHook(() => useTerminalTheme(), {wrapper});
		await waitFor(() => {
			expect(result.current).toStrictEqual({ready: true, theme: light, fontSize: null});
		});

		act(() => {
			document.documentElement.classList.add("dark");
		});

		await waitFor(() => {
			expect(result.current).toStrictEqual({ready: true, theme: dark, fontSize: null});
		});
	});

	it("uses the Ghostty colours when Terminal colors is set to Ghostty", async () => {
		stubStorage({"ccp-terminal-appearance": "ghostty"});

		const {result} = renderHook(() => useTerminalTheme(), {wrapper});

		await waitFor(() => {
			expect(result.current).toStrictEqual({ready: true, theme: null, fontSize: null});
		});
	});

	it("hands terminals the Code font size when one is set", async () => {
		stubStorage({"ccp-terminal-appearance": "ghostty", "ccp-code-font-size": "18"});

		const {result} = renderHook(() => useTerminalTheme(), {wrapper});

		await waitFor(() => {
			expect(result.current).toStrictEqual({ready: true, theme: null, fontSize: 18});
		});
	});
});
