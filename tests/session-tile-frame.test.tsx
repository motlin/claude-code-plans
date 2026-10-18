// @vitest-environment jsdom
import {act, cleanup, render} from "@testing-library/react";
import {useContext, useLayoutEffect, useRef} from "react";
import {afterEach, beforeEach, expect, it, vi} from "vite-plus/test";
import {SessionTileFrame, type SessionTileScrollPosition} from "../src/components/session-tile-frame";
import {SessionTileGeometryReadyContext} from "../src/components/session-tile-geometry-context";

const fakeRouter = vi.hoisted(() => ({
	state: {
		location: {href: "/session/example-alice", state: {}},
		resolvedLocation: {href: "/session/example-alice", state: {}},
	},
	subscribe: vi.fn<
		(
			event: string,
			listener: (event: {toLocation: {state: {__TSR_key: string}; href: string}}) => void,
		) => () => void
	>(() => () => {}),
}));
vi.mock("@tanstack/react-router", () => ({useRouter: () => fakeRouter}));
const frames: FrameRequestCallback[] = [];
beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
	cleanup();
	frames.length = 0;
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});
function Ready() {
	const geometryReady = useContext(SessionTileGeometryReadyContext);
	useLayoutEffect(() => geometryReady?.(), [geometryReady]);
	return <p>Example transcript</p>;
}
function Visit({visitKey}: {visitKey: string}) {
	const positionRef = useRef<SessionTileScrollPosition | null>(null);
	const anchorRef = useRef<HTMLDivElement>(null);
	return (
		<SessionTileFrame
			sessionId="example-alice"
			visitKey={visitKey}
			positionRef={positionRef}
			anchorRef={anchorRef}
			restoredScrollY={200}
			header={<p>Example header</p>}
			footer={<p>Example composer</p>}
		>
			<Ready />
		</SessionTileFrame>
	);
}
it.each([
	{
		name: "owned alias carry",
		visitKey: "example-original-entry",
		state: {
			__TSR_key: "example-canonical-entry",
			sessionIdentity: {
				sessionId: "example-alice",
				routeId: "example-alice",
				aliasRouteId: "session_example_alice",
				scrollKey: "example-original-entry",
			},
		},
		expectedTop: 200,
	},
	{
		name: "foreign carry falls back to current entry",
		visitKey: "example-alice-entry",
		state: {
			__TSR_key: "example-alice-entry",
			sessionIdentity: {
				sessionId: "example-bob",
				routeId: "example-bob",
				aliasRouteId: "session_example_bob",
				scrollKey: "example-bob-entry",
			},
		},
		expectedTop: 200,
	},
	{
		name: "departing visit ignores the incoming entry",
		visitKey: "example-alice-entry",
		state: {__TSR_key: "example-next-entry"},
		expectedTop: 0,
	},
])("cold restoration respects $name", ({visitKey, state, expectedTop}) => {
	fakeRouter.state.location = {href: "/session/example-alice", state};
	fakeRouter.state.resolvedLocation = fakeRouter.state.location;
	const view = render(<Visit visitKey={visitKey} />);
	const queuedFrames = frames.length;
	act(() => {
		for (const frame of frames.splice(0)) frame(0);
	});
	expect({
		top: view.container.querySelector<HTMLElement>("[data-session-scrollport]")?.scrollTop,
		queuedFrames,
		subscriptions: fakeRouter.subscribe.mock.calls,
	}).toStrictEqual({top: expectedTop, queuedFrames: expectedTop === 0 ? 0 : 1, subscriptions: []});
});

it("ignores a queued cold restore after its visit starts departing", () => {
	fakeRouter.state.location = {href: "/session/example-alice", state: {__TSR_key: "example-alice-entry"}};
	fakeRouter.state.resolvedLocation = fakeRouter.state.location;
	const view = render(<Visit visitKey="example-alice-entry" />);
	const queuedFrames = frames.length;
	fakeRouter.state.location = {href: "/session/example-bob", state: {__TSR_key: "example-bob-entry"}};
	act(() => {
		for (const frame of frames.splice(0)) frame(0);
	});
	expect({
		queuedFrames,
		top: view.container.querySelector<HTMLElement>("[data-session-scrollport]")?.scrollTop,
	}).toStrictEqual({queuedFrames: 1, top: 0});
});
it("does not hand a stale rendered event to a cold restore after departure", () => {
	fakeRouter.state.location = {href: "/session/example-alice", state: {__TSR_key: "example-alice-entry"}};
	fakeRouter.state.resolvedLocation = {href: "/session/example-before", state: {__TSR_key: "example-before-entry"}};
	const view = render(<Visit visitKey="example-alice-entry" />);
	const [event, listener] = fakeRouter.subscribe.mock.calls[0]!;
	fakeRouter.state.location = {href: "/session/example-bob", state: {__TSR_key: "example-bob-entry"}};
	act(() => {
		listener({toLocation: {href: "/session/example-alice", state: {__TSR_key: "example-alice-entry"}}});
	});
	expect({
		event,
		queuedFrames: frames.length,
		top: view.container.querySelector<HTMLElement>("[data-session-scrollport]")?.scrollTop,
	}).toStrictEqual({event: "onRendered", queuedFrames: 0, top: 0});
});
it("docks the session rail beside the scrollport, under the header, and marks the tile while docked", () => {
	function RailVisit({docked}: {docked: boolean}) {
		const positionRef = useRef<SessionTileScrollPosition | null>(null);
		const anchorRef = useRef<HTMLDivElement>(null);
		return (
			<SessionTileFrame
				sessionId="example-alice"
				visitKey="example-entry"
				positionRef={positionRef}
				anchorRef={anchorRef}
				restoredScrollY={undefined}
				header={<p>Example header</p>}
				footer={<p>Example composer</p>}
				rail={docked ? <aside aria-label="Session details" /> : null}
				railDocked={docked}
			>
				<p>Example transcript</p>
			</SessionTileFrame>
		);
	}
	const {container, rerender} = render(<RailVisit docked />);
	const tile = container.firstElementChild;
	const scrollport = container.querySelector("[data-session-scrollport]");
	const docked = {
		marked: tile?.hasAttribute("data-session-rail-docked"),
		railBesideScrollport: scrollport?.parentElement?.querySelector(":scope > aside")?.getAttribute("aria-label"),
		headerOutside: scrollport?.parentElement?.textContent.includes("Example header"),
	};
	rerender(<RailVisit docked={false} />);

	expect({docked, undocked: tile?.hasAttribute("data-session-rail-docked")}).toStrictEqual({
		docked: {marked: true, railBesideScrollport: "Session details", headerOutside: false},
		undocked: false,
	});
});
it("wraps the chat tile in upstream's rounded surface-2 card", () => {
	const {container} = render(<Visit visitKey="example-alice-entry" />);
	expect((container.firstElementChild as HTMLElement).className).toBe(
		"@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r7 bg-surface-2 shadow-panel-sm",
	);
});
