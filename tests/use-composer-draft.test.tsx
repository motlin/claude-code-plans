// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, renderHook, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {COMPOSER_DRAFT_DEBOUNCE_MS, useComposerDraft} from "../src/hooks/use-composer-draft";
import
{
	composerDraftStorageKey,
	markFailedSend,
	readFailedSend,
	storeRejectedDraft,
} from "../src/lib/composer-draft-store";
import {getContextChips, removeContextChip} from "../src/lib/context-attach";
import {installLocalStorage} from "./fake-storage";

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() =>
{
	storage = installLocalStorage();
});

afterEach(() =>
{
	cleanup();
	for (const chip of getContextChips("s1")) removeContextChip("s1", chip.id);
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function storedDrafts(): Record<string, string>
{
	return Object.fromEntries(storage.values);
}

describe("composerDraftStorageKey", () =>
{
	it("namespaces session drafts and uses a home key for the home composer", () =>
	{
		expect(
			{
				session: composerDraftStorageKey("session-alice"),
				home: composerDraftStorageKey("home"),
			},
		).toStrictEqual(
			{
				session: "ccp-composer-draft:session-alice",
				home: "ccp-composer-draft:home",
			},
		);
	});
});

describe("useComposerDraft", () =>
{
	it("restores a stored draft on mount", () =>
	{
		storage.setItem(
			"ccp-composer-draft:session-alice",
			JSON.stringify(
				{
					text: "Continue Alice's test",
				},
			),
		);

		const {result} = renderHook(() => useComposerDraft("session-alice"));

		expect(result.current.text).toBe("Continue Alice's test");
	});

	it("ignores drafts that fail the strict schema", () =>
	{
		storage.setItem(
			"ccp-composer-draft:session-alice",
			JSON.stringify(
				{
					text: "Continue Alice's test",
					files: [],
				},
			),
		);

		const {result} = renderHook(() => useComposerDraft("session-alice"));

		expect(result.current.text).toBe("");
	});

	it("writes the draft after the debounce and removes the key once emptied", () =>
	{
		vi.useFakeTimers();
		const {result} = renderHook(() => useComposerDraft("session-bob"));

		act(() =>
		{
			result.current.setText("Continue Bob's test");
		});
		const beforeDebounce = storedDrafts();
		act(() =>
		{
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});
		const afterDebounce = storedDrafts();
		act(() =>
		{
			result.current.setText("");
		});
		act(() =>
		{
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});

		expect(
			{
				debounceMs: COMPOSER_DRAFT_DEBOUNCE_MS,
				beforeDebounce,
				afterDebounce,
				afterEmpty: storedDrafts(),
			},
		).toStrictEqual(
			{
				debounceMs: 150,
				beforeDebounce: {},
				afterDebounce:
				{
					"ccp-composer-draft:session-bob": JSON.stringify(
						{
							text: "Continue Bob's test",
						},
					),
				},
				afterEmpty: {},
			},
		);
	});

	it("flushes a pending write when the key changes", () =>
	{
		vi.useFakeTimers();
		const {result, rerender} = renderHook(
			({draftKey}) => useComposerDraft(draftKey),
			{
				initialProps:
				{
					draftKey: "session-alice",
				},
			},
		);

		act(() =>
		{
			result.current.setText("Continue Alice's test");
		});
		rerender(
			{
				draftKey: "session-bob",
			},
		);

		expect(
			{
				text: result.current.text,
				stored: storedDrafts(),
			},
		).toStrictEqual(
			{
				text: "",
				stored:
				{
					"ccp-composer-draft:session-alice": JSON.stringify(
						{
							text: "Continue Alice's test",
						},
					),
				},
			},
		);
	});

	it("keeps working when storage throws", () =>
	{
		vi.useFakeTimers();
		vi.spyOn(storage, "getItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		vi.spyOn(storage, "setItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});
		vi.spyOn(storage, "removeItem").mockImplementation(() =>
		{
			throw new Error("denied");
		});

		const {result} = renderHook(() => useComposerDraft("session-alice"));
		act(() =>
		{
			result.current.setText("Continue Alice's test");
		});
		act(() =>
		{
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});
		const typed = result.current.text;
		act(() =>
		{
			result.current.clear();
		});

		expect(
			{
				typed,
				cleared: result.current.text,
			},
		).toStrictEqual(
			{
				typed: "Continue Alice's test",
				cleared: "",
			},
		);
	});
});

describe("failedSend draft marker", () =>
{
	it("restores the text of a draft that carries a failedSend marker", () =>
	{
		storage.setItem(
			"ccp-composer-draft:session-alice",
			JSON.stringify(
				{
					text: "hi",
					failedSend: "hi",
				},
			),
		);

		const {result} = renderHook(() => useComposerDraft("session-alice"));

		expect(
			{
				text: result.current.text,
				failedSend: readFailedSend("session-alice"),
			},
		).toStrictEqual(
			{
				text: "hi",
				failedSend: "hi",
			},
		);
	});

	it("reports a failed send only while the draft text still equals it", () =>
	{
		storage.setItem(
			"ccp-composer-draft:session-alice",
			JSON.stringify(
				{
					text: "hi edited",
					failedSend: "hi",
				},
			),
		);
		storage.setItem(
			"ccp-composer-draft:session-bob",
			JSON.stringify(
				{
					text: "hi",
				},
			),
		);

		expect(
			{
				edited: readFailedSend("session-alice"),
				unmarked: readFailedSend("session-bob"),
				missing: readFailedSend("session-carol"),
			},
		).toStrictEqual(
			{
				edited: null,
				unmarked: null,
				missing: null,
			},
		);
	});

	it("writes the marker, keeps it through an equal write and drops it once the text changes", () =>
	{
		vi.useFakeTimers();
		const {result} = renderHook(() => useComposerDraft("session-bob"));

		act(() =>
		{
			markFailedSend("session-bob", "hi");
		});
		const marked = storedDrafts();
		act(() =>
		{
			result.current.setText("hi");
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});
		const unchanged = storedDrafts();
		act(() =>
		{
			result.current.setText("hi edited");
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});
		const edited = storedDrafts();
		act(() =>
		{
			result.current.setText("hi");
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});

		expect(
			{
				marked,
				unchanged,
				edited,
				editedBack: storedDrafts(),
			},
		).toStrictEqual(
			{
				marked:
				{
					"ccp-composer-draft:session-bob": JSON.stringify(
						{
							text: "hi",
							failedSend: "hi",
						},
					),
				},
				unchanged:
				{
					"ccp-composer-draft:session-bob": JSON.stringify(
						{
							text: "hi",
							failedSend: "hi",
						},
					),
				},
				edited:
				{
					"ccp-composer-draft:session-bob": JSON.stringify(
						{
							text: "hi edited",
						},
					),
				},
				editedBack:
				{
					"ccp-composer-draft:session-bob": JSON.stringify(
						{
							text: "hi",
						},
					),
				},
			},
		);
	});
});

describe("rejected prompt merged into a stored draft", () =>
{
	it("puts the rejected prompt above newer stored text, marking failedSend only when nothing else is there", () =>
	{
		storage.setItem(
			"ccp-composer-draft:session-alice",
			JSON.stringify(
				{
					text: "newer",
				},
			),
		);

		markFailedSend("session-alice", "hi");
		markFailedSend("session-bob", "hi");
		storeRejectedDraft("session-carol", "hi");
		storage.setItem(
			"ccp-composer-draft:session-dave",
			JSON.stringify(
				{
					text: "newer",
					bashMode: true,
				},
			),
		);
		storeRejectedDraft("session-dave", "hi");

		expect(storedDrafts()).toStrictEqual(
			{
				"ccp-composer-draft:session-alice": JSON.stringify(
					{
						text: "hi\n\nnewer",
					},
				),
				"ccp-composer-draft:session-bob": JSON.stringify(
					{
						text: "hi",
						failedSend: "hi",
					},
				),
				"ccp-composer-draft:session-carol": JSON.stringify(
					{
						text: "hi",
					},
				),
				"ccp-composer-draft:session-dave": JSON.stringify(
					{
						text: "hi\n\nnewer",
					},
				),
			},
		);
	});

	it("doesn't add the prompt twice when the stored draft already starts with it", () =>
	{
		storeRejectedDraft("session-alice", "hi");
		markFailedSend("session-alice", "hi");

		expect(storedDrafts()).toStrictEqual(
			{
				"ccp-composer-draft:session-alice": JSON.stringify(
					{
						text: "hi",
						failedSend: "hi",
					},
				),
			},
		);
	});
});

describe("oversized stored draft demoted to a Saved draft chip", () =>
{
	const big = "a".repeat(1_000_001);

	function chipsOf(sessionId: string): unknown[]
	{
		return getContextChips(sessionId).map(({id: _id, ...chip}) => chip);
	}

	it("restores a draft over 1,000,000 chars as a saved-draft chip, dropping failedSend and bashMode", () =>
	{
		storage.setItem(
			"ccp-composer-draft:s1",
			JSON.stringify(
				{
					text: big,
					failedSend: big,
					bashMode: true,
				},
			),
		);

		const {result} = renderHook(() => useComposerDraft("s1"));

		expect(
			{
				text: result.current.text,
				bashMode: result.current.bashMode,
				chips: chipsOf("s1"),
				stored: storedDrafts(),
			},
		).toStrictEqual(
			{
				text: "",
				bashMode: false,
				chips: [
					{
						kind: "saved-draft",
						text: big,
					},
				],
				stored:
				{
					"ccp-composer-attachments:s1": JSON.stringify([
						{
							kind: "saved-draft",
							text: big,
						},
					]),
				},
			},
		);
	});

	it("keeps a draft of exactly 1,000,000 chars inline", () =>
	{
		const limit = "a".repeat(1_000_000);
		storage.setItem(
			"ccp-composer-draft:s1",
			JSON.stringify(
				{
					text: limit,
				},
			),
		);

		const {result} = renderHook(() => useComposerDraft("s1"));

		expect(
			{
				length: result.current.text.length,
				chips: chipsOf("s1"),
			},
		).toStrictEqual(
			{
				length: 1_000_000,
				chips: [],
			},
		);
	});

	it("brings back the tiles saved before the reload ahead of the demoted draft, and never stages it twice", () =>
	{
		storage.setItem(
			"ccp-composer-attachments:s1",
			JSON.stringify([
				{
					kind: "excerpt",
					text: "Carol's quote",
				},
				{
					kind: "saved-draft",
					text: big,
				},
			]),
		);
		storage.setItem(
			"ccp-composer-draft:s1",
			JSON.stringify(
				{
					text: big,
				},
			),
		);

		renderHook(() => useComposerDraft("s1"));

		expect(chipsOf("s1")).toStrictEqual([
			{
				kind: "excerpt",
				text: "Carol's quote",
			},
			{
				kind: "saved-draft",
				text: big,
			},
		]);
	});

	it("doesn't demote text typed past the limit while mounted", () =>
	{
		vi.useFakeTimers();
		const {result} = renderHook(() => useComposerDraft("s1"));

		act(() =>
		{
			result.current.setText(big);
			vi.advanceTimersByTime(COMPOSER_DRAFT_DEBOUNCE_MS);
		});

		expect(
			{
				length: result.current.text.length,
				chips: chipsOf("s1"),
			},
		).toStrictEqual(
			{
				length: 1_000_001,
				chips: [],
			},
		);
	});
});

describe("Composer draft persistence", () =>
{
	it("restores the draft and clears it after a send", () =>
	{
		storage.setItem(
			"ccp-composer-draft:session-alice",
			JSON.stringify(
				{
					text: "Continue Alice's test",
				},
			),
		);
		const onSend = vi.fn<(prompt: string) => void>();
		render(<Composer variant="session" draftKey="session-alice" onSend={onSend} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
		const restored = textarea.value;

		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				restored,
				sends: onSend.mock.calls,
				value: textarea.value,
				stored: storedDrafts(),
			},
		).toStrictEqual(
			{
				restored: "Continue Alice's test",
				sends: [["Continue Alice's test", {}]],
				value: "",
				stored: {},
			},
		);
	});

	it("persists typed text for the next mount", () =>
	{
		vi.useFakeTimers();
		const {unmount} = render(
			<Composer
				variant="home"
				draftKey="home"
				onSend={() =>
				{
				}}
			/>,
		);
		fireEvent.change(
			screen.getByRole(
				"textbox",
				{
					name: "Prompt",
				},
			),
			{
				target:
				{
					value: "Describe Bob's task",
				},
			},
		);
		unmount();
		render(
			<Composer
				variant="home"
				draftKey="home"
				onSend={() =>
				{
				}}
			/>,
		);

		expect(
			screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			).value,
		).toBe("Describe Bob's task");
	});
});
