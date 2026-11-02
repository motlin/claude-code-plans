// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {useStepCollapseFocusReturn} from "../src/hooks/use-step-collapse-focus-return";
import {processTranscript} from "../src/lib/transcript";
import type {TranscriptMode} from "../src/lib/transcript-mode";

vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug: false,
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

function Harness({open, withToggle = true}: {open: boolean; withToggle?: boolean})
{
	const {rootRef, panelMounted} = useStepCollapseFocusReturn(open);
	return (
		<div ref={rootRef}>
			<div data-cds-row="">
				{withToggle && (
					<button type="button" data-cds-row-toggle="">
						Toggle
					</button>
				)}
			</div>
			{panelMounted && (
				<div data-cds-row-panel="" hidden={!open}>
					<button type="button">Copy</button>
					<div data-cds-row-panel="">
						<button type="button">Inner</button>
					</div>
				</div>
			)}
		</div>
	);
}

function button(container: HTMLElement, name: string): HTMLButtonElement
{
	const found = [...container.querySelectorAll("button")].find((el) => el.textContent === name);
	if (found === undefined) throw new Error(`No button "${name}"`);
	return found;
}

function spyFocus()
{
	const calls:
	{
		target: Element;
		options: unknown;
	}[] = [];
	const original = HTMLElement.prototype.focus;
	vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options)
	{
		calls.push(
			{
				target: this,
				options,
			},
		);
		original.call(this, options);
	});
	return calls;
}

describe("useStepCollapseFocusReturn", () =>
{
	it("returns focus from the panel to the row toggle, then unmounts the panel", () =>
	{
		const {container, rerender} = render(<Harness open />);
		button(container, "Copy").focus();
		const toggle = button(container, "Toggle");
		const calls = spyFocus();
		act(() =>
		{
			rerender(<Harness open={false} />);
		});
		expect(
			{
				active: document.activeElement === toggle,
				calls,
				panel: container.querySelector("[data-cds-row-panel]"),
			},
		).toStrictEqual(
			{
				active: true,
				calls: [
					{
						target: toggle,
						options:
						{
							preventScroll: true,
						},
					},
				],
				panel: null,
			},
		);
	});

	it("leaves focus alone when it is outside the root", () =>
	{
		const outside = document.createElement("button");
		document.body.append(outside);
		const {rerender} = render(<Harness open />);
		outside.focus();
		const calls = spyFocus();
		act(() =>
		{
			rerender(<Harness open={false} />);
		});
		expect(
			{
				calls,
				active: document.activeElement === outside,
			},
		).toStrictEqual(
			{
				calls: [],
				active: true,
			},
		);
		outside.remove();
	});

	it("returns focus from a nested panel inside the root's first panel", () =>
	{
		const {container, rerender} = render(<Harness open />);
		button(container, "Inner").focus();
		const toggle = button(container, "Toggle");
		const calls = spyFocus();
		act(() =>
		{
			rerender(<Harness open={false} />);
		});
		expect(
			{
				active: document.activeElement === toggle,
				calls,
			},
		).toStrictEqual(
			{
				active: true,
				calls: [
					{
						target: toggle,
						options:
						{
							preventScroll: true,
						},
					},
				],
			},
		);
	});

	it("does nothing on a closed mount and does not throw without a toggle", () =>
	{
		const calls = spyFocus();
		const closed = render(<Harness open={false} />);
		expect(calls).toStrictEqual([]);
		closed.unmount();
		const {container, rerender} = render(<Harness open withToggle={false} />);
		button(container, "Copy").focus();
		calls.length = 0;
		act(() =>
		{
			rerender(<Harness open={false} withToggle={false} />);
		});
		expect(
			{
				calls,
				panel: container.querySelector("[data-cds-row-panel]"),
			},
		).toStrictEqual(
			{
				calls: [],
				panel: null,
			},
		);
	});

	it("makes no extra focus calls when focus already sits on the toggle", () =>
	{
		const {container, rerender} = render(<Harness open />);
		button(container, "Toggle").focus();
		const calls = spyFocus();
		act(() =>
		{
			rerender(<Harness open={false} />);
		});
		act(() =>
		{
			rerender(<Harness open />);
		});
		act(() =>
		{
			rerender(<Harness open={false} />);
		});
		expect(calls).toStrictEqual([]);
	});
});

const USER_PROMPT =
{
	type: "user",
	uuid: "u0",
	message:
	{
		role: "user",
		content: "Search please",
	},
};

/** `count` Bash calls in one assistant turn, each with its own result. */
function toolCallRecords(count: number): unknown[]
{
	const ids = Array.from(
		{
			length: count,
		},
		(_, index) => `t${index + 1}`,
	);
	return [
		{
			type: "assistant",
			uuid: "a1",
			parentUuid: "u0",
			message:
			{
				role: "assistant",
				content: ids.map((id) => (
				{
					type: "tool_use",
					id,
					name: "Bash",
					input:
					{
						command: `echo ${id}`,
					},
				})),
			},
		},
		...ids.map((id) => (
		{
			type: "user",
			uuid: `r-${id}`,
			parentUuid: "a1",
			message:
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						content: `out ${id}`,
					},
				],
			},
		})),
	];
}

function chat(records: unknown[], transcriptMode: TranscriptMode = "normal")
{
	const {lines, toolResultMap} = processTranscript(records);
	return (
		<SessionChat
			sessionId="s1"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
			showThinking
			shouldScrollToEnd={false}
			transcriptMode={transcriptMode}
		/>
	);
}

/** A focusable element inside `scope` that isn't a row toggle (a Bash body has no controls, so make one focusable). */
function focusableIn(scope: Element): HTMLElement
{
	const found = [...scope.querySelectorAll<HTMLElement>("button, [tabindex='0'], a[href]")].find(
		(el) => !el.hasAttribute("data-cds-row-toggle"),
	);
	if (found !== undefined) return found;
	const fallback = scope.querySelector<HTMLElement>("pre, div");
	if (fallback === null) throw new Error("No element in the panel");
	fallback.tabIndex = -1;
	return fallback;
}

describe("SessionChat root-level tool status focus return", () =>
{
	it("returns focus to the group toggle when the group collapses with focus inside", () =>
	{
		const {container} = render(chat([USER_PROMPT, ...toolCallRecords(3)]));
		const groupToggle = container.querySelector<HTMLElement>("[data-turn-status] > [data-cds-row-toggle]")!;
		fireEvent.click(groupToggle);
		const panel = container.querySelector("[data-turn-status] > [data-cds-row-panel]")!;
		const bodyId = panel.id;
		const step = panel.querySelector<HTMLElement>('[role="button"][aria-expanded]')!;
		fireEvent.click(step);
		focusableIn(panel).focus();
		const calls = spyFocus();
		act(() =>
		{
			fireEvent.click(groupToggle);
		});
		expect(
			{
				active: document.activeElement === groupToggle,
				calls,
				body: container.querySelector(`[id="${bodyId}"]`),
			},
		).toStrictEqual(
			{
				active: true,
				calls: [
					{
						target: groupToggle,
						options:
						{
							preventScroll: true,
						},
					},
				],
				body: null,
			},
		);
	});

	it("returns focus to a standalone row's toggle when a mode change collapses it", () =>
	{
		const records = [USER_PROMPT, ...toolCallRecords(1)];
		const {container, rerender} = render(chat(records, "verbose"));
		const panel = container.querySelector("[data-standalone-tool-row] > [data-cds-row-panel]")!;
		const toggle = container.querySelector<HTMLElement>("[data-standalone-tool-row] > [data-cds-row-toggle]")!;
		focusableIn(panel).focus();
		const calls = spyFocus();
		act(() =>
		{
			rerender(chat(records, "normal"));
		});
		expect(
			{
				active: document.activeElement === toggle,
				calls,
			},
		).toStrictEqual(
			{
				active: true,
				calls: [
					{
						target: toggle,
						options:
						{
							preventScroll: true,
						},
					},
				],
			},
		);
	});

	it("does not return focus when a nested step collapses", () =>
	{
		const {container} = render(chat([USER_PROMPT, ...toolCallRecords(3)]));
		fireEvent.click(container.querySelector<HTMLElement>("[data-turn-status] > [data-cds-row-toggle]")!);
		const groupPanel = container.querySelector("[data-turn-status] > [data-cds-row-panel]")!;
		const step = groupPanel.querySelector<HTMLElement>('[role="button"][aria-expanded]')!;
		fireEvent.click(step);
		const stepBody = document.getElementById(step.getAttribute("aria-controls")!)!;
		focusableIn(stepBody).focus();
		const calls = spyFocus();
		act(() =>
		{
			fireEvent.click(step);
		});
		expect(
			{
				calls,
				nestedToggle: step.hasAttribute("data-cds-row-toggle"),
			},
		).toStrictEqual(
			{
				calls: [],
				nestedToggle: false,
			},
		);
	});

	it("drops a collapsed group's panel after the closing commit", () =>
	{
		const {container} = render(chat([USER_PROMPT, ...toolCallRecords(3)]));
		const groupToggle = container.querySelector<HTMLElement>("[data-turn-status] > [data-cds-row-toggle]")!;
		fireEvent.click(groupToggle);
		act(() =>
		{
			fireEvent.click(groupToggle);
		});
		expect(
			{
				panel: container.querySelector("[data-cds-row-panel]"),
				hasStepText: container.textContent.includes("echo t2"),
			},
		).toStrictEqual(
			{
				panel: null,
				hasStepText: false,
			},
		);
	});
});
