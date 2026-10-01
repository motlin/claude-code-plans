// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {
	ARTIFACT_PIN_STORAGE_KEY,
	isArtifactPinned,
	pinArtifact,
	readArtifactPins,
	unpinArtifact,
	useArtifactPins,
} from "../src/lib/artifact-pins";
import {installLocalStorage} from "./fake-storage";

const LADDER_URL = "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6";
const DOCS_URL = "https://claude.ai/artifact/7Hq2vXbN4pLmKcR9sTwYzA";

function stored(): unknown {
	const raw = localStorage.getItem(ARTIFACT_PIN_STORAGE_KEY);
	return raw === null ? null : JSON.parse(raw);
}

describe("artifact pin store", () => {
	let storage: ReturnType<typeof installLocalStorage>;

	beforeEach(() => {
		storage = installLocalStorage();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("round-trips pin and unpin through localStorage", () => {
		const initial = readArtifactPins();
		pinArtifact(LADDER_URL);
		pinArtifact(DOCS_URL);
		pinArtifact(LADDER_URL);
		const afterPin = {stored: stored(), ladder: isArtifactPinned(LADDER_URL)};

		unpinArtifact(LADDER_URL);

		expect({initial, afterPin, afterUnpin: stored(), ladder: isArtifactPinned(LADDER_URL)}).toStrictEqual({
			initial: [],
			afterPin: {stored: [LADDER_URL, DOCS_URL], ladder: true},
			afterUnpin: [DOCS_URL],
			ladder: false,
		});
	});

	it.each([
		["corrupt JSON", "{not json"],
		["the wrong shape", JSON.stringify({pinned: [LADDER_URL]})],
		["non-string entries", JSON.stringify([1, 2])],
	])("falls back to no pins on %s", (_label, raw) => {
		localStorage.setItem(ARTIFACT_PIN_STORAGE_KEY, raw);

		expect(readArtifactPins()).toStrictEqual([]);
	});

	it("keeps working when storage throws", () => {
		vi.spyOn(storage, "getItem").mockImplementation(() => {
			throw new Error("denied");
		});
		vi.spyOn(storage, "setItem").mockImplementation(() => {
			throw new Error("denied");
		});

		expect(() => pinArtifact(LADDER_URL)).not.toThrow();
		expect(readArtifactPins()).toStrictEqual([]);
	});

	it("updates every hook instance, including from another tab's storage event", () => {
		const first = renderHook(() => useArtifactPins());
		const second = renderHook(() => useArtifactPins());

		act(() => pinArtifact(LADDER_URL));
		const afterLocal = {
			first: first.result.current.pinned,
			second: second.result.current.isPinned(LADDER_URL),
		};

		const otherTab = JSON.stringify([DOCS_URL]);
		act(() => {
			localStorage.setItem(ARTIFACT_PIN_STORAGE_KEY, otherTab);
			window.dispatchEvent(new StorageEvent("storage", {key: ARTIFACT_PIN_STORAGE_KEY, newValue: otherTab}));
		});

		expect({
			afterLocal,
			afterStorageEvent: {
				pinned: second.result.current.pinned,
				ladder: second.result.current.isPinned(LADDER_URL),
				docs: second.result.current.isPinned(DOCS_URL),
			},
		}).toStrictEqual({
			afterLocal: {first: [LADDER_URL], second: true},
			afterStorageEvent: {pinned: [DOCS_URL], ladder: false, docs: true},
		});
	});
});
