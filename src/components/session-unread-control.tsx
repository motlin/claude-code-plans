import {Laptop} from "lucide-react";
import type {SessionListItem} from "../lib/api/sessions";
import {prGlyph} from "../lib/pr-status";
import {sessionEnvironment, sessionEnvironmentText} from "../lib/session-environment";
import {sessionMenuReadState, type SessionMenuReadState} from "../lib/session-menu-items";
import {isLiveSessionState, sessionRowIconKind} from "../lib/session-state";
import {TOUCH_HIT} from "../lib/touch-reveal";
import {toggleUnseen} from "../lib/unread-store";
import {useSettings} from "./settings-context";
import {GIT_PR_STATE_LABELS, SessionStateIcon} from "./status-dot";
import {Tooltip} from "./ui/tooltip";
import {useHasUnseenWork} from "./use-has-unseen-work";

/**
 * Upstream session row status dot. Awaiting and running glyphs carry a top tooltip, a read finished
 * row's glyph is a plain icon, and only the unread dot is a button that marks the row read
 * (the row menu's "Mark as unread" handles the other direction).
 */
export function SessionRowStatusDot({session, tabIndex}: {session: SessionListItem; tabIndex?: number}) {
	const unseen = useHasUnseenWork(session.id);
	const {settings} = useSettings();
	// The server bucket lags a manual toggle until the next summary arrives, so a finished
	// row's icon follows the local unseen flag.
	const kind = sessionRowIconKind({
		bucket: session.bucket,
		unseen,
		serverUnseen: session.unseen,
		prStatus: session.prStatus,
		showPrStatus: settings.sessionListPrefs.showPrStatus,
	});
	const readState = sessionMenuReadState(session.bucket, unseen);
	const icon = (
		<SessionStateIcon
			kind={kind}
			{...(kind === "pr" && session.prStatus !== undefined ? {pr: prGlyph(session.prStatus)} : {})}
		/>
	);
	if (readState === "working" || readState === "awaiting") {
		return <Tooltip content={readState === "awaiting" ? "Awaiting input" : "Running"}>{icon}</Tooltip>;
	}
	if (readState === "read") return icon;

	const label = "Click to mark as read";
	return (
		<Tooltip content={label}>
			<button
				type="button"
				{...(tabIndex === undefined ? {} : {tabIndex})}
				aria-label={label}
				className={`flex cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 ${TOUCH_HIT}`}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					toggleUnseen(session.id);
				}}
			>
				{icon}
			</button>
		</Tooltip>
	);
}

const SR_ROW_STATUS_LABELS = {
	working: "Running",
	awaiting: "Awaiting input",
	unread: "Unread response",
	read: "",
} satisfies Record<SessionMenuReadState, string>;

/**
 * Upstream's sr-only environment text: where the session runs (its terminal
 * host, or Local), its Remote Control status when bridged, then the PR state.
 */
function rowEnvironmentText(session: SessionListItem): string {
	const environment = sessionEnvironment({
		terminalHost: session.terminalHost ?? null,
		bridged: session.remoteControl === true,
		live: isLiveSessionState(session.state),
	});
	const parts = [sessionEnvironmentText(environment)];
	if (session.prStatus !== undefined) parts.push(GIT_PR_STATE_LABELS[prGlyph(session.prStatus).state]);
	return ` ${parts.join(" · ")}`;
}

/**
 * claude.ai/code's trailing sidebar-row decoration: the status mark (amber Awaiting input, blinking
 * muted Running, accent Unread response) or, on a settled row, the muted environment glyph, here
 * the laptop the local CLI runs on. It fades out while the row is hovered, keyboard-focused or has
 * its menu open, when the row's More options button takes the same 24px slot. The glyph is
 * aria-hidden; screen readers get upstream's two sr-only siblings, a status and the environment.
 */
export function SidebarRowDecoration({session}: {session: SessionListItem}) {
	const unseen = useHasUnseenWork(session.id);
	const {settings} = useSettings();
	const kind = sessionRowIconKind({
		bucket: session.bucket,
		unseen,
		serverUnseen: session.unseen,
		prStatus: session.prStatus,
		showPrStatus: settings.sessionListPrefs.showPrStatus,
	});
	const srClass = "sr-only [[role=tooltip]_&]:hidden";
	return (
		<>
			<span
				data-row-decoration=""
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 right-[var(--sb-row-ctl-inset)] flex size-[var(--sb-row-ctl,24px)] -translate-y-1/2 items-center justify-center group-hover/session-row:opacity-0 group-has-[:focus-visible]/session-row:opacity-0 group-has-[[data-popup-open]]/session-row:opacity-0"
			>
				{kind === "idle" ? (
					<span
						aria-hidden="true"
						data-env-glyph="local"
						className="flex size-full shrink-0 items-center justify-center"
					>
						<Laptop className="size-4 shrink-0 text-ink-muted" />
					</span>
				) : (
					<SessionStateIcon
						kind={kind}
						{...(kind === "ready" ? {label: "Unread response"} : {})}
						{...(kind === "pr" && session.prStatus !== undefined ? {pr: prGlyph(session.prStatus)} : {})}
					/>
				)}
			</span>
			<span role="status" className={srClass}>
				{SR_ROW_STATUS_LABELS[sessionMenuReadState(session.bucket, unseen)]}
			</span>
			<span className={srClass}>{rowEnvironmentText(session)}</span>
		</>
	);
}
