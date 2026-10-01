import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, render} from "@testing-library/react";
import {Profiler, type ReactNode} from "react";
import {vi} from "vite-plus/test";
import {openEventSourceListeners} from "./fake-event-source";

/**
 * Client lab harness (measurement plan §4.3). It renders a tree, lets it settle, then counts what one interaction
 * costs: React commits, DOM mutations, fetches, hidden query reloads, component renders and live subscriptions. It
 * counts and never times.
 */
export interface InteractionMeasurement {
	commits: number;
	commitsBySubtree: Record<string, number>;
	mutations: number;
	fetches: {count: number; bytes: number; urls: Array<string>};
	hiddenReloads: number;
	rendersByComponent: Record<string, number>;
	subscriptions: {queryCacheListeners: number; queryObservers: number; eventSourceListeners: number};
}

export interface MeasureOptions {
	/** Response bodies keyed by request URL (or its path and query); each is served as JSON. */
	fixtures: Record<string, unknown>;
	queryClient?: QueryClient;
	/** Query fetches the interaction is supposed to make; only the rest count as hidden reloads. */
	expectedQueryFetches?: number;
}

export interface InteractionContext {
	queryClient: QueryClient;
}

interface Recorder {
	measuring: boolean;
	commits: number;
	commitsBySubtree: Map<string, number>;
	renders: Map<string, number>;
}

let activeRecorder: Recorder | undefined;

function increment(map: Map<string, number>, key: string): void {
	map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedRecord(map: Map<string, number>): Record<string, number> {
	return Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function onSubtreeRender(id: string): void {
	if (activeRecorder?.measuring === true) {
		increment(activeRecorder.commitsBySubtree, id);
	}
}

/** A named `<Profiler>` whose commits are reported under `commitsBySubtree[id]`. */
export function PerfSubtree({id, children}: {id: string; children: ReactNode}) {
	return (
		<Profiler id={id} onRender={onSubtreeRender}>
			{children}
		</Profiler>
	);
}

/** Counts this component's renders under `rendersByComponent[name]` while an interaction is measured. */
export function useRenderCount(name: string): void {
	if (activeRecorder?.measuring === true) {
		increment(activeRecorder.renders, name);
	}
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
}

function fixtureFor(fixtures: Record<string, unknown>, url: string): {found: boolean; body: unknown} {
	if (Object.hasOwn(fixtures, url)) {
		return {found: true, body: fixtures[url]};
	}
	const parsed = new URL(url, "http://localhost");
	const pathAndQuery = `${parsed.pathname}${parsed.search}`;
	if (Object.hasOwn(fixtures, pathAndQuery)) {
		return {found: true, body: fixtures[pathAndQuery]};
	}
	return {found: false, body: undefined};
}

const MAX_SETTLE_ROUNDS = 100;

/** Drains microtasks and one macrotask turn, which is where TanStack Query's notifyManager delivers updates. */
async function flushRound(): Promise<void> {
	await act(async () => {
		for (let index = 0; index < 10; index++) {
			await Promise.resolve();
		}
		if (vi.isFakeTimers()) {
			vi.advanceTimersByTime(0);
		} else {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			});
		}
	});
}

export async function measureInteraction(
	renderTree: () => ReactNode,
	interact: (context: InteractionContext) => void | Promise<void>,
	options: MeasureOptions,
): Promise<InteractionMeasurement> {
	const queryClient = options.queryClient ?? new QueryClient({defaultOptions: {queries: {retry: false}}});
	const queryCache = queryClient.getQueryCache();
	const recorder: Recorder = {measuring: false, commits: 0, commitsBySubtree: new Map(), renders: new Map()};
	activeRecorder = recorder;

	const fetched: Array<{url: string; bytes: number}> = [];
	const unmatched: Array<string> = [];
	let inFlight = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = requestUrl(input);
			const fixture = fixtureFor(options.fixtures, url);
			if (!fixture.found) {
				unmatched.push(url);
				return new Promise<Response>(() => {});
			}
			const text = JSON.stringify(fixture.body);
			if (recorder.measuring) {
				fetched.push({url, bytes: Buffer.byteLength(text)});
			}
			inFlight++;
			try {
				await Promise.resolve();
				return new Response(text, {status: 200, headers: {"content-type": "application/json"}});
			} finally {
				inFlight--;
			}
		}),
	);

	let queryFetches = 0;
	queryCache.subscribe((event) => {
		if (recorder.measuring && event.type === "updated" && event.action.type === "fetch") {
			queryFetches++;
		}
	});
	let queryCacheListeners = 0;
	const subscribe = queryCache.subscribe.bind(queryCache);
	queryCache.subscribe = (listener) => {
		queryCacheListeners++;
		const unsubscribe = subscribe(listener);
		return () => {
			queryCacheListeners--;
			unsubscribe();
		};
	};

	const settle = async () => {
		for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
			await flushRound();
			if (inFlight === 0 && queryClient.isFetching() === 0 && queryClient.isMutating() === 0) {
				await flushRound();
				return;
			}
		}
		throw new Error("measureInteraction: the tree did not settle");
	};

	const onAppRender = () => {
		if (recorder.measuring) {
			recorder.commits++;
		}
	};

	let mutations = 0;
	const observer = new MutationObserver((records) => {
		if (recorder.measuring) {
			mutations += records.length;
		}
	});

	try {
		render(
			<Profiler id="app" onRender={onAppRender}>
				<QueryClientProvider client={queryClient}>{renderTree()}</QueryClientProvider>
			</Profiler>,
		);
		await settle();

		observer.observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true});
		recorder.measuring = true;
		await act(async () => {
			await interact({queryClient});
		});
		await settle();
		mutations += observer.takeRecords().length;
		recorder.measuring = false;

		if (unmatched.length > 0) {
			throw new Error(`measureInteraction: no fixture for fetch ${unmatched.join(", ")}`);
		}

		return {
			commits: recorder.commits,
			commitsBySubtree: sortedRecord(recorder.commitsBySubtree),
			mutations,
			fetches: {
				count: fetched.length,
				bytes: fetched.reduce((sum, entry) => sum + entry.bytes, 0),
				urls: fetched.map((entry) => entry.url),
			},
			hiddenReloads: Math.max(0, queryFetches - (options.expectedQueryFetches ?? 0)),
			rendersByComponent: sortedRecord(recorder.renders),
			subscriptions: {
				queryCacheListeners,
				queryObservers: queryCache.getAll().reduce((sum, query) => sum + query.getObserversCount(), 0),
				eventSourceListeners: openEventSourceListeners(),
			},
		};
	} finally {
		recorder.measuring = false;
		observer.disconnect();
		if (activeRecorder === recorder) {
			activeRecorder = undefined;
		}
	}
}
