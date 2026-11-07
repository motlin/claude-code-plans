// @vitest-environment jsdom

import {render, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SettingsProvider} from "../src/components/settings-provider";

function stubStorage(entries: Record<string, string>): void {
	const storage = new Map(Object.entries(entries));
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	});
}

async function interfaceFontAttribute(font: string): Promise<string | null> {
	stubStorage({"ccp-interface-font": font});
	const {unmount} = render(<SettingsProvider>{null}</SettingsProvider>);
	await waitFor(() => {
		expect(document.documentElement.dataset["interfaceFont"] === undefined).toBe(font === "sans");
	});
	const value = document.documentElement.getAttribute("data-interface-font");
	unmount();
	vi.unstubAllGlobals();
	return value;
}

afterEach(() => {
	vi.unstubAllGlobals();
	delete document.documentElement.dataset["interfaceFont"];
});

describe("SettingsProvider data-interface-font", () => {
	it("exposes system and dyslexic on <html> so CSS can pick the system wght axes; sans has no attribute", async () => {
		const result: Record<string, string | null> = {};
		for (const font of ["sans", "system", "dyslexic"]) result[font] = await interfaceFontAttribute(font);
		expect(result).toStrictEqual({sans: null, system: "system", dyslexic: "dyslexic"});
	});
});
