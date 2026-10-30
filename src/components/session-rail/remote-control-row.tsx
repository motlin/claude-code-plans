import {Ellipsis, MousePointer2} from "lucide-react";
import {useEffect, useId, useState, useSyncExternalStore} from "react";

import {HerdrRequestError, toggleRemoteControl} from "../../lib/api/herdr";
import {writeClipboardText} from "../../lib/clipboard";
import type {RemoteControlState} from "../../lib/session-state";
import {useToast} from "../toast-context";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import {Skeleton} from "../ui/skeleton";
import {Spinner} from "../ui/spinner";
import {Switch} from "../ui/switch";
import {Tooltip} from "../ui/tooltip";

/*
 * Upstream's desktop Remote Control setting row (`RA` in the flat-rail Environment card): the Cursor icon, a
 * label that clicks its xs switch, and, while bridged, a hover-revealed "…" menu (also on right-click) to open
 * the bridged session or copy its link.
 */

const ROW_CLASS = "group/setting flex min-h-6.5 w-full min-w-0 items-center gap-2 px-1 text-[13px]/[19px]";
const ICON_SLOT_CLASS = "flex size-5 shrink-0 items-center justify-center text-secondary [&_svg]:size-4";
const LABEL_CLASS = "min-w-0 flex-1 cursor-pointer truncate text-primary";
/* Upstream `Ae`: hidden until the row is hovered or focused, its menu is open, or on touch. */
const OPTIONS_WRAPPER_CLASS =
	"pointer-events-none flex shrink-0 opacity-0 group-focus-within/setting:pointer-events-auto group-focus-within/setting:opacity-100 group-hover/setting:pointer-events-auto group-hover/setting:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100";
const OPTIONS_TRIGGER_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary data-[popup-open]:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

export interface RemoteControlRowProps {
	state: RemoteControlState;
	/** The bridged session's claude.ai link; the options menu needs it. */
	url: string | null;
	onToggle?: ((on: boolean) => void) | undefined;
	toggleDisabled?: boolean | undefined;
	/** A turn-on is in flight: upstream shows a "Connecting" spinner and checks the switch. */
	connecting?: boolean | undefined;
	/**
	 * Set when the CLI did not backfill the session's history to claude.ai (`bridge-session.noHistoryBackfill`),
	 * with the latest `history-suppression` cause's label, or null for an unknown cause.
	 */
	historySuppressed?: {reason: string | null} | null | undefined;
}

function RemoteControlIcon() {
	return (
		<span className={ICON_SLOT_CLASS}>
			<MousePointer2 aria-hidden />
		</span>
	);
}

/** The hover title of the "History not synced" hint, naming the suppression cause when known. */
function historyNoteTitle(reason: string | null): string {
	return reason === null
		? "Remote history not synced to claude.ai"
		: `Remote history not synced to claude.ai · ${reason}`;
}

export function RemoteControlRow({
	state,
	url,
	onToggle,
	toggleDisabled = false,
	connecting = false,
	historySuppressed = null,
}: RemoteControlRowProps) {
	const switchId = useId();
	const toast = useToast();
	const [menuOpen, setMenuOpen] = useState(false);
	const optionsUrl = state === "on" ? url : null;
	return (
		<div
			data-rail-remote-control=""
			className={ROW_CLASS}
			{...(optionsUrl === null
				? {}
				: {
						onContextMenu: (event: React.MouseEvent) => {
							event.preventDefault();
							setMenuOpen(true);
						},
					})}
		>
			<RemoteControlIcon />
			<label data-rail-row-label="" htmlFor={switchId} className={LABEL_CLASS}>
				Remote Control
			</label>
			{state === "on" && historySuppressed !== null && (
				<span
					data-rail-row-hint=""
					title={historyNoteTitle(historySuppressed.reason)}
					className="shrink-0 text-[12px]/[15px] text-ink-muted"
				>
					History not synced
				</span>
			)}
			{optionsUrl !== null && (
				<span className={OPTIONS_WRAPPER_CLASS}>
					<Menu open={menuOpen} onOpenChange={setMenuOpen}>
						<Tooltip content="Remote Control options" suppressAfterPopup>
							<MenuTrigger aria-label="Remote Control options" className={OPTIONS_TRIGGER_CLASS}>
								<Ellipsis aria-hidden className="size-4" />
							</MenuTrigger>
						</Tooltip>
						<MenuContent side="bottom" align="end">
							<MenuItem
								onSelect={() => {
									window.open(optionsUrl, "_blank", "noopener,noreferrer");
								}}
							>
								Open in claude.ai
							</MenuItem>
							<MenuItem
								onSelect={() => {
									// Upstream `Mv` stays silent when the copy fails.
									void writeClipboardText(optionsUrl).then((copied) => {
										if (copied) toast({kind: "success", message: "Link copied"});
									});
								}}
							>
								Copy link
							</MenuItem>
						</MenuContent>
					</Menu>
				</span>
			)}
			{connecting && <Spinner size="sm" label="Connecting" />}
			<Switch
				id={switchId}
				checked={state === "on" || connecting}
				disabled={toggleDisabled}
				onCheckedChange={onToggle}
			/>
		</div>
	);
}

/** Upstream `Hk` pending: the row's name over a 28px skeleton while the bridge state loads. */
export function RemoteControlRowPending() {
	return (
		<div data-rail-remote-control-pending="" className={ROW_CLASS}>
			<RemoteControlIcon />
			<span data-rail-row-label="" className="min-w-0 flex-1 truncate text-primary">
				Remote Control
			</span>
			<Skeleton className="h-3 w-7 rounded" />
		</div>
	);
}

/*
 * Toggles in flight by session id (upstream `Kf`), kept outside React so a
 * remounted rail still shows the spinner: each holds the requested state until
 * the bridge reaches it or 15 s pass.
 */
const PENDING_TIMEOUT_MS = 15_000;
const pendingToggles = new Map<string, {on: boolean; timer: ReturnType<typeof setTimeout> | null}>();
const pendingListeners = new Set<() => void>();

function notifyPending(): void {
	for (const listener of pendingListeners) listener();
}

function setPendingToggle(sessionId: string, on: boolean | null): void {
	const previous = pendingToggles.get(sessionId);
	if (previous?.timer != null) clearTimeout(previous.timer);
	if (on === null) pendingToggles.delete(sessionId);
	else pendingToggles.set(sessionId, {on, timer: null});
	notifyPending();
}

/** Starts the 15 s give-up once the send has gone through. */
function armPendingTimeout(sessionId: string): void {
	const pending = pendingToggles.get(sessionId);
	if (pending === undefined) return;
	pending.timer = setTimeout(() => {
		if (pendingToggles.get(sessionId) === pending) setPendingToggle(sessionId, null);
	}, PENDING_TIMEOUT_MS);
}

function subscribePending(listener: () => void): () => void {
	pendingListeners.add(listener);
	return () => {
		pendingListeners.delete(listener);
	};
}

function usePendingToggle(sessionId: string): boolean | null {
	return useSyncExternalStore(
		subscribePending,
		() => pendingToggles.get(sessionId)?.on ?? null,
		() => null,
	);
}

const TOGGLE_FAILED = "Couldn’t toggle Remote Control. Try again.";

export interface RemoteControlToggleRowProps {
	sessionId: string;
	state: RemoteControlState;
	url: string | null;
	/** A turn is running: upstream's `blockedByTurn` disables the switch. */
	working: boolean;
	historySuppressed?: {reason: string | null} | null | undefined;
	send?: (sessionId: string, on: boolean) => Promise<void>;
}

/**
 * The Remote Control row with a working switch for a session in a live
 * terminal pane: upstream's no-IPC path, which types `/remote-control` into
 * the session, then waits for the registry's bridge state to follow.
 */
export function RemoteControlToggleRow({
	sessionId,
	state,
	url,
	working,
	historySuppressed = null,
	send = toggleRemoteControl,
}: RemoteControlToggleRowProps) {
	const toast = useToast();
	const pending = usePendingToggle(sessionId);
	useEffect(() => {
		if (pending === null || (state === "on") !== pending) return;
		setPendingToggle(sessionId, null);
		toast({kind: "success", message: pending ? "Remote Control turned on." : "Remote Control turned off."});
	}, [pending, state, sessionId, toast]);
	const onToggle = (on: boolean) => {
		if (pendingToggles.has(sessionId)) return;
		setPendingToggle(sessionId, on);
		send(sessionId, on).then(
			() => {
				armPendingTimeout(sessionId);
			},
			(error: unknown) => {
				setPendingToggle(sessionId, null);
				toast(
					error instanceof HerdrRequestError && error.status === 409
						? {kind: "warning", message: error.message}
						: {kind: "error", message: TOGGLE_FAILED},
				);
			},
		);
	};
	return (
		<RemoteControlRow
			state={state}
			url={url}
			onToggle={onToggle}
			toggleDisabled={pending !== null || working}
			connecting={pending === true && state === "off"}
			historySuppressed={historySuppressed}
		/>
	);
}
