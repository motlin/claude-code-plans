import type {SessionListItem} from "../../lib/api/sessions";
import type {PendingLaunchEntry} from "../../lib/pending-launch-store";
import type {SessionGroupRow} from "../../lib/session-groups";

export interface SidebarSessionRow extends SessionGroupRow
{
	id: string;
	session: SessionListItem;
	/** A launch this tab started whose session has no row yet: drawn as upstream's pending skeleton row. */
	pendingLaunch?: PendingLaunchEntry;
}

export function toGroupRow(session: SessionListItem): SidebarSessionRow
{
	return {
		session,
		id: session.id,
		sessionId: session.id,
		title: session.title,
		bucket: session.bucket,
		project: session.projectName,
		archived: session.archived,
		createdAt: Date.parse(session.created),
		lastActivityAt: Date.parse(session.mtime),
		forkedFromSessionId: session.forkedFromSessionId,
		live: session.state !== "ended",
	};
}

/** The synthetic Working row for a pending launch, keyed by the launch so it never remounts when herdr names it. */
export function toPendingLaunchRow(launch: PendingLaunchEntry): SidebarSessionRow
{
	const at = new Date(launch.since).toISOString();
	return {
		...toGroupRow(
			{
				id: launch.key,
				title: "",
				mtime: at,
				created: at,
				project: launch.projectId,
				projectName: launch.projectName,
				messageCount: 0,
				archived: false,
				state: "working",
				bucket: "working",
				liveAgentCount: 0,
				unseen: false,
				blockedSince: null,
			},
		),
		pendingLaunch: launch,
	};
}
