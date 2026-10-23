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
	const icon = <SessionStateIcon kind={kind} />;
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
				className={`flex cursor-pointer items-center justify-center rounded-full hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${TOUCH_HIT}`}
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
 * Upstream's `bridge` environment glyph (a local CLI is what upstream calls a Remote Control bridge):
 * a Laptop, or LaptopSlash with `data-env-offline` once a bridged CLI has gone offline.
 */
function BridgeEnvGlyph({offline}: {offline: boolean}) {
	return (
		<span aria-hidden="true" className="flex size-[var(--sb-row-ctl)] shrink-0 items-center justify-center">
			<Laptop
				data-env-glyph="bridge"
				data-env-offline={offline ? "" : undefined}
				className="size-4 shrink-0 text-ink-muted"
			>
				{offline && <path d="m2 2 20 20" />}
			</Laptop>
		</span>
	);
}

/**
 * claude.ai/code's trailing sidebar-row decoration: the status mark (amber Awaiting input, blinking
 * muted Running, accent Unread response) or, on a settled row, the muted environment glyph, here
 * upstream's bridge laptop (omitted on pinned rows and under project grouping). It fades out while the row is hovered, keyboard-focused or has
 * its menu open, when the row's More options button takes the same 24px slot. The glyph is
 * aria-hidden; screen readers get upstream's two sr-only siblings, a status and the environment.
 */
export function SidebarRowDecoration({session, envGlyph}: {session: SessionListItem; envGlyph: boolean}) {
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
					envGlyph && (
						<BridgeEnvGlyph
							offline={session.remoteControl === true && !isLiveSessionState(session.state)}
						/>
					)
				) : (
					<SessionStateIcon kind={kind} {...(kind === "ready" ? {label: "Unread response"} : {})} />
				)}
			</span>
			<span role="status" className={srClass}>
				{SR_ROW_STATUS_LABELS[sessionMenuReadState(session.bucket, unseen)]}
			</span>
			<span className={srClass}>{rowEnvironmentText(session)}</span>
		</>
	);
}
