// Chrome allows six HTTP/1.1 connections per origin, and every tab's event stream holds one forever, so six tabs
// starved every other fetch (a transcript's ?before= history page queued behind the streams). The tabs of an origin
// elect one leader with a Web Lock; it alone opens the stream and relays each event to the others over a
// BroadcastChannel. When the leader closes, the lock passes to a waiting tab, which opens the stream and has every
// tab catch up on the events missed in between.

import {z} from "zod";
import {assertNever} from "./assert-never";
import {
	openReconnectingEventSource,
	type ReconnectingEventSourceOptions,
	type StreamStatus,
} from "./reconnecting-event-source";

/** An event a fresh stream sends as soon as it connects, which a following tab fetches instead. */
const SnapshotEventSchema = z.strictObject({type: z.string(), data: z.string()});
export type SnapshotEvent = z.infer<typeof SnapshotEventSchema>;

const RelayMessageSchema = z.discriminatedUnion("kind", [
	z.strictObject({kind: z.literal("event"), type: z.string(), data: z.string()}),
	z.strictObject({kind: z.literal("resync")}),
	z.strictObject({kind: z.literal("status"), status: z.enum(["connecting", "connected", "reconnecting"])}),
	// A tab that starts following asks the leader for the stream's current status.
	z.strictObject({kind: z.literal("status-request")}),
]);
type RelayMessage = z.infer<typeof RelayMessageSchema>;

interface ChannelLike {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage(message: RelayMessage): void;
	close(): void;
}

interface LocksLike {
	request(
		name: string,
		options: {ifAvailable?: boolean; signal?: AbortSignal},
		callback: (lock: {name: string} | null) => unknown,
	): Promise<unknown>;
}

export interface SharedEventSourceDeps {
	locks: LocksLike | undefined;
	createChannel: ((name: string) => ChannelLike) | undefined;
	openStream(url: string, options: ReconnectingEventSourceOptions): () => void;
	fetchSnapshot(url: string): Promise<SnapshotEvent[]>;
}

export interface SharedEventSourceOptions {
	/** Adds the event listeners, once: the target delivers the shared stream's events to this tab. */
	attach(target: EventTarget): void;
	/** Runs when this tab may have missed events: the stream reconnected, or another tab took it over. */
	onReconnected(): void;
	/** Runs whenever the shared stream's status changes, and once a following tab learns the current status. */
	onStatus?(status: StreamStatus): void;
}

/** The URL a following tab fetches the stream's connect-time events from. */
function snapshotUrl(url: string): string {
	return `${url}?snapshot`;
}

function browserDeps(): SharedEventSourceDeps {
	return {
		locks: typeof navigator === "undefined" ? undefined : navigator.locks,
		createChannel: typeof BroadcastChannel === "undefined" ? undefined : (name) => new BroadcastChannel(name),
		openStream: openReconnectingEventSource,
		async fetchSnapshot(url) {
			const response = await fetch(snapshotUrl(url));
			if (!response.ok) throw new Error(`${response.status} fetching ${snapshotUrl(url)}`);
			return z.array(SnapshotEventSchema).parse(await response.json());
		},
	};
}

/** The listeners' target, which remembers the event types they listen for so the leader relays exactly those. */
class EventHub extends EventTarget {
	readonly types = new Set<string>();

	override addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean,
	): void {
		this.types.add(type);
		super.addEventListener(type, listener, options);
	}

	deliver(type: string, data: string): void {
		this.dispatchEvent(new MessageEvent(type, {data}));
	}
}

/**
 * Delivers an origin's event stream to this tab over one connection shared by all its tabs, or over a stream of
 * its own when the browser lacks Web Locks or BroadcastChannel. Returns a close function.
 */
export function openSharedEventSource(
	url: string,
	options: SharedEventSourceOptions,
	deps: SharedEventSourceDeps = browserDeps(),
): () => void {
	const {locks, createChannel} = deps;
	if (!locks || !createChannel) {
		return deps.openStream(url, {
			attach: (es) => {
				options.attach(es);
			},
			onReconnected: () => {
				options.onReconnected();
			},
			onStatus: (status) => options.onStatus?.(status),
		});
	}

	const hub = new EventHub();
	options.attach(hub);
	const channel = createChannel(`events:${url}`);
	const abort = new AbortController();
	let closed = false;
	let releaseLock = (): void => {};
	let closeStream = (): void => {};
	// A following tab holds relayed events here until the connect-time snapshot it fetched is delivered first.
	let pending: SnapshotEvent[] | null = null;
	// Set only while this tab leads: the status of the stream it owns.
	let leaderStatus: StreamStatus | undefined;

	const deliver = (type: string, data: string): void => {
		if (pending) pending.push({type, data});
		else hub.deliver(type, data);
	};

	channel.onmessage = (event: MessageEvent) => {
		const parsed = RelayMessageSchema.safeParse(event.data);
		if (!parsed.success) return;
		const message = parsed.data;
		switch (message.kind) {
			case "event":
				deliver(message.type, message.data);
				break;
			case "resync":
				options.onReconnected();
				break;
			case "status":
				options.onStatus?.(message.status);
				break;
			case "status-request":
				if (leaderStatus) channel.postMessage({kind: "status", status: leaderStatus});
				break;
			default:
				assertNever(message);
		}
	};

	const lead = async (resumeAfterGap: boolean): Promise<void> => {
		if (pending) {
			for (const event of pending) hub.deliver(event.type, event.data);
			pending = null;
		}
		closeStream = deps.openStream(url, {
			attach(es) {
				for (const type of hub.types) {
					es.addEventListener(type, (event) => {
						const data: unknown = event instanceof MessageEvent ? event.data : undefined;
						if (typeof data !== "string") return;
						hub.deliver(type, data);
						channel.postMessage({kind: "event", type, data});
					});
				}
			},
			onReconnected() {
				options.onReconnected();
				channel.postMessage({kind: "resync"});
			},
			onStatus(status) {
				leaderStatus = status;
				options.onStatus?.(status);
				channel.postMessage({kind: "status", status});
			},
			resumeAfterGap,
		});
		return new Promise<void>((resolve) => {
			releaseLock = resolve;
		});
	};

	const follow = (): void => {
		pending = [];
		channel.postMessage({kind: "status-request"});
		deps.fetchSnapshot(url).then(
			(snapshot) => {
				if (!pending) return;
				const relayed = pending;
				pending = null;
				for (const event of [...snapshot, ...relayed]) hub.deliver(event.type, event.data);
			},
			() => {
				if (!pending) return;
				const relayed = pending;
				pending = null;
				for (const event of relayed) hub.deliver(event.type, event.data);
			},
		);
		locks
			.request(url, {signal: abort.signal}, (): Promise<void> | undefined => (closed ? undefined : lead(true)))
			.catch(() => {
				// aborted when this tab closed while waiting
			});
	};

	void locks.request(url, {ifAvailable: true}, (lock): Promise<void> | undefined => {
		if (closed) return undefined;
		if (lock) return lead(false);
		follow();
		return undefined;
	});

	return () => {
		closed = true;
		abort.abort();
		closeStream();
		releaseLock();
		channel.onmessage = null;
		channel.close();
	};
}
