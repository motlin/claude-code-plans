// @vitest-environment jsdom
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {useContext, useEffect, useLayoutEffect, useRef, type ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ChatFileDropContext} from "../src/components/chat-file-drop-context";
import {AssistantMessageActions} from "../src/components/message-actions";
import {SessionTileFrame} from "../src/components/session-tile-frame";
import {SessionTileGeometryReadyContext} from "../src/components/session-tile-geometry-context";
import {TranscriptOverlayHostContext} from "../src/components/transcript-overlay-host-context";

const fakeRouter = vi.hoisted(() => (
{
	state:
	{
		location:
		{
			href: "/session/example-alice",
			state: {},
		},
		resolvedLocation:
		{
			href: "/session/example-alice",
			state: {},
		},
	},
	subscribe: vi.fn<
		(
			event: string,
			listener: (event: {
				toLocation:
				{
					state:
					{
						__TSR_key: string;
					};
					href: string;
				};
			}) => void,
		) => () => void
	>(() => () =>
	{
	}),
}));
vi.mock("@tanstack/react-router", () => (
{
	useRouter: () => fakeRouter,
}));
const frames: FrameRequestCallback[] = [];
beforeEach(() =>
{
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() =>
{
	cleanup();
	frames.length = 0;
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});
function Ready()
{
	const geometryReady = useContext(SessionTileGeometryReadyContext);
	useLayoutEffect(() => geometryReady?.(), [geometryReady]);
	return <p>Example transcript</p>;
}
function Visit({visitKey}: {visitKey: string})
{
	const anchorRef = useRef<HTMLDivElement>(null);
	return (
		<SessionTileFrame
			sessionId="example-alice"
			visitKey={visitKey}
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
		state:
		{
			__TSR_key: "example-canonical-entry",
			sessionIdentity:
			{
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
		state:
		{
			__TSR_key: "example-alice-entry",
			sessionIdentity:
			{
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
		state:
		{
			__TSR_key: "example-next-entry",
		},
		expectedTop: 0,
	},
])("cold restoration respects $name", ({visitKey, state, expectedTop}) =>
{
	fakeRouter.state.location =
	{
		href: "/session/example-alice",
		state,
	};
	fakeRouter.state.resolvedLocation = fakeRouter.state.location;
	const view = render(<Visit visitKey={visitKey} />);
	const queuedFrames = frames.length;
	act(() =>
	{
		for (const frame of frames.splice(0)) frame(0);
	});
	expect(
		{
			top: view.container.querySelector<HTMLElement>("[data-session-scrollport]")?.scrollTop,
			queuedFrames,
			subscriptions: fakeRouter.subscribe.mock.calls,
		},
	).toStrictEqual(
		{
			top: expectedTop,
			queuedFrames: expectedTop === 0 ? 0 : 1,
			subscriptions: [],
		},
	);
});

it("ignores a queued cold restore after its visit starts departing", () =>
{
	fakeRouter.state.location =
	{
		href: "/session/example-alice",
		state:
		{
			__TSR_key: "example-alice-entry",
		},
	};
	fakeRouter.state.resolvedLocation = fakeRouter.state.location;
	const view = render(<Visit visitKey="example-alice-entry" />);
	const queuedFrames = frames.length;
	fakeRouter.state.location =
	{
		href: "/session/example-bob",
		state:
		{
			__TSR_key: "example-bob-entry",
		},
	};
	act(() =>
	{
		for (const frame of frames.splice(0)) frame(0);
	});
	expect(
		{
			queuedFrames,
			top: view.container.querySelector<HTMLElement>("[data-session-scrollport]")?.scrollTop,
		},
	).toStrictEqual(
		{
			queuedFrames: 1,
			top: 0,
		},
	);
});
it("does not hand a stale rendered event to a cold restore after departure", () =>
{
	fakeRouter.state.location =
	{
		href: "/session/example-alice",
		state:
		{
			__TSR_key: "example-alice-entry",
		},
	};
	fakeRouter.state.resolvedLocation =
	{
		href: "/session/example-before",
		state:
		{
			__TSR_key: "example-before-entry",
		},
	};
	const view = render(<Visit visitKey="example-alice-entry" />);
	const [event, listener] = fakeRouter.subscribe.mock.calls[0]!;
	fakeRouter.state.location =
	{
		href: "/session/example-bob",
		state:
		{
			__TSR_key: "example-bob-entry",
		},
	};
	act(() =>
	{
		listener(
			{
				toLocation:
				{
					href: "/session/example-alice",
					state:
					{
						__TSR_key: "example-alice-entry",
					},
				},
			},
		);
	});
	expect(
		{
			event,
			queuedFrames: frames.length,
			top: view.container.querySelector<HTMLElement>("[data-session-scrollport]")?.scrollTop,
		},
	).toStrictEqual(
		{
			event: "onRendered",
			queuedFrames: 0,
			top: 0,
		},
	);
});
it("docks the session rail beside the scrollport, under the header, and marks the tile while docked", () =>
{
	function RailVisit({docked}: {docked: boolean})
	{
		const anchorRef = useRef<HTMLDivElement>(null);
		return (
			<SessionTileFrame
				sessionId="example-alice"
				visitKey="example-entry"
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
	const docked =
	{
		marked: tile?.hasAttribute("data-session-rail-docked"),
		railBesideScrollport: scrollport?.parentElement?.querySelector(":scope > aside")?.getAttribute("aria-label"),
		headerOutside: scrollport?.parentElement?.textContent.includes("Example header"),
	};
	rerender(<RailVisit docked={false} />);

	expect(
		{
			docked,
			undocked: tile?.hasAttribute("data-session-rail-docked"),
		},
	).toStrictEqual(
		{
			docked:
			{
				marked: true,
				railBesideScrollport: "Session details",
				headerOutside: false,
			},
			undocked: false,
		},
	);
});
it("hands the scrollport's positioned wrapper to transcript overlays as their host", () =>
{
	let host: HTMLElement | null = null;
	function ReadsHost()
	{
		const value = useContext(TranscriptOverlayHostContext);
		useEffect(() =>
		{
			host = value;
		}, [value]);
		return <p>Example transcript</p>;
	}
	function HostVisit()
	{
		const anchorRef = useRef<HTMLDivElement>(null);
		return (
			<SessionTileFrame
				sessionId="example-alice"
				visitKey="example-entry"
				anchorRef={anchorRef}
				restoredScrollY={undefined}
				header={<p>Example header</p>}
				footer={<p>Example composer</p>}
			>
				<ReadsHost />
			</SessionTileFrame>
		);
	}
	const {container} = render(<HostVisit />);
	const wrapper = container.querySelector("[data-session-scrollport]")?.parentElement;
	expect(
		{
			isWrapper: host === wrapper,
			marked: wrapper?.hasAttribute("data-transcript-overlay-host"),
			className: wrapper?.className,
		},
	).toStrictEqual(
		{
			isWrapper: true,
			marked: true,
			className: "relative flex min-h-0 flex-1 flex-col",
		},
	);
});
it("wraps the chat tile in upstream's rounded surface-2 card", () =>
{
	const {container} = render(<Visit visitKey="example-alice-entry" />);
	expect((container.firstElementChild as HTMLElement).className).toBe(
		"epitaxy-chat-panel @container flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r7 bg-surface-2 shadow-panel-sm",
	);
});

it("portals a transcript toolbar tooltip out of the contain:strict scroller and shifts it inside the viewport's 8px edge", () =>
{
	vi.useFakeTimers(
		{
			toFake: ["setTimeout", "clearTimeout"],
		},
	);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
	const {container} = render(
		<SessionTileFrame
			sessionId="example-alice"
			visitKey="example-alice-entry"
			anchorRef={
			{
				current: null,
			}}
			restoredScrollY={undefined}
			header={<p>Example header</p>}
			footer={<p>Example composer</p>}
		>
			<AssistantMessageActions
				message={
				{
					sessionId: "example-alice",
					uuid: "message-1",
				}}
				text="Hello"
				details={[]}
			/>
		</SessionTileFrame>,
	);
	const fork = container.querySelector<HTMLButtonElement>('button[aria-label="Fork from here"]')!;
	const anchor = fork.parentElement!;
	vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect(
			{
				x: 40,
				y: 400,
				width: 24,
				height: 24,
			},
		),
	);
	fireEvent.pointerEnter(anchor);
	act(() =>
	{
		vi.advanceTimersByTime(300);
	});
	const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
	expect(
		{
			insideScroller: container.querySelector("[data-session-scrollport]")!.contains(tooltip),
			inBody: document.body.contains(tooltip),
			text: tooltip.textContent,
			transform: tooltip.style.transform,
		},
	).toStrictEqual(
		{
			insideScroller: false,
			inBody: true,
			text: "Fork from hereStarts a new session from this point. This one stays as it is.",
			// Centred on the 24px button the 300px tip would start at -98px; it shifts to 8px.
			transform: "translate(106px)",
		},
	);
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("chat panel file drop zone", () =>
{
	const png = new File(
		[new Uint8Array([1])],
		"dropped.png",
		{
			type: "image/png",
		},
	);
	const files = () => (
	{
		dataTransfer:
		{
			types: ["Files"],
			files: [png],
			items: [],
			dropEffect: "none",
		},
	});
	function Registers({onDrop}: {onDrop: (files: readonly File[]) => void})
	{
		const register = useContext(ChatFileDropContext);
		useEffect(() => register?.(onDrop), [register, onDrop]);
		return <p>Example composer</p>;
	}
	function DropVisit({footer}: {footer: ReactNode})
	{
		return (
			<SessionTileFrame
				sessionId="example-alice"
				visitKey="example-entry"
				anchorRef={
				{
					current: null,
				}}
				restoredScrollY={undefined}
				header={<p>Example header</p>}
				footer={footer}
			>
				<p>Example transcript</p>
			</SessionTileFrame>
		);
	}

	it("shows the badge inside the tile for a Files drag over the transcript and drops into the registered composer", () =>
	{
		const onDrop = vi.fn<(files: readonly File[]) => void>();
		const {container} = render(<DropVisit footer={<Registers onDrop={onDrop} />} />);
		const scrollport = container.querySelector("[data-session-scrollport]")!;
		fireEvent.dragEnter(scrollport, files());
		const shown = container.querySelector("[data-session-tile] .dframe-drop-overlay-badge") !== null;
		const notPrevented = fireEvent.drop(scrollport, files());
		expect(
			{
				shown,
				notPrevented,
				calls: onDrop.mock.calls,
			},
		).toStrictEqual(
			{
				shown: true,
				notPrevented: false,
				calls: [[[png]]],
			},
		);
	});

	it("is disabled with no composer registered: no badge, but the drop is still swallowed", () =>
	{
		const {container} = render(<DropVisit footer={<p>Archived</p>} />);
		const scrollport = container.querySelector("[data-session-scrollport]")!;
		fireEvent.dragEnter(scrollport, files());
		const shown = container.querySelector(".dframe-drop-overlay-badge");
		expect(
			{
				shown,
				notPrevented: fireEvent.drop(scrollport, files()),
			},
		).toStrictEqual(
			{
				shown: null,
				notPrevented: false,
			},
		);
	});
});
