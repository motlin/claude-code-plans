import {vi} from "vite-plus/test";

type Listener = EventListenerOrEventListenerObject;

/**
 * A scriptable `EventSource` for client lab tests (measurement plan §4.3). J4 tests `emit` SSE domain events and J1
 * tests `open` to simulate a (re)connect. Nothing is delivered after `close()`, like the real one.
 */
export class FakeEventSource {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 2;
	static instances: Array<FakeEventSource> = [];

	static last(): FakeEventSource {
		const instance = FakeEventSource.instances.at(-1);
		if (instance === undefined) {
			throw new Error("FakeEventSource: no EventSource has been constructed");
		}
		return instance;
	}

	readonly url: string;
	readyState: number = FakeEventSource.CONNECTING;
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	private readonly listeners = new Map<string, Set<Listener>>();

	constructor(url: string | URL) {
		this.url = String(url);
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: Listener | null): void {
		if (listener === null) {
			return;
		}
		const set = this.listeners.get(type) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(type, set);
	}

	removeEventListener(type: string, listener: Listener | null): void {
		if (listener !== null) {
			this.listeners.get(type)?.delete(listener);
		}
	}

	/** Listeners registered with `addEventListener`, plus any `on*` handler that is set. */
	listenerCount(): number {
		let count = 0;
		for (const set of this.listeners.values()) {
			count += set.size;
		}
		for (const handler of [this.onopen, this.onmessage, this.onerror]) {
			if (handler !== null) {
				count += 1;
			}
		}
		return count;
	}

	close(): void {
		this.readyState = FakeEventSource.CLOSED;
		this.listeners.clear();
		this.onopen = null;
		this.onmessage = null;
		this.onerror = null;
	}

	open(): void {
		if (this.readyState === FakeEventSource.CLOSED) {
			return;
		}
		this.readyState = FakeEventSource.OPEN;
		this.dispatch("open", new Event("open"), this.onopen);
	}

	/** Delivers an SSE event; an object payload is sent as JSON text, the way the server writes it. */
	emit(type: string, payload: unknown): void {
		if (this.readyState === FakeEventSource.CLOSED) {
			return;
		}
		const data = typeof payload === "string" ? payload : JSON.stringify(payload);
		const event = new MessageEvent(type, {data});
		this.dispatch(type, event, type === "message" ? this.onmessage : null);
	}

	error(): void {
		if (this.readyState === FakeEventSource.CLOSED) {
			return;
		}
		this.readyState = FakeEventSource.CONNECTING;
		this.dispatch("error", new Event("error"), this.onerror);
	}

	private dispatch<E extends Event>(type: string, event: E, handler: ((event: E) => void) | null): void {
		handler?.(event);
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			if (typeof listener === "function") {
				listener(event);
			} else {
				listener.handleEvent(event);
			}
		}
	}
}

/** Replaces the global `EventSource` with `FakeEventSource` and forgets earlier instances. */
export function installFakeEventSource(): typeof FakeEventSource {
	FakeEventSource.instances = [];
	vi.stubGlobal("EventSource", FakeEventSource);
	return FakeEventSource;
}

/** Listeners across every open `FakeEventSource`; 0 when the global is not the fake. */
export function openEventSourceListeners(): number {
	if (globalThis.EventSource !== (FakeEventSource as unknown)) {
		return 0;
	}
	return FakeEventSource.instances
		.filter((instance) => instance.readyState !== FakeEventSource.CLOSED)
		.reduce((sum, instance) => sum + instance.listenerCount(), 0);
}
