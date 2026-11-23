import {Cpu, Laptop} from "lucide-react";
import {useEffect, useRef} from "react";
import type {SessionListItem} from "../lib/api/sessions";
import {prGlyph} from "../lib/pr-status";
import {sessionMenuReadState, type SessionMenuReadState} from "../lib/session-menu-items";
import {sessionStateKindLabels} from "../lib/schema-choices";
import {announce, clearAnnouncement} from "../lib/live-announcer";
import {HEADLESS_HOST_LABEL} from "../lib/session-environment";
import {isLiveSessionState, sessionRowIconKind} from "../lib/session-state";
import {TOUCH_HIT} from "../lib/touch-reveal";
import {markSeen} from "../lib/unread-store";
import {useSettings} from "./settings-context";
import {SessionStateIcon} from "./status-dot";
import {GIT_PR_STATE_LABELS} from "./git-pr-state-labels";
import {Tooltip} from "./ui/tooltip";
import {useHasUnseenWork} from "./use-has-unseen-work";
import {useRowAttention, useRowIconKind} from "./use-row-icon-kind";

/**
 * Upstream session row status dot. Awaiting and running glyphs carry a top tooltip, a read finished
 * row's glyph is a plain icon, and only the unread dot is a button that marks the row read
 * (the row menu's "Mark as unread" handles the other direction).
 */
export function SessionRowStatusDot({session, tabIndex}: {session: SessionListItem; tabIndex?: number})
{
	const unseen = useHasUnseenWork(session.id);
	const {settings} = useSettings();
	// The server bucket lags a manual toggle until the next summary arrives, so a finished
	// row's icon follows the local unseen flag.
	const kind = sessionRowIconKind(
		{
			bucket: session.bucket,
			unseen,
			serverUnseen: session.unseen,
			unseenError: session.unseenError === true,
			prStatus: session.prStatus,
			showPrStatus: settings.sessionListPrefs.showPrStatus,
		},
	);
	const readState = sessionMenuReadState(session.bucket, unseen);
	const icon = <SessionStateIcon kind={kind} />;
	if (readState === "working" || readState === "awaiting")
	{
		return <Tooltip content={readState === "awaiting" ? "Awaiting input" : "Running"}>{icon}</Tooltip>;
	}
	if (readState === "read") return icon;

	const label = "Click to mark as read";
	return (
		<Tooltip content={label}>
			<button
				type="button"
				{...(tabIndex === undefined
					? {}
					:
						{
							tabIndex,
						})}
				aria-label={label}
				className={`flex cursor-pointer items-center justify-center rounded-full hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${TOUCH_HIT}`}
				onClick={(event) =>
				{
					event.preventDefault();
					event.stopPropagation();
					markSeen(session.id);
				}}
			>
				{icon}
			</button>
		</Tooltip>
	);
}

const SR_ROW_STATUS_LABELS =
{
	working: "Running",
	awaiting: "Awaiting input",
	unread: "Unread response",
	read: "",
} satisfies Record<SessionMenuReadState, string>;

/** Upstream `L_` announces an errored row with its error text in place of the live status. */
const SR_ROW_ERROR_LABEL = sessionStateKindLabels.error;

/**
 * Upstream's sr-only environment text (`Z7a` for a bridge, which every local CLI is): the machine
 * name (here its terminal host) or repo, falling back to "Remote Control", then Connected while
 * the CLI lives or Offline once it ended, then the PR state.
 * Upstream (shared-18) drops the PR when Show PR status is off or the row is archived.
 */
function rowEnvironmentText(session: SessionListItem, showPrStatus: boolean): string
{
	const name = session.terminalHost ?? (session.projectName || "Remote Control");
	const parts = [name, isLiveSessionState(session.state) ? "Connected" : "Offline"];
	if (showPrStatus && !session.archived && session.prStatus !== undefined)
	{
		parts.push(GIT_PR_STATE_LABELS[prGlyph(session.prStatus).state]);
	}
	return ` ${parts.join(" · ")}`;
}

/**
 * Upstream's `bridge` environment glyph (a local CLI is what upstream calls a Remote Control bridge):
 * a Laptop, or LaptopSlash with `data-env-offline` once a bridged CLI has gone offline.
 */
function BridgeEnvGlyph({offline}: {offline: boolean})
{
	return (
		<span aria-hidden="true" className="flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center">
			<Laptop
				data-env-glyph="bridge"
				data-env-offline={offline ? "" : undefined}
				className="size-4 shrink-0 text-muted-as-secondary"
			>
				{offline && <path d="m2 2 20 20" />}
			</Laptop>
		</span>
	);
}

/** A headless session's environment glyph: the app owns its CLI process, which runs in no terminal. */
function HeadlessEnvGlyph()
{
	return (
		<span aria-hidden="true" className="flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center">
			<Cpu data-env-glyph="headless" className="size-4 shrink-0 text-muted-as-secondary" />
		</span>
	);
}

/**
 * claude.ai/code's trailing sidebar-row decoration: the status mark (amber Awaiting input, blinking
 * muted Running, accent Unread response) or, on a settled row, the muted environment glyph, here
 * upstream's bridge laptop (omitted on pinned rows and under project grouping). It fades out while
 * the row is hovered, keyboard-focused or has its kebab menu open, when the row's More options button
 * takes the same 24px slot; an open context menu leaves it visible, as upstream. The mark is an aria-hidden `role=img`; screen readers get
 * `SidebarRowSrText` inside the title instead.
 */
export function SidebarRowDecoration({
	session,
	envGlyph,
	paneSelected,
}: {
	session: SessionListItem;
	envGlyph: boolean;
	/** The row is the open pane's, which is never unread. */
	paneSelected: boolean;
})
{
	const {kind} = useRowIconKind(session, paneSelected);
	const attention = useRowAttention(session, paneSelected);
	const mark = (
		<SessionStateIcon
			kind={kind}
			live={false}
			{...(kind === "ready"
				?
					{
						label: "Unread response",
					}
				: {})}
		/>
	);
	return (
		<span
			data-row-decoration=""
			aria-hidden="true"
			className="pointer-events-none absolute top-1/2 right-[var(--sb-row-ctl-inset)] flex size-[var(--sb-row-ctl,24px)] -translate-y-1/2 items-center justify-center group-hover/session-row:opacity-0 group-has-[:focus-visible]/session-row:opacity-0 group-data-[menu-open=true]/session-row:opacity-0"
		>
			{kind === "idle" ? (
				envGlyph &&
				(session.terminalHost === HEADLESS_HOST_LABEL ? (
					<HeadlessEnvGlyph />
				) : (
					<BridgeEnvGlyph offline={session.remoteControl === true && !isLiveSessionState(session.state)} />
				))
			) : (
				<span aria-hidden="true" className="flex items-center">
					{attention === undefined ? (
						mark
					) : (
						// Upstream `Oc`: a waiting or unread attention look wraps the mark once more.
						<span aria-hidden="true" className="flex items-center">
							{mark}
						</span>
					)}
				</span>
			)}
		</span>
	);
}

/**
 * Upstream skips a row's status announcement while it sits in an inert or aria-hidden subtree, or is
 * not visible (except below the fold, `[data-row-below]`).
 */
function rowAnnounceable(element: HTMLElement): boolean
{
	if (element.closest('[inert], [aria-hidden="true"]') !== null) return false;
	if (element.closest("[data-row-below]") !== null) return true;
	return (
		typeof element.checkVisibility !== "function" ||
		element.checkVisibility(
			{
				visibilityProperty: true,
			},
		)
	);
}

/** Upstream `hc`: end a title with a period unless it already ends a sentence. */
function asSentence(title: string): string
{
	return /[\p{Sentence_Terminal}\u2026:]["'\u201D\u2019)\]]*$/u.test(title) ? title : `${title}.`;
}

/**
 * Upstream's `L_` screen-reader text, rendered inside the row title so it joins the link's
 * accessible name: a status span (" Awaiting input", " Error", " Running", " Unread response"), unmounted
 * when the row has none, and the environment (" herdr · Connected", " claude-code-plans · Offline").
 * Status changes (never the first render) are read through the shared polite announcer, keyed per
 * session, after the row's title unless the row is the selected one (upstream `It`, shared-59).
 */
export function SidebarRowSrText({
	session,
	paneSelected,
	title,
}: {
	session: SessionListItem;
	paneSelected: boolean;
	title?: string;
})
{
	const {unseen, kind, showPrStatus} = useRowIconKind(session, paneSelected);
	const srClass = "sr-only [[role=tooltip]_&]:hidden";
	const status =
		(kind === "error" ? SR_ROW_ERROR_LABEL : SR_ROW_STATUS_LABELS[sessionMenuReadState(session.bucket, unseen)]) ||
		null;
	const statusRef = useRef<HTMLSpanElement>(null);
	const announced = useRef(status);
	const key = `session-status-${session.id}`;
	const spokenTitle = paneSelected ? undefined : title;
	useEffect(() =>
	{
		if (announced.current === status) return;
		announced.current = status;
		if (status === null)
		{
			clearAnnouncement(key);
			return;
		}
		const element = statusRef.current;
		if (element !== null && rowAnnounceable(element))
			announce(spokenTitle ? `${asSentence(spokenTitle)} ${status}` : status, key);
	}, [status, key, spokenTitle]);
	useEffect(
		() => () =>
		{
			clearAnnouncement(key);
		},
		[key],
	);
	return (
		<>
			{status !== null && (
				<span ref={statusRef} className={srClass} data-find-omitted="" data-session-status="">
					{` ${status}`}
				</span>
			)}
			<span className={srClass} data-find-omitted="">
				{rowEnvironmentText(session, showPrStatus)}
			</span>
		</>
	);
}
