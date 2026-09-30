// @vitest-environment jsdom

import {renderHook} from "@testing-library/react";
import {createElement, type ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";
import {useCodeThemes} from "../src/hooks/use-code-themes";

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
});

describe("useCodeThemes", () => {
	it("resolves the default light/dark pair", () => {
		stubStorage({});
		const {result} = renderHook(() => useCodeThemes(), {wrapper});
		expect(result.current).toStrictEqual({light: "claude-light", dark: "github-dark"});
	});

	it("resolves the stored pair", () => {
		stubStorage({"ccp-code-theme-light": "min-light", "ccp-code-theme-dark": "nord"});
		const {result} = renderHook(() => useCodeThemes(), {wrapper});
		expect(result.current).toStrictEqual({light: "min-light", dark: "nord"});
	});

	it("ignores stored ids that are not offered for that mode", () => {
		stubStorage({"ccp-code-theme-light": "nord", "ccp-code-theme-dark": "claude-dark"});
		const {result} = renderHook(() => useCodeThemes(), {wrapper});
		expect(result.current).toStrictEqual({light: "claude-light", dark: "github-dark"});
	});
});
