// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, renderHook, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {COMPOSER_DRAFT_DEBOUNCE_MS, composerDraftStorageKey, useComposerDraft} from "../src/hooks/use-composer-draft";
import {installLocalStorage} from "./fake-storage";

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
	storage = installLocalStorage();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function storedDrafts(): Record<string, string> {
	return Object.fromEntries(storage.values);
}

describe("composerDraftStorageKey", () => {
	it("namespaces session drafts and uses a home key for the home composer", () => {
		expect({
			session: composerDraftStorageKey("session-alice"),
			home: composerDraftStorageKey("home"),
		}).toStrictEqual({
			session: "ccp-composer-draft:session-alice",
			home: "ccp-composer-draft:home",
		});
	});
});

describe("useComposerDraft", () => {
	it("restores a stored draft on mount", () => {
		storage.setItem("ccp-composer-draft:session-alice", JSON.stringify({text: "Continue Alice's test"}));

		const {result} = renderHook(() => useComposerDraft("session-alice"));

		expect(result.current.text).toBe("Continue Alice's test");
	});

	it("ignores drafts that fail the strict schema", () => {
		storage.setItem("ccp-composer-draft:session-alice", JSON.stringify({text: "Continue Alice's test", files: []}));

		const {result} = renderHook(() => useComposerDraft("session-alice"));

		expect(result.current.text).toBe("");
	});

	it("writes the draft after the debounce and removes the key once emptied", () => {
		vi.useFakeTimers();
		const {result} = renderHook(() => useComposerDraft("session-bob"));

		act(() => result.current.setText("Continue Bob's test"));
		const beforeDebounce = storedDrafts();
		act(() => {
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});
		const afterDebounce = storedDrafts();
		act(() => result.current.setText(""));
		act(() => {
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});

		expect({
			debounceMs: COMPOSER_DRAFT_DEBOUNCE_MS <= 150,
			beforeDebounce,
			afterDebounce,
			afterEmpty: storedDrafts(),
		}).toStrictEqual({
			debounceMs: true,
			beforeDebounce: {},
			afterDebounce: {
				"ccp-composer-draft:session-bob": JSON.stringify({text: "Continue Bob's test"}),
			},
			afterEmpty: {},
		});
	});

	it("flushes a pending write when the key changes", () => {
		vi.useFakeTimers();
		const {result, rerender} = renderHook(({draftKey}) => useComposerDraft(draftKey), {
			initialProps: {draftKey: "session-alice"},
		});

		act(() => result.current.setText("Continue Alice's test"));
		rerender({draftKey: "session-bob"});

		expect({text: result.current.text, stored: storedDrafts()}).toStrictEqual({
			text: "",
			stored: {
				"ccp-composer-draft:session-alice": JSON.stringify({text: "Continue Alice's test"}),
			},
		});
	});

	it("keeps working when storage throws", () => {
		vi.useFakeTimers();
		vi.spyOn(storage, "getItem").mockImplementation(() => {
			throw new Error("denied");
		});
		vi.spyOn(storage, "setItem").mockImplementation(() => {
			throw new Error("denied");
		});
		vi.spyOn(storage, "removeItem").mockImplementation(() => {
			throw new Error("denied");
		});

		const {result} = renderHook(() => useComposerDraft("session-alice"));
		act(() => result.current.setText("Continue Alice's test"));
		act(() => {
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});
		const typed = result.current.text;
		act(() => result.current.clear());

		expect({typed, cleared: result.current.text}).toStrictEqual({
			typed: "Continue Alice's test",
			cleared: "",
		});
	});
});

describe("Composer draft persistence", () => {
	it("restores the draft and clears it after a send", () => {
		storage.setItem("ccp-composer-draft:session-alice", JSON.stringify({text: "Continue Alice's test"}));
		const onSend = vi.fn<(prompt: string) => void>();
		render(<Composer variant="session" draftKey="session-alice" onSend={onSend} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		const restored = textarea.value;

		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			restored,
			sends: onSend.mock.calls,
			value: textarea.value,
			stored: storedDrafts(),
		}).toStrictEqual({
			restored: "Continue Alice's test",
			sends: [["Continue Alice's test", {}]],
			value: "",
			stored: {},
		});
	});

	it("persists typed text for the next mount", () => {
		vi.useFakeTimers();
		const {unmount} = render(<Composer variant="home" draftKey="home" onSend={() => {}} />);
		fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {
			target: {value: "Describe Bob's task"},
		});
		unmount();
		render(<Composer variant="home" draftKey="home" onSend={() => {}} />);

		expect(screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"}).value).toBe("Describe Bob's task");
	});
});
