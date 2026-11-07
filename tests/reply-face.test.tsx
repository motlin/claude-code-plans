// @vitest-environment jsdom

import {act, render, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {DEFAULTS, STORAGE_KEYS, useSettings} from "../src/components/settings-context";
import {SettingsProvider} from "../src/components/settings-provider";
import {applyReplyFace, replyFaceFor, ResponseFontSchema} from "../src/lib/appearance";

function stubStorage(entries: Record<string, string>): void {
	const storage = new Map(Object.entries(entries));
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.documentElement.removeAttribute("data-reply-face");
});

describe("Response font setting", () => {
	it("offers sans and serif, defaults to sans under ccp-response-font", () => {
		expect({
			options: ResponseFontSchema.options,
			default: DEFAULTS.responseFont,
			key: STORAGE_KEYS.responseFont,
		}).toStrictEqual({options: ["sans", "serif"], default: "sans", key: "ccp-response-font"});
	});
});

describe("replyFaceFor (upstream dH under fizzy type)", () => {
	it("maps sans to interface and serif to serif", () => {
		expect(Object.fromEntries(ResponseFontSchema.options.map((v) => [v, replyFaceFor(v)]))).toStrictEqual({
			sans: "interface",
			serif: "serif",
		});
	});
});

describe("applyReplyFace (upstream GK)", () => {
	it("writes the face once, skips an unchanged value, and leaves it alone with type off", () => {
		const root = document.createElement("html");
		const setAttribute = vi.spyOn(root, "setAttribute");
		const removeAttribute = vi.spyOn(root, "removeAttribute");
		applyReplyFace(root, "serif", {type: true});
		const first = root.getAttribute("data-reply-face");
		applyReplyFace(root, "serif", {type: true});
		applyReplyFace(root, "sans", {type: false});
		expect({
			first,
			after: root.getAttribute("data-reply-face"),
			setCalls: setAttribute.mock.calls,
			removeCalls: removeAttribute.mock.calls.length,
		}).toStrictEqual({
			first: "serif",
			after: "serif",
			setCalls: [["data-reply-face", "serif"]],
			removeCalls: 0,
		});
	});
});

describe("SettingsProvider data-reply-face", () => {
	it("writes the stored Response font's face after load and rewrites it when the setting changes", async () => {
		stubStorage({"ccp-response-font": "serif"});
		let setResponseFont: ((font: "sans" | "serif") => void) | undefined;
		function Probe() {
			const {setSetting} = useSettings();
			setResponseFont = (font) => {
				setSetting("responseFont", font);
			};
			return null;
		}
		render(
			<SettingsProvider>
				<Probe />
			</SettingsProvider>,
		);
		await waitFor(() => {
			expect(document.documentElement.dataset["replyFace"]).toBe("serif");
		});
		act(() => setResponseFont?.("sans"));
		expect(document.documentElement.dataset["replyFace"]).toBe("interface");
	});

	it("falls back to interface for an unknown stored value", async () => {
		stubStorage({"ccp-response-font": "comic"});
		render(<SettingsProvider>{null}</SettingsProvider>);
		await waitFor(() => {
			expect(document.documentElement.dataset["replyFace"]).toBe("interface");
		});
	});
});
