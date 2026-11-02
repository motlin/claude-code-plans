// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, renderHook, screen, waitFor, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {Composer, type ComposerQueueView} from "../src/components/composer";
import {pickWorkingPlaceholder} from "../src/lib/working-placeholder";
import {recallLastHeldSteer} from "../src/lib/steer-recall";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import {useLiveHerdrPrompt} from "../src/components/use-live-herdr-prompt";
import {type DeliveryResult, SEND_NOW_FAILED_MESSAGE, useComposerQueue} from "../src/hooks/use-composer-queue";
import {useStopResponse} from "../src/hooks/use-stop-response";
import {clearAnnouncements, clearLanded, isLanded, peekAnnouncement} from "../src/lib/landed-store";
import {HerdrRequestError, isAgentNotReady, sendHerdrPrompt} from "../src/lib/api/herdr";
import
{
	clearComposerQueues,
	composerQueueReducer,
	nextQueuedPrompt,
	type QueuedPrompt,
	queuedForLater,
	queuedStatusText,
	steeredPrompts,
} from "../src/lib/composer-queue";
import type {SlashCommand} from "../src/lib/slash-commands";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";

// The deferred chunks these tests render, loaded up front as the page warms them before first use.
beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

vi.mock("../src/components/session-chat", () => (
{
	SessionChat: () => null,
}));

afterEach(() =>
{
	cleanup();
	localStorage.clear();
	clearComposerQueues();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const ALICE: QueuedPrompt =
{
	id: "q1",
	text: "Alice's first follow-up",
};
const BOB: QueuedPrompt =
{
	id: "q2",
	text: "Bob's second follow-up",
};
const CAROL: QueuedPrompt =
{
	id: "q3",
	text: "Carol's third follow-up",
};

describe("composerQueueReducer", () =>
{
	it("enqueues at the back by default and at the front on request", () =>
	{
		const back = composerQueueReducer(
			[ALICE],
			{
				type: "enqueue",
				item: BOB,
			},
		);
		const front = composerQueueReducer(
			back,
			{
				type: "enqueue",
				item: CAROL,
				position: "front",
			},
		);
		expect(
			{
				back,
				front,
			},
		).toStrictEqual(
			{
				back: [ALICE, BOB],
				front: [CAROL, ALICE, BOB],
			},
		);
	});

	it("edits a queued prompt's text in place", () =>
	{
		expect(
			composerQueueReducer(
				[ALICE, BOB],
				{
					type: "edit",
					id: "q2",
					text: "Bob, edited",
				},
			),
		).toStrictEqual([
			ALICE,
			{
				id: "q2",
				text: "Bob, edited",
			},
		]);
	});

	it("clears the whole queue", () =>
	{
		expect(
			composerQueueReducer(
				[ALICE, BOB, CAROL],
				{
					type: "clear",
				},
			),
		).toStrictEqual([]);
	});

	it("removes a queued prompt", () =>
	{
		expect(
			composerQueueReducer(
				[ALICE, BOB, CAROL],
				{
					type: "remove",
					id: "q2",
				},
			),
		).toStrictEqual([ALICE, CAROL]);
	});

	it("reorders a queued prompt to a clamped index", () =>
	{
		const queue = [ALICE, BOB, CAROL];
		expect(
			{
				toFront: composerQueueReducer(
					queue,
					{
						type: "reorder",
						id: "q3",
						toIndex: 0,
					},
				),
				toBack: composerQueueReducer(
					queue,
					{
						type: "reorder",
						id: "q1",
						toIndex: 99,
					},
				),
				missing: composerQueueReducer(
					queue,
					{
						type: "reorder",
						id: "nope",
						toIndex: 0,
					},
				),
			},
		).toStrictEqual(
			{
				toFront: [CAROL, ALICE, BOB],
				toBack: [BOB, CAROL, ALICE],
				missing: [ALICE, BOB, CAROL],
			},
		);
	});

	it("offers the head for flushing only once the session is idle", () =>
	{
		expect(
			{
				busy: nextQueuedPrompt([ALICE, BOB], true),
				idle: nextQueuedPrompt([ALICE, BOB], false),
				empty: nextQueuedPrompt([], false),
			},
		).toStrictEqual(
			{
				busy: null,
				idle: ALICE,
				empty: null,
			},
		);
	});

	it("offers a mid-turn head while the session works, once no dialog is open", () =>
	{
		const midTurn: QueuedPrompt =
		{
			id: "q4",
			text: "Dave's answer instead",
			midTurn: true,
		};
		expect(
			{
				dialogOpen: nextQueuedPrompt([midTurn, ALICE], true, true),
				working: nextQueuedPrompt([midTurn, ALICE], true, false),
				idle: nextQueuedPrompt([midTurn, ALICE], false, false),
				plainHeadWorking: nextQueuedPrompt([ALICE, midTurn], true, false),
			},
		).toStrictEqual(
			{
				dialogOpen: null,
				working: midTurn,
				idle: midTurn,
				plainHeadWorking: null,
			},
		);
	});

	it("splits steered (mid-turn) prompts from those queued for later, keeping order", () =>
	{
		const steer: QueuedPrompt =
		{
			id: "q4",
			text: "Dave's answer instead",
			midTurn: true,
		};
		const items = [steer, ALICE, BOB];
		expect(
			{
				steered: steeredPrompts(items),
				later: queuedForLater(items),
				laterUnchanged: queuedForLater([ALICE, BOB]),
			},
		).toStrictEqual(
			{
				steered: [steer],
				later: [ALICE, BOB],
				laterUnchanged: [ALICE, BOB],
			},
		);
	});

	it("words the sr-only status with the upstream plural", () =>
	{
		expect([queuedStatusText(1), queuedStatusText(3)]).toStrictEqual([
			"1 message queued. Will send after the current response.",
			"3 messages queued. Will send after the current response.",
		]);
	});
});

describe("409 agent_not_ready → queued", () =>
{
	function fetcherReturning(status: number, body: unknown): typeof fetch
	{
		return async () =>
			Promise.resolve(
				Response.json(
					body,
					{
						status,
					},
				),
			);
	}

	it("throws a HerdrRequestError carrying the status and herdr code", async () =>
	{
		const error: unknown = await sendHerdrPrompt(
			"session-alice",
			"Alice's prompt",
			{
				fetcher: fetcherReturning(
					409,
					{
						error: "agent is working",
						code: "agent_not_ready",
					},
				),
			},
		).catch((caught: unknown) => caught);

		expect(
			{
				isRequestError: error instanceof HerdrRequestError,
				status: error instanceof HerdrRequestError ? error.status : null,
				code: error instanceof HerdrRequestError ? error.code : null,
				message: error instanceof Error ? error.message : null,
				notReady: isAgentNotReady(error),
			},
		).toStrictEqual(
			{
				isRequestError: true,
				status: 409,
				code: "agent_not_ready",
				message: "agent is working",
				notReady: true,
			},
		);
	});

	it("does not treat a stalled prompt or other errors as not-ready", async () =>
	{
		const stalled: unknown = await sendHerdrPrompt(
			"session-alice",
			"Alice's prompt",
			{
				fetcher: fetcherReturning(
					409,
					{
						error: "stalled",
						code: "agent_prompt_stalled",
					},
				),
			},
		).catch((caught: unknown) => caught);
		expect([
			isAgentNotReady(stalled),
			isAgentNotReady(new Error("agent_not_ready")),
			isAgentNotReady(null),
		]).toStrictEqual([false, false, false]);
	});

	it("useLiveHerdrPrompt reports not-ready without surfacing an error", async () =>
	{
		const postPrompt = vi
			.fn<(sessionId: string, prompt: string) => Promise<void>>()
			.mockRejectedValue(new HerdrRequestError("agent is working", 409, "agent_not_ready"));
		const {result} = renderHook(() => useLiveHerdrPrompt("session-alice", 100, [], postPrompt));

		let delivery: DeliveryResult | undefined;
		await act(async () =>
		{
			delivery = await result.current.send("Alice's prompt");
		});

		expect(
			{
				delivery,
				state: result.current.state,
			},
		).toStrictEqual(
			{
				delivery: "not-ready",
				state:
				{
					phase: "idle",
					isPending: false,
					prompt: "",
					rejection: null,
				},
			},
		);
	});

	it("useLiveHerdrPrompt posts a mid-turn prompt with its flag", async () =>
	{
		const postPrompt = vi
			.fn<
				(
					sessionId: string,
					prompt: string,
					options:
					{
						midTurn?: boolean;
					},
				) => Promise<void>
			>()
			.mockResolvedValue(undefined);
		const {result} = renderHook(() => useLiveHerdrPrompt("session-alice", 100, [], postPrompt));

		await act(async () =>
		{
			await result.current.send("Alice's prompt");
		});
		await act(async () =>
		{
			await result.current.send(
				"Alice's answer instead",
				{
					midTurn: true,
				},
			);
		});

		expect(postPrompt.mock.calls).toStrictEqual([
			["session-alice", "Alice's prompt", {}],
			[
				"session-alice",
				"Alice's answer instead",
				{
					midTurn: true,
				},
			],
		]);
	});

	it("useLiveHerdrPrompt reports sent and failed deliveries", async () =>
	{
		const postPrompt = vi
			.fn<(sessionId: string, prompt: string) => Promise<void>>()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("Fabricated failure"));
		const {result} = renderHook(() => useLiveHerdrPrompt("session-alice", 100, [], postPrompt));

		const deliveries: DeliveryResult[] = [];
		await act(async () =>
		{
			deliveries.push(await result.current.send("Alice's prompt"));
		});
		await act(async () =>
		{
			deliveries.push(await result.current.send("Bob's prompt"));
		});

		expect(deliveries).toStrictEqual(["sent", "failed"]);
	});
});

type Deliver = (
	text: string,
	options?:
	{
		midTurn: true;
	},
) => Promise<DeliveryResult>;

/** The session turns busy as soon as a prompt is delivered, like the live pane's pending send. */
function renderQueue({
	busy,
	deliver,
	interrupt = vi.fn<() => Promise<void>>(async () => {}),
	sessionId = "session-alice",
	dialogOpen = false,
	onSendNowFailed,
}: {
	busy: boolean;
	deliver: Deliver;
	interrupt?: () => Promise<void>;
	sessionId?: string;
	dialogOpen?: boolean;
	onSendNowFailed?: () => void;
})
{
	const hook = renderHook(() =>
	{
		const [isBusy, setBusy] = useState(busy);
		const [isDialogOpen, setDialogOpen] = useState(dialogOpen);
		const queue = useComposerQueue(
			{
				sessionId,
				busy: isBusy,
				dialogOpen: isDialogOpen,
				deliver: async (...args) =>
				{
					const result = await deliver(...args);
					if (result === "sent") setBusy(true);
					return result;
				},
				interrupt,
				retryMs: 20,
				...(onSendNowFailed === undefined
					? {}
					:
						{
							onSendNowFailed,
						}),
			},
		);
		return {
			queue,
			setBusy,
			setDialogOpen,
		};
	});
	return {
		result:
		{
			get current()
			{
				return hook.result.current.queue;
			},
		},
		setBusy: (next: boolean) =>
		{
			act(() =>
			{
				hook.result.current.setBusy(next);
			});
		},
		setDialogOpen: (next: boolean) =>
		{
			act(() =>
			{
				hook.result.current.setDialogOpen(next);
			});
		},
	};
}

describe("useComposerQueue", () =>
{
	it("holds prompts while busy and flushes one at a time on each idle", async () =>
	{
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const {result, setBusy} = renderQueue(
			{
				busy: true,
				deliver,
			},
		);

		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		expect(
			{
				texts: result.current.items.map((item) => item.text),
				delivered: deliver.mock.calls,
			},
		).toStrictEqual(
			{
				texts: ["Alice's first follow-up", "Bob's second follow-up"],
				delivered: [],
			},
		);

		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(1);
		});
		expect(
			{
				texts: result.current.items.map((item) => item.text),
				delivered: deliver.mock.calls,
			},
		).toStrictEqual(
			{
				texts: ["Bob's second follow-up"],
				delivered: [["Alice's first follow-up"]],
			},
		);

		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(2);
		});
		expect(
			{
				texts: result.current.items.map((item) => item.text),
				delivered: deliver.mock.calls,
			},
		).toStrictEqual(
			{
				texts: [],
				delivered: [["Alice's first follow-up"], ["Bob's second follow-up"]],
			},
		);
	});

	it("clears every queued prompt at once", () =>
	{
		const {result} = renderQueue(
			{
				busy: true,
				deliver: vi.fn<Deliver>(),
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		act(() =>
		{
			result.current.clear();
		});
		expect(result.current.items).toStrictEqual([]);
	});

	it("puts a not-ready prompt back at the head and retries", async () =>
	{
		const deliver = vi.fn<Deliver>().mockResolvedValueOnce("not-ready").mockResolvedValueOnce("sent");
		const {result, setBusy} = renderQueue(
			{
				busy: true,
				deliver,
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});

		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(2);
		});

		expect(
			{
				delivered: deliver.mock.calls,
				texts: result.current.items.map((item) => item.text),
			},
		).toStrictEqual(
			{
				delivered: [["Alice's first follow-up"], ["Alice's first follow-up"]],
				texts: ["Bob's second follow-up"],
			},
		);
	});

	it("delivers a mid-turn prompt ahead of the queue as soon as the dialog closes, while still working", async () =>
	{
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const {result, setDialogOpen} = renderQueue(
			{
				busy: true,
				dialogOpen: true,
				deliver,
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue(
				"Bob's answer instead",
				{
					midTurn: true,
				},
			);
		});
		expect(
			{
				texts: result.current.items.map((item) => item.text),
				delivered: deliver.mock.calls,
			},
		).toStrictEqual(
			{
				texts: ["Bob's answer instead", "Alice's first follow-up"],
				delivered: [],
			},
		);

		setDialogOpen(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(1);
		});

		expect(
			{
				texts: result.current.items.map((item) => item.text),
				delivered: deliver.mock.calls,
			},
		).toStrictEqual(
			{
				texts: ["Alice's first follow-up"],
				delivered: [
					[
						"Bob's answer instead",
						{
							midTurn: true,
						},
					],
				],
			},
		);
	});

	it("Send now moves a queued prompt to the head and interrupts a busy session", () =>
	{
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const interrupt = vi.fn<() => Promise<void>>(async () => {});
		const {result} = renderQueue(
			{
				busy: true,
				deliver,
				interrupt,
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		const bob = result.current.items[1];
		if (bob === undefined) throw new Error("Expected Bob's queued prompt");

		act(() =>
		{
			void result.current.sendNow(bob.id);
		});

		expect(
			{
				texts: result.current.items.map((item) => item.text),
				interrupts: interrupt.mock.calls.length,
				delivered: deliver.mock.calls,
			},
		).toStrictEqual(
			{
				texts: ["Bob's second follow-up", "Alice's first follow-up"],
				interrupts: 1,
				delivered: [],
			},
		);
	});

	it("Send now settles when the interrupt request settles", async () =>
	{
		let settle = () =>
		{
		};
		const pending = new Promise<void>((resolve) =>
		{
			settle = resolve;
		});
		const interrupt = vi.fn<() => Promise<void>>(async () => pending);
		const {result} = renderQueue(
			{
				busy: true,
				deliver: vi.fn<Deliver>(),
				interrupt,
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
		});
		const alice = result.current.items[0];
		if (alice === undefined) throw new Error("Expected Alice's queued prompt");

		let settled = false;
		let sending: Promise<void> = Promise.resolve();
		act(() =>
		{
			sending = result.current.sendNow(alice.id).then(() =>
			{
				settled = true;
			});
		});
		await Promise.resolve();
		const before = settled;
		settle();
		await sending;

		expect(
			{
				before,
				after: settled,
			},
		).toStrictEqual(
			{
				before: false,
				after: true,
			},
		);
	});

	it("marks a promoted prompt landed once it is delivered, and no other", async () =>
	{
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const {result, setBusy} = renderQueue(
			{
				busy: true,
				deliver,
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		const bob = result.current.items[1];
		if (bob === undefined) throw new Error("Expected Bob's queued prompt");
		await act(async () => result.current.sendNow(bob.id));
		const beforeDelivery = isLanded("Bob's second follow-up");
		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(1);
		});
		const promoted = isLanded("Bob's second follow-up");
		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(2);
		});
		expect(
			{
				beforeDelivery,
				promoted,
				other: isLanded("Alice's first follow-up"),
			},
		).toStrictEqual(
			{
				beforeDelivery: false,
				promoted: true,
				other: false,
			},
		);
		clearLanded();
	});

	it("holds a promoted prompt accepted until it is delivered, announcing Sent then Read", async () =>
	{
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const {result, setBusy} = renderQueue(
			{
				busy: true,
				deliver,
				sessionId: "session-accepted",
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		const bob = result.current.items[1];
		if (bob === undefined) throw new Error("Expected Bob's queued prompt");
		const beforeSend = [...result.current.acceptedIds];
		await act(async () => result.current.sendNow(bob.id));
		const accepted = [...result.current.acceptedIds];
		const sentAnnouncement = peekAnnouncement("session-accepted")?.kind;
		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(1);
		});
		await waitFor(() =>
		{
			expect(result.current.acceptedIds.size).toBe(0);
		});
		expect(
			{
				beforeSend,
				accepted,
				sentAnnouncement,
				readAnnouncement: peekAnnouncement("session-accepted")?.kind,
			},
		).toStrictEqual(
			{
				beforeSend: [],
				accepted: [bob.id],
				sentAnnouncement: "sent",
				readAnnouncement: "read",
			},
		);
		clearLanded();
		clearAnnouncements();
	});

	it("never accepts a Send now whose interrupt fails", async () =>
	{
		const interrupt = vi.fn<() => Promise<void>>(async () => Promise.reject(new Error("herdr down")));
		const {result} = renderQueue(
			{
				busy: true,
				deliver: vi.fn<Deliver>(),
				interrupt,
				sessionId: "session-rejected",
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
		});
		const alice = result.current.items[0];
		if (alice === undefined) throw new Error("Expected Alice's queued prompt");
		await act(async () => result.current.sendNow(alice.id));
		expect(
			{
				accepted: [...result.current.acceptedIds],
				announcement: peekAnnouncement("session-rejected"),
			},
		).toStrictEqual(
			{
				accepted: [],
				announcement: undefined,
			},
		);
	});

	it("drops an accepted prompt removed from the queue", async () =>
	{
		const {result} = renderQueue(
			{
				busy: true,
				deliver: vi.fn<Deliver>(),
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
		});
		const alice = result.current.items[0];
		if (alice === undefined) throw new Error("Expected Alice's queued prompt");
		await act(async () => result.current.sendNow(alice.id));
		const accepted = [...result.current.acceptedIds];
		act(() =>
		{
			result.current.remove(alice.id);
		});
		expect(
			{
				accepted,
				after: [...result.current.acceptedIds],
			},
		).toStrictEqual(
			{
				accepted: [alice.id],
				after: [],
			},
		);
		clearAnnouncements();
	});

	it("reports a failed Send now interrupt and keeps the prompt queued", async () =>
	{
		const onSendNowFailed = vi.fn<() => void>();
		const interrupt = vi.fn<() => Promise<void>>(async () => Promise.reject(new Error("herdr down")));
		const {result} = renderQueue(
			{
				busy: true,
				deliver: vi.fn<Deliver>(),
				interrupt,
				onSendNowFailed,
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
		});
		const alice = result.current.items[0];
		if (alice === undefined) throw new Error("Expected Alice's queued prompt");
		await act(async () => result.current.sendNow(alice.id));
		expect(
			{
				failed: onSendNowFailed.mock.calls,
				texts: result.current.items.map((item) => item.text),
				message: SEND_NOW_FAILED_MESSAGE,
			},
		).toStrictEqual(
			{
				failed: [[]],
				texts: ["Alice's first follow-up"],
				message: "Couldn’t send the message now. It’s still in the queue.",
			},
		);
	});

	it("restores the order and never flashes landed when the Send now interrupt fails", async () =>
	{
		const onSendNowFailed = vi.fn<() => void>();
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const interrupt = vi.fn<() => Promise<void>>(async () => Promise.reject(new Error("herdr down")));
		const {result, setBusy} = renderQueue(
			{
				busy: true,
				deliver,
				interrupt,
				onSendNowFailed,
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
		});
		const bob = result.current.items[1];
		if (bob === undefined) throw new Error("Expected Bob's queued prompt");
		await act(async () => result.current.sendNow(bob.id));
		const order = result.current.items.map((item) => item.text);
		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(1);
		});
		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(2);
		});
		expect(
			{
				order,
				delivered: deliver.mock.calls.map(([text]) => text),
				landed: isLanded("Bob's second follow-up"),
				failed: onSendNowFailed.mock.calls,
			},
		).toStrictEqual(
			{
				order: ["Alice's first follow-up", "Bob's second follow-up"],
				delivered: ["Alice's first follow-up", "Bob's second follow-up"],
				landed: false,
				failed: [[]],
			},
		);
		clearLanded();
	});

	it("moves an idle Send now to the head without flashing landed, since it starts a new turn", async () =>
	{
		let releaseAlice = (_result: DeliveryResult) =>
		{
		};
		const deliver = vi.fn<Deliver>(async (text) =>
			text === "Alice's first follow-up"
				? new Promise<DeliveryResult>((resolve) =>
					{
						releaseAlice = resolve;
					})
				: Promise.resolve("sent"),
		);
		const interrupt = vi.fn<() => Promise<void>>(async () => {});
		const {result, setBusy} = renderQueue(
			{
				busy: true,
				deliver,
				interrupt,
			},
		);
		act(() =>
		{
			result.current.enqueue("Alice's first follow-up");
			result.current.enqueue("Bob's second follow-up");
			result.current.enqueue("Carol's third follow-up");
		});
		// Alice's delivery is held in flight, so the session is idle while Bob and Carol wait.
		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(1);
		});
		const carol = result.current.items[1];
		if (carol === undefined) throw new Error("Expected Carol's queued prompt");
		await act(async () => result.current.sendNow(carol.id));
		const order = result.current.items.map((item) => item.text);
		await act(async () =>
		{
			releaseAlice("sent");
			await Promise.resolve();
		});
		setBusy(false);
		await waitFor(() =>
		{
			expect(deliver.mock.calls.length).toBe(2);
		});
		expect(
			{
				order,
				delivered: deliver.mock.calls.map(([text]) => text),
				interrupts: interrupt.mock.calls.length,
				landed: isLanded("Carol's third follow-up"),
			},
		).toStrictEqual(
			{
				order: ["Carol's third follow-up", "Bob's second follow-up"],
				delivered: ["Alice's first follow-up", "Carol's third follow-up"],
				interrupts: 0,
				landed: false,
			},
		);
		clearLanded();
	});

	it("keeps queues per session", () =>
	{
		const deliver = vi.fn<Deliver>(async () => Promise.resolve("sent"));
		const alice = renderQueue(
			{
				busy: true,
				deliver,
				sessionId: "session-alice",
			},
		);
		const bob = renderQueue(
			{
				busy: true,
				deliver,
				sessionId: "session-bob",
			},
		);
		act(() =>
		{
			alice.result.current.enqueue("Alice's follow-up");
		});

		expect(
			{
				alice: alice.result.current.items.map((item) => item.text),
				bob: bob.result.current.items.map((item) => item.text),
			},
		).toStrictEqual(
			{
				alice: ["Alice's follow-up"],
				bob: [],
			},
		);
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
})
{
	render(
		<ToastContext.Provider value={toast}>
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={(prompt) =>
				{
					onSend(prompt);
				}}
				onStop={onStop}
				queue={queue}
				onQueueForLater={onQueueForLater}
				slashCommands={slashCommands}
			/>
		</ToastContext.Provider>,
	);
	return screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
}

function queueView(items: readonly QueuedPrompt[])
{
	return {
		items,
		sendNow: vi.fn<(id: string) => Promise<void>>(async () => {}),
		remove: vi.fn<(id: string) => void>(),
		clear: vi.fn<() => void>(),
	};
}

async function openRowMenu(index: number)
{
	fireEvent.click(
		screen.getByRole(
			"button",
			{
				name: /messages queued/,
			},
		),
	);
	const triggers = screen.getAllByRole(
		"button",
		{
			name: "Queued message actions",
		},
	);
	const trigger = triggers[index];
	if (trigger === undefined) throw new Error(`Expected row ${index}`);
	fireEvent.click(trigger);
	return await screen.findByRole("menu");
}

describe("Composer queued message bar", () =>
{
	it("shows the queued band above the composer with an sr-only status", () =>
	{
		renderComposer(
			{
				queue: queueView([ALICE, BOB]),
			},
		);
		const bar = screen.getByRole(
			"button",
			{
				name: /2 messages queued/,
			},
		);
		const status = screen.getByTestId("coach-queued-status");

		expect(
			{
				bar: bar.textContent,
				status:
				{
					tag: status.tagName,
					className: status.className,
					role: status.getAttribute("role"),
					live: status.getAttribute("aria-live"),
					atomic: status.getAttribute("aria-atomic"),
					text: status.textContent,
				},
			},
		).toStrictEqual(
			{
				bar: "2 messages queuedNext: Alice's first follow-up",
				status:
				{
					tag: "P",
					className: "sr-only",
					role: null,
					live: "polite",
					atomic: "true",
					text: "2 messages queued. Will send after the current response.",
				},
			},
		);
	});

	it("lists only prompts queued for later: a steer draws in the transcript instead", () =>
	{
		const steer: QueuedPrompt =
		{
			id: "q4",
			text: "Dave's answer instead",
			midTurn: true,
		};
		renderComposer(
			{
				queue: queueView([steer, ALICE]),
			},
		);
		expect(
			{
				band: document.querySelector("[data-take-back-entry]")?.textContent.includes("1 message queued"),
				steerShown: document.body.textContent.includes("Dave's answer instead"),
				status: screen.getByTestId("coach-queued-status").textContent,
			},
		).toStrictEqual(
			{
				band: true,
				steerShown: false,
				status: "1 message queued. Will send after the current response.",
			},
		);
	});

	it("renders no band when only steers are held", () =>
	{
		renderComposer(
			{
				queue: queueView([
					{
						id: "q4",
						text: "Dave's answer instead",
						midTurn: true,
					},
				]),
			},
		);
		expect(
			{
				band: document.querySelector("[data-take-back-entry]"),
				status: screen.getByTestId("coach-queued-status").textContent,
			},
		).toStrictEqual(
			{
				band: null,
				status: "",
			},
		);
	});

	it("renders nothing without queued prompts", () =>
	{
		renderComposer(
			{
				queue: queueView([]),
			},
		);
		expect(document.querySelector("[data-take-back-entry]")).toBeNull();
	});

	it("Edit in composer moves the prompt back into the editor", async () =>
	{
		const queue = queueView([ALICE, BOB]);
		const textarea = renderComposer(
			{
				queue,
			},
		);
		const menu = await openRowMenu(1);
		fireEvent.click(
			within(menu).getByRole(
				"menuitem",
				{
					name: "Edit in composer",
				},
			),
		);

		expect(
			{
				value: textarea.value,
				removed: queue.remove.mock.calls,
			},
		).toStrictEqual(
			{
				value: "Bob's second follow-up",
				removed: [["q2"]],
			},
		);
	});

	it("Send now forwards the entry id", () =>
	{
		const queue = queueView([BOB]);
		renderComposer(
			{
				queue,
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Send now",
				},
			),
		);
		expect(queue.sendNow.mock.calls).toStrictEqual([["q2"]]);
	});

	it("Clear all empties the queue in one action", () =>
	{
		const queue = queueView([ALICE, BOB]);
		renderComposer(
			{
				queue,
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /2 messages queued/,
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Clear all",
				},
			),
		);
		expect(
			{
				cleared: queue.clear.mock.calls,
				removed: queue.remove.mock.calls,
			},
		).toStrictEqual(
			{
				cleared: [[]],
				removed: [],
			},
		);
	});

	it("Remove from queue removes at once, without a confirm", () =>
	{
		const queue = queueView([ALICE]);
		renderComposer(
			{
				queue,
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Remove from queue",
				},
			),
		);
		expect(
			{
				removed: queue.remove.mock.calls,
				dialog: screen.queryByRole("alertdialog"),
			},
		).toStrictEqual(
			{
				removed: [["q1"]],
				dialog: null,
			},
		);
	});

	it("Edit in composer over a draft toasts a warning and keeps the entry", () =>
	{
		const queue = queueView([ALICE]);
		const toast = vi.fn<(options: ToastOptions) => void>();
		const textarea = renderComposer(
			{
				queue,
				toast,
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "Bob's draft",
				},
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Edit in composer",
				},
			),
		);

		expect(
			{
				value: textarea.value,
				removed: queue.remove.mock.calls,
				toasts: toast.mock.calls,
			},
		).toStrictEqual(
			{
				value: "Bob's draft",
				removed: [],
				toasts: [
					[
						{
							kind: "warning",
							message: "The input already has a draft. Clear it to pull this message back in.",
						},
					],
				],
			},
		);
	});

	it("Edit in composer with an empty draft fills and focuses the composer", () =>
	{
		const queue = queueView([ALICE]);
		const textarea = renderComposer(
			{
				queue,
			},
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Edit in composer",
				},
			),
		);

		expect(
			{
				value: textarea.value,
				focused: document.activeElement === textarea,
				removed: queue.remove.mock.calls,
			},
		).toStrictEqual(
			{
				value: "Alice's first follow-up",
				focused: true,
				removed: [["q1"]],
			},
		);
	});
});

describe("Composer while working", () =>
{
	it("keeps the editor enabled and sends on Enter while the slot is Stop", () =>
	{
		const onSend = vi.fn<(prompt: string) => void>();
		const textarea = renderComposer(
			{
				onSend,
				onStop: () =>
				{
				},
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "Alice's follow-up",
				},
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
			},
		);

		expect(
			{
				disabled: textarea.disabled,
				sent: onSend.mock.calls,
				cleared: textarea.value,
			},
		).toStrictEqual(
			{
				disabled: false,
				sent: [["Alice's follow-up"]],
				cleared: "",
			},
		);
	});

	it("queues for later on ⌘⏎ and Ctrl+⏎ without sending or stopping", () =>
	{
		const onSend = vi.fn<(prompt: string) => void>();
		const onQueueForLater = vi.fn<(prompt: string) => void>();
		const onStop = vi.fn<() => void>();
		const textarea = renderComposer(
			{
				onSend,
				onQueueForLater,
				onStop,
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "Alice's later prompt",
				},
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
				metaKey: true,
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "Bob's later prompt",
				},
			},
		);
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
				ctrlKey: true,
			},
		);

		expect(
			{
				sent: onSend.mock.calls,
				later: onQueueForLater.mock.calls,
				stops: onStop.mock.calls,
			},
		).toStrictEqual(
			{
				sent: [],
				later: [["Alice's later prompt"], ["Bob's later prompt"]],
				stops: [],
			},
		);
	});

	it("shows upstream's working placeholder with ⌘⏎ on Mac", () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
		const textarea = renderComposer(
			{
				onQueueForLater: () =>
				{
				},
				onStop: () =>
				{
				},
			},
		);

		expect(textarea.getAttribute("aria-placeholder")).toBe("⏎ to send, ⌘⏎ to queue for later");
	});

	it("shows the working placeholder with Ctrl⏎ off Mac", () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
		const textarea = renderComposer(
			{
				onQueueForLater: () =>
				{
				},
				onStop: () =>
				{
				},
			},
		);

		expect(textarea.getAttribute("aria-placeholder")).toBe("⏎ to send, Ctrl⏎ to queue for later");
	});

	it("picks the compact working placeholder only when the full sentence doesn't fit", () =>
	{
		expect(
			{
				fitsMac: pickWorkingPlaceholder(
					{
						fits: true,
						isMac: true,
					},
				),
				overflowMac: pickWorkingPlaceholder(
					{
						fits: false,
						isMac: true,
					},
				),
				overflowOther: pickWorkingPlaceholder(
					{
						fits: false,
						isMac: false,
					},
				),
			},
		).toStrictEqual(
			{
				fitsMac: "⏎ to send, ⌘⏎ to queue for later",
				overflowMac: "⌘⏎ to queue",
				overflowOther: "Ctrl⏎ to queue",
			},
		);
	});

	it("shows the compact working placeholder when the full one overflows, keeping the full aria-placeholder", () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(120);
		vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(260);
		const textarea = renderComposer(
			{
				onQueueForLater: () =>
				{
				},
				onStop: () =>
				{
				},
			},
		);

		expect(
			{
				visible: screen.getByTestId("composer-placeholder-text").textContent,
				aria: textarea.getAttribute("aria-placeholder"),
			},
		).toStrictEqual(
			{
				visible: "⌘⏎ to queue",
				aria: "⏎ to send, ⌘⏎ to queue for later",
			},
		);
	});

	it("keeps the full working placeholder visible when it fits", () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
		renderComposer(
			{
				onQueueForLater: () =>
				{
				},
				onStop: () =>
				{
				},
			},
		);

		expect(screen.getByTestId("composer-placeholder-text").textContent).toBe("⏎ to send, ⌘⏎ to queue for later");
	});

	it("keeps the normal placeholder on a coarse pointer, where plain Enter doesn't send (upstream's gate)", () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
		);
		vi.stubGlobal(
			"matchMedia",
			(query: string) =>
				(
				{
					matches: query === "(pointer: coarse)",
					media: query,
					addEventListener: () =>
					{
					},
					removeEventListener: () =>
					{
					},
				}) as unknown as MediaQueryList,
		);
		try
		{
			const textarea = renderComposer(
				{
					onQueueForLater: () =>
					{
					},
					onStop: () =>
					{
					},
				},
			);
			expect(textarea.getAttribute("aria-placeholder")).toBe("Type / for commands");
		}
		finally
		{
			vi.unstubAllGlobals();
		}
	});

	it("keeps the working placeholder on a coarse Windows pointer, where plain Enter still sends", () =>
	{
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
		vi.stubGlobal(
			"matchMedia",
			(query: string) =>
				(
				{
					matches: query === "(pointer: coarse)",
					media: query,
					addEventListener: () =>
					{
					},
					removeEventListener: () =>
					{
					},
				}) as unknown as MediaQueryList,
		);
		try
		{
			const textarea = renderComposer(
				{
					onQueueForLater: () =>
					{
					},
					onStop: () =>
					{
					},
				},
			);
			expect(textarea.getAttribute("aria-placeholder")).toBe("⏎ to send, Ctrl⏎ to queue for later");
		}
		finally
		{
			vi.unstubAllGlobals();
		}
	});

	it("keeps the normal placeholder while the composer is disabled", () =>
	{
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
				onStop={() =>
				{
				}}
				onQueueForLater={() =>
				{
				}}
				disabled
			/>,
		);

		expect(
			screen
				.getByRole(
					"textbox",
					{
						name: "Prompt",
					},
				)
				.getAttribute("aria-placeholder"),
		).toBe("Type / for commands");
	});

	it("keeps the idle placeholder when the live pane is not working", () =>
	{
		const textarea = renderComposer(
			{
				onQueueForLater: () =>
				{
				},
			},
		);

		expect(textarea.getAttribute("aria-placeholder")).toBe("Type / for commands");
	});

	it("draws upstream's StopFilled glyph on the Stop face, with no scale-90 wrapper", () =>
	{
		renderComposer(
			{
				onStop: () =>
				{
				},
			},
		);
		const stop = screen.getByRole(
			"button",
			{
				name: "Stop",
			},
		);
		const rect = stop.querySelector("svg rect");

		expect(
			{
				rect:
					rect === null
						? null
						:
							{
								x: rect.getAttribute("x"),
								y: rect.getAttribute("y"),
								width: rect.getAttribute("width"),
								height: rect.getAttribute("height"),
								rx: rect.getAttribute("rx"),
								fill: rect.getAttribute("fill"),
							},
				viewBox: stop.querySelector("svg")?.getAttribute("viewBox"),
				scaled: stop.querySelector(".scale-90") !== null,
			},
		).toStrictEqual(
			{
				rect:
				{
					x: "4",
					y: "4",
					width: "12",
					height: "12",
					rx: "2.5",
					fill: "currentColor",
				},
				viewBox: "0 0 20 20",
				scaled: false,
			},
		);
	});

	it("swallows a repeated ⌘⏎ keydown", () =>
	{
		const onSend = vi.fn<(prompt: string) => void>();
		const onQueueForLater = vi.fn<(prompt: string) => void>();
		const textarea = renderComposer(
			{
				onSend,
				onQueueForLater,
				onStop: () =>
				{
				},
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "Alice's held-down prompt",
				},
			},
		);
		const notCancelled = fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
				metaKey: true,
				repeat: true,
			},
		);

		expect(
			{
				notCancelled,
				sent: onSend.mock.calls,
				later: onQueueForLater.mock.calls,
				draft: textarea.value,
			},
		).toStrictEqual(
			{
				notCancelled: false,
				sent: [],
				later: [],
				draft: "Alice's held-down prompt",
			},
		);
	});
});

describe("Esc modal guard", () =>
{
	function Stopper({
		onInterrupt,
		queue,
		slashCommands,
		onEscapeRecall,
	}: {
		onInterrupt: () => void;
		queue?: ComposerQueueView;
		slashCommands?: readonly SlashCommand[];
		onEscapeRecall?: () => boolean;
	})
	{
		const stop = useStopResponse(
			{
				sessionId: "session-alice",
				enabled: true,
				interrupt: async () =>
				{
				},
				onInterrupt,
				onError: () =>
				{
				},
				...(onEscapeRecall === undefined
					? {}
					:
						{
							onEscapeRecall,
						}),
			},
		);
		return (
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={() =>
				{
				}}
				onStop={stop}
				queue={queue}
				slashCommands={slashCommands}
			/>
		);
	}

	it("stops on Esc from the editor when nothing is open (no steer recall: a steer already typed into the CLI can't be taken back)", () =>
	{
		const onInterrupt = vi.fn<() => void>();
		render(<Stopper onInterrupt={onInterrupt} />);
		const textarea = screen.getByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);
		textarea.focus();
		fireEvent.keyDown(
			textarea,
			{
				key: "Escape",
				code: "Escape",
			},
		);
		expect(onInterrupt.mock.calls.length).toBe(1);
	});

	const HELD_ALICE: QueuedPrompt =
	{
		id: "s1",
		text: "Alice's first steer",
		midTurn: true,
	};
	const HELD_BOB: QueuedPrompt =
	{
		id: "s2",
		text: "Bob's second steer",
		midTurn: true,
	};

	function RecallingStopper({onInterrupt, initial}: {onInterrupt: () => void; initial: readonly QueuedPrompt[]})
	{
		const [held, setHeld] = useState(initial);
		return (
			<>
				<Stopper
					onInterrupt={onInterrupt}
					onEscapeRecall={() =>
						recallLastHeldSteer("session-alice", held, (id) =>
						{
							setHeld((items) => items.filter((item) => item.id !== id));
						})
					}
				/>
				<output data-testid="held">{held.map((item) => item.text).join("|")}</output>
			</>
		);
	}

	it("recalls the last browser-held steer into an empty composer on Esc instead of stopping", () =>
	{
		const onInterrupt = vi.fn<() => void>();
		render(<RecallingStopper onInterrupt={onInterrupt} initial={[HELD_ALICE, HELD_BOB]} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
		fireEvent.keyDown(
			document.body,
			{
				key: "Escape",
				code: "Escape",
			},
		);

		expect(
			{
				draft: textarea.value,
				focused: document.activeElement === textarea,
				held: screen.getByTestId("held").textContent,
				interrupts: onInterrupt.mock.calls.length,
			},
		).toStrictEqual(
			{
				draft: "Bob's second steer",
				focused: true,
				held: "Alice's first steer",
				interrupts: 0,
			},
		);
	});

	it("stops on Esc over a draft, keeping the held steer (the take-back refuses over a draft)", () =>
	{
		const onInterrupt = vi.fn<() => void>();
		render(<RecallingStopper onInterrupt={onInterrupt} initial={[HELD_ALICE]} />);
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "Carol's draft",
				},
			},
		);
		fireEvent.keyDown(
			document.body,
			{
				key: "Escape",
				code: "Escape",
			},
		);

		expect(
			{
				draft: textarea.value,
				held: screen.getByTestId("held").textContent,
				interrupts: onInterrupt.mock.calls.length,
			},
		).toStrictEqual(
			{
				draft: "Carol's draft",
				held: "Alice's first steer",
				interrupts: 1,
			},
		);
	});

	it("stops once on Esc with no browser-held steer (a steer already typed into the CLI is never recalled)", () =>
	{
		const onInterrupt = vi.fn<() => void>();
		render(<RecallingStopper onInterrupt={onInterrupt} initial={[]} />);
		fireEvent.keyDown(
			document.body,
			{
				key: "Escape",
				code: "Escape",
			},
		);

		expect(onInterrupt.mock.calls.length).toBe(1);
	});

	it("stops from the Stop button even with a held steer: only Esc recalls", () =>
	{
		const onInterrupt = vi.fn<() => void>();
		render(<RecallingStopper onInterrupt={onInterrupt} initial={[HELD_ALICE]} />);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Stop",
				},
			),
		);

		expect(
			{
				held: screen.getByTestId("held").textContent,
				interrupts: onInterrupt.mock.calls.length,
			},
		).toStrictEqual(
			{
				held: "Alice's first steer",
				interrupts: 1,
			},
		);
	});

	it("closes the slash popup instead of stopping", () =>
	{
		const onInterrupt = vi.fn<() => void>();
		render(
			<Stopper
				onInterrupt={onInterrupt}
				slashCommands={[
					{
						name: "review",
						description: "Review code",
						source: "builtin",
					},
				]}
			/>,
		);
		const textarea = screen.getByRole(
			"textbox",
			{
				name: "Prompt",
			},
		);
		textarea.focus();
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "/rev",
				},
			},
		);
		const openBefore = screen.queryByRole("menu") !== null;
		fireEvent.keyDown(
			textarea,
			{
				key: "Escape",
				code: "Escape",
			},
		);

		expect(
			{
				openBefore,
				interrupts: onInterrupt.mock.calls.length,
			},
		).toStrictEqual(
			{
				openBefore: true,
				interrupts: 0,
			},
		);
	});

	it("does not stop while a queued row's menu is open", async () =>
	{
		const onInterrupt = vi.fn<() => void>();
		render(<Stopper onInterrupt={onInterrupt} queue={queueView([ALICE, BOB])} />);
		const menu = await openRowMenu(0);
		const item = within(menu).getByRole(
			"menuitem",
			{
				name: "Remove from queue",
			},
		);
		item.focus();
		fireEvent.keyDown(
			item,
			{
				key: "Escape",
				code: "Escape",
			},
		);

		expect(onInterrupt.mock.calls.length).toBe(0);
	});
});
