import {Link, useMatches} from "@tanstack/react-router";
import {useQuery} from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import type {Section} from "./types";
import {activeSectionFor} from "./hooks";
import {MoreNavMenu, type NavBadge} from "./more-menu";
import {useVisibleNavItems} from "./navigation";
import {NavScroll} from "./nav-scroll";
import {NewSessionRow} from "./new-session-row";
import {SidebarFooter} from "./sidebar-footer";
import {SidebarSearchField} from "./sidebar-search-field";
import {SidebarToggleButton} from "./sidebar-toggle";
import {useSidebarBodyRoving} from "./use-roving-focus";
import {Search, X} from "lucide-react";
import {openCommandPalette} from "../../hooks/use-command-palette";
import {SidebarSessionGroups} from "./session-filter-menu";
import {approvalsQueryOptions} from "../../lib/api/approvals";
import {notificationsQueryOptions, useMarkNotificationsRead} from "../../lib/api/notifications";
import {activeSessionsQueryOptions} from "../../lib/api/sessions";
import {
	clearPeekSuppression,
	isPeekSuppressed,
	setSidebarWidth,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_RESIZE_STEP,
	readSidebarState,
	toggleSidebarCollapsed,
	useSidebarState,
	writeSidebarState,
} from "../../lib/sidebar-store";
import {useResizableWidth} from "../../hooks/use-resizable-width";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {useSessionIdentity} from "../../hooks/use-session-identity";
import {Tooltip} from "../ui/tooltip";
import {useSettings} from "../settings-context";

export function Sidebar({
	collapsed,
	onToggle,
	narrowViewport = false,
	onPhoneSheetClose,
}: {
	collapsed: boolean;
	/** Overrides the persisted toggle on the expanded sidebar's Hide button. */
	onToggle?: () => void;
	/** 640–767px: collapse is forced, so the trigger opens the peek rather than toggling the pref. */
	narrowViewport?: boolean;
	/** Renders the phone-sheet contents (Close + wordmark header) instead of a docked sidebar. */
	onPhoneSheetClose?: () => void;
}) {
	const {width} = useSidebarState();
	const matches = useMatches();
	const currentPath = matches[matches.length - 1]?.fullPath ?? "/";
	const {section: activeSection, activeItemId} = activeSectionFor(matches);
	const activeSessionId = useSessionIdentity(activeSection === "sessions" ? activeItemId : null);
	const {pinned: navigationItems, overflow: overflowItems, visibleNavSections} = useVisibleNavItems();
	const {data: approvalsData} = useQuery(approvalsQueryOptions());
	const approvalsCount = approvalsData?.approvals.length ?? 0;
	const {data: notificationsData} = useQuery(notificationsQueryOptions());
	const unreadCount = notificationsData?.notifications.filter((notification) => notification.unread).length ?? 0;
	const {mutate: markNotificationsRead} = useMarkNotificationsRead();
	const {settings} = useSettings();
	const {data: activeSessions} = useQuery(activeSessionsQueryOptions(settings.activeTimeoutSec * 1000));
	const activeCount = activeSessions?.length ?? 0;
	const roving = useSidebarBodyRoving();

	function badgeFor(section: Section): NavBadge | null {
		if (section === "active") return {count: activeCount, title: `${activeCount} active`};
		if (section === "approvals") {
			return {count: approvalsCount, title: `${approvalsCount} awaiting approval`};
		}
		if (section === "notifications") return {count: unreadCount, title: `${unreadCount} unread`};
		return null;
	}

	useEffect(() => {
		if (!currentPath.startsWith("/notifications") || unreadCount === 0) return;
		markNotificationsRead();
	}, [currentPath, unreadCount, markNotificationsRead]);

	const body = (
		<>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- upstream's sidebar-body keyboard container: arrow keys rove across the field, New, the nav rows and the session list */}
			<div
				ref={roving.ref}
				onKeyDown={roving.onKeyDown}
				onKeyDownCapture={roving.onKeyDownCapture}
				data-sidebar-body=""
				className="flex min-h-0 flex-1 flex-col px-2"
			>
				<div className="shrink-0">
					{/* Upstream's phone sheet swaps the field for its header Search button. */}
					{onPhoneSheetClose === undefined && <SidebarSearchField />}
					<NewSessionRow />
				</div>
				<NavScroll activeKey={activeSection === "sessions" ? activeSessionId : null}>
					<div className="shrink-0">
						{navigationItems.map((item) => {
							const Icon = item.icon;
							const badge = badgeFor(item.section);
							return (
								<Link
									key={item.to}
									to={item.to}
									data-row=""
									data-roving-item=""
									data-selected={item.section === activeSection ? "focused" : undefined}
									className="group df-nav-row h-[var(--sb-row-h)] rounded-[var(--sb-radius)] hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]"
								>
									<span className="df-leading-slot">
										<Icon aria-hidden="true" />
									</span>
									<span className="min-w-0 flex-1 truncate">{item.label}</span>
									{badge && badge.count > 0 && (
										<span className="df-tail-mark">
											<span
												className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold text-white"
												title={badge.title}
											>
												{badge.count}
											</span>
										</span>
									)}
								</Link>
							);
						})}
						<MoreNavMenu
							overflow={overflowItems}
							visibleNavSections={visibleNavSections}
							badgeFor={badgeFor}
							activeSection={activeSection}
						/>
						{/* Upstream's phone sheet ends the nav block 11px below More; desktop's ends 13px below. */}
						<div
							data-nav-groups-gap=""
							className={onPhoneSheetClose ? "h-[11px] shrink-0" : "h-[13px] shrink-0"}
						/>
					</div>
					<SidebarSessionGroups
						activeItemId={activeSection === "sessions" ? activeSessionId : activeItemId}
					/>
				</NavScroll>
			</div>
			{/* Upstream's peek footer has no Search icon, and the phone sheet moves it to the header. */}
			<SidebarFooter />
		</>
	);

	if (onPhoneSheetClose) {
		return (
			<nav
				aria-label="Sidebar"
				data-focus-region="navigation"
				className="group/sidebar flex h-full min-h-0 flex-col"
			>
				<div data-testid="phone-sheet-header" className="flex shrink-0 flex-col gap-2 px-2">
					<div className="flex h-11 items-center gap-2">
						<button
							type="button"
							aria-label="Close sidebar"
							data-phone-sheet-close=""
							onClick={onPhoneSheetClose}
							className="flex h-8 w-8 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover"
						>
							<X aria-hidden="true" className="size-5" />
						</button>
						<SidebarWordmark className="ml-2" />
					</div>
					{/* Upstream's CDS lg button: the ⌘K default entry opens forced to Search over the open sheet. */}
					<button
						type="button"
						data-prefetch="palette"
						onClick={() => {
							openCommandPalette("default", {source: "mobile"});
						}}
						className="flex h-10 w-full items-center gap-1 rounded-r7 bg-fill-control px-4 text-[15px]/[22px] text-primary transition-colors"
					>
						<Search aria-hidden="true" className="-ms-1 size-5" />
						Search
					</button>
				</div>
				{body}
			</nav>
		);
	}

	if (collapsed) {
		return <CollapsedSidebar narrowViewport={narrowViewport}>{body}</CollapsedSidebar>;
	}

	return (
		<nav
			aria-label="Sidebar"
			data-focus-region="navigation"
			style={{"--sidebar-width": `${width}px`}}
			className="group/sidebar relative hidden h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r-[0.5px] border-border bg-[var(--sb-bg)] md:flex"
		>
			<div data-testid="sidebar-titlebar" className="flex h-11 shrink-0 items-center px-2">
				{/* Pinned to the collapsed trigger's 12,12 spot so the toggle never moves between states. */}
				<div data-testid="sidebar-toggle-slot" className="flex w-8 shrink-0 justify-center self-start pt-3">
					<div className="flex opacity-70 transition-opacity duration-[120ms] ease-[cubic-bezier(.32,.72,0,1)] group-hover/sidebar:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100">
						<SidebarToggleButton
							{...(onToggle ? {onClick: onToggle, collapsed: false} : {})}
							className="flex size-6 items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover [&_svg]:size-4"
						/>
					</div>
				</div>
				<div className="ml-1.5 flex min-w-0 flex-col items-start">
					<SidebarWordmark />
				</div>
			</div>

			<div aria-hidden="true" className="h-2 shrink-0" />
			{body}
			<SidebarResizeHandle width={width} onHide={onToggle ?? toggleSidebarCollapsed} />
		</nav>
	);
}

function SidebarWordmark({className}: {className?: string}) {
	return (
		<Link
			to="/"
			className={`${className ? `${className} ` : ""}font-voice text-[20px] leading-none font-medium whitespace-nowrap text-primary no-underline`}
		>
			Claude Code Browser
		</Link>
	);
}

/**
 * Upstream's 12px `dframe-resize-handle` straddling the sidebar's right edge: its inner half is
 * clipped away unless focus-visible, and hovering reveals a 3x48 grip pill. A press that never
 * moves past the drag threshold hides the sidebar like ⌘B, which the right-side tooltip explains.
 */
function SidebarResizeHandle({width, onHide}: {width: number; onHide: () => void}) {
	const {keys} = useShortcutKeys("toggle_sidebar");
	const handleProps = useResizableWidth({
		label: "Resize sidebar",
		min: SIDEBAR_MIN_WIDTH,
		max: SIDEBAR_MAX_WIDTH,
		step: SIDEBAR_RESIZE_STEP,
		edge: "end",
		value: width,
		onChange: setSidebarWidth,
		onClick: onHide,
	});

	return (
		<Tooltip
			content="Hide sidebar"
			shortcut={keys}
			description="Drag to resize"
			side="right"
			trackCursor="y"
			className="absolute! inset-y-0 end-[-6px] z-10 w-3"
		>
			<div
				{...handleProps}
				className="group/resize flex size-full cursor-col-resize touch-none items-center justify-center [clip-path:inset(0_0_0_37.5%)] focus-visible:outline-hidden focus-visible:[clip-path:none]"
			>
				<span
					aria-hidden="true"
					className="h-12 w-[3px] rounded-full bg-border opacity-0 transition-opacity duration-[120ms] group-hover/resize:opacity-100 group-focus-visible/resize:bg-accent-100 group-focus-visible/resize:opacity-100"
				/>
			</div>
		</Tooltip>
	);
}

/**
 * Upstream's collapsed-sidebar edge (`.dframe-sidebar-edge`): an 8px `separator` at the frame's left
 * edge whose hover fades in a 3x48 grip pill after 200ms (accent and full height when focus-visible),
 * with a cursor-tracking "Show sidebar ⌘B / Drag to resize" tooltip on its right. A click expands
 * the sidebar, a drag past half the floor expands it live, and ArrowRight expands it and focuses Hide.
 */
/** Upstream's `mF`: pointer travel (px) below which a press on the edge is a click. */
const EDGE_CLICK_THRESHOLD_PX = 3;
/** Upstream keeps at least this much width (px) for the content when committing a drag. */
const EDGE_DRAG_CONTENT_RESERVE_PX = 330;

/** Expand or re-collapse live from an edge drag of `distance` px, like upstream's `aK`. */
function applyEdgeDrag(distance: number): void {
	const state = readSidebarState();
	if (distance < SIDEBAR_MIN_WIDTH / 2) {
		if (!state.collapsed) writeSidebarState({...state, collapsed: true});
		return;
	}
	const max = Math.max(
		SIDEBAR_MIN_WIDTH,
		Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - EDGE_DRAG_CONTENT_RESERVE_PX),
	);
	const width = Math.round(Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, distance)));
	if (state.collapsed || state.width !== width) writeSidebarState({...state, collapsed: false, width});
}

/**
 * Track an edge press on window listeners, since a drag that passes the threshold expands the
 * sidebar and unmounts the edge mid-gesture.
 */
function startEdgeGesture(event: ReactPointerEvent<HTMLElement>): void {
	const {pointerId, clientX: startX} = event;
	const frame = event.currentTarget.closest<HTMLElement>('[data-testid="app-frame"]');
	let dragging = false;

	function onMove(moveEvent: PointerEvent): void {
		if (moveEvent.pointerId !== pointerId) return;
		const distance = moveEvent.clientX - startX;
		if (!dragging && Math.abs(distance) < EDGE_CLICK_THRESHOLD_PX) return;
		if (!dragging) {
			dragging = true;
			frame?.setAttribute("data-resizing", "");
		}
		applyEdgeDrag(distance);
	}

	function finish(endEvent: PointerEvent): void {
		if (endEvent.pointerId !== pointerId) return;
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", finish);
		window.removeEventListener("pointercancel", finish);
		frame?.removeAttribute("data-resizing");
		if (!dragging && endEvent.type === "pointerup") toggleSidebarCollapsed();
	}

	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", finish);
	window.addEventListener("pointercancel", finish);
}

function onEdgePointerDown(event: ReactPointerEvent<HTMLElement>): void {
	if (event.button !== 0) return;
	event.preventDefault();
	startEdgeGesture(event);
}

function onEdgeKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
	if (event.key !== "ArrowRight") return;
	event.preventDefault();
	writeSidebarState({...readSidebarState(), collapsed: false});
	requestAnimationFrame(() => {
		document.querySelector<HTMLElement>('button[aria-label="Hide sidebar"]')?.focus();
	});
}

export function SidebarEdgeHandle() {
	const {keys} = useShortcutKeys("toggle_sidebar");
	return (
		<Tooltip
			content="Show sidebar"
			shortcut={keys}
			description="Drag to resize"
			side="right"
			trackCursor="y"
			className="absolute! inset-y-0 left-0 z-[21] w-2"
		>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize sidebar"
				aria-valuenow={0}
				aria-valuemin={0}
				aria-valuemax={SIDEBAR_MAX_WIDTH}
				tabIndex={0}
				data-sidebar-edge=""
				onPointerDown={onEdgePointerDown}
				onKeyDown={onEdgeKeyDown}
				className="group/resize absolute inset-y-0 left-0 z-[21] w-2 cursor-col-resize touch-none outline-none select-none"
			>
				<div
					aria-hidden="true"
					className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize rounded-full transition-shadow duration-150 group-focus-visible/resize:shadow-focus"
				/>
				<div
					aria-hidden="true"
					data-resize-pill=""
					className="absolute top-1/2 left-1/2 h-full max-h-12 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current text-ink-muted opacity-0 transition-[opacity,color,background-color] delay-200 duration-200 group-hover/resize:opacity-100 group-focus-visible/resize:max-h-none group-focus-visible/resize:bg-accent-100 group-focus-visible/resize:opacity-100 group-focus-visible/resize:delay-0"
				/>
			</div>
		</Tooltip>
	);
}

const PEEK_ID = "sidebar-peek-popover";

/**
 * Collapsed desktop sidebar, like claude.ai/code: a transparent 24x24 floating trigger at 12,12
 * (the expanded Hide sidebar toggle's spot) whose hover (or the invisible bridge beneath it)
 * slides in upstream's `#frame-peek-popover`: a 288px full-height panel at the left edge whose
 * 48px top padding leaves room for the still-visible trigger beside the wordmark.
 * In the forced-collapse regime (640–767px) a click toggles the peek open instead of expanding
 * the persisted preference.
 */
/** Upstream's peek close grace (ms) after the pointer leaves the trigger, bridge or body. */
const PEEK_CLOSE_GRACE_MS = 180;

/**
 * Whether the peek must stay open past its grace, as upstream re-arms the close while its More/sort
 * menu is open (`overflowMenuOpen`) or a text input inside the peek has focus.
 */
function isPeekInUse(peek: HTMLElement | null): boolean {
	if (peek === null) return false;
	if (peek.querySelector('[aria-haspopup][aria-expanded="true"]') !== null) return true;
	const active = document.activeElement;
	if (!(active instanceof HTMLElement) || !peek.contains(active)) return false;
	if (active.isContentEditable || active instanceof HTMLTextAreaElement) return true;
	return active instanceof HTMLInputElement && (active.type === "text" || active.type === "search");
}

function CollapsedSidebar({narrowViewport, children}: {narrowViewport: boolean; children: ReactNode}) {
	const [hovering, setHovering] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const cancelClose = useCallback(() => {
		clearTimeout(closeTimerRef.current);
		closeTimerRef.current = undefined;
	}, []);

	// Upstream's `fu` → `RA`: leaving starts a grace that re-arms while the peek is still in use.
	const scheduleClose = useCallback(() => {
		cancelClose();
		closeTimerRef.current = setTimeout(() => {
			if (isPeekInUse(document.getElementById(PEEK_ID))) {
				scheduleClose();
				return;
			}
			closeTimerRef.current = undefined;
			setHovering(false);
		}, PEEK_CLOSE_GRACE_MS);
	}, [cancelClose]);

	useEffect(
		() => () => {
			cancelClose();
			clearPeekSuppression();
		},
		[cancelClose],
	);

	// A tapped-open peek has no pointerleave to close it, so an outside press dismisses it.
	useEffect(() => {
		if (!narrowViewport || !hovering) return undefined;
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
			setHovering(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [narrowViewport, hovering]);

	return (
		<div
			ref={rootRef}
			data-testid="sidebar-collapsed"
			data-hovering={hovering ? "" : undefined}
			onPointerEnter={(event) => {
				if (event.pointerType !== "mouse" || isPeekSuppressed()) return;
				cancelClose();
				setHovering(true);
			}}
			onPointerLeave={(event) => {
				clearPeekSuppression();
				if (event.pointerType !== "mouse") return;
				scheduleClose();
			}}
			className="group/peek absolute left-3 top-3 z-50 flex"
		>
			<div
				data-testid="sidebar-peek-bridge"
				aria-hidden="true"
				className="pointer-events-none absolute -left-3 top-0 h-10 w-[288px] group-data-[hovering]/peek:pointer-events-auto"
			/>
			<SidebarToggleButton
				collapsed
				controls={{id: PEEK_ID, expanded: hovering}}
				{...(narrowViewport
					? {
							onClick: () => {
								setHovering(true);
							},
						}
					: {})}
				className="relative z-10 flex size-6 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover [&_svg]:size-4"
			/>
			<nav
				id={PEEK_ID}
				data-testid="sidebar-peek"
				aria-label="Sidebar"
				data-focus-region="navigation"
				aria-hidden={hovering ? undefined : true}
				inert={!hovering}
				className="pointer-events-none fixed inset-y-0 left-0 flex h-dvh w-[288px] -translate-x-full flex-col overflow-hidden rounded-none border-r-[0.5px] border-border bg-surface-popover pt-12 pb-1.5 opacity-0 shadow-[0_0_0_.5px_rgba(0,0,0,.06),0_4px_12px_rgba(0,0,0,.06),0_16px_40px_rgba(0,0,0,.08)] sidebar-peek-motion group-data-[hovering]/peek:pointer-events-auto group-data-[hovering]/peek:translate-x-0 group-data-[hovering]/peek:opacity-100"
			>
				{/* The header row: the trigger stays put over the empty 32px slot, the wordmark sits beside it. */}
				<div data-testid="sidebar-peek-header" className="absolute inset-x-0 top-0 flex h-11 items-center px-2">
					<div className="w-8 shrink-0" />
					<SidebarWordmark className="ml-1.5" />
				</div>
				{children}
			</nav>
		</div>
	);
}
