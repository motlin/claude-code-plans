// @vitest-environment jsdom

import {useIsFetching, useQuery, useQueryClient} from "@tanstack/react-query";
import {cleanup, fireEvent, screen} from "@testing-library/react";
import {useEffect, useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {FakeEventSource, installFakeEventSource} from "./fake-event-source";
import {installFixedResizeObserver} from "./fixed-resize-observer";
import {measureInteraction, PerfSubtree, useRenderCount} from "./measure-interaction";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function Loader() {
	useRenderCount("Loader");
	const [loading, setLoading] = useState(false);
	const [name, setName] = useState("");
	const load = async () => {
		setLoading(true);
		const response = await fetch("/api/thing");
		const body = (await response.json()) as {name: string};
		setName(body.name);
	};
	return (
		<div>
			<button type="button" onClick={() => void load()}>
				{loading ? "Loaded by" : "Load"}
			</button>
			<p>{name}</p>
		</div>
	);
}

function Static() {
	useRenderCount("Static");
	return <span>static</span>;
}

function ThingName() {
	useRenderCount("ThingName");
	const query = useQuery({
		queryKey: ["thing"],
		queryFn: async () => (await (await fetch("/api/thing")).json()) as {name: string},
	});
	return <p>{query.data?.name ?? "pending"}</p>;
}

function FetchingBadge() {
	const fetching = useIsFetching();
	useEffect(() => {
		const source = new EventSource("/api/events");
		source.addEventListener("session:lines-appended", () => {});
		return () => source.close();
	}, []);
	return <span>{fetching}</span>;
}

function Invalidator() {
	const queryClient = useQueryClient();
	return (
		<button type="button" onClick={() => void queryClient.invalidateQueries({queryKey: ["thing"]})}>
			Refresh
		</button>
	);
}

describe("measureInteraction", () => {
	it("counts the commits, mutations and fetches of a click that makes two state updates and one fetch", async () => {
		const result = await measureInteraction(
			() => (
				<>
					<PerfSubtree id="loader">
						<Loader />
					</PerfSubtree>
					<PerfSubtree id="static">
						<Static />
					</PerfSubtree>
				</>
			),
			() => {
				fireEvent.click(screen.getByRole("button"));
			},
			{fixtures: {"/api/thing": {name: "widget"}}},
		);

		expect({result, text: screen.getByRole("paragraph").textContent}).toStrictEqual({
			result: {
				commits: 2,
				commitsBySubtree: {loader: 2},
				mutations: 2,
				fetches: {count: 1, bytes: 17, urls: ["/api/thing"]},
				hiddenReloads: 0,
				rendersByComponent: {Loader: 2},
				subscriptions: {queryCacheListeners: 0, queryObservers: 0, eventSourceListeners: 0},
			},
			text: "widget",
		});
	});

	it("reports a background invalidation as one hidden reload", async () => {
		const result = await measureInteraction(
			() => (
				<>
					<ThingName />
					<Invalidator />
				</>
			),
			() => {
				fireEvent.click(screen.getByRole("button", {name: "Refresh"}));
			},
			{fixtures: {"/api/thing": {name: "widget"}}},
		);

		// Tracked props plus structural sharing: the refetch costs a request but no commit, which is what makes it hidden.
		expect(result).toStrictEqual({
			commits: 0,
			commitsBySubtree: {},
			mutations: 0,
			fetches: {count: 1, bytes: 17, urls: ["/api/thing"]},
			hiddenReloads: 1,
			rendersByComponent: {},
			subscriptions: {queryCacheListeners: 0, queryObservers: 1, eventSourceListeners: 0},
		});
	});

	it("subtracts the query fetches an interaction explicitly expects", async () => {
		const result = await measureInteraction(
			() => (
				<>
					<ThingName />
					<Invalidator />
				</>
			),
			() => {
				fireEvent.click(screen.getByRole("button", {name: "Refresh"}));
			},
			{fixtures: {"/api/thing": {name: "widget"}}, expectedQueryFetches: 1},
		);

		expect(result.hiddenReloads).toBe(0);
	});

	it("counts QueryCache listeners and open EventSource listeners in the subscription census", async () => {
		installFakeEventSource();
		const result = await measureInteraction(
			() => <FetchingBadge />,
			() => {},
			{fixtures: {}},
		);

		expect(result.subscriptions).toStrictEqual({
			queryCacheListeners: 1,
			queryObservers: 0,
			eventSourceListeners: 1,
		});
	});

	it("fails on a fetch with no fixture", async () => {
		await expect(
			measureInteraction(
				() => <Loader />,
				() => {
					fireEvent.click(screen.getByRole("button"));
				},
				{fixtures: {}},
			),
		).rejects.toThrow("measureInteraction: no fixture for fetch /api/thing");
	});
});

describe("FakeEventSource", () => {
	it("opens, delivers named events as JSON MessageEvents, reports errors, and drops listeners on close", () => {
		installFakeEventSource();
		const received: Array<string> = [];
		const source = new EventSource("/api/events");
		const fake = FakeEventSource.last();
		const ignored = () => received.push("removed listener ran");
		fake.addEventListener("open", () => received.push("open"));
		fake.addEventListener("session:lines-appended", (event) => received.push((event as MessageEvent).data));
		fake.addEventListener("session:lines-appended", ignored);
		fake.removeEventListener("session:lines-appended", ignored);
		fake.onerror = () => received.push("error");

		fake.open();
		fake.emit("session:lines-appended", {sessionId: "s1"});
		fake.error();
		const listenersBeforeClose = fake.listenerCount();
		fake.close();
		fake.emit("session:lines-appended", {sessionId: "s2"});

		expect({
			received,
			listenersBeforeClose,
			listenersAfterClose: fake.listenerCount(),
			readyState: source.readyState,
			instances: FakeEventSource.instances.map((instance) => instance.url),
		}).toStrictEqual({
			received: ["open", '{"sessionId":"s1"}', "error"],
			listenersBeforeClose: 3,
			listenersAfterClose: 0,
			readyState: 2,
			instances: ["/api/events"],
		});
	});
});

describe("installFixedResizeObserver", () => {
	it("reports a fixed size for every observed element", () => {
		installFixedResizeObserver({width: 800, height: 40});
		const sizes: Array<[number, number, number]> = [];
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				sizes.push([entry.contentRect.width, entry.contentRect.height, entry.borderBoxSize[0]!.blockSize]);
			}
		});
		observer.observe(document.createElement("div"));
		observer.observe(document.createElement("div"));

		expect(sizes).toStrictEqual([
			[800, 40, 40],
			[800, 40, 40],
		]);
	});
});
