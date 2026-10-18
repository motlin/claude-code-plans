import {useRouter} from "@tanstack/react-router";
import {sessionScrollKey} from "../lib/session-route-location";
import {SessionTileGeometryReadyContext} from "./session-tile-geometry-context";
import {useScrollGutterVar} from "../hooks/use-scroll-gutter-var";
import {SESSION_TILE_CLASS} from "./dock-tokens";
import {useCallback, useLayoutEffect, useRef, type ReactNode, type Ref, type RefObject} from "react";

/** The one live chat tile's offset while a pane move reparents it; never a cross-route cache. */
export interface SessionTileScrollPosition {
	visitKey: string;
	top: number;
}

/** Upstream's rounded chat card; its chrome stays outside the single scroll/restoration owner. */
export function SessionTileFrame({
	sessionId,
	header,
	anchorRef,
	children,
	footer,
	visitKey,
	positionRef,
	restoredScrollY,
	rail = null,
	railDocked = false,
}: {
	sessionId: string;
	header: ReactNode;
	anchorRef: Ref<HTMLDivElement>;
	children: ReactNode;
	footer: ReactNode;
	visitKey: string;
	positionRef: RefObject<SessionTileScrollPosition | null>;
	restoredScrollY: number | undefined;
	/** The session rail's column, docked over the scrollport's end below the header. */
	rail?: ReactNode;
	/** Re-centres the chat column in the room the docked rail leaves. */
	railDocked?: boolean;
}) {
	const router = useRouter();
	const pendingRendered = useRef<(() => void) | undefined>(undefined);
	const scrollerRef = useRef<HTMLDivElement>(null);
	useScrollGutterVar(scrollerRef);
	const geometryReady = useRef<string | undefined>(undefined);
	const restoredHost = useRef<{node: HTMLDivElement; visitKey: string} | null>(null);
	const pendingFrame = useRef<number | undefined>(undefined);
	const restoreGeometry = useCallback(() => {
		geometryReady.current = visitKey;
		const scroller = scrollerRef.current;
		if (
			!scroller ||
			pendingFrame.current !== undefined ||
			pendingRendered.current !== undefined ||
			(restoredHost.current?.node === scroller && restoredHost.current.visitKey === visitKey)
		)
			return;
		const saved = positionRef.current;
		if (saved?.visitKey === visitKey) {
			if (scroller.scrollTop !== saved.top) scroller.scrollTop = saved.top;
			restoredHost.current = {node: scroller, visitKey};
		} else if (restoredScrollY === undefined) {
			restoredHost.current = {node: scroller, visitKey};
		} else {
			// A pending navigation can change the router location while this departing
			// visit is still painted. Only schedule a cold restore for our own visit.
			const location = router.state.location;
			const locationKey = location.state.__TSR_key ?? location.href;
			if (sessionScrollKey(location, sessionId) !== visitKey) return;
			// Warm routes restore in the router's rendered pass. A cold identity/data
			// mount missed that pass, so apply its captured snapshot once afterward.
			// Geometry can commit while the router still resolves the previous location.
			const scheduleFallback = () => {
				pendingFrame.current = requestAnimationFrame(() => {
					pendingFrame.current = undefined;
					if (
						scrollerRef.current !== scroller ||
						sessionScrollKey(router.state.location, sessionId) !== visitKey
					)
						return;
					if (scroller.scrollTop !== restoredScrollY) scroller.scrollTop = restoredScrollY;
					restoredHost.current = {node: scroller, visitKey};
				});
			};
			const resolved = router.state.resolvedLocation;
			if ((resolved?.state.__TSR_key ?? resolved?.href) === locationKey) scheduleFallback();
			else
				pendingRendered.current = router.subscribe("onRendered", ({toLocation}) => {
					if ((toLocation.state.__TSR_key ?? toLocation.href) !== locationKey) return;
					pendingRendered.current?.();
					pendingRendered.current = undefined;
					if (sessionScrollKey(router.state.location, sessionId) === visitKey) scheduleFallback();
				});
		}
	}, [positionRef, visitKey, restoredScrollY, router, sessionId]);
	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		if (geometryReady.current === visitKey) restoreGeometry();
		return () => {
			pendingRendered.current?.();
			pendingRendered.current = undefined;
			if (pendingFrame.current !== undefined) cancelAnimationFrame(pendingFrame.current);
			pendingFrame.current = undefined;
			if (scroller && restoredHost.current?.node === scroller && scroller.clientHeight > 0)
				positionRef.current = {visitKey, top: scroller.scrollTop};
		};
	}, [positionRef, visitKey, restoreGeometry]);
	const cancelPendingRestore = () => {
		if (pendingFrame.current === undefined && pendingRendered.current === undefined) return;
		pendingRendered.current?.();
		pendingRendered.current = undefined;
		if (pendingFrame.current !== undefined) cancelAnimationFrame(pendingFrame.current);
		pendingFrame.current = undefined;
		const node = scrollerRef.current;
		if (node) restoredHost.current = {node, visitKey};
	};

	return (
		<div className={SESSION_TILE_CLASS} {...(railDocked ? {"data-session-rail-docked": ""} : {})}>
			<div className="shrink-0">{header}</div>
			<div className="relative flex min-h-0 flex-1 flex-col">
				<div
					ref={scrollerRef}
					onWheelCapture={cancelPendingRestore}
					onTouchMoveCapture={cancelPendingRestore}
					onPointerDownCapture={cancelPendingRestore}
					onKeyDownCapture={(event) => {
						if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
							cancelPendingRestore();
					}}
					data-session-scrollport
					data-scroll-restoration-id="main"
					onScroll={(event) => {
						if (event.currentTarget.clientHeight > 0)
							positionRef.current = {visitKey, top: event.currentTarget.scrollTop};
					}}
					className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [contain:strict] [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]"
				>
					<div ref={anchorRef} className="flex min-h-full flex-col">
						<SessionTileGeometryReadyContext.Provider value={restoreGeometry}>
							<div className="flex-1">{children}</div>
						</SessionTileGeometryReadyContext.Provider>
						{footer}
					</div>
				</div>
				{rail}
			</div>
		</div>
	);
}
