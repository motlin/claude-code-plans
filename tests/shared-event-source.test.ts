import {describe, expect, it} from "vite-plus/test";
import {
	openSharedEventSource,
	type SharedEventSourceDeps,
	type SharedEventSourceOptions,
	type SnapshotEvent,
} from "../src/lib/shared-event-source";

/** One browser origin: the Web Locks manager and the BroadcastChannel bus that every tab of it shares. */
class FakeOrigin {
	private readonly holders = new Map<string, symbol>();
	private readonly waiters = new Map<string, Array<() => void>>();
	private readonly channels = new Set<FakeChannel>();
	readonly streams: FakeStream[] = [];
	snapshot: SnapshotEvent[] = [{type: "subagents:snapshot", data: '{"subagents":[]}'}];
	snapshotFetches = 0;

	readonly locks: SharedEventSourceDeps["locks"] = {
		request: async (name, options, callback) => {
			const tryGrant = (): Promise<unknown> | undefined => {
				if (this.holders.has(name)) return undefined;
				const token = Symbol(name);
				this.holders.set(name, token);
				return Promise.resolve(callback({name})).finally(() => {
					this.holders.delete(name);
					const next = this.waiters.get(name)?.shift();
					next?.();
				});
			};
			const granted = tryGrant();
			if (granted) return granted;
			if (options.ifAvailable) return Promise.resolve(callback(null));
			return new Promise((resolve, reject) => {
				const queue = this.waiters.get(name) ?? [];
				const grant = () => {
					options.signal?.removeEventListener("abort", abort);
					tryGrant()!.then(resolve, reject);
				};
				const abort = () => {
					queue.splice(queue.indexOf(grant), 1);
					reject(new DOMException("aborted", "AbortError"));
				};
				options.signal?.addEventListener("abort", abort);
				queue.push(grant);
				this.waiters.set(name, queue);
			});
		},
	};

	createChannel = (name: string): FakeChannel => {
		const channel = new FakeChannel(name, this.channels);
		this.channels.add(channel);
		return channel;
	};

	/** A tab of this origin, recording what its consumer's listeners and resync callback saw. */
	openTab(options: {locks?: boolean} = {}): FakeTab {
		const tab: FakeTab = {received: [], resyncs: 0, close: () => {}};
		const consumer: SharedEventSourceOptions = {
			attach(target) {
				for (const type of ["session:start", "subagents:snapshot"]) {
					target.addEventListener(type, (e) => tab.received.push(`${e.type} ${(e as MessageEvent).data}`));
				}
			},
			onReconnected: () => tab.resyncs++,
		};
		tab.close = openSharedEventSource("/api/events", consumer, {
			locks: options.locks === false ? undefined : this.locks,
			createChannel: this.createChannel,
			openStream: (url, streamOptions) => {
				const stream = new FakeStream(url, streamOptions.resumeAfterGap === true, () => {
					streamOptions.onReconnected();
				});
				streamOptions.attach(stream as unknown as EventSource);
				this.streams.push(stream);
				return () => {
					stream.closed = true;
				};
			},
			fetchSnapshot: async () => {
				this.snapshotFetches++;
				return Promise.resolve(this.snapshot);
			},
		});
		return tab;
	}

	openStreams(): FakeStream[] {
		return this.streams.filter((stream) => !stream.closed);
	}
}

interface FakeTab {
	received: string[];
	resyncs: number;
	close: () => void;
}

class FakeChannel {
	onmessage: ((event: MessageEvent) => void) | null = null;
	constructor(
		readonly name: string,
		private readonly bus: Set<FakeChannel>,
	) {}

	postMessage(message: unknown): void {
		for (const other of this.bus) {
			if (other === this || other.name !== this.name) continue;
			queueMicrotask(() => other.onmessage?.(new MessageEvent("message", {data: message})));
		}
	}

	close(): void {
		this.bus.delete(this);
	}
}

class FakeStream extends EventTarget {
	closed = false;
	constructor(
		readonly url: string,
		readonly resumeAfterGap: boolean,
		private readonly onReconnected: () => void,
	) {
		super();
	}

	emit(type: string, data: string): void {
		this.dispatchEvent(new MessageEvent(type, {data}));
	}

	/** The stream opened, after a gap when the tab started it as a takeover or after an error. */
	open(): void {
		if (this.resumeAfterGap) this.onReconnected();
	}

	reconnect(): void {
		this.onReconnected();
	}
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++)
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
}

describe("openSharedEventSource", () => {
	it("opens one stream for every tab of the origin and fans its events out to all of them", async () => {
		const origin = new FakeOrigin();
		const tabs = Array.from({length: 8}, () => origin.openTab());
		await settle();

		origin.openStreams()[0]!.emit("session:start", '{"sessionId":"a"}');
		await settle();

		expect({
			streams: origin.openStreams().map((stream) => ({url: stream.url, resumeAfterGap: stream.resumeAfterGap})),
			received: tabs.map((tab) => tab.received.filter((line) => line.startsWith("session:start"))),
			resyncs: tabs.map((tab) => tab.resyncs),
		}).toStrictEqual({
			streams: [{url: "/api/events", resumeAfterGap: false}],
			received: Array.from({length: 8}, () => ['session:start {"sessionId":"a"}']),
			resyncs: [0, 0, 0, 0, 0, 0, 0, 0],
		});
	});

	it("gives a following tab the stream's connect-time snapshot before any relayed event", async () => {
		const origin = new FakeOrigin();
		origin.openTab();
		await settle();
		const follower = origin.openTab();
		origin.openStreams()[0]!.emit("session:start", '{"sessionId":"a"}');
		await settle();

		expect({fetches: origin.snapshotFetches, received: follower.received}).toStrictEqual({
			fetches: 1,
			received: ['subagents:snapshot {"subagents":[]}', 'session:start {"sessionId":"a"}'],
		});
	});

	it("catches every tab up when the leading tab's stream reconnects", async () => {
		const origin = new FakeOrigin();
		const tabs = [origin.openTab(), origin.openTab(), origin.openTab()];
		await settle();

		origin.openStreams()[0]!.reconnect();
		await settle();

		expect(tabs.map((tab) => tab.resyncs)).toStrictEqual([1, 1, 1]);
	});

	it("hands the stream to another tab when the leading tab closes, catching every remaining tab up once it opens", async () => {
		const origin = new FakeOrigin();
		const [leader, ...followers] = [origin.openTab(), origin.openTab(), origin.openTab()];
		await settle();

		leader.close();
		await settle();
		const [takeover] = origin.openStreams();
		const resyncsBeforeOpen = followers.map((tab) => tab.resyncs);
		takeover!.open();
		takeover!.emit("session:start", '{"sessionId":"b"}');
		await settle();

		expect({
			streams: origin.streams.map((stream) => ({closed: stream.closed, resumeAfterGap: stream.resumeAfterGap})),
			resyncsBeforeOpen,
			resyncs: followers.map((tab) => tab.resyncs),
			received: followers.map((tab) => tab.received.at(-1)),
		}).toStrictEqual({
			streams: [
				{closed: true, resumeAfterGap: false},
				{closed: false, resumeAfterGap: true},
			],
			resyncsBeforeOpen: [0, 0],
			resyncs: [1, 1],
			received: ['session:start {"sessionId":"b"}', 'session:start {"sessionId":"b"}'],
		});
	});

	it("stops waiting for the stream once a following tab closes", async () => {
		const origin = new FakeOrigin();
		const leader = origin.openTab();
		const follower = origin.openTab();
		await settle();

		follower.close();
		leader.close();
		await settle();

		expect(origin.openStreams()).toStrictEqual([]);
	});

	it("opens a stream per tab when the browser has no Web Locks", async () => {
		const origin = new FakeOrigin();
		const tabs = [origin.openTab({locks: false}), origin.openTab({locks: false})];
		await settle();

		for (const stream of origin.openStreams()) stream.emit("session:start", "{}");
		await settle();

		expect({
			streams: origin.openStreams().length,
			received: tabs.map((tab) => tab.received),
			fetches: origin.snapshotFetches,
		}).toStrictEqual({streams: 2, received: [["session:start {}"], ["session:start {}"]], fetches: 0});
	});
});
