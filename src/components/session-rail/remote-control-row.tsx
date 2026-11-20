import {Ellipsis, MousePointer2} from "lucide-react";
import {useId} from "react";

import {toggleRemoteControl} from "../../lib/api/herdr";
import {useRemoteControlToggle} from "../../hooks/use-remote-control-toggle";
import {writeClipboardText} from "../../lib/clipboard";
import type {RemoteControlState} from "../../lib/session-state";
import {useToast} from "../toast-context";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import {useMenuOpensOnContextMenu} from "../ui/use-menu-opens-on-context-menu";
import {Skeleton} from "../ui/skeleton";
import {Spinner} from "../ui/spinner";
import {Switch} from "../ui/switch";
import {Tooltip} from "../ui/tooltip";
import {RailGlyph} from "./rail-row";

/*
 * Upstream's desktop Remote Control setting row (`RA` in the flat-rail Environment card): the Cursor icon, a
 * label that clicks its xs switch, and, while bridged, a hover-revealed "…" menu (also on right-click) to open
 * the bridged session or copy its link.
 */

const ROW_CLASS = "group/setting flex min-h-8 w-full min-w-0 items-center gap-2.5 px-2 text-body";
const LABEL_CLASS = "min-w-0 flex-1 cursor-pointer truncate text-primary";
/* Upstream `Ae`: hidden until the row is hovered or focused, its menu is open, or on touch. */
const OPTIONS_WRAPPER_CLASS =
	"pointer-events-none flex shrink-0 opacity-0 group-focus-within/setting:pointer-events-auto group-focus-within/setting:opacity-100 group-hover/setting:pointer-events-auto group-hover/setting:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100";
const OPTIONS_TRIGGER_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary data-[popup-open]:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

export interface RemoteControlRowProps
{
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
	historySuppressed?:
		|
		  {
				reason: string | null;
		  }
		| null
		| undefined;
}

function RemoteControlIcon()
{
	return (
		<RailGlyph glyph="Cursor">
			<MousePointer2 aria-hidden />
		</RailGlyph>
	);
}

/** The hover title of the "History not synced" hint, naming the suppression cause when known. */
function historyNoteTitle(reason: string | null): string
{
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
}: RemoteControlRowProps)
{
	const switchId = useId();
	const toast = useToast();
	const {rootProps: menuRootProps, onContextMenu: openMenuOnContextMenu} = useMenuOpensOnContextMenu();
	const optionsUrl = state === "on" ? url : null;
	return (
		<div
			data-rail-remote-control=""
			className={ROW_CLASS}
			{...(optionsUrl === null
				? {}
				:
					{
						onContextMenu: openMenuOnContextMenu,
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
					<Menu {...menuRootProps}>
						<Tooltip content="Remote Control options" suppressAfterPopup>
							<MenuTrigger aria-label="Remote Control options" className={OPTIONS_TRIGGER_CLASS}>
								<Ellipsis aria-hidden className="size-4" />
							</MenuTrigger>
						</Tooltip>
						<MenuContent side="bottom" align="end">
							<MenuItem
								onSelect={() =>
								{
									window.open(optionsUrl, "_blank", "noopener,noreferrer");
								}}
							>
								Open in claude.ai
							</MenuItem>
							<MenuItem
								onSelect={() =>
								{
									// Upstream `Mv` stays silent when the copy fails.
									void writeClipboardText(optionsUrl).then((copied) =>
									{
										if (copied)
											toast(
												{
													kind: "success",
													message: "Link copied",
												},
											);
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
				// Upstream `cM`: a stable wrapper with no reason yet (a turn-blocked toggle gets none), its tooltip at
				// inline-start. The local app has no "unavailable" Remote Control state to give it one.
				disabledReason={null}
				disabledReasonSide={inlineStartSide()}
			/>
		</div>
	);
}

/** Upstream `io("inline-start")`: left, or right under RTL. */
function inlineStartSide(): "left" | "right"
{
	// Rendered on the server too, where there is no document to read a direction from.
	if (typeof document === "undefined") return "left";
	return document.documentElement.dir === "rtl" ? "right" : "left";
}

/** Upstream `Hk` pending: the row's name over a 28px skeleton while the bridge state loads. */
export function RemoteControlRowPending()
{
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

export interface RemoteControlToggleRowProps
{
	sessionId: string;
	state: RemoteControlState;
	url: string | null;
	/** A turn is running: upstream's `blockedByTurn` disables the switch. */
	working: boolean;
	historySuppressed?:
		|
		  {
				reason: string | null;
		  }
		| null
		| undefined;
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
}: RemoteControlToggleRowProps)
{
	const {pending, onToggle} = useRemoteControlToggle(sessionId, state, send);
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
