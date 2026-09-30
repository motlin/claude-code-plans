// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {useWorkingMarkerState, WorkingMarker} from "../src/components/working-marker";
import {canStopResponse, STOP_FORCE_WINDOW_MS, useStopResponse} from "../src/hooks/use-stop-response";
import {sendHerdrInterrupt} from "../src/lib/api/herdr";
import {getShortcut} from "../src/lib/shortcuts/registry";

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.useRealTimers();
});

type Interrupt = (sessionId: string, force: boolean) => Promise<void>;

function Harness({
	enabled,
	interrupt,
	onInterrupt = () => {},
	now,
	withDialog = false,
}: {
	enabled: boolean;
	interrupt: Interrupt;
	onInterrupt?: (at: number) => void;
	now: () => number;
	withDialog?: boolean;
}) {
	const stop = useStopResponse({
		sessionId: "session-alice",
		enabled,
		interrupt,
		onInterrupt,
		onError: () => {},
		now,
	});
	return (
		<div>
			<button type="button" onClick={stop}>
				Stop
			</button>
			{withDialog && (
				<div role="dialog">
					<button type="button">Inside dialog</button>
				</div>
			)}
		</div>
	);
}

function pressEscape(target: Element = document.body) {
	fireEvent.keyDown(target, {key: "Escape", code: "Escape"});
}

describe("canStopResponse", () => {
	it("is only available with a live pane, writes enabled and a working session", () => {
		expect([
			canStopResponse({hasLivePane: true, writesEnabled: true, working: true}),
			canStopResponse({hasLivePane: false, writesEnabled: true, working: true}),
			canStopResponse({hasLivePane: true, writesEnabled: false, working: true}),
			canStopResponse({hasLivePane: true, writesEnabled: true, working: false}),
		]).toStrictEqual([true, false, false, false]);
	});
});

describe("Composer stop slot", () => {
	it("turns the send slot into Stop response when onStop is given, and clicking it stops", () => {
		const onStop = vi.fn<() => void>();
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} onStop={onStop} />);
		const before = screen.queryByRole("button", {name: "Send"});
		fireEvent.click(screen.getByRole("button", {name: "Stop response"}));

		expect({
			before,
			calls: onStop.mock.calls.length,
			editorDisabled: screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"}).disabled,
		}).toStrictEqual({before: null, calls: 1, editorDisabled: false});
	});

	it("keeps Send without onStop", () => {
		render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
		expect({
			send: screen.queryByRole("button", {name: "Send"}) !== null,
			stop: screen.queryByRole("button", {name: "Stop response"}),
		}).toStrictEqual({send: true, stop: null});
	});
});

describe("useStopResponse", () => {
	it("enables the stop_response registry entry", () => {
		expect(getShortcut("stop_response").enabled).toBe(true);
	});

	it("sends a normal interrupt on Esc and records when it was sent", () => {
		const interrupt = vi.fn<Interrupt>(async () => {});
		const onInterrupt = vi.fn<(at: number) => void>();
		render(<Harness enabled interrupt={interrupt} onInterrupt={onInterrupt} now={() => 1000} />);

		pressEscape();

		expect({
			interrupt: interrupt.mock.calls,
			onInterrupt: onInterrupt.mock.calls,
		}).toStrictEqual({
			interrupt: [["session-alice", false]],
			onInterrupt: [[1000]],
		});
	});

	it("ignores Esc while disabled", () => {
		const interrupt = vi.fn<Interrupt>(async () => {});
		render(<Harness enabled={false} interrupt={interrupt} now={() => 1000} />);

		pressEscape();

		expect(interrupt.mock.calls).toStrictEqual([]);
	});

	it("ignores Esc while a dialog or menu has focus", () => {
		const interrupt = vi.fn<Interrupt>(async () => {});
		render(<Harness enabled interrupt={interrupt} now={() => 1000} withDialog />);
		const inside = screen.getByRole("button", {name: "Inside dialog"});
		inside.focus();

		pressEscape(inside);

		expect(interrupt.mock.calls).toStrictEqual([]);
	});

	it("sends force (ctrl+c) on a second press within 2s", () => {
		let time = 1000;
		const interrupt = vi.fn<Interrupt>(async () => {});
		render(<Harness enabled interrupt={interrupt} now={() => time} />);

		pressEscape();
		time += STOP_FORCE_WINDOW_MS - 1;
		fireEvent.click(screen.getByRole("button", {name: "Stop"}));

		expect(interrupt.mock.calls).toStrictEqual([
			["session-alice", false],
			["session-alice", true],
		]);
	});

	it("sends a normal interrupt on a second press after 2s", () => {
		let time = 1000;
		const interrupt = vi.fn<Interrupt>(async () => {});
		render(<Harness enabled interrupt={interrupt} now={() => time} />);

		pressEscape();
		time += STOP_FORCE_WINDOW_MS + 1;
		pressEscape();

		expect(interrupt.mock.calls).toStrictEqual([
			["session-alice", false],
			["session-alice", false],
		]);
	});
});

describe("sendHerdrInterrupt", () => {
	it("POSTs sessionId and force to /api/herdr/interrupt", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => Response.json({ok: true}));

		await sendHerdrInterrupt("session-alice", true, fetcher);

		expect(fetcher.mock.calls).toStrictEqual([
			[
				"/api/herdr/interrupt",
				{
					method: "POST",
					credentials: "same-origin",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({sessionId: "session-alice", force: true}),
				},
			],
		]);
	});

	it("throws the server error", async () => {
		const fetcher = vi.fn<typeof fetch>(async () =>
			Response.json({error: "herdr writes are disabled"}, {status: 403}),
		);

		await expect(sendHerdrInterrupt("session-alice", false, fetcher)).rejects.toThrow("herdr writes are disabled");
	});
});

describe("working marker Stopping…", () => {
	const PROMPT_AT = Date.parse("2026-09-29T12:00:00.000Z");

	function MarkerHarness({interruptedAt}: {interruptedAt: number | null}) {
		const state = useWorkingMarkerState({
			records: [
				{
					type: "user",
					timestamp: new Date(PROMPT_AT).toISOString(),
					message: {role: "user", content: "go"},
				},
			],
			sessionState: "working",
			isActive: true,
			pendingToolName: "Bash",
			interruptedAt,
		});
		return <WorkingMarker state={state} />;
	}

	it("shows Stopping… once an interrupt was sent during the current turn", () => {
		vi.useFakeTimers({toFake: ["Date"]});
		vi.setSystemTime(PROMPT_AT + 3000);
		vi.stubGlobal("matchMedia", undefined);
		const view = render(<MarkerHarness interruptedAt={null} />);
		const before = view.getByRole("status").textContent;
		act(() => view.rerender(<MarkerHarness interruptedAt={PROMPT_AT + 3000} />));
		const after = view.getByRole("status").textContent;
		act(() => view.rerender(<MarkerHarness interruptedAt={PROMPT_AT - 60_000} />));
		const stale = view.getByRole("status").textContent;
		vi.unstubAllGlobals();

		expect({before, after, stale}).toStrictEqual({
			before: "Running command · 3s",
			after: "Stopping…",
			stale: "Running command · 3s",
		});
	});
});
