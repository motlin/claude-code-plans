// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {ThinkingStep} from "../src/components/thinking-step";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import type {TranscriptMode} from "../src/lib/transcript-mode";
import {processTranscript} from "../src/lib/transcript";

let showDebug = false;

vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug,
			codeThemeLight: "claude-light",
			codeThemeDark: "claude-dark",
		},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => (
{
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => (
{
	useClaudeEvents: () => (
	{
		failedTools: new Map(),
	}),
}));

class NoopResizeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
	takeRecords(): ResizeObserverEntry[]
	{
		return [];
	}
}

globalThis.ResizeObserver = NoopResizeObserver;

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

const THINKING = "Fabricated reasoning about the next step\nSecond line of reasoning";
const SUMMARY = "Fabricated reasoning about the next step";

interface RenderOptions
{
	showDebug?: boolean;
	thinkingDurationMs?: number;
	thinking?: string;
	thinkingDisplay?: "omitted" | "updates" | "summarized";
	showThinking?: boolean;
	transcriptMode?: TranscriptMode;
	turnInProgress?: boolean;
	toast?: (options: ToastOptions) => void;
}

function chatFor(options: RenderOptions)
{
	showDebug = options.showDebug ?? false;
	const {lines, toolResultMap} = processTranscript([
		{
			type: "assistant",
			uuid: "a1",
			...(options.thinkingDurationMs === undefined
				? {}
				:
					{
						thinkingDurationMs: options.thinkingDurationMs,
					}),
			...(options.thinkingDisplay === undefined
				? {}
				:
					{
						thinkingDisplay: options.thinkingDisplay,
					}),
			message:
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: options.thinking ?? THINKING,
					},
				],
			},
		},
	]);
	const chat = (
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
			showThinking={options.showThinking ?? true}
			{...(options.transcriptMode === undefined
				? {}
				:
					{
						transcriptMode: options.transcriptMode,
					})}
			{...(options.turnInProgress === undefined
				? {}
				:
					{
						turnInProgress: options.turnInProgress,
					})}
		/>
	);
	return options.toast === undefined ? (
		chat
	) : (
		<ToastContext.Provider value={options.toast}>{chat}</ToastContext.Provider>
	);
}

function renderThinking(options: RenderOptions = {}): HTMLElement
{
	return render(chatFor(options)).container;
}

function step(): HTMLElement
{
	const element = document.querySelector<HTMLElement>('[data-cds="TurnStatusStep"]');
	if (element === null) throw new Error("no thinking step");
	return element;
}

function row(): HTMLElement
{
	const element = step().querySelector<HTMLElement>("[data-cds-row]");
	if (element === null) throw new Error("no step row");
	return element;
}

function toggle(): HTMLButtonElement
{
	const element = row().querySelector<HTMLButtonElement>(":scope > button[data-cds-row-toggle]");
	if (element === null) throw new Error("no row toggle");
	return element;
}

function panel(): HTMLElement | null
{
	return step().querySelector<HTMLElement>("[data-cds-row-panel]");
}

function scope(): HTMLElement
{
	const element = step().querySelector<HTMLElement>("[data-cds-actions-scope]");
	if (element === null) throw new Error("no actions scope");
	return element;
}

function tokens(element: Element | null | undefined): string[]
{
	return (element?.getAttribute("class") ?? "").split(" ").filter((token) => token !== "");
}

function hasTokens(element: Element | null | undefined, wanted: string): boolean
{
	const have = tokens(element);
	return wanted.split(" ").every((token) => have.includes(token));
}

function openStep(): void
{
	fireEvent.click(toggle());
}

/** The label's MorphSlot, which carries the label id the toggle is labelled by. */
function labelSlot(): Element | null | undefined
{
	return row().querySelector('span[dir="auto"]')?.closest("[data-morph-key]")?.parentElement;
}

function closedState()
{
	const label = row().querySelector('span[dir="auto"]');
	return {
		closed: step().hasAttribute("data-closed"),
		open: step().hasAttribute("data-open"),
		rowTokens: hasTokens(row(), "items-center select-none relative isolate rounded"),
		rowTitle: row().getAttribute("data-cds-row-title"),
		openText: row().hasAttribute("data-cds-open-text"),
		label: label?.textContent,
		stretched: toggle().hasAttribute("data-cds-row-toggle-stretched"),
		expanded: toggle().getAttribute("aria-expanded"),
		panel: panel(),
	};
}

const CLOSED_STATE =
{
	closed: true,
	open: false,
	rowTokens: true,
	rowTitle: SUMMARY,
	openText: false,
	label: SUMMARY,
	stretched: true,
	expanded: "false",
	panel: null,
};

describe("thinking step, closed", () =>
{
	// A `thinkingDisplay: "summarized"` turn carries summarized thinking text; upstream draws it like any thinking.
	it.each([undefined, "summarized" as const])(
		"is a closed TurnStatusStep whose row is labelled with the thinking's summary line (thinkingDisplay %s)",
		(thinkingDisplay) =>
		{
			renderThinking(
				thinkingDisplay === undefined
					? {}
					:
						{
							thinkingDisplay,
						},
			);

			expect(
				{
					cds: step().getAttribute("data-cds"),
					state: step().getAttribute("data-state"),
					...closedState(),
				},
			).toStrictEqual(
				{
					cds: "TurnStatusStep",
					state: "done",
					...CLOSED_STATE,
				},
			);
		},
	);

	it("draws the label in rest ink that turns secondary on row hover or focus, clipped to one line", () =>
	{
		renderThinking();
		const label = row().querySelector('span[dir="auto"]');

		expect(label?.className).toBe(
			"min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap py-[0.125em] -my-[0.125em] text-secondary group-hover/step:text-secondary group-has-[:focus-visible]/step:text-secondary group-focus-visible/step:text-secondary",
		);
	});

	it("draws no legacy chrome: no Thought process or Thought for text, no italic, no left rail", () =>
	{
		const container = renderThinking(
			{
				thinkingDurationMs: 1200,
			},
		);

		expect(
			{
				thoughtProcess: screen.queryAllByText(/Thought process/).length,
				thoughtFor: screen.queryAllByText(/^Thought for/).length,
				italic: container.querySelectorAll(".italic").length,
				rail: container.querySelectorAll(".border-l-2").length,
			},
		).toStrictEqual(
			{
				thoughtProcess: 0,
				thoughtFor: 0,
				italic: 0,
				rail: 0,
			},
		);
	});

	it("makes the row one stretched toggle placed last, labelled by the label, with upstream's caret turned to point right", () =>
	{
		renderThinking();
		const labelId = labelSlot()?.id;
		const caret = toggle().querySelector('[data-cds="Icon"]');

		expect(
			{
				labelId: labelId?.endsWith("-label"),
				labelledBy: toggle().getAttribute("aria-labelledby"),
				owns: toggle().getAttribute("aria-owns"),
				className: toggle().className,
				caretInk: caret?.parentElement?.className,
				caret: caret?.getAttribute("class"),
				caretOpen: caret?.hasAttribute("data-open"),
				caretPath: caret?.querySelector("path")?.getAttribute("d"),
				caretStyle:
				{
					width: caret?.getAttribute("width"),
					contain: (caret as SVGElement | null)?.style.contain,
					pointerEvents: (caret as SVGElement | null)?.style.pointerEvents,
					translate: (caret as SVGElement | null)?.style.translate,
				},
			},
		).toStrictEqual(
			{
				labelId: true,
				labelledBy: labelId,
				owns: labelId,
				className:
					"cds-reset -ms-1 inline-flex h-[1lh] shrink-0 items-center self-start border-0 bg-transparent p-0 outline-none focus-visible:outline-hidden static justify-center after:absolute after:inset-0 after:rounded after:content-[''] after:transition-shadow after:duration-[60ms] focus-visible:after:[box-shadow:inset_0_0_0_1px_var(--cds-fill-accent)] order-last",
				caretInk:
					"inline-flex h-[1lh] items-center justify-center text-secondary group-hover/step:text-secondary group-has-[:focus-visible]/step:text-secondary",
				caret: "transition-transform duration-[60ms] motion-reduce:transition-none -rotate-90 page-rtl:rotate-90",
				caretOpen: false,
				caretPath: "M7.8 9.9 12 14.1l4.2-4.2",
				caretStyle:
				{
					width: "1em",
					contain: "layout paint",
					pointerEvents: "none",
					translate: "0px 0.5px",
				},
			},
		);
	});

	it("turns the caret down and marks it open once the step opens", () =>
	{
		renderThinking();
		openStep();
		const caret = toggle().querySelector('[data-cds="Icon"]');

		expect(
			{
				caret: caret?.getAttribute("class"),
				caretOpen: caret?.getAttribute("data-open"),
			},
		).toStrictEqual(
			{
				caret: "transition-transform duration-[60ms] motion-reduce:transition-none",
				caretOpen: "",
			},
		);
	});

	it("holds the label in upstream's MorphSlot, keyed by state and label, so busy swaps to done in place", () =>
	{
		const props =
		{
			text: "Weighing options\nmore",
			open: false,
			onOpenChange: () =>
			{
			},
		};
		const {rerender} = render(<ThinkingStep {...props} live />);
		const faces = () =>
			[...(labelSlot()?.querySelectorAll("[data-morph-key]") ?? [])].map((face) =>
				face.getAttribute("data-morph-key"),
			);
		const busy =
		{
			slotClass: labelSlot()?.className,
			faces: faces(),
			shimmer: labelSlot()?.querySelectorAll('[data-cds="ShimmerText"]').length,
		};
		rerender(<ThinkingStep {...props} />);

		expect(
			{
				busy,
				done:
				{
					slotClass: labelSlot()?.className,
					faces: faces(),
					shimmer: labelSlot()?.querySelectorAll('[data-cds="ShimmerText"]').length,
				},
			},
		).toStrictEqual(
			{
				busy:
				{
					slotClass:
						"group/morph inline-grid items-center justify-items-start data-[gliding]:overflow-x-clip min-w-0 max-w-full",
					faces: ["busy|Weighing options"],
					shimmer: 1,
				},
				done:
				{
					slotClass:
						"group/morph inline-grid items-center justify-items-start data-[gliding]:overflow-x-clip min-w-0 max-w-full",
					faces: ["done|Weighing options"],
					shimmer: 0,
				},
			},
		);
	});

	it("keeps the thinking duration as the row's title", () =>
	{
		renderThinking(
			{
				thinkingDurationMs: 2600,
			},
		);

		expect(row().getAttribute("title")).toBe("Thought for 2.6s");
	});

	it.each([
		[400, "Thought for 0.4s"],
		[59_940, "Thought for 59.9s"],
		[65_000, "Thought for 1m 5s"],
	])("formats a %i ms thinking duration as the title %s", (thinkingDurationMs, expected) =>
	{
		renderThinking(
			{
				thinkingDurationMs,
			},
		);

		expect(row().getAttribute("title")).toBe(expected);
	});

	it("has no row title when the turn has no thinking duration", () =>
	{
		renderThinking();

		expect(row().hasAttribute("title")).toBe(false);
	});

	it("labels the row with the first line's text once its markdown markers go", () =>
	{
		renderThinking(
			{
				thinking: "\n## Plan the **work**\nmore",
			},
		);

		expect(row().querySelector('span[dir="auto"]')?.textContent).toBe("Plan the work");
	});
});

describe("thinking step, opened in place", () =>
{
	it("swaps the label for the body inside the row and moves the toggle to the row's end", () =>
	{
		renderThinking();
		openStep();
		const textSpan = row().firstElementChild;
		const body = panel();

		expect(
			{
				open: step().hasAttribute("data-open"),
				expanded: toggle().getAttribute("aria-expanded"),
				panelOpen: toggle().hasAttribute("data-panel-open"),
				controls: toggle().getAttribute("aria-controls"),
				panelId: body?.id,
				owns: toggle().hasAttribute("aria-owns"),
				textId: textSpan?.id.endsWith("-text"),
				textClass: textSpan?.className,
				panelParent: body?.parentElement === row(),
				panelLast: row().lastElementChild === body,
				panelClass: body?.className,
				stretched: toggle().hasAttribute("data-cds-row-toggle-stretched"),
				toggleClass: toggle().className,
				rowItemsStart: hasTokens(row(), "items-start"),
				rowItemsCenter: hasTokens(row(), "items-center"),
				rowSelectNone: hasTokens(row(), "select-none"),
				rowTitle: row().hasAttribute("data-cds-row-title"),
				openText: row().getAttribute("data-cds-open-text"),
			},
		).toStrictEqual(
			{
				open: true,
				expanded: "true",
				panelOpen: true,
				controls: body?.id,
				panelId: body?.id,
				owns: false,
				textId: true,
				textClass: "min-w-0 gap-xs items-start hidden",
				panelParent: true,
				panelLast: true,
				panelClass:
					"break-words ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[ending-style]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[animating]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[starting-style]:contain-layout data-[ending-style]:contain-layout data-[animating]:contain-layout [--cds-disclosure-panel-height:var(--collapsible-panel-height)] h-auto overflow-visible transition-none duration-0 data-[ending-style]:h-auto data-[starting-style]:h-auto order-first min-w-0 flex-1",
				stretched: false,
				toggleClass:
					"cds-reset -ms-1 inline-flex h-[1lh] shrink-0 items-center self-start border-0 bg-transparent p-0 outline-none focus-visible:outline-hidden min-w-[1lh] justify-end rounded transition-shadow duration-[60ms] focus-visible:shadow-focus order-last",
				rowItemsStart: true,
				rowItemsCenter: false,
				rowSelectNone: false,
				rowTitle: false,
				openText: "",
			},
		);
	});

	it("puts the body in a line-spaced actions scope with the Thinking actions toolbar on its first line", () =>
	{
		renderThinking();
		openStep();
		const actions = scope().lastElementChild;
		const toolbar = actions?.firstElementChild;

		expect(
			{
				scopeClass: scope().className,
				actionsClass: actions?.className,
				cds: toolbar?.getAttribute("data-cds"),
				reveal: toolbar?.getAttribute("data-reveal"),
				role: toolbar?.getAttribute("role"),
				label: toolbar?.getAttribute("aria-label"),
				size: toolbar?.getAttribute("data-size"),
				tabIndex: toolbar?.getAttribute("tabindex"),
				toolbarClass: toolbar?.className,
				buttons: Array.from(toolbar?.querySelectorAll("button") ?? []).map((button) => (
				{
					label: button.getAttribute("aria-label"),
					tabIndex: button.getAttribute("tabindex"),
				})),
			},
		).toStrictEqual(
			{
				scopeClass:
					"flex min-w-0 items-start gap-xs font-sans text-body font-normal text-secondary not-italic [--cds-assistant-message-text-inset:0px] [--cds-assistant-message-text-stop:0px]",
				actionsClass: "flex h-[1lh] shrink-0 items-center",
				cds: "MessageActions",
				reveal: "fade",
				role: "toolbar",
				label: "Thinking actions",
				size: "xs",
				tabIndex: "-1",
				toolbarClass:
					"flex items-center select-none [&_button:hover:not([aria-pressed=true]):not(:disabled)]:text-primary touch:flex-wrap touch:[--cds-h-control--xs:calc(2rem*var(--cds-rem-scale,1))] touch:h-auto touch:min-h-[calc(1.5rem*var(--cds-rem-scale,1))] touch:gap-y-[calc(0.5rem*var(--cds-rem-scale,1))] touch:*:-my-[calc(0.25rem*var(--cds-rem-scale,1))] focus-visible:rounded outline-none focus-visible:outline-hidden forced-colors:focus-visible:-outline-offset-2 focus-visible:[box-shadow:inset_0_0_0_var(--cds-ring-focus-width,1px)_var(--cds-fill-accent,Highlight)]",
				buttons: [
					{
						label: "Copy as quote",
						tabIndex: "0",
					},
				],
			},
		);
	});

	it("keeps focus on the toggle as it opens, and Enter closes it again with focus still there", async () =>
	{
		renderThinking();
		toggle().focus();
		openStep();
		const focusedAfterOpen = document.activeElement === toggle();

		const button = toggle();
		fireEvent.keyDown(
			button,
			{
				key: "Enter",
			},
		);
		fireEvent.click(button);
		await waitFor(() =>
		{
			expect(panel()).toBeNull();
		});

		expect(
			{
				focusedAfterOpen,
				focusedAfterClose: document.activeElement === toggle(),
				...closedState(),
			},
		).toStrictEqual(
			{
				focusedAfterOpen: true,
				focusedAfterClose: true,
				...CLOSED_STATE,
			},
		);
	});

	it("closes when its open text's first line is clicked, handing focus from the body to the row toggle", async () =>
	{
		renderThinking();
		openStep();
		vi.spyOn(row(), "getBoundingClientRect").mockReturnValue(
			DOMRect.fromRect(
				{
					x: 0,
					y: 100,
					width: 300,
					height: 60,
				},
			),
		);
		screen.getByLabelText("Copy as quote").focus();
		const firstLine = scope().querySelector("p");
		if (firstLine === null) throw new Error("no body paragraph");
		fireEvent.pointerDown(
			firstLine,
			{
				clientX: 20,
				clientY: 100,
				pointerType: "mouse",
			},
		);
		fireEvent.click(
			firstLine,
			{
				clientX: 20,
				clientY: 100,
				detail: 1,
			},
		);
		await waitFor(() =>
		{
			expect(panel()).toBeNull();
		});

		expect(
			{
				focusedToggle: document.activeElement === toggle(),
				...closedState(),
			},
		).toStrictEqual(
			{
				focusedToggle: true,
				...CLOSED_STATE,
			},
		);
	});

	it("renders the body as markdown in secondary, non-italic body type", () =>
	{
		renderThinking(
			{
				thinking: "Check **this** and `code`\n\n- one\n- two",
			},
		);
		openStep();
		const body = scope().firstElementChild;

		expect(
			{
				bodyClass: body?.className,
				proseSize: body?.getAttribute("data-prose-size"),
				strong: body?.querySelector("strong")?.textContent,
				code: body?.querySelector("code")?.textContent,
				items: body?.querySelectorAll("ul > li").length,
				ink: hasTokens(scope(), "text-secondary not-italic"),
				legacyInk: hasTokens(scope(), "text-t6") || hasTokens(scope(), "italic"),
			},
		).toStrictEqual(
			{
				bodyClass: "min-w-0 flex-1",
				proseSize: "inherit",
				strong: "this",
				code: "code",
				items: 2,
				ink: true,
				legacyInk: false,
			},
		);
	});

	it("adds the debug link to the toolbar after the copy button", () =>
	{
		renderThinking(
			{
				showDebug: true,
			},
		);
		openStep();
		const toolbar = scope().querySelector('[role="toolbar"]');

		expect(
			Array.from(toolbar?.querySelectorAll("a, button") ?? []).map(
				(element) => element.getAttribute("aria-label") ?? element.getAttribute("href"),
			),
		).toStrictEqual(["Copy as quote", "/session/test-session/source/a1"]);
	});
});

describe("thinking step, copy as quote", () =>
{
	function stubClipboard()
	{
		const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => {});
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				value:
				{
					writeText,
				},
				configurable: true,
			},
		);
		return writeText;
	}

	it("copies the thinking text as a markdown quote", () =>
	{
		const writeText = stubClipboard();
		renderThinking();
		openStep();

		fireEvent.click(screen.getByLabelText("Copy as quote"));

		expect(writeText.mock.calls).toStrictEqual([
			["> **Thinking** (~16 tok)\n>\n> Fabricated reasoning about the next step\n> Second line of reasoning"],
		]);
	});

	it("quotes empty thinking lines as a bare > under the token-estimate header", () =>
	{
		const writeText = stubClipboard();
		renderThinking(
			{
				thinking: "a\n\nb",
			},
		);
		openStep();

		fireEvent.click(screen.getByLabelText("Copy as quote"));

		expect(writeText.mock.calls).toStrictEqual([["> **Thinking** (~1 tok)\n>\n> a\n>\n> b"]]);
	});

	it("splits the quote's lines on CR, CRLF, U+2028 and U+2029 as well as LF", () =>
	{
		const writeText = stubClipboard();
		renderThinking(
			{
				thinking: "a\r\nb\u2028\u2029c",
			},
		);
		openStep();

		fireEvent.click(screen.getByLabelText("Copy as quote"));

		expect(writeText.mock.calls).toStrictEqual([["> **Thinking** (~2 tok)\n>\n> a\n> b\n>\n> c"]]);
	});

	it("shows a Copied success toast after copying the thinking quote", async () =>
	{
		stubClipboard();
		const toast = vi.fn<(options: ToastOptions) => void>();
		renderThinking(
			{
				toast,
			},
		);
		openStep();

		await act(async () =>
		{
			fireEvent.click(screen.getByLabelText("Copy as quote"));
			await Promise.resolve();
		});

		expect(toast.mock.calls).toStrictEqual([
			[
				{
					message: "Copied",
					kind: "success",
				},
			],
		]);
	});

	it("relabels the thinking quote button Copied with a check icon for 2000ms after a click", async () =>
	{
		vi.useFakeTimers();
		try
		{
			stubClipboard();
			renderThinking();
			openStep();
			const button = screen.getByLabelText("Copy as quote");
			const state = () => (
			{
				ariaLabel: button.getAttribute("aria-label"),
				icon: button.querySelector("svg")?.innerHTML,
			});
			const idle = state();

			await act(async () =>
			{
				fireEvent.click(button);
				await Promise.resolve();
			});
			const copied = state();
			act(() =>
			{
				vi.advanceTimersByTime(1999);
			});
			const beforeReset = state();
			act(() =>
			{
				vi.advanceTimersByTime(1);
			});

			expect(
				{
					idle,
					copied,
					beforeReset,
					reset: state(),
				},
			).toStrictEqual(
				{
					idle:
					{
						ariaLabel: "Copy as quote",
						icon: idle.icon,
					},
					copied:
					{
						ariaLabel: "Copied",
						icon: copied.icon,
					},
					beforeReset:
					{
						ariaLabel: "Copied",
						icon: copied.icon,
					},
					reset:
					{
						ariaLabel: "Copy as quote",
						icon: idle.icon,
					},
				},
			);
			expect(copied.icon).not.toBe(idle.icon);
		}
		finally
		{
			vi.useRealTimers();
		}
	});
});

describe("thinking step, live and without a summary", () =>
{
	it("draws a live block busy: the summary so far shimmers, a running cue labels the stretched toggle", () =>
	{
		renderThinking(
			{
				thinking: "Weighing options\nmore",
				turnInProgress: true,
			},
		);
		const label = row().querySelector('[data-cds="ShimmerText"]');
		const busy = row().querySelector("span.sr-only");
		const labelId = labelSlot()?.id;

		expect(
			{
				state: step().getAttribute("data-state"),
				label: label?.firstChild?.textContent,
				labelDir: label?.getAttribute("dir"),
				busy: busy?.textContent,
				busyId: busy?.id.endsWith("-busy"),
				labelledBy: toggle().getAttribute("aria-labelledby"),
				stretched: toggle().hasAttribute("data-cds-row-toggle-stretched"),
				last: hasTokens(toggle(), "order-last"),
			},
		).toStrictEqual(
			{
				state: "busy",
				label: "Weighing options",
				labelDir: "auto",
				busy: "running",
				busyId: true,
				labelledBy: `${labelId} ${busy?.id}`,
				stretched: true,
				last: false,
			},
		);
	});

	it("opens a live block below its row", () =>
	{
		renderThinking(
			{
				thinking: "Weighing options\nmore",
				turnInProgress: true,
			},
		);
		openStep();
		const body = panel();

		expect(
			{
				afterRow: body?.previousElementSibling === row(),
				inRow: body?.parentElement === row(),
				openText: row().hasAttribute("data-cds-open-text"),
				panelInset: hasTokens(body, "ps-[var(--cds-assistant-message-text-inset,0px)]"),
				panelInPlace: hasTokens(body, "order-first"),
				scopePad: hasTokens(scope(), "pt-xs"),
				labelShown: !hasTokens(row().firstElementChild, "hidden"),
			},
		).toStrictEqual(
			{
				afterRow: true,
				inRow: false,
				openText: false,
				panelInset: true,
				panelInPlace: false,
				scopePad: true,
				labelShown: true,
			},
		);
	});

	it("settles once the turn ends", () =>
	{
		renderThinking(
			{
				thinking: "Weighing options\nmore",
				turnInProgress: false,
			},
		);

		expect(
			{
				state: step().getAttribute("data-state"),
				shimmer: row().querySelectorAll('[data-cds="ShimmerText"]').length,
				busy: row().querySelectorAll("span.sr-only").length,
			},
		).toStrictEqual(
			{
				state: "done",
				shimmer: 0,
				busy: 0,
			},
		);
	});

	it("labels a block with no content line Thinking… and opens it below its row", () =>
	{
		renderThinking(
			{
				thinking: "```\n```",
			},
		);
		const lastBeforeOpen = hasTokens(toggle(), "order-last");
		openStep();
		const body = panel();

		expect(
			{
				label: row().querySelector('span[dir="auto"]')?.textContent,
				lastBeforeOpen,
				afterRow: body?.previousElementSibling === row(),
				inRow: body?.parentElement === row(),
			},
		).toStrictEqual(
			{
				label: "Thinking…",
				lastBeforeOpen: false,
				afterRow: true,
				inRow: false,
			},
		);
	});
});

describe("thinking step, collapse focus return", () =>
{
	it("returns focus from Copy as quote to the row toggle when the toggle collapses the step", () =>
	{
		renderThinking();
		openStep();
		const copy = screen.getByLabelText("Copy as quote");
		copy.focus();
		const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

		fireEvent.click(toggle());

		expect(
			{
				active: document.activeElement === toggle(),
				calls: focusSpy.mock.contexts.map((context) => context === toggle()),
				options: focusSpy.mock.calls,
			},
		).toStrictEqual(
			{
				active: true,
				calls: [true],
				options: [
					[
						{
							preventScroll: true,
						},
					],
				],
			},
		);
	});

	it("returns focus to the row toggle when a Verbose to Normal switch collapses the step", () =>
	{
		const {rerender} = render(
			chatFor(
				{
					transcriptMode: "verbose",
				},
			),
		);
		const copy = screen.getByLabelText("Copy as quote");
		copy.focus();
		const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

		rerender(
			chatFor(
				{
					transcriptMode: "normal",
				},
			),
		);

		expect(
			{
				expanded: toggle().getAttribute("aria-expanded"),
				active: document.activeElement === toggle(),
				calls: focusSpy.mock.contexts.map((context) => context === toggle()),
				options: focusSpy.mock.calls,
			},
		).toStrictEqual(
			{
				expanded: "false",
				active: true,
				calls: [true],
				options: [
					[
						{
							preventScroll: true,
						},
					],
				],
			},
		);
	});
});

describe("thinking step, expansion across views", () =>
{
	function expanded(): string | null
	{
		return toggle().getAttribute("aria-expanded");
	}

	it("forces every step open in Verbose, where the toggle does nothing and stores nothing", () =>
	{
		const {rerender} = render(
			chatFor(
				{
					transcriptMode: "thinking",
				},
			),
		);
		const thinkingDefault = expanded();
		rerender(
			chatFor(
				{
					transcriptMode: "verbose",
				},
			),
		);
		const verbose = expanded();
		fireEvent.click(toggle());
		const verboseAfterClick = expanded();
		rerender(
			chatFor(
				{
					transcriptMode: "thinking",
				},
			),
		);

		expect(
			{
				thinkingDefault,
				verbose,
				verboseAfterClick,
				thinkingAgain: expanded(),
			},
		).toStrictEqual(
			{
				thinkingDefault: "false",
				verbose: "true",
				verboseAfterClick: "true",
				thinkingAgain: "false",
			},
		);
	});

	it("keeps a step the user opened in the Thinking view open after a Verbose round trip", () =>
	{
		const {rerender} = render(
			chatFor(
				{
					transcriptMode: "thinking",
				},
			),
		);
		openStep();
		rerender(
			chatFor(
				{
					transcriptMode: "verbose",
				},
			),
		);
		rerender(
			chatFor(
				{
					transcriptMode: "thinking",
				},
			),
		);

		expect(expanded()).toBe("true");
	});
});

describe("omitted and empty thinking", () =>
{
	it("draws omitted thinking as a label-only Thinking hidden step with the duration as the row's title", () =>
	{
		const container = renderThinking(
			{
				thinking: "",
				thinkingDisplay: "omitted",
				thinkingDurationMs: 871,
			},
		);
		const label = row().querySelector('span[dir="auto"]');

		expect(
			{
				cds: step().getAttribute("data-cds"),
				state: step().getAttribute("data-state"),
				rowTokens: hasTokens(row(), "group/step items-center select-none relative isolate rounded"),
				title: row().getAttribute("title"),
				label: label?.textContent,
				labelClass: label?.className,
				toggles: container.querySelectorAll("[data-cds-row-toggle]").length,
				panels: container.querySelectorAll("[data-cds-row-panel]").length,
				rail: container.querySelectorAll(".border-l-2").length,
				italic: container.querySelectorAll(".italic").length,
				durations: screen.queryAllByText(/^Thought for/).length,
				copyButtons: container.querySelectorAll('button[aria-label="Copy as quote"]').length,
			},
		).toStrictEqual(
			{
				cds: "TurnStatusStep",
				state: "done",
				rowTokens: true,
				title: "Thought for 0.9s",
				label: "Thinking hidden",
				labelClass:
					"min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap py-[0.125em] -my-[0.125em] text-secondary",
				toggles: 0,
				panels: 0,
				rail: 0,
				italic: 0,
				durations: 0,
				copyButtons: 0,
			},
		);
	});

	it("draws the Thinking hidden step without a row title when the turn has no thinking duration", () =>
	{
		renderThinking(
			{
				thinking: "",
				thinkingDisplay: "omitted",
			},
		);

		expect(
			{
				label: row().textContent,
				title: row().hasAttribute("title"),
			},
		).toStrictEqual(
			{
				label: "Thinking hidden",
				title: false,
			},
		);
	});

	it("hides the omitted-thinking placeholder when thinking is not shown", () =>
	{
		renderThinking(
			{
				thinking: "",
				thinkingDisplay: "omitted",
				thinkingDurationMs: 871,
				showThinking: false,
			},
		);

		expect(screen.queryAllByText("Thinking hidden").length).toBe(0);
	});

	it("draws nothing for empty thinking whose display was not omitted", () =>
	{
		const container = renderThinking(
			{
				thinking: "",
				thinkingDisplay: "updates",
				thinkingDurationMs: 871,
			},
		);

		expect(
			{
				placeholders: screen.queryAllByText("Thinking hidden").length,
				steps: container.querySelectorAll('[data-cds="TurnStatusStep"]').length,
			},
		).toStrictEqual(
			{
				placeholders: 0,
				steps: 0,
			},
		);
	});
});

/** Upstream c6a992d55's row-toggle focus-in selectors, nested-panel exclusion included. */
const ROW_TOGGLE_REVEAL =
	'[data-cds-row]:has([data-cds-row-toggle]:focus-visible) ~ [data-cds-row-panel] [data-cds-actions-scope] [data-cds="MessageActions"][data-reveal]:not(:where([data-cds-row]:has([data-cds-row-toggle]:focus-visible) ~ [data-cds-row-panel] [data-cds-row-panel] [data-cds="MessageActions"][data-reveal])), [data-cds-row] > [data-cds-row-toggle]:focus-visible ~ [data-cds-row-panel] [data-cds-actions-scope] [data-cds="MessageActions"][data-reveal]:not(:where([data-cds-row] > [data-cds-row-toggle]:focus-visible ~ [data-cds-row-panel] [data-cds-row-panel] [data-cds="MessageActions"][data-reveal]))';

/** Upstream c6a992d55's scope hover-in selector: an enclosing scope's hover never reveals a non-hovered inner scope's bar. */
const SCOPE_HOVER_REVEAL =
	'[data-cds-actions-scope]:hover [data-cds="MessageActions"][data-reveal]:not(:where([data-cds-actions-scope]:not(:hover) [data-cds="MessageActions"][data-reveal]))';

/** Upstream c6a992d55's scope focus-in and open-popup selectors. */
const SCOPE_FOCUS_REVEAL =
	'[data-cds-actions-scope]:focus-within [data-cds="MessageActions"][data-reveal]:not(:where([data-cds-actions-scope]:not(:focus-within) [data-cds="MessageActions"][data-reveal])), [data-cds-actions-scope] [data-cds="MessageActions"][data-reveal]:has([data-popup-open])';

describe("thinking actions reveal", () =>
{
	// Whitespace-insensitive: the formatter wraps long selectors inside :not( … ).
	const css = readFileSync("src/styles/globals.css", "utf8")
		.replaceAll(/\s+/g, " ")
		.replaceAll("( ", "(")
		.replaceAll(" )", ")");

	it("hides a step body's actions until the body itself is hovered, then fades them in from hidden after 100ms", () =>
	{
		expect(
			{
				rest: css.includes(
					'[data-cds-actions-scope] [data-cds="MessageActions"][data-reveal] { opacity: 0; transition: opacity 60ms cubic-bezier(0.32, 0.72, 0, 1) 0s; }',
				),
				hover: css.includes(
					`@media (hover: hover) { ${SCOPE_HOVER_REVEAL} { opacity: 1; transition-duration: 120ms; transition-delay: 100ms; } @starting-style { ${SCOPE_HOVER_REVEAL} { opacity: 0; } } }`,
				),
			},
		).toStrictEqual(
			{
				rest: true,
				hover: true,
			},
		);
	});

	it("shows them at once on focus inside the body or the toolbar, or with a popup open, fading in from hidden", () =>
	{
		expect(
			{
				reveal: css.includes(
					`${SCOPE_FOCUS_REVEAL} { opacity: 1; transition-duration: 120ms; transition-delay: 0s; }`,
				),
				startingStyle: css.includes(`@starting-style { ${SCOPE_FOCUS_REVEAL} { opacity: 0; } }`),
			},
		).toStrictEqual(
			{
				reveal: true,
				startingStyle: true,
			},
		);
	});

	it("shows them at once on the row toggle's focus ring, fading in from hidden, but not in a nested step's panel", () =>
	{
		expect(
			{
				reveal: css.includes(
					`${ROW_TOGGLE_REVEAL} { opacity: 1; transition-duration: 120ms; transition-delay: 0s; }`,
				),
				startingStyle: css.includes(`@starting-style { ${ROW_TOGGLE_REVEAL} { opacity: 0; } }`),
			},
		).toStrictEqual(
			{
				reveal: true,
				startingStyle: true,
			},
		);
	});

	it("always shows them on touch and drops the fade under reduced motion", () =>
	{
		expect(
			{
				touch: css.includes(
					'@media (pointer: coarse), (hover: none) { [data-cds-actions-scope] [data-cds="MessageActions"][data-reveal] { opacity: 1; transition-property: none; } }',
				),
				reducedMotion: css.includes(
					'@media (prefers-reduced-motion: reduce) { [data-cds-actions-scope] [data-cds="MessageActions"][data-reveal] { transition-property: none; } }',
				),
			},
		).toStrictEqual(
			{
				touch: true,
				reducedMotion: true,
			},
		);
	});
});

describe("thinking actions, row toggle focus ring", () =>
{
	function renderStep(
		options:
		{
			nested?: boolean;
			actions?: boolean;
		} = {},
	)
	{
		const actions = options.actions ?? true;
		const thinking = (
			<ThinkingStep
				text={"Plan\n\nWeigh the options."}
				open
				onOpenChange={() =>
				{
				}}
				{...(actions
					?
						{
							actions: <button type="button">Copy as quote</button>,
						}
					: {})}
			/>
		);
		const result = render(
			options.nested ? (
				<div>
					<div data-cds-row="">
						<button type="button" data-cds-row-toggle="">
							Worked for 3m
						</button>
					</div>
					<div data-cds-row-panel="">{thinking}</div>
				</div>
			) : (
				thinking
			),
		);
		const toolbar = result.container.querySelector('[data-cds="MessageActions"][data-reveal]');
		const toggles = result.container.querySelectorAll<HTMLButtonElement>("button[data-cds-row-toggle]");
		return {
			container: result.container,
			revealed: () => toolbar?.matches(ROW_TOGGLE_REVEAL) ?? false,
			outer: toggles[0]!,
			inner: toggles[toggles.length - 1]!,
		};
	}

	// jsdom has no input modality (its :focus-visible is :focus), so the mouse-click case rests on the CSS text test
	// pinning :focus-visible in every row-toggle selector.
	it("reveals the toolbar while the row toggle has the focus ring", () =>
	{
		const {revealed, inner} = renderStep();
		const atRest = revealed();
		inner.focus();

		expect(
			{
				atRest,
				focused: revealed(),
			},
		).toStrictEqual(
			{
				atRest: false,
				focused: true,
			},
		);
	});

	it("keeps a nested step's toolbar hidden when the outer row's toggle has the focus ring", () =>
	{
		const {revealed, outer, inner} = renderStep(
			{
				nested: true,
			},
		);
		outer.focus();
		const outerFocused = revealed();
		inner.focus();

		expect(
			{
				outerFocused,
				innerFocused: revealed(),
			},
		).toStrictEqual(
			{
				outerFocused: false,
				innerFocused: true,
			},
		);
	});

	it("draws no actions scope or toolbar for a body without actions", () =>
	{
		const {container} = renderStep(
			{
				actions: false,
			},
		);

		expect(
			{
				scopes: container.querySelectorAll("[data-cds-actions-scope]").length,
				toolbars: container.querySelectorAll('[data-cds="MessageActions"]').length,
			},
		).toStrictEqual(
			{
				scopes: 0,
				toolbars: 0,
			},
		);
	});
});

describe("thinking body prose size", () =>
{
	it("makes prose under data-prose-size=inherit take the step's own size, leading and ink, as upstream's Prose size=inherit", () =>
	{
		const css = readFileSync("src/components/markdown-article.module.css", "utf8").replaceAll(/\s+/g, " ");

		expect(
			css.includes(
				':global([data-prose-size="inherit"]) > .markdown.markdown { --md-prose-size: 1em; --md-prose-leading: 1lh; color: inherit; }',
			),
		).toBe(true);
	});
});
