// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, renderHook, screen, waitFor, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer, type ComposerQueueView} from "../src/components/composer";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import {useLiveHerdrPrompt} from "../src/components/use-live-herdr-prompt";
import {type DeliveryResult, useComposerQueue} from "../src/hooks/use-composer-queue";
import {useStopResponse} from "../src/hooks/use-stop-response";
import {HerdrRequestError, isAgentNotReady, sendHerdrPrompt} from "../src/lib/api/herdr";
import {
	clearComposerQueues,
	composerQueueReducer,
	nextQueuedPrompt,
	type QueuedPrompt,
	queuedForLater,
	queuedStatusText,
	steeredPrompts,
} from "../src/lib/composer-queue";
import type {SlashCommand} from "../src/lib/slash-commands";

vi.mock("../src/components/session-chat", () => ({
	SessionChat: () => null,
}));

afterEach(() => {
	cleanup();
	localStorage.clear();
	clearComposerQueues();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const ALICE: QueuedPrompt = {id: "q1", text: "Alice's first follow-up"};
const BOB: QueuedPrompt = {id: "q2", text: "Bob's second follow-up"};
const CAROL: QueuedPrompt = {id: "q3", text: "Carol's third follow-up"};

describe("composerQueueReducer", () => {
	it("enqueues at the back by default and at the front on request", () => {
		const back = composerQueueReducer([ALICE], {type: "enqueue", item: BOB});
		const front = composerQueueReducer(back, {type: "enqueue", item: CAROL, position: "front"});
		expect({back, front}).toStrictEqual({
			back: [ALICE, BOB],
			front: [CAROL, ALICE, BOB],
		});
	});

	it("edits a queued prompt's text in place", () => {
		expect(composerQueueReducer([ALICE, BOB], {type: "edit", id: "q2", text: "Bob, edited"})).toStrictEqual([
			ALICE,
			{id: "q2", text: "Bob, edited"},
		]);
	});

	it("clears the whole queue", () => {
		expect(composerQueueReducer([ALICE, BOB, CAROL], {type: "clear"})).toStrictEqual([]);
	});

	it("removes a queued prompt", () => {
		expect(composerQueueReducer([ALICE, BOB, CAROL], {type: "remove", id: "q2"})).toStrictEqual([ALICE, CAROL]);
	});

	it("reorders a queued prompt to a clamped index", () => {
		const queue = [ALICE, BOB, CAROL];
		expect({
			toFront: composerQueueReducer(queue, {type: "reorder", id: "q3", toIndex: 0}),
			toBack: composerQueueReducer(queue, {type: "reorder", id: "q1", toIndex: 99}),
			missing: composerQueueReducer(queue, {type: "reorder", id: "nope", toIndex: 0}),
		}).toStrictEqual({
			toFront: [CAROL, ALICE, BOB],
			toBack: [BOB, CAROL, ALICE],
			missing: [ALICE, BOB, CAROL],
		});
	});

	it("offers the head for flushing only once the session is idle", () => {
		expect({
			busy: nextQueuedPrompt([ALICE, BOB], true),
			idle: nextQueuedPrompt([ALICE, BOB], false),
			empty: nextQueuedPrompt([], false),
		}).toStrictEqual({busy: null, idle: ALICE, empty: null});
	});

	it("offers a mid-turn head while the session works, once no dialog is open", () => {
		const midTurn: QueuedPrompt = {id: "q4", text: "Dave's answer instead", midTurn: true};
		expect({
			dialogOpen: nextQueuedPrompt([midTurn, ALICE], true, true),
			working: nextQueuedPrompt([midTurn, ALICE], true, false),
			idle: nextQueuedPrompt([midTurn, ALICE], false, false),
			plainHeadWorking: nextQueuedPrompt([ALICE, midTurn], true, false),
		}).toStrictEqual({dialogOpen: null, working: midTurn, idle: midTurn, plainHeadWorking: null});
	});

	it("splits steered (mid-turn) prompts from those queued for later, keeping order", () => {
		const steer: QueuedPrompt = {id: "q4", text: "Dave's answer instead", midTurn: true};
		const items = [steer, ALICE, BOB];
		expect({
			steered: steeredPrompts(items),
			later: queuedForLater(items),
			laterUnchanged: queuedForLater([ALICE, BOB]),
		}).toStrictEqual({steered: [steer], later: [ALICE, BOB], laterUnchanged: [ALICE, BOB]});
	});

	it("words the sr-only status with the upstream plural", () => {
		expect([queuedStatusText(1), queuedStatusText(3)]).toStrictEqual([
			"1 message queued. Will send after the current response.",
			"3 messages queued. Will send after the current response.",
		]);
	});
});

describe("409 agent_not_ready → queued", () => {
	function fetcherReturning(status: number, body: unknown): typeof fetch {
		return async () => Promise.resolve(Response.json(body, {status}));
	}

	it("throws a HerdrRequestError carrying the status and herdr code", async () => {
		const error: unknown = await sendHerdrPrompt("session-alice", "Alice's prompt", {
			fetcher: fetcherReturning(409, {error: "agent is working", code: "agent_not_ready"}),
		}).catch((caught: unknown) => caught);

		expect({
			isRequestError: error instanceof HerdrRequestError,
			status: error instanceof HerdrRequestError ? error.status : null,
			code: error instanceof HerdrRequestError ? error.code : null,
			message: error instanceof Error ? error.message : null,
			notReady: isAgentNotReady(error),
		}).toStrictEqual({
			isRequestError: true,
			status: 409,
			code: "agent_not_ready",
			message: "agent is working",
			notReady: true,
		});
	});

	it("does not treat a stalled prompt or other errors as not-ready", async () => {
		const stalled: unknown = await sendHerdrPrompt("session-alice", "Alice's prompt", {
			fetcher: fetcherReturning(409, {error: "stalled", code: "agent_prompt_stalled"}),
		}).catch((caught: unknown) => caught);
		expect([
			isAgentNotReady(stalled),
			isAgentNotReady(new Error("agent_not_ready")),
			isAgentNotReady(null),
		]).toStrictEqual([false, false, false]);
	});

	it("useLiveHerdrPrompt reports not-ready without surfacing an error", async () => {
		const postPrompt = vi
			.fn<(sessionId: string, prompt: string) => Promise<void>>()
			.mockRejectedValue(new HerdrRequestError("agent is working", 409, "agent_not_ready"));
		const {result} = renderHook(() => useLiveHerdrPrompt("session-alice", 100, [], postPrompt));

		let delivery: DeliveryResult | undefined;
		await act(async () => {
			delivery = await result.current.send("Alice's prompt");
		});

		expect({delivery, state: result.current.state}).toStrictEqual({
			delivery: "not-ready",
			state: {phase: "idle", isPending: false, prompt: "", rejection: null},
		});
	});

	it("useLiveHerdrPrompt posts a mid-turn prompt with its flag", async () => {
		const postPrompt = vi
			.fn<(sessionId: string, prompt: string, options: {midTurn?: boolean}) => Promise<void>>()
			.mockResolvedValue(undefined);
		const {result} = renderHook(() => useLiveHerdrPrompt("session-alice", 100, [], postPrompt));

		await act(async () => {
			await result.current.send("Alice's prompt");
		});
		await act(async () => {
			await result.current.send("Alice's answer instead", {midTurn: true});
		});

		expect(postPrompt.mock.calls).toStrictEqual([
			["session-alice", "Alice's prompt", {}],
			["session-alice", "Alice's answer instead", {midTurn: true}],
		]);
	});

	it("useLiveHerdrPrompt reports sent and failed deliveries", async () => {
		const postPrompt = vi
			.fn<(sessionId: string, prompt: string) => Promise<void>>()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("Fabricated failure"));
		const {result} = renderHook(() => useLiveHerdrPrompt("session-alice", 100, [], postPrompt));

		const deliveries: DeliveryResult[] = [];
		await act(async () => {
			deliveries.push(await result.current.send("Alice's prompt"));
		});
		await act(async () => {
			deliveries.push(await result.current.send("Bob's prompt"));
		});

		expect(deliveries).toStrictEqual(["sent", "failed"]);
	});
});

type Deliver = (text: string, options?: {midTurn: true}) => Promise<DeliveryResult>;

/** The session turns busy as soon as a prompt is delivered, like the live pane's pending send. */
function renderQueue({
	busy,
	deliver,
	interrupt = vi.fn<() => Promise<void>>(async () => {}),
	sessionId = "session-alice",
	dialogOpen = false,
}: {
	busy: boolean;
	deliver: Deliver;
	interrupt?: () => Promise<void>;
	sessionId?: string;
	dialogOpen?: boolean;
}) {
	const hook = renderHook(() => {
		const [isBusy, setBusy] = useState(busy);
		const [isDialogOpen, setDialogOpen] = useState(dialogOpen);
		const queue = useComposerQueue({
			sessionId,
			busy: isBusy,
			dialogOpen: isDialogOpen,
			deliver: async (...args) => {
				const result = await deliver(...args);
				if (result === "sent") setBusy(true);
				return result;
			},
			interrupt,
			retryMs: 20,
		});
		return {queue, setBusy, setDialogOpen};
	});
	return {
		result: {
			get current() {
				return hook.result.current.queue;
			},
		},
		setBusy: (next: boolean) => {
			act(() => {
				hook.result.current.setBusy(next);
			});
		},
		setDialogOpen: (next: boolean) => {
			act(() => {
				hook.result.current.setDialogOpen(next);
			});
		},
	};
}

describe("useComposerQueue", () => {
	it("holds prompts while busy and flushes one at a time on each idle", async () => {
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const {result, setBusy} = renderQueue({busy: true, deliver});

		act(() => {
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		expect({
			texts: result.current.items.map((item) => item.text),
			delivered: deliver.mock.calls,
		}).toStrictEqual({
			texts: ["Alice's first follow-up", "Bob's second follow-up"],
			delivered: [],
		});

		setBusy(false);
		await waitFor(() => {
			expect(deliver.mock.calls.length).toBe(1);
		});
		expect({
			texts: result.current.items.map((item) => item.text),
			delivered: deliver.mock.calls,
		}).toStrictEqual({
			texts: ["Bob's second follow-up"],
			delivered: [["Alice's first follow-up"]],
		});

		setBusy(false);
		await waitFor(() => {
			expect(deliver.mock.calls.length).toBe(2);
		});
		expect({
			texts: result.current.items.map((item) => item.text),
			delivered: deliver.mock.calls,
		}).toStrictEqual({
			texts: [],
			delivered: [["Alice's first follow-up"], ["Bob's second follow-up"]],
		});
	});

	it("clears every queued prompt at once", () => {
		const {result} = renderQueue({busy: true, deliver: vi.fn<Deliver>()});
		act(() => {
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		act(() => {
			result.current.clear();
		});
		expect(result.current.items).toStrictEqual([]);
	});

	it("puts a not-ready prompt back at the head and retries", async () => {
		const deliver = vi.fn<Deliver>().mockResolvedValueOnce("not-ready").mockResolvedValueOnce("sent");
		const {result, setBusy} = renderQueue({busy: true, deliver});
		act(() => {
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});

		setBusy(false);
		await waitFor(() => {
			expect(deliver.mock.calls.length).toBe(2);
		});

		expect({
			delivered: deliver.mock.calls,
			texts: result.current.items.map((item) => item.text),
		}).toStrictEqual({
			delivered: [["Alice's first follow-up"], ["Alice's first follow-up"]],
			texts: ["Bob's second follow-up"],
		});
	});

	it("delivers a mid-turn prompt ahead of the queue as soon as the dialog closes, while still working", async () => {
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const {result, setDialogOpen} = renderQueue({busy: true, dialogOpen: true, deliver});
		act(() => {
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's answer instead", {midTurn: true});
		});
		expect({
			texts: result.current.items.map((item) => item.text),
			delivered: deliver.mock.calls,
		}).toStrictEqual({
			texts: ["Bob's answer instead", "Alice's first follow-up"],
			delivered: [],
		});

		setDialogOpen(false);
		await waitFor(() => {
			expect(deliver.mock.calls.length).toBe(1);
		});

		expect({
			texts: result.current.items.map((item) => item.text),
			delivered: deliver.mock.calls,
		}).toStrictEqual({
			texts: ["Alice's first follow-up"],
			delivered: [["Bob's answer instead", {midTurn: true}]],
		});
	});

	it("Send now moves a queued prompt to the head and interrupts a busy session", () => {
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const interrupt = vi.fn<() => Promise<void>>(async () => {});
		const {result} = renderQueue({busy: true, deliver, interrupt});
		act(() => {
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		const bob = result.current.items[1];
		if (bob === undefined) throw new Error("Expected Bob's queued prompt");

		act(() => {
			void result.current.sendNow(bob.id);
		});

		expect({
			texts: result.current.items.map((item) => item.text),
			interrupts: interrupt.mock.calls.length,
			delivered: deliver.mock.calls,
		}).toStrictEqual({
			texts: ["Bob's second follow-up", "Alice's first follow-up"],
			interrupts: 1,
			delivered: [],
		});
	});

	it("Send now settles when the interrupt request settles", async () => {
		let settle = () => {};
		const pending = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const interrupt = vi.fn<() => Promise<void>>(async () => pending);
		const {result} = renderQueue({busy: true, deliver: vi.fn<Deliver>(), interrupt});
		act(() => {
			result.current.enqueue("Alice's first follow-up");
		});
		const alice = result.current.items[0];
		if (alice === undefined) throw new Error("Expected Alice's queued prompt");

		let settled = false;
		let sending: Promise<void> = Promise.resolve();
		act(() => {
			sending = result.current.sendNow(alice.id).then(() => {
				settled = true;
			});
		});
		await Promise.resolve();
		const before = settled;
		settle();
		await sending;

		expect({before, after: settled}).toStrictEqual({before: false, after: true});
	});

	it("keeps queues per session", () => {
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const alice = renderQueue({busy: true, deliver, sessionId: "session-alice"});
		const bob = renderQueue({busy: true, deliver, sessionId: "session-bob"});
		act(() => {
			alice.result.current.enqueue("Alice's follow-up");
		});

		expect({
			alice: alice.result.current.items.map((item) => item.text),
			bob: bob.result.current.items.map((item) => item.text),
		}).toStrictEqual({alice: ["Alice's follow-up"], bob: []});
	});
});

function renderComposer({
	queue,
	onSend = vi.fn<(prompt: string) => void>(),
	onQueueForLater,
	onStop,
	slashCommands,
	toast = vi.fn<(options: ToastOptions) => void>(),
}: {
	toast?: (options: ToastOptions) => void;
	queue?: ComposerQueueView;
	onSend?: (prompt: string) => void;
	onQueueForLater?: (prompt: string) => void;
	onStop?: () => void;
	slashCommands?: readonly SlashCommand[];
}) {
	render(
		<ToastContext.Provider value={toast}>
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={(prompt) => {
					onSend(prompt);
				}}
				onStop={onStop}
				queue={queue}
				onQueueForLater={onQueueForLater}
				slashCommands={slashCommands}
			/>
		</ToastContext.Provider>,
	);
	return screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
}

function queueView(items: readonly QueuedPrompt[]) {
	return {
		items,
		sendNow: vi.fn<(id: string) => Promise<void>>(async () => {}),
		remove: vi.fn<(id: string) => void>(),
		clear: vi.fn<() => void>(),
	};
}

async function openRowMenu(index: number) {
	fireEvent.click(screen.getByRole("button", {name: /messages queued/}));
	const triggers = screen.getAllByRole("button", {name: "Queued message actions"});
	const trigger = triggers[index];
	if (trigger === undefined) throw new Error(`Expected row ${index}`);
	fireEvent.click(trigger);
	return await screen.findByRole("menu");
}

describe("Composer queued message bar", () => {
	it("shows the queued band above the composer with an sr-only status", () => {
		renderComposer({queue: queueView([ALICE, BOB])});
		const bar = screen.getByRole("button", {name: /2 messages queued/});
		const status = screen.getByTestId("coach-queued-status");

		expect({
			bar: bar.textContent,
			status: {
				tag: status.tagName,
				className: status.className,
				role: status.getAttribute("role"),
				live: status.getAttribute("aria-live"),
				atomic: status.getAttribute("aria-atomic"),
				text: status.textContent,
			},
		}).toStrictEqual({
			bar: "2 messages queuedNext: Alice's first follow-up",
			status: {
				tag: "P",
				className: "sr-only",
				role: null,
				live: "polite",
				atomic: "true",
				text: "2 messages queued. Will send after the current response.",
			},
		});
	});

	it("lists only prompts queued for later: a steer draws in the transcript instead", () => {
		const steer: QueuedPrompt = {id: "q4", text: "Dave's answer instead", midTurn: true};
		renderComposer({queue: queueView([steer, ALICE])});
		expect({
			band: document.querySelector("[data-take-back-entry]")?.textContent.includes("1 message queued"),
			steerShown: document.body.textContent.includes("Dave's answer instead"),
			status: screen.getByTestId("coach-queued-status").textContent,
		}).toStrictEqual({
			band: true,
			steerShown: false,
			status: "1 message queued. Will send after the current response.",
		});
	});

	it("renders no band when only steers are held", () => {
		renderComposer({queue: queueView([{id: "q4", text: "Dave's answer instead", midTurn: true}])});
		expect({
			band: document.querySelector("[data-take-back-entry]"),
			status: screen.getByTestId("coach-queued-status").textContent,
		}).toStrictEqual({band: null, status: ""});
	});

	it("renders nothing without queued prompts", () => {
		renderComposer({queue: queueView([])});
		expect(document.querySelector("[data-take-back-entry]")).toBeNull();
	});

	it("Edit in composer moves the prompt back into the editor", async () => {
		const queue = queueView([ALICE, BOB]);
		const textarea = renderComposer({queue});
		const menu = await openRowMenu(1);
		fireEvent.click(within(menu).getByRole("menuitem", {name: "Edit in composer"}));

		expect({value: textarea.value, removed: queue.remove.mock.calls}).toStrictEqual({
			value: "Bob's second follow-up",
			removed: [["q2"]],
		});
	});

	it("Send now forwards the entry id", () => {
		const queue = queueView([BOB]);
		renderComposer({queue});
		fireEvent.click(screen.getByRole("button", {name: "Send now"}));
		expect(queue.sendNow.mock.calls).toStrictEqual([["q2"]]);
	});

	it("Clear all empties the queue in one action", () => {
		const queue = queueView([ALICE, BOB]);
		renderComposer({queue});
		fireEvent.click(screen.getByRole("button", {name: /2 messages queued/}));
		fireEvent.click(screen.getByRole("button", {name: "Clear all"}));
		expect({cleared: queue.clear.mock.calls, removed: queue.remove.mock.calls}).toStrictEqual({
			cleared: [[]],
			removed: [],
		});
	});

	it("Remove from queue removes at once, without a confirm", () => {
		const queue = queueView([ALICE]);
		renderComposer({queue});
		fireEvent.click(screen.getByRole("button", {name: "Remove from queue"}));
		expect({removed: queue.remove.mock.calls, dialog: screen.queryByRole("alertdialog")}).toStrictEqual({
			removed: [["q1"]],
			dialog: null,
		});
	});

	it("Edit in composer over a draft toasts a warning and keeps the entry", () => {
		const queue = queueView([ALICE]);
		const toast = vi.fn<(options: ToastOptions) => void>();
		const textarea = renderComposer({queue, toast});
		fireEvent.change(textarea, {target: {value: "Bob's draft"}});
		fireEvent.click(screen.getByRole("button", {name: "Edit in composer"}));

		expect({value: textarea.value, removed: queue.remove.mock.calls, toasts: toast.mock.calls}).toStrictEqual({
			value: "Bob's draft",
			removed: [],
			toasts: [
				[{kind: "warning", message: "The input already has a draft. Clear it to pull this message back in."}],
			],
		});
	});

	it("Edit in composer with an empty draft fills and focuses the composer", () => {
		const queue = queueView([ALICE]);
		const textarea = renderComposer({queue});
		fireEvent.click(screen.getByRole("button", {name: "Edit in composer"}));

		expect({
			value: textarea.value,
			focused: document.activeElement === textarea,
			removed: queue.remove.mock.calls,
		}).toStrictEqual({value: "Alice's first follow-up", focused: true, removed: [["q1"]]});
	});
});

describe("Composer while working", () => {
	it("keeps the editor enabled and sends on Enter while the slot is Stop", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		const textarea = renderComposer({onSend, onStop: () => {}});
		fireEvent.change(textarea, {target: {value: "Alice's follow-up"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			disabled: textarea.disabled,
			sent: onSend.mock.calls,
			cleared: textarea.value,
		}).toStrictEqual({disabled: false, sent: [["Alice's follow-up"]], cleared: ""});
	});

	it("queues for later on ⌘⏎ and Ctrl+⏎ without sending or stopping", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		const onQueueForLater = vi.fn<(prompt: string) => void>();
		const onStop = vi.fn<() => void>();
		const textarea = renderComposer({onSend, onQueueForLater, onStop});
		fireEvent.change(textarea, {target: {value: "Alice's later prompt"}});
		fireEvent.keyDown(textarea, {key: "Enter", metaKey: true});
		fireEvent.change(textarea, {target: {value: "Bob's later prompt"}});
		fireEvent.keyDown(textarea, {key: "Enter", ctrlKey: true});

		expect({sent: onSend.mock.calls, later: onQueueForLater.mock.calls, stops: onStop.mock.calls}).toStrictEqual({
			sent: [],
			later: [["Alice's later prompt"], ["Bob's later prompt"]],
			stops: [],
		});
	});

	it("shows upstream's working placeholder with ⌘⏎ on Mac", () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
		const textarea = renderComposer({onQueueForLater: () => {}, onStop: () => {}});

		expect(textarea.placeholder).toBe("⏎ to send, ⌘⏎ to queue for later");
	});

	it("shows the working placeholder with Ctrl⏎ off Mac", () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
		const textarea = renderComposer({onQueueForLater: () => {}, onStop: () => {}});

		expect(textarea.placeholder).toBe("⏎ to send, Ctrl⏎ to queue for later");
	});

	it("keeps the idle placeholder when the live pane is not working", () => {
		const textarea = renderComposer({onQueueForLater: () => {}});

		expect(textarea.placeholder).toBe("Type / for commands");
	});

	it("swallows a repeated ⌘⏎ keydown", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		const onQueueForLater = vi.fn<(prompt: string) => void>();
		const textarea = renderComposer({onSend, onQueueForLater, onStop: () => {}});
		fireEvent.change(textarea, {target: {value: "Alice's held-down prompt"}});
		const notCancelled = fireEvent.keyDown(textarea, {key: "Enter", metaKey: true, repeat: true});

		expect({
			notCancelled,
			sent: onSend.mock.calls,
			later: onQueueForLater.mock.calls,
			draft: textarea.value,
		}).toStrictEqual({notCancelled: false, sent: [], later: [], draft: "Alice's held-down prompt"});
	});
});

describe("Esc modal guard", () => {
	function Stopper({
		onInterrupt,
		queue,
		slashCommands,
	}: {
		onInterrupt: () => void;
		queue?: ComposerQueueView;
		slashCommands?: readonly SlashCommand[];
	}) {
		const stop = useStopResponse({
			sessionId: "session-alice",
			enabled: true,
			interrupt: async () => {},
			onInterrupt,
			onError: () => {},
		});
		return (
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() => {}}
				onStop={stop}
				queue={queue}
				slashCommands={slashCommands}
			/>
		);
	}

	it("stops on Esc from the editor when nothing is open (no steer recall: a steer already typed into the CLI can't be taken back)", () => {
		const onInterrupt = vi.fn<() => void>();
		render(<Stopper onInterrupt={onInterrupt} />);
		const textarea = screen.getByRole("textbox", {name: "Prompt"});
		textarea.focus();
		fireEvent.keyDown(textarea, {key: "Escape", code: "Escape"});
		expect(onInterrupt.mock.calls.length).toBe(1);
	});

	it("closes the slash popup instead of stopping", () => {
		const onInterrupt = vi.fn<() => void>();
		render(
			<Stopper
				onInterrupt={onInterrupt}
				slashCommands={[{name: "review", description: "Review code", source: "builtin"}]}
			/>,
		);
		const textarea = screen.getByRole("textbox", {name: "Prompt"});
		textarea.focus();
		fireEvent.change(textarea, {target: {value: "/rev"}});
		const openBefore = screen.queryByRole("menu") !== null;
		fireEvent.keyDown(textarea, {key: "Escape", code: "Escape"});

		expect({openBefore, interrupts: onInterrupt.mock.calls.length}).toStrictEqual({
			openBefore: true,
			interrupts: 0,
		});
	});

	it("does not stop while a queued row's menu is open", async () => {
		const onInterrupt = vi.fn<() => void>();
		render(<Stopper onInterrupt={onInterrupt} queue={queueView([ALICE, BOB])} />);
		const menu = await openRowMenu(0);
		const item = within(menu).getByRole("menuitem", {name: "Remove from queue"});
		item.focus();
		fireEvent.keyDown(item, {key: "Escape", code: "Escape"});

		expect(onInterrupt.mock.calls.length).toBe(0);
	});
});
