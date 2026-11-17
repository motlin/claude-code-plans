// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer, type NestedStopFace} from "../src/components/composer";

afterEach(() =>
{
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function stubPointer(coarse: boolean)
{
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => (
		{
			matches: coarse && query === "(pointer: coarse)",
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
}

function nestedStop(overrides: Partial<NestedStopFace> = {}): NestedStopFace
{
	return {
		label: "Stop 2 background agents",
		stopping: false,
		stoppingLabel: "Stopping background agents…",
		onStop: vi.fn<() => void>(),
		...overrides,
	};
}

function renderComposer({
	nested,
	onStop,
	coarse = false,
}: {
	nested?: NestedStopFace | undefined;
	onStop?: (() => void) | undefined;
	coarse?: boolean;
})
{
	stubPointer(coarse);
	const element = (next: {nested?: NestedStopFace | undefined; onStop?: (() => void) | undefined}) => (
		<Composer
			variant="session"
			draftKey="session-alice"
			onSend={() => undefined}
			onStop={next.onStop}
			onQueueForLater={() => undefined}
			nestedStop={next.nested}
		/>
	);
	const view = render(
		element(
			{
				nested,
				onStop,
			},
		),
	);
	const textarea = screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
	return {
		view,
		textarea,
		rerender: (next: {nested?: NestedStopFace | undefined; onStop?: (() => void) | undefined}) =>
		{
			view.rerender(element(next));
		},
	};
}

function faces()
{
	return [...document.querySelectorAll("[data-send-face]:not([inert]) button")].map((button) =>
		button.getAttribute("data-testid"),
	);
}

function type(textarea: HTMLTextAreaElement, value: string)
{
	fireEvent.change(
		textarea,
		{
			target:
			{
				value,
			},
		},
	);
}

describe("Composer nested-session Stop (background agents)", () =>
{
	it("shows upstream's nested Stop face on an idle, empty composer, with no Escape shortcut", () =>
	{
		renderComposer(
			{
				nested: nestedStop(),
			},
		);
		const button = screen.getByTestId("code-prompt-stop-nested");
		expect(
			{
				label: button.getAttribute("aria-label"),
				keyShortcuts: button.getAttribute("aria-keyshortcuts"),
				busy: button.getAttribute("aria-busy"),
				faces: faces(),
			},
		).toStrictEqual(
			{
				label: "Stop 2 background agents",
				keyShortcuts: null,
				busy: null,
				faces: ["code-prompt-stop-nested"],
			},
		);
	});

	it("gives way to Send while there is a draft, and comes back when it is cleared", () =>
	{
		const {textarea} = renderComposer(
			{
				nested: nestedStop(),
			},
		);
		type(textarea, "x");
		const typed = faces();
		type(textarea, "");
		expect(
			{
				typed,
				cleared: faces(),
			},
		).toStrictEqual(
			{
				typed: ["code-prompt-send"],
				cleared: ["code-prompt-stop-nested"],
			},
		);
	});

	it("lets the session's own Stop win while its own turn runs", () =>
	{
		renderComposer(
			{
				nested: nestedStop(),
				onStop: () => undefined,
			},
		);
		expect(
			{
				faces: faces(),
				nested: screen.queryByTestId("code-prompt-stop-nested"),
			},
		).toStrictEqual(
			{
				faces: ["code-prompt-stop"],
				nested: null,
			},
		);
	});

	it("ignores a click within 500ms of the face appearing", () =>
	{
		vi.useFakeTimers();
		const stop = nestedStop();
		renderComposer(
			{
				nested: stop,
			},
		);
		const button = screen.getByTestId("code-prompt-stop-nested");
		fireEvent.click(button);
		const early = vi.mocked(stop.onStop).mock.calls.length;
		act(() =>
		{
			vi.advanceTimersByTime(501);
		});
		fireEvent.click(button);
		expect(
			{
				early,
				late: vi.mocked(stop.onStop).mock.calls.length,
			},
		).toStrictEqual(
			{
				early: 0,
				late: 1,
			},
		);
	});

	it("ignores the own Stop for 500ms after the nested face hands over to it", () =>
	{
		vi.useFakeTimers();
		const onStop = vi.fn<() => void>();
		const {rerender} = renderComposer(
			{
				nested: nestedStop(),
			},
		);
		act(() =>
		{
			vi.advanceTimersByTime(1000);
		});
		rerender(
			{
				nested: nestedStop(),
				onStop,
			},
		);
		const own = screen.getByTestId("code-prompt-stop");
		fireEvent.click(own);
		const early = onStop.mock.calls.length;
		act(() =>
		{
			vi.advanceTimersByTime(501);
		});
		fireEvent.click(own);
		expect(
			{
				early,
				late: onStop.mock.calls.length,
			},
		).toStrictEqual(
			{
				early: 0,
				late: 1,
			},
		);
	});

	it("shows the busy face while stopping and ignores clicks", () =>
	{
		vi.useFakeTimers();
		const stop = nestedStop(
			{
				stopping: true,
			},
		);
		renderComposer(
			{
				nested: stop,
			},
		);
		act(() =>
		{
			vi.advanceTimersByTime(501);
		});
		const button = screen.getByTestId("code-prompt-stop-nested");
		fireEvent.click(button);
		expect(
			{
				label: button.getAttribute("aria-label"),
				busy: button.getAttribute("aria-busy"),
				disabled: button.getAttribute("aria-disabled"),
				spinner: button.querySelector("[data-spinner]") !== null,
				calls: vi.mocked(stop.onStop).mock.calls.length,
			},
		).toStrictEqual(
			{
				label: "Stopping background agents…",
				busy: "true",
				disabled: "true",
				spinner: true,
				calls: 0,
			},
		);
	});

	it("never stops background agents on Escape", () =>
	{
		const stop = nestedStop();
		const {textarea} = renderComposer(
			{
				nested: stop,
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Escape",
			},
		);
		fireEvent.keyDown(
			document,
			{
				key: "Escape",
			},
		);
		expect(vi.mocked(stop.onStop).mock.calls.length).toBe(0);
	});

	it("hands focus back to the prompt when the face goes while it holds focus", () =>
	{
		const {rerender, textarea} = renderComposer(
			{
				nested: nestedStop(),
			},
		);
		screen.getByTestId("code-prompt-stop-nested").focus();
		rerender(
			{
				nested: undefined,
			},
		);
		expect(document.activeElement).toBe(textarea);
	});

	it("never shows the touch split for it: Send with a draft, the nested face without one (send-split-touch T2)", () =>
	{
		const {textarea} = renderComposer(
			{
				nested: nestedStop(),
				coarse: true,
			},
		);
		const empty =
		{
			faces: faces(),
			split: screen.queryByRole(
				"group",
				{
					name: "Send",
				},
			),
		};
		type(textarea, "x");
		expect(
			{
				empty,
				draft:
				{
					faces: faces(),
					split: screen.queryByRole(
						"group",
						{
							name: "Send",
						},
					),
				},
			},
		).toStrictEqual(
			{
				empty:
				{
					faces: ["code-prompt-stop-nested"],
					split: null,
				},
				draft:
				{
					faces: ["code-prompt-send"],
					split: null,
				},
			},
		);
	});
});
